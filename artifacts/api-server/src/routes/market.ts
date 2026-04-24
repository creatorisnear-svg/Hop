import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { db, marketWatchesTable, marketPredictionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  predictMarket,
  fetchYahooQuote,
  fetchYahooCandles,
  fetchEarnings,
  chatAboutMarket,
  evaluatePrediction,
  computeIndicators,
} from "../lib/market";

// Tiny in-memory caches so a 1-second client poll doesn't hammer Yahoo.
const quoteCache = new Map<string, { ts: number; data: unknown }>();
const candleCache = new Map<string, { ts: number; data: unknown }>();
const indicatorCache = new Map<string, { ts: number; data: unknown }>();
const earningsCache = new Map<string, { ts: number; data: unknown }>();
const QUOTE_TTL_MS = 1500;
const CANDLE_TTL_MS = 30_000;
const INDICATOR_TTL_MS = 5 * 60_000;
const EARNINGS_TTL_MS = 30 * 60_000;   // 30 minutes — earnings barely change intraday

const router: IRouter = Router();

router.get("/market/watches", async (_req, res) => {
  const rows = await db
    .select()
    .from(marketWatchesTable)
    .orderBy(desc(marketWatchesTable.createdAt));
  res.json({ watches: rows });
});

router.post("/market/watches", async (req, res) => {
  const body = (req.body ?? {}) as {
    symbol?: string;
    name?: string;
    market?: string;
    notes?: string;
  };
  const symbol = (body.symbol ?? "").trim().toUpperCase();
  const name = (body.name ?? "").trim() || symbol;
  const market = (body.market ?? "stock").trim().toLowerCase();
  const notes = (body.notes ?? "").trim();

  if (!symbol) {
    return res.status(400).json({ error: "symbol is required" });
  }

  const id = randomUUID();
  const [row] = await db
    .insert(marketWatchesTable)
    .values({ id, symbol, name, market, notes })
    .returning();
  res.status(201).json({ watch: row });
});

router.delete("/market/watches/:id", async (req, res) => {
  const id = req.params.id;
  await db.delete(marketPredictionsTable).where(eq(marketPredictionsTable.watchId, id));
  await db.delete(marketWatchesTable).where(eq(marketWatchesTable.id, id));
  res.json({ ok: true });
});

router.get("/market/watches/:id/predictions", async (req, res) => {
  const id = req.params.id;
  const rows = await db
    .select()
    .from(marketPredictionsTable)
    .where(eq(marketPredictionsTable.watchId, id))
    .orderBy(desc(marketPredictionsTable.createdAt))
    .limit(50);

  // Fetch one live quote (cached) and reuse it to evaluate every prediction
  // for this watch.
  const symbol = rows[0]?.symbol;
  let currentPrice: number | null = null;
  if (symbol) {
    const cacheHit = quoteCache.get(symbol);
    if (cacheHit && Date.now() - cacheHit.ts < QUOTE_TTL_MS) {
      currentPrice = (cacheHit.data as { price?: number | null })?.price ?? null;
    } else {
      const q = await fetchYahooQuote(symbol);
      if (q) {
        quoteCache.set(symbol, { ts: Date.now(), data: q });
        currentPrice = q.price;
      }
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    evaluation: evaluatePrediction(
      {
        direction: r.direction,
        horizon: r.horizon,
        targetPrice: r.targetPrice ?? null,
        quote: r.quote as ReturnType<typeof JSON.parse> | null,
        createdAt: r.createdAt,
      },
      currentPrice,
    ),
  }));

  // Track-record summary: only count predictions whose horizon has elapsed.
  let total = 0;
  let correct = 0;
  const byDirection: Record<string, { total: number; correct: number }> = {
    BULLISH: { total: 0, correct: 0 },
    BEARISH: { total: 0, correct: 0 },
    NEUTRAL: { total: 0, correct: 0 },
  };
  const byAction: Record<string, { total: number; correct: number }> = {
    BUY_CALL: { total: 0, correct: 0 },
    BUY_PUT: { total: 0, correct: 0 },
    HOLD: { total: 0, correct: 0 },
  };
  let liveOnTrack = 0;
  let liveOffTrack = 0;
  let targetHits = 0;
  for (const p of enriched) {
    const s = p.evaluation.status;
    if (s === "TARGET_HIT") targetHits++;
    if (s === "ON_TRACK") liveOnTrack++;
    if (s === "OFF_TRACK") liveOffTrack++;
    const settled = s === "CORRECT" || s === "WRONG" || s === "TARGET_HIT";
    if (!settled) continue;
    total++;
    const ok = s === "CORRECT" || s === "TARGET_HIT";
    if (ok) correct++;
    const d = p.direction;
    if (byDirection[d]) {
      byDirection[d].total++;
      if (ok) byDirection[d].correct++;
    }
    const a = p.action ?? "HOLD";
    if (byAction[a]) {
      byAction[a].total++;
      if (ok) byAction[a].correct++;
    }
  }
  const trackRecord = {
    total,
    correct,
    accuracy: total ? correct / total : null,
    byDirection,
    byAction,
    live: { onTrack: liveOnTrack, offTrack: liveOffTrack, targetHits },
    currentPrice,
  };

  res.json({ predictions: enriched, trackRecord });
});

router.post("/market/watches/:id/predict", async (req, res) => {
  const id = req.params.id;
  const horizonInput = (req.body?.horizon as string | undefined)?.trim() || "1w";
  const horizon = ["1d", "1w", "1m", "3m"].includes(horizonInput) ? horizonInput : "1w";

  const [watch] = await db
    .select()
    .from(marketWatchesTable)
    .where(eq(marketWatchesTable.id, id))
    .limit(1);
  if (!watch) return res.status(404).json({ error: "watch not found" });

  try {
    const result = await predictMarket({
      symbol: watch.symbol,
      name: watch.name,
      market: watch.market,
      horizon,
      notes: watch.notes,
    });

    const predictionId = randomUUID();
    const [row] = await db
      .insert(marketPredictionsTable)
      .values({
        id: predictionId,
        watchId: id,
        symbol: watch.symbol,
        horizon: result.horizon,
        direction: result.direction,
        confidence: result.confidence,
        summary: result.summary,
        reasoning: result.reasoning,
        headlines: result.headlines,
        quote: result.quote,
        action: result.action,
        strikeHint: result.strikeHint,
        expiryHint: result.expiryHint,
        entryTrigger: result.entryTrigger,
        riskNote: result.riskNote,
        targetPrice: result.targetPrice,
        bullCase: result.bullCase,
        bearCase: result.bearCase,
        keyDrivers: result.keyDrivers,
        nextCatalysts: result.nextCatalysts,
        earnings: result.earnings,
        model: result.model,
        durationMs: result.durationMs,
      })
      .returning();
    res.json({ prediction: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, watchId: id }, "predict failed");
    res.status(500).json({ error: msg });
  }
});

// Stock / asset search — wraps Yahoo's free search endpoint so the user can
// type a name like "apple" or "tesla" instead of having to know the ticker.
// When Yahoo is rate-limiting / blocking us we fall back to SEC EDGAR's
// company-tickers file (US stocks/ETFs only) plus a small built-in list of
// popular crypto / forex pairs so the search box stays useful.
const searchCache = new Map<string, { ts: number; data: unknown }>();
const SEARCH_TTL_MS = 5 * 60_000;

type SearchResult = {
  symbol: string;
  name: string;
  market: string;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
};

let secTickers: Array<{ ticker: string; title: string }> | null = null;
let secTickersAt = 0;
const SEC_TICKERS_TTL_MS = 24 * 60 * 60_000;
async function loadSecTickers(): Promise<Array<{ ticker: string; title: string }>> {
  if (secTickers && Date.now() - secTickersAt < SEC_TICKERS_TTL_MS) return secTickers;
  try {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "user-agent": "NeuroLinkedBrain support@neurolinked.local" },
    });
    if (!r.ok) return secTickers ?? [];
    const data = (await r.json()) as Record<string, { ticker: string; title: string }>;
    secTickers = Object.values(data).map((v) => ({
      ticker: String(v.ticker).toUpperCase(),
      title: String(v.title),
    }));
    secTickersAt = Date.now();
    return secTickers;
  } catch {
    return secTickers ?? [];
  }
}

const POPULAR_CRYPTO_FOREX: SearchResult[] = [
  { symbol: "BTC-USD", name: "Bitcoin USD", market: "crypto", exchange: "CCC", sector: null, industry: null },
  { symbol: "ETH-USD", name: "Ethereum USD", market: "crypto", exchange: "CCC", sector: null, industry: null },
  { symbol: "SOL-USD", name: "Solana USD", market: "crypto", exchange: "CCC", sector: null, industry: null },
  { symbol: "DOGE-USD", name: "Dogecoin USD", market: "crypto", exchange: "CCC", sector: null, industry: null },
  { symbol: "XRP-USD", name: "XRP USD", market: "crypto", exchange: "CCC", sector: null, industry: null },
  { symbol: "ADA-USD", name: "Cardano USD", market: "crypto", exchange: "CCC", sector: null, industry: null },
  { symbol: "BNB-USD", name: "BNB USD", market: "crypto", exchange: "CCC", sector: null, industry: null },
  { symbol: "AVAX-USD", name: "Avalanche USD", market: "crypto", exchange: "CCC", sector: null, industry: null },
  { symbol: "MATIC-USD", name: "Polygon USD", market: "crypto", exchange: "CCC", sector: null, industry: null },
  { symbol: "LINK-USD", name: "Chainlink USD", market: "crypto", exchange: "CCC", sector: null, industry: null },
  { symbol: "EURUSD=X", name: "EUR/USD", market: "forex", exchange: "FX", sector: null, industry: null },
  { symbol: "GBPUSD=X", name: "GBP/USD", market: "forex", exchange: "FX", sector: null, industry: null },
  { symbol: "USDJPY=X", name: "USD/JPY", market: "forex", exchange: "FX", sector: null, industry: null },
  { symbol: "USDCAD=X", name: "USD/CAD", market: "forex", exchange: "FX", sector: null, industry: null },
  { symbol: "AUDUSD=X", name: "AUD/USD", market: "forex", exchange: "FX", sector: null, industry: null },
  { symbol: "^GSPC", name: "S&P 500", market: "index", exchange: "SNP", sector: null, industry: null },
  { symbol: "^IXIC", name: "NASDAQ Composite", market: "index", exchange: "NIM", sector: null, industry: null },
  { symbol: "^DJI", name: "Dow Jones Industrial Average", market: "index", exchange: "DJI", sector: null, industry: null },
  { symbol: "^RUT", name: "Russell 2000", market: "index", exchange: "RUT", sector: null, industry: null },
  { symbol: "GC=F", name: "Gold Futures", market: "commodity", exchange: "CMX", sector: null, industry: null },
  { symbol: "CL=F", name: "Crude Oil Futures", market: "commodity", exchange: "NYM", sector: null, industry: null },
];

async function searchFallback(q: string): Promise<SearchResult[]> {
  const needle = q.toLowerCase();
  const out: SearchResult[] = [];
  for (const e of POPULAR_CRYPTO_FOREX) {
    if (e.symbol.toLowerCase().includes(needle) || e.name.toLowerCase().includes(needle)) {
      out.push(e);
    }
  }
  const tickers = await loadSecTickers();
  const exact = tickers.filter((t) => t.ticker.toLowerCase() === needle);
  const startsTicker = tickers.filter((t) => t.ticker.toLowerCase().startsWith(needle) && !exact.includes(t));
  const startsTitle = tickers.filter(
    (t) => t.title.toLowerCase().startsWith(needle) && !exact.includes(t) && !startsTicker.includes(t),
  );
  const containsTitle = tickers.filter(
    (t) =>
      t.title.toLowerCase().includes(needle) &&
      !exact.includes(t) &&
      !startsTicker.includes(t) &&
      !startsTitle.includes(t),
  );
  for (const t of [...exact, ...startsTicker, ...startsTitle, ...containsTitle].slice(0, 10)) {
    out.push({
      symbol: t.ticker,
      name: t.title.replace(/\s+/g, " ").trim(),
      market: "stock",
      exchange: null,
      sector: null,
      industry: null,
    });
  }
  return out.slice(0, 10);
}
router.get("/market/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json({ results: [] });
  const key = q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < SEARCH_TTL_MS) return res.json(hit.data);
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
  const hosts = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];
  let r: Response | null = null;
  let lastStatus = 0;
  outer: for (let attempt = 0; attempt < 3; attempt++) {
    for (const host of hosts) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        r = await fetch(
          `https://${host}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`,
          {
            signal: ctrl.signal,
            headers: {
              "user-agent": ua,
              accept: "application/json,text/plain,*/*",
              "accept-language": "en-US,en;q=0.9",
              referer: "https://finance.yahoo.com/",
            },
          },
        );
        clearTimeout(t);
        lastStatus = r.status;
        if (r.ok) break outer;
      } catch {
        /* try next */
      }
    }
    await new Promise((rs) => setTimeout(rs, 400 * (attempt + 1)));
  }
  try {
    if (!r || !r.ok) {
      logger.warn({ q, status: lastStatus }, "yahoo search failed, using SEC fallback");
      const results = await searchFallback(q);
      const payload = { results, source: "fallback" };
      if (results.length) searchCache.set(key, { ts: Date.now(), data: payload });
      return res.json(payload);
    }
    const data = (await r.json()) as {
      quotes?: Array<{
        symbol?: string;
        shortname?: string;
        longname?: string;
        quoteType?: string;
        exchDisp?: string;
        sector?: string;
        industry?: string;
      }>;
    };
    const typeMap: Record<string, string> = {
      EQUITY: "stock",
      ETF: "etf",
      CRYPTOCURRENCY: "crypto",
      INDEX: "index",
      CURRENCY: "forex",
      MUTUALFUND: "etf",
    };
    const results = (data.quotes ?? [])
      .filter((q) => q.symbol)
      .map((qt) => ({
        symbol: qt.symbol!,
        name: qt.longname || qt.shortname || qt.symbol!,
        market: typeMap[qt.quoteType ?? ""] ?? "stock",
        exchange: qt.exchDisp ?? null,
        sector: qt.sector ?? null,
        industry: qt.industry ?? null,
      }))
      .slice(0, 10);
    const payload = { results };
    searchCache.set(key, { ts: Date.now(), data: payload });
    res.json(payload);
  } catch (err) {
    logger.warn({ err, q }, "search error");
    res.json({ results: [] });
  }
});

router.get("/market/quote/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const now = Date.now();
  const hit = quoteCache.get(symbol);
  if (hit && now - hit.ts < QUOTE_TTL_MS) {
    return res.json({ quote: hit.data });
  }
  const quote = await fetchYahooQuote(symbol);
  if (!quote) return res.status(404).json({ error: "quote unavailable" });
  quoteCache.set(symbol, { ts: now, data: quote });
  res.json({ quote });
});

router.get("/market/indicators/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const now = Date.now();
  const hit = indicatorCache.get(symbol);
  if (hit && now - hit.ts < INDICATOR_TTL_MS) {
    return res.json({ indicators: hit.data });
  }
  const series = await fetchYahooCandles(symbol, "1d", "1y");
  if (!series) return res.status(404).json({ error: "indicators unavailable" });
  const closes = series.candles.map((c) => c.c);
  const indicators = computeIndicators(symbol, closes);
  indicatorCache.set(symbol, { ts: now, data: indicators });
  res.json({ indicators });
});

router.get("/market/earnings/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const now = Date.now();
  const hit = earningsCache.get(symbol);
  if (hit && now - hit.ts < EARNINGS_TTL_MS) {
    return res.json({ earnings: hit.data });
  }
  const earnings = await fetchEarnings(symbol);
  earningsCache.set(symbol, { ts: now, data: earnings });
  res.json({ earnings });
});

router.post("/market/watches/:id/chat", async (req, res) => {
  const id = req.params.id;
  const body = (req.body ?? {}) as {
    message?: string;
    history?: Array<{ role?: string; content?: string }>;
  };
  const userMessage = String(body.message ?? "").trim();
  if (!userMessage) {
    return res.status(400).json({ error: "message is required" });
  }
  const [watch] = await db
    .select()
    .from(marketWatchesTable)
    .where(eq(marketWatchesTable.id, id))
    .limit(1);
  if (!watch) return res.status(404).json({ error: "watch not found" });

  const history = (body.history ?? [])
    .filter((m): m is { role: string; content: string } =>
      typeof m?.content === "string" && (m.role === "user" || m.role === "assistant"),
    )
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  try {
    const result = await chatAboutMarket(
      {
        symbol: watch.symbol,
        name: watch.name,
        market: watch.market,
        notes: watch.notes,
      },
      history,
      userMessage,
    );
    res.json({
      reply: { role: "assistant", content: result.reply },
      model: result.model,
      durationMs: result.durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, watchId: id }, "market chat failed");
    res.status(500).json({ error: msg });
  }
});

router.get("/market/candles/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const interval = String(req.query.interval ?? "5m");
  const range = String(req.query.range ?? "1d");
  const cacheKey = `${symbol}|${interval}|${range}`;
  const now = Date.now();
  const hit = candleCache.get(cacheKey);
  if (hit && now - hit.ts < CANDLE_TTL_MS) {
    return res.json({ series: hit.data });
  }
  const series = await fetchYahooCandles(symbol, interval, range);
  if (!series) return res.status(404).json({ error: "candles unavailable" });
  candleCache.set(cacheKey, { ts: now, data: series });
  res.json({ series });
});

export default router;
