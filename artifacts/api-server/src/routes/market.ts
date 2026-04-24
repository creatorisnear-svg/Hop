import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  db,
  marketWatchesTable,
  marketPredictionsTable,
  marketUserTradesTable,
} from "@workspace/db";
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
import { runBacktest } from "../lib/marketBacktest";

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
    // Allow caller to override (1..5). Default bumped to 5 — gives us full
    // temperature spread (0.1 → 0.7) so consensus is statistically tighter.
    const ensembleRaw = Number(req.body?.ensemble);
    const ensemble = Number.isFinite(ensembleRaw)
      ? Math.max(1, Math.min(5, Math.floor(ensembleRaw)))
      : 5;

    // ── Self-calibration: feed the model its own recent track record ─────
    // Pull the last 20 predictions on this watch, evaluate each against the
    // live quote, and pass them as `pastResults` so the model can spot its
    // own biases ("I overcall BULLISH on this ticker — tone confidence down").
    const recent = await db
      .select()
      .from(marketPredictionsTable)
      .where(eq(marketPredictionsTable.watchId, id))
      .orderBy(desc(marketPredictionsTable.createdAt))
      .limit(20);
    let livePrice: number | null = null;
    const cacheHit = quoteCache.get(watch.symbol);
    if (cacheHit && Date.now() - cacheHit.ts < QUOTE_TTL_MS) {
      livePrice = (cacheHit.data as { price?: number | null })?.price ?? null;
    } else {
      const q = await fetchYahooQuote(watch.symbol);
      if (q) {
        quoteCache.set(watch.symbol, { ts: Date.now(), data: q });
        livePrice = q.price;
      }
    }
    const pastResults = recent.map((p) => {
      const evalResult = evaluatePrediction(
        {
          direction: p.direction,
          horizon: p.horizon,
          targetPrice: p.targetPrice ?? null,
          quote: p.quote as ReturnType<typeof JSON.parse> | null,
          createdAt: p.createdAt,
        },
        livePrice,
      );
      const daysAgo = Math.max(0, Math.round((Date.now() - new Date(p.createdAt).getTime()) / 86_400_000));
      return {
        direction: p.direction,
        action: p.action ?? null,
        horizon: p.horizon,
        confidence: typeof p.confidence === "number" ? p.confidence : null,
        status: evalResult.status,
        deltaPct: evalResult.deltaPct,
        daysAgo,
      };
    });

    const result = await predictMarket({
      symbol: watch.symbol,
      name: watch.name,
      market: watch.market,
      horizon,
      notes: watch.notes,
      ensemble,
      pastResults,
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

// ─── USER TRADE TRACKING ─────────────────────────────────────────────────
// When the user clicks "I took this trade" we record an entry so we can
// continue showing live P/L even after the prediction itself rolls off the
// active list.
type EnrichedTrade = {
  id: string;
  watchId: string;
  predictionId: string | null;
  symbol: string;
  action: string;
  entryPrice: number;
  targetPrice: number | null;
  horizon: string;
  strikeHint: string;
  expiryHint: string;
  quantity: number;
  notes: string;
  status: string;
  closePrice: number | null;
  closedAt: Date | null;
  openedAt: Date;
  // Computed fields
  livePrice: number | null;
  pnlPct: number | null;            // signed % move from entry, oriented to the trade direction
  pnlAbs: number | null;            // signed absolute move (livePrice - entryPrice), direction-aware
  targetProgressPct: number | null; // 0..100 — how far from entry to target the price has traveled
  reachedTarget: boolean;
};

async function enrichTradeWithLive(row: typeof marketUserTradesTable.$inferSelect): Promise<EnrichedTrade> {
  let livePrice: number | null = null;
  if (row.status === "OPEN") {
    const cacheKey = row.symbol.toUpperCase();
    const now = Date.now();
    const hit = quoteCache.get(cacheKey);
    if (hit && now - hit.ts < QUOTE_TTL_MS) {
      const q = hit.data as { price: number | null } | null;
      livePrice = q?.price ?? null;
    } else {
      const q = await fetchYahooQuote(row.symbol);
      if (q) {
        quoteCache.set(cacheKey, { ts: now, data: q });
        livePrice = q.price ?? null;
      }
    }
  } else {
    livePrice = row.closePrice;
  }
  let pnlPct: number | null = null;
  let pnlAbs: number | null = null;
  let targetProgressPct: number | null = null;
  let reachedTarget = false;
  if (livePrice != null && row.entryPrice) {
    const rawPct = ((livePrice - row.entryPrice) / row.entryPrice) * 100;
    const sign = row.action === "BUY_PUT" ? -1 : 1;
    pnlPct = rawPct * sign;
    pnlAbs = (livePrice - row.entryPrice) * sign;
    if (row.targetPrice && row.targetPrice !== row.entryPrice) {
      const total = row.targetPrice - row.entryPrice;
      const moved = livePrice - row.entryPrice;
      const ratio = total === 0 ? 0 : moved / total;
      targetProgressPct = Math.max(0, Math.min(150, ratio * 100));
      reachedTarget = sign > 0
        ? livePrice >= row.targetPrice
        : livePrice <= row.targetPrice;
    }
  }
  return {
    ...row,
    livePrice,
    pnlPct,
    pnlAbs,
    targetProgressPct,
    reachedTarget,
  };
}

router.get("/market/trades", async (req, res) => {
  const status = (req.query.status as string | undefined)?.toUpperCase();
  const watchId = req.query.watchId as string | undefined;
  let q = db.select().from(marketUserTradesTable).$dynamic();
  if (watchId) q = q.where(eq(marketUserTradesTable.watchId, watchId));
  const rows = await q.orderBy(desc(marketUserTradesTable.openedAt)).limit(200);
  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  const enriched = await Promise.all(filtered.map(enrichTradeWithLive));
  res.json({ trades: enriched });
});

router.post("/market/trades", async (req, res) => {
  const body = (req.body ?? {}) as {
    watchId?: string;
    predictionId?: string | null;
    symbol?: string;
    action?: string;
    entryPrice?: number;
    targetPrice?: number | null;
    horizon?: string;
    strikeHint?: string;
    expiryHint?: string;
    quantity?: number;
    notes?: string;
  };
  const watchId = (body.watchId ?? "").trim();
  const symbol = (body.symbol ?? "").trim().toUpperCase();
  const action = (body.action ?? "").trim().toUpperCase();
  if (!watchId || !symbol) return res.status(400).json({ error: "watchId and symbol are required" });
  if (action !== "BUY_CALL" && action !== "BUY_PUT") {
    return res.status(400).json({ error: "action must be BUY_CALL or BUY_PUT" });
  }
  // Use supplied entryPrice if present (so the user can lock in the exact
  // price they saw on screen). Otherwise fall back to the live quote.
  let entryPrice = Number(body.entryPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    const q = await fetchYahooQuote(symbol);
    if (!q?.price) return res.status(400).json({ error: "could not resolve entry price — supply entryPrice" });
    entryPrice = q.price;
  }
  const id = randomUUID();
  const [row] = await db
    .insert(marketUserTradesTable)
    .values({
      id,
      watchId,
      predictionId: body.predictionId ?? null,
      symbol,
      action,
      entryPrice,
      targetPrice: body.targetPrice ?? null,
      horizon: (body.horizon ?? "1w").trim() || "1w",
      strikeHint: (body.strikeHint ?? "").trim(),
      expiryHint: (body.expiryHint ?? "").trim(),
      quantity: Number.isFinite(Number(body.quantity)) ? Number(body.quantity) : 1,
      notes: (body.notes ?? "").trim(),
    })
    .returning();
  const enriched = await enrichTradeWithLive(row);
  res.status(201).json({ trade: enriched });
});

router.post("/market/trades/:id/close", async (req, res) => {
  const id = req.params.id;
  const [trade] = await db
    .select()
    .from(marketUserTradesTable)
    .where(eq(marketUserTradesTable.id, id))
    .limit(1);
  if (!trade) return res.status(404).json({ error: "trade not found" });
  if (trade.status === "CLOSED") {
    const enriched = await enrichTradeWithLive(trade);
    return res.json({ trade: enriched });
  }
  let closePrice = Number(req.body?.closePrice);
  if (!Number.isFinite(closePrice) || closePrice <= 0) {
    const q = await fetchYahooQuote(trade.symbol);
    if (!q?.price) return res.status(400).json({ error: "could not resolve close price" });
    closePrice = q.price;
  }
  const [updated] = await db
    .update(marketUserTradesTable)
    .set({ status: "CLOSED", closePrice, closedAt: new Date() })
    .where(eq(marketUserTradesTable.id, id))
    .returning();
  const enriched = await enrichTradeWithLive(updated);
  res.json({ trade: enriched });
});

router.delete("/market/trades/:id", async (req, res) => {
  await db.delete(marketUserTradesTable).where(eq(marketUserTradesTable.id, req.params.id));
  res.json({ ok: true });
});

// ── Predictor Backtest ────────────────────────────────────────────────────────
// Replays the indicator+scoring pipeline over the last N trading days without
// calling the LLM (deterministic), then measures the hit-rate per direction and
// per horizon so the user can validate the signal before trading real money.
const backtestCache = new Map<string, { ts: number; data: unknown }>();
const BACKTEST_TTL_MS = 10 * 60_000; // 10 min cache

router.post("/market/watches/:id/backtest", async (req, res) => {
  const id = req.params.id;
  const [watch] = await db
    .select()
    .from(marketWatchesTable)
    .where(eq(marketWatchesTable.id, id))
    .limit(1);
  if (!watch) return res.status(404).json({ error: "watch not found" });

  const horizonInput = (req.body?.horizon as string | undefined)?.trim() || "1w";
  const horizon = ["1d", "1w", "1m", "3m"].includes(horizonInput) ? horizonInput : "1w";
  const lookbackRaw = Number(req.body?.lookback);
  const lookback = Number.isFinite(lookbackRaw) ? Math.max(10, Math.min(60, Math.floor(lookbackRaw))) : 30;

  const cacheKey = `${watch.symbol}:${horizon}:${lookback}`;
  const cached = backtestCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < BACKTEST_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const result = await runBacktest(watch.symbol, horizon, lookback);
    const payload = { backtest: result };
    backtestCache.set(cacheKey, { ts: Date.now(), data: payload });
    res.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, watchId: id, symbol: watch.symbol }, "backtest failed");
    res.status(500).json({ error: msg });
  }
});

export default router;
