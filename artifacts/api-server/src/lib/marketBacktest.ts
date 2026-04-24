import { fetchYahooCandles } from "./market";
import { computeIndicators } from "./market";
import { logger } from "./logger";

export type BacktestDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type BacktestOutcome = "CORRECT" | "WRONG" | "SKIP";

export interface BacktestBar {
  date: string;
  entryPrice: number;
  exitPrice: number | null;
  predictedDirection: BacktestDirection;
  confidence: number;
  score: number;
  actualChangePct: number | null;
  outcome: BacktestOutcome;
  horizonDays: number;
}

export interface BacktestResult {
  symbol: string;
  horizon: string;
  lookback: number;
  bars: BacktestBar[];
  summary: {
    total: number;
    correct: number;
    wrong: number;
    skipped: number;
    hitRate: number | null;
    byDirection: Record<BacktestDirection, { total: number; correct: number; hitRate: number | null }>;
    avgConfidence: number | null;
    avgWinPct: number | null;
    avgLossPct: number | null;
  };
  fetchedAt: string;
}

const HORIZON_TRADING_DAYS: Record<string, number> = {
  "1d": 1,
  "1w": 5,
  "1m": 21,
  "3m": 63,
};

/**
 * Deterministically score indicators and derive a direction the same way the
 * LLM prompt steps A-E work, but without any model calls.  This lets us replay
 * the indicator pipeline over historical windows and measure hit-rate cheaply.
 */
function scoreIndicators(
  ind: ReturnType<typeof computeIndicators>,
): { direction: BacktestDirection; confidence: number; score: number } {
  let score = 0;

  // Trend (multi-timeframe trendScore is already -3..+3)
  const ts = ind.trendScore ?? 0;
  score += ts;

  // Momentum — RSI
  const rsi = ind.rsi14;
  if (rsi != null) {
    if (rsi >= 65) score += 2;
    else if (rsi >= 55) score += 1;
    else if (rsi <= 35) score -= 2;
    else if (rsi <= 45) score -= 1;
  }

  // Momentum — MACD histogram direction
  if (ind.macdHist != null) {
    if (ind.macdHist > 0) score += 1;
    else score -= 1;
  }

  // Momentum — 5d price change
  const c5 = ind.change5d;
  if (c5 != null) {
    if (c5 > 3) score += 1;
    else if (c5 < -3) score -= 1;
  }

  // Mean-reversion risk (high RSI → bearish pressure; low RSI → bullish bounce)
  if (rsi != null) {
    if (rsi >= 75) score -= 1;
    else if (rsi <= 25) score += 1;
  }

  // Bollinger position — price near/outside upper band is overbought
  if (ind.bbUpper != null && ind.bbLower != null && ind.price != null) {
    const range = ind.bbUpper - ind.bbLower;
    if (range > 0) {
      const pos = (ind.price - ind.bbLower) / range; // 0..1
      if (pos > 1.0) score -= 1;
      else if (pos < 0.0) score += 1;
    }
  }

  // Weekly timeframe confirmation (+/- 1)
  if (ind.weeklyTrendTag === "weekly bull") score += 1;
  else if (ind.weeklyTrendTag === "weekly bear") score -= 1;

  // Stochastic
  if (ind.stochK14 != null) {
    if (ind.stochK14 >= 80) score -= 0.5;
    else if (ind.stochK14 <= 20) score += 0.5;
  }

  let direction: BacktestDirection;
  if (score >= 2) direction = "BULLISH";
  else if (score <= -2) direction = "BEARISH";
  else direction = "NEUTRAL";

  const confidence = Math.min(0.92, Math.max(0.4, 0.4 + 0.07 * Math.abs(score)));

  return { direction, confidence, score };
}

/**
 * Run the indicator+rules pipeline over the last `lookback` trading days and
 * measure hit-rate per direction and per horizon.
 *
 * We fetch 1.5y of daily closes, then for each test date:
 *   1. Compute indicators on the slice up to that date.
 *   2. Score the indicators → direction.
 *   3. Check the actual close N trading days later.
 *   4. Mark CORRECT / WRONG / SKIP (SKIP when we don't have enough forward bars).
 */
export async function runBacktest(
  symbol: string,
  horizon: string,
  lookback = 30,
): Promise<BacktestResult> {
  const fwdDays = HORIZON_TRADING_DAYS[horizon] ?? 5;

  // Need plenty of history: 200-bar indicator warmup + 30 lookback + fwd bars.
  // "2y" daily gives us ~500 bars which is more than enough.
  const series = await fetchYahooCandles(symbol, "1d", "2y");
  if (!series || series.candles.length < 60) {
    throw new Error(`Not enough historical data for ${symbol} to run backtest`);
  }

  const closes = series.candles.map((c) => c.c);
  const volumes = series.candles.map((c) => c.v);
  const dates = series.candles.map((c) => new Date(c.t).toISOString().slice(0, 10));
  const n = closes.length;

  // We test each of the last `lookback` completed trading days (not including
  // the very last bar, which may be "today" still in-session).
  const testStartIdx = Math.max(60, n - lookback - fwdDays - 1);
  const testEndIdx = n - fwdDays - 1; // last bar with enough forward history

  if (testEndIdx < testStartIdx) {
    throw new Error(`Not enough forward bars for horizon ${horizon} — try a shorter horizon or longer range`);
  }

  const bars: BacktestBar[] = [];

  for (let i = testStartIdx; i <= testEndIdx; i++) {
    const sliceCloses = closes.slice(0, i + 1);
    const sliceVols = volumes.slice(0, i + 1) as (number | null | undefined)[];

    const ind = computeIndicators(symbol, sliceCloses, { dailyVolumes: sliceVols });
    const { direction, confidence, score } = scoreIndicators(ind);

    const entryPrice = closes[i];
    const exitIdx = i + fwdDays;
    const exitPrice = exitIdx < n ? closes[exitIdx] : null;
    const actualChangePct =
      exitPrice != null ? ((exitPrice - entryPrice) / entryPrice) * 100 : null;

    let outcome: BacktestOutcome = "SKIP";
    if (actualChangePct != null) {
      const noise = 0.5;
      let correct: boolean;
      if (direction === "BULLISH") correct = actualChangePct > noise;
      else if (direction === "BEARISH") correct = actualChangePct < -noise;
      else correct = Math.abs(actualChangePct) <= 2;
      outcome = correct ? "CORRECT" : "WRONG";
    }

    bars.push({
      date: dates[i],
      entryPrice,
      exitPrice,
      predictedDirection: direction,
      confidence,
      score,
      actualChangePct,
      outcome,
      horizonDays: fwdDays,
    });
  }

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const settled = bars.filter((b) => b.outcome !== "SKIP");
  const correct = settled.filter((b) => b.outcome === "CORRECT");
  const wrong = settled.filter((b) => b.outcome === "WRONG");

  const byDirection: BacktestResult["summary"]["byDirection"] = {
    BULLISH: { total: 0, correct: 0, hitRate: null },
    BEARISH: { total: 0, correct: 0, hitRate: null },
    NEUTRAL: { total: 0, correct: 0, hitRate: null },
  };
  for (const b of settled) {
    const d = b.predictedDirection;
    byDirection[d].total++;
    if (b.outcome === "CORRECT") byDirection[d].correct++;
  }
  for (const d of ["BULLISH", "BEARISH", "NEUTRAL"] as const) {
    const rec = byDirection[d];
    rec.hitRate = rec.total > 0 ? rec.correct / rec.total : null;
  }

  const confs = settled.map((b) => b.confidence);
  const avgConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;

  const winPcts = correct.map((b) => Math.abs(b.actualChangePct!));
  const lossPcts = wrong.map((b) => Math.abs(b.actualChangePct!));
  const avgWinPct = winPcts.length ? winPcts.reduce((a, b) => a + b, 0) / winPcts.length : null;
  const avgLossPct = lossPcts.length ? lossPcts.reduce((a, b) => a + b, 0) / lossPcts.length : null;

  logger.info(
    { symbol, horizon, lookback, total: settled.length, correct: correct.length },
    "backtest complete",
  );

  return {
    symbol,
    horizon,
    lookback,
    bars,
    summary: {
      total: settled.length,
      correct: correct.length,
      wrong: wrong.length,
      skipped: bars.length - settled.length,
      hitRate: settled.length > 0 ? correct.length / settled.length : null,
      byDirection,
      avgConfidence,
      avgWinPct,
      avgLossPct,
    },
    fetchedAt: new Date().toISOString(),
  };
}
