import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { db, marketWatchesTable, marketPredictionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  predictMarket,
  fetchYahooQuote,
  fetchYahooCandles,
  evaluatePrediction,
  computeIndicators,
} from "../lib/market";

// Tiny in-memory caches so a 1-second client poll doesn't hammer Yahoo.
const quoteCache = new Map<string, { ts: number; data: unknown }>();
const candleCache = new Map<string, { ts: number; data: unknown }>();
const indicatorCache = new Map<string, { ts: number; data: unknown }>();
const QUOTE_TTL_MS = 1500;
const CANDLE_TTL_MS = 30_000;
const INDICATOR_TTL_MS = 5 * 60_000;

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
