import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { db, marketWatchesTable, marketPredictionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { predictMarket, fetchYahooQuote } from "../lib/market";

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
  res.json({ predictions: rows });
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
  const quote = await fetchYahooQuote(req.params.symbol.toUpperCase());
  if (!quote) return res.status(404).json({ error: "quote unavailable" });
  res.json({ quote });
});

export default router;
