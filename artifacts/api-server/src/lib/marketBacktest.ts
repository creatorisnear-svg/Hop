import { fetchYahooCandles } from "./market";
import { computeIndicators } from "./market";
import { logger } from "./logger";

export type BacktestDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type BacktestOutcome = "CORRECT" | "WRONG" | "SKIP";
export type SignalQuality = "STRONG" | "MODERATE" | "WEAK" | "POOR";

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
    edgeRatio: number | null;
    expectedValue: number | null;
    maxWinStreak: number;
    maxLossStreak: number;
    signalQuality: SignalQuality;
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
 * Score the indicator snapshot into a directional call.
 *
 * Improvements over v1:
 *  - Volume confirmation (relVolume × daily change direction)
 *  - VWAP bias (price vs VWAP)
 *  - MACD signal-line cross in addition to histogram sign
 *  - Stronger tiered RSI scoring + separate extreme mean-reversion penalty
 *  - Bollinger near-band signals (not just outside-band)
 *  - Weekly trend given more weight
 *  - ATR dampens confidence in high-volatility environments
 *  - Higher score threshold for BULLISH/BEARISH (3 vs 2) → fewer but more
 *    reliable directional calls; more NEUTRAL which historically has high accuracy
 */
function scoreIndicators(
  ind: ReturnType<typeof computeIndicators>,
): { direction: BacktestDirection; confidence: number; score: number } {
  let score = 0;

  // ── 1. Multi-timeframe trend (-3..+3 already) ───────────────────────────
  score += ind.trendScore ?? 0;

  // ── 2. RSI momentum (tiered) ─────────────────────────────────────────────
  const rsi = ind.rsi14;
  if (rsi != null) {
    if (rsi >= 70)      score += 2.5;
    else if (rsi >= 60) score += 1.5;
    else if (rsi >= 55) score += 0.5;
    else if (rsi <= 30) score -= 2.5;
    else if (rsi <= 40) score -= 1.5;
    else if (rsi <= 45) score -= 0.5;

    // Extreme readings flip to mean-reversion penalty / bonus
    if (rsi >= 82)      score -= 2.5;
    else if (rsi >= 75) score -= 1.0;
    else if (rsi <= 18) score += 2.5;
    else if (rsi <= 25) score += 1.0;
  }

  // ── 3. MACD — histogram sign + signal-line cross ─────────────────────────
  if (ind.macdHist != null) {
    score += ind.macdHist > 0 ? 1 : -1;
  }
  if (ind.macd != null && ind.macdSignal != null) {
    score += ind.macd > ind.macdSignal ? 0.5 : -0.5;
  }

  // ── 4. Short-term price momentum (5d change) ─────────────────────────────
  const c5 = ind.change5d;
  if (c5 != null) {
    if (c5 > 5)       score += 1.5;
    else if (c5 > 2)  score += 0.5;
    else if (c5 < -5) score -= 1.5;
    else if (c5 < -2) score -= 0.5;
  }

  // ── 5. Bollinger Bands position ───────────────────────────────────────────
  if (ind.bbUpper != null && ind.bbLower != null && ind.price != null) {
    const range = ind.bbUpper - ind.bbLower;
    if (range > 0) {
      const pos = (ind.price - ind.bbLower) / range; // 0 = lower, 1 = upper
      if (pos > 1.05)      score -= 1.5; // outside upper band (overbought breakout)
      else if (pos > 0.85) score -= 0.5; // approaching upper band
      else if (pos < -0.05) score += 1.5; // outside lower band (oversold breakout)
      else if (pos < 0.15) score += 0.5; // approaching lower band
    }
  }

  // ── 6. Weekly trend confirmation (heavier weight) ─────────────────────────
  if (ind.weeklyTrendTag === "weekly bull")      score += 1.5;
  else if (ind.weeklyTrendTag === "weekly bear") score -= 1.5;

  // ── 7. Stochastic %K ─────────────────────────────────────────────────────
  if (ind.stochK14 != null) {
    if (ind.stochK14 >= 85)      score -= 1.0;
    else if (ind.stochK14 >= 75) score -= 0.5;
    else if (ind.stochK14 <= 15) score += 1.0;
    else if (ind.stochK14 <= 25) score += 0.5;
  }

  // ── 8. Volume confirmation ────────────────────────────────────────────────
  // High relative volume on a trending day amplifies the signal in that direction.
  if (ind.relVolume != null && ind.change1d != null) {
    const volBoost = ind.relVolume > 1.8 ? 1.0 : ind.relVolume > 1.3 ? 0.5 : 0;
    if (volBoost > 0) {
      if (ind.change1d > 0)      score += volBoost;
      else if (ind.change1d < 0) score -= volBoost;
    }
  }

  // ── 9. Price vs VWAP ─────────────────────────────────────────────────────
  if (ind.priceVsVwapPct != null) {
    if (ind.priceVsVwapPct > 1.5)       score += 0.5;
    else if (ind.priceVsVwapPct < -1.5) score -= 0.5;
  }

  // ── Direction gate (higher threshold = fewer but stronger calls) ──────────
  let direction: BacktestDirection;
  if (score >= 3)       direction = "BULLISH";
  else if (score <= -3) direction = "BEARISH";
  else                  direction = "NEUTRAL";

  // ── Confidence — scales with |score|, dampened in high-volatility regimes ─
  let confidence = Math.min(0.93, Math.max(0.35, 0.38 + 0.052 * Math.abs(score)));
  if (ind.atr14Pct != null && ind.atr14Pct > 3) {
    confidence = Math.max(0.35, confidence - 0.08);
  }

  return { direction, confidence, score };
}

/** Horizon-scaled noise band: tiny moves on a 1-day horizon are noise;
 *  on a 1-month horizon the bar should be higher. */
function noiseThreshold(fwdDays: number): number {
  if (fwdDays <= 1)  return 0.3;
  if (fwdDays <= 5)  return 0.5;
  if (fwdDays <= 21) return 1.0;
  return 2.0;
}

function computeSignalQuality(
  hitRate: number | null,
  ev: number | null,
  edgeRatio: number | null,
): SignalQuality {
  if (hitRate == null || ev == null) return "POOR";
  if (ev > 0.8 && hitRate > 0.6 && (edgeRatio ?? 0) > 1.2) return "STRONG";
  if (ev > 0.3 && hitRate > 0.5)                             return "MODERATE";
  if (ev > 0)                                                return "WEAK";
  return "POOR";
}

function computeStreaks(bars: BacktestBar[]): { maxWin: number; maxLoss: number } {
  let maxWin = 0, maxLoss = 0, curWin = 0, curLoss = 0;
  for (const b of bars) {
    if (b.outcome === "CORRECT") {
      curWin++; curLoss = 0;
      if (curWin > maxWin) maxWin = curWin;
    } else if (b.outcome === "WRONG") {
      curLoss++; curWin = 0;
      if (curLoss > maxLoss) maxLoss = curLoss;
    }
  }
  return { maxWin, maxLoss };
}

/**
 * Run the improved indicator+rules pipeline over the last `lookback` trading
 * days and measure hit-rate, edge ratio, expected value, and streaks per
 * direction and horizon.
 *
 * Enhancements vs v1:
 *  - scoreIndicators now uses volume, VWAP, signal-line cross, tiered RSI
 *  - noise threshold scales with horizon
 *  - summary adds edgeRatio, expectedValue, streaks, signalQuality
 */
export async function runBacktest(
  symbol: string,
  horizon: string,
  lookback = 30,
): Promise<BacktestResult> {
  const fwdDays = HORIZON_TRADING_DAYS[horizon] ?? 5;
  const noise = noiseThreshold(fwdDays);

  const series = await fetchYahooCandles(symbol, "1d", "2y");
  if (!series || series.candles.length < 60) {
    throw new Error(`Not enough historical data for ${symbol} to run backtest`);
  }

  const closes  = series.candles.map((c) => c.c);
  const volumes = series.candles.map((c) => c.v);
  const dates   = series.candles.map((c) => new Date(c.t).toISOString().slice(0, 10));
  const n = closes.length;

  const testStartIdx = Math.max(60, n - lookback - fwdDays - 1);
  const testEndIdx   = n - fwdDays - 1;

  if (testEndIdx < testStartIdx) {
    throw new Error(`Not enough forward bars for horizon ${horizon} — try a shorter horizon`);
  }

  const bars: BacktestBar[] = [];

  for (let i = testStartIdx; i <= testEndIdx; i++) {
    const sliceCloses = closes.slice(0, i + 1);
    const sliceVols   = volumes.slice(0, i + 1) as (number | null | undefined)[];

    const ind = computeIndicators(symbol, sliceCloses, { dailyVolumes: sliceVols });
    const { direction, confidence, score } = scoreIndicators(ind);

    const entryPrice = closes[i];
    const exitIdx    = i + fwdDays;
    const exitPrice  = exitIdx < n ? closes[exitIdx] : null;
    const actualChangePct =
      exitPrice != null ? ((exitPrice - entryPrice) / entryPrice) * 100 : null;

    let outcome: BacktestOutcome = "SKIP";
    if (actualChangePct != null) {
      let correct: boolean;
      if (direction === "BULLISH")      correct = actualChangePct > noise;
      else if (direction === "BEARISH") correct = actualChangePct < -noise;
      else                              correct = Math.abs(actualChangePct) <= noise * 4;
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

  // ── Aggregates ────────────────────────────────────────────────────────────
  const settled = bars.filter((b) => b.outcome !== "SKIP");
  const correct = settled.filter((b) => b.outcome === "CORRECT");
  const wrong   = settled.filter((b) => b.outcome === "WRONG");

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

  const hitRate = settled.length > 0 ? correct.length / settled.length : null;

  const confs      = settled.map((b) => b.confidence);
  const avgConf    = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;

  const winPcts  = correct.map((b) => Math.abs(b.actualChangePct!));
  const lossPcts = wrong.map((b) => Math.abs(b.actualChangePct!));
  const avgWinPct  = winPcts.length  ? winPcts.reduce((a, b)  => a + b, 0) / winPcts.length  : null;
  const avgLossPct = lossPcts.length ? lossPcts.reduce((a, b) => a + b, 0) / lossPcts.length : null;

  const edgeRatio = avgWinPct != null && avgLossPct != null && avgLossPct > 0
    ? avgWinPct / avgLossPct
    : null;

  const expectedValue =
    hitRate != null && avgWinPct != null && avgLossPct != null
      ? hitRate * avgWinPct - (1 - hitRate) * avgLossPct
      : null;

  const { maxWin: maxWinStreak, maxLoss: maxLossStreak } = computeStreaks(settled);

  const signalQuality = computeSignalQuality(hitRate, expectedValue, edgeRatio);

  logger.info(
    { symbol, horizon, lookback, total: settled.length, correct: correct.length, signalQuality },
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
      hitRate,
      byDirection,
      avgConfidence: avgConf,
      avgWinPct,
      avgLossPct,
      edgeRatio,
      expectedValue,
      maxWinStreak,
      maxLossStreak,
      signalQuality,
    },
    fetchedAt: new Date().toISOString(),
  };
}
