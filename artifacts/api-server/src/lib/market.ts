import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";

export type Sentiment = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface NewsHeadline {
  title: string;
  source: string;
  link: string;
  publishedAt: string;
  sentiment?: Sentiment;
}

export interface IndicatorsResult {
  symbol: string;
  price: number | null;
  change1d: number | null;
  change5d: number | null;
  change1m: number | null;
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  high52w: number | null;
  low52w: number | null;
  volatility20d: number | null;
  asOf: string;
}

export type EvaluationStatus =
  | "PENDING"        // horizon not yet elapsed AND we have no measurable move yet
  | "ON_TRACK"       // horizon not elapsed but price already moving the right way
  | "OFF_TRACK"      // horizon not elapsed but price moving wrong way
  | "CORRECT"        // horizon elapsed, direction matched
  | "WRONG"          // horizon elapsed, direction wrong
  | "TARGET_HIT"     // price reached/exceeded targetPrice in the predicted direction
  | "NO_ENTRY";      // we never recorded an entry price

export interface PredictionEvaluation {
  status: EvaluationStatus;
  entryPrice: number | null;
  currentPrice: number | null;
  deltaPct: number | null;
  reachedTarget: boolean;
  isDue: boolean;
}

export interface MarketQuote {
  symbol: string;
  price: number | null;
  changePct: number | null;
  currency: string | null;
  marketState: string | null;
  asOf: string;
}

export type TradeAction = "BUY_CALL" | "BUY_PUT" | "HOLD";

export interface PredictionResult {
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  horizon: string;
  summary: string;
  reasoning: string;
  headlines: NewsHeadline[];
  quote: MarketQuote | null;
  action: TradeAction;
  strikeHint: string;
  expiryHint: string;
  entryTrigger: string;
  riskNote: string;
  targetPrice: number | null;
  model: string;
  durationMs: number;
}

export interface CandlePoint {
  t: number;
  c: number;
}

export interface CandleSeries {
  symbol: string;
  interval: string;
  range: string;
  currency: string | null;
  marketState: string | null;
  previousClose: number | null;
  candles: CandlePoint[];
}

const MODEL = "gemini-2.5-flash";
const HEADLINE_LIMIT = 12;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim();
}

function extractTag(item: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = item.match(re);
  return m ? decodeXmlEntities(stripCdata(m[1])).trim() : "";
}

function parseRssItems(xml: string): NewsHeadline[] {
  const out: NewsHeadline[] = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  const items = xml.match(itemRe) ?? [];
  for (const item of items) {
    const title = extractTag(item, "title");
    if (!title) continue;
    const link = extractTag(item, "link");
    const pub = extractTag(item, "pubDate");
    let source = extractTag(item, "source");
    if (!source) {
      const m = title.match(/\s+-\s+([^-]+)$/);
      source = m ? m[1].trim() : "";
    }
    out.push({
      title: title.replace(/\s+-\s+[^-]+$/, "").trim(),
      source,
      link,
      publishedAt: pub,
    });
  }
  return out;
}

export async function fetchHeadlines(query: string): Promise<NewsHeadline[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query,
  )}&hl=en-US&gl=US&ceid=US:en`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 NeuroLinkedBrain/1.0" },
    });
    if (!res.ok) {
      logger.warn({ status: res.status, query }, "headline fetch failed");
      return [];
    }
    const xml = await res.text();
    return parseRssItems(xml).slice(0, HEADLINE_LIMIT);
  } catch (err) {
    logger.warn({ err, query }, "headline fetch error");
    return [];
  } finally {
    clearTimeout(t);
  }
}

export async function fetchYahooCandles(
  symbol: string,
  interval: string = "5m",
  range: string = "1d",
): Promise<CandleSeries | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 NeuroLinkedBrain/1.0" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            symbol?: string;
            currency?: string;
            marketState?: string;
            chartPreviousClose?: number;
            previousClose?: number;
          };
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }>;
      };
    };
    const r = data.chart?.result?.[0];
    if (!r || !r.timestamp) return null;
    const closes = r.indicators?.quote?.[0]?.close ?? [];
    const candles: CandlePoint[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const c = closes[i];
      if (typeof c === "number" && Number.isFinite(c)) {
        candles.push({ t: r.timestamp[i] * 1000, c });
      }
    }
    return {
      symbol: r.meta?.symbol ?? symbol,
      interval,
      range,
      currency: r.meta?.currency ?? null,
      marketState: r.meta?.marketState ?? null,
      previousClose:
        typeof r.meta?.chartPreviousClose === "number"
          ? r.meta.chartPreviousClose
          : typeof r.meta?.previousClose === "number"
            ? r.meta.previousClose
            : null,
      candles,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchYahooQuote(symbol: string): Promise<MarketQuote | null> {
  // The /v7/finance/quote endpoint now requires a crumb. The /v8 chart endpoint
  // still works unauthenticated and gives us enough fields for our purposes.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=1d`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 NeuroLinkedBrain/1.0" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            symbol?: string;
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            currency?: string;
            marketState?: string;
          };
        }>;
      };
    };
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
    const prev = typeof meta.chartPreviousClose === "number"
      ? meta.chartPreviousClose
      : typeof meta.previousClose === "number"
        ? meta.previousClose
        : null;
    const changePct = price !== null && prev ? ((price - prev) / prev) * 100 : null;
    return {
      symbol: meta.symbol ?? symbol,
      price,
      changePct,
      currency: meta.currency ?? null,
      marketState: meta.marketState ?? null,
      asOf: new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function safeJsonExtract(text: string): Record<string, unknown> | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeDirection(raw: unknown): "BULLISH" | "BEARISH" | "NEUTRAL" {
  const s = String(raw ?? "").toUpperCase();
  if (s.includes("BULL") || s === "UP" || s === "LONG") return "BULLISH";
  if (s.includes("BEAR") || s === "DOWN" || s === "SHORT") return "BEARISH";
  return "NEUTRAL";
}

export interface PredictArgs {
  symbol: string;
  name: string;
  market: string;
  horizon: string;
  notes?: string;
}

export async function predictMarket(args: PredictArgs): Promise<PredictionResult> {
  const start = Date.now();
  const query = `${args.name} ${args.symbol} stock market news`;
  const [headlines, quote] = await Promise.all([
    fetchHeadlines(query),
    fetchYahooQuote(args.symbol),
  ]);

  const headlineBlock = headlines.length
    ? headlines
        .map((h, i) => `[${i + 1}] ${h.title}${h.source ? ` (${h.source})` : ""}`)
        .join("\n")
    : "(no recent headlines fetched)";

  const quoteBlock = quote
    ? `Symbol: ${quote.symbol}\nLast price: ${quote.price ?? "n/a"}${
        quote.currency ? ` ${quote.currency}` : ""
      }\nIntraday change: ${quote.changePct?.toFixed(2) ?? "n/a"}%\nMarket state: ${
        quote.marketState ?? "n/a"
      }`
    : "(no live quote available)";

  const prompt = `You are a market analysis assistant inside the NeuroLinked Brain. Produce a probabilistic forecast AND an options trade signal for the asset below.

ASSET
- Symbol: ${args.symbol}
- Name: ${args.name}
- Market: ${args.market}
- Horizon: ${args.horizon}
${args.notes ? `- User notes: ${args.notes}` : ""}

LIVE QUOTE
${quoteBlock}

RECENT HEADLINES
${headlineBlock}

TASK
1. Weigh the headlines, sentiment and quote to decide a directional bias for the given horizon.
2. Translate that into an options trade signal:
   - BUY_CALL when bias is bullish with enough conviction
   - BUY_PUT when bias is bearish with enough conviction
   - HOLD when conviction is too low or the picture is mixed
3. Recommend strike (ATM / slightly-OTM / slightly-ITM) and expiry that fits the horizon.
4. Give a clear "entry trigger" — a short, observable condition that should be true before opening the trade (e.g. "Wait for close above $275" or "Enter if pre-market sells off below $268").
5. Add a one-line risk note for what would invalidate the thesis.

Respond with STRICT JSON only, matching this shape:
{
  "direction": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": <number between 0 and 1>,
  "action": "BUY_CALL" | "BUY_PUT" | "HOLD",
  "strikeHint": "<short strike recommendation, e.g. 'ATM ~$273' or 'Slightly OTM $280'>",
  "expiryHint": "<expiry that matches the horizon, e.g. 'weekly Fri exp' or '30-45 DTE'>",
  "entryTrigger": "<one short observable condition to enter>",
  "riskNote": "<one short sentence on what would invalidate the trade>",
  "targetPrice": <number — your projected price for the asset at the END of the horizon, used to draw a forecast line on the chart>,
  "headlineSentiments": [<one entry per headline above in order: "BULLISH" | "BEARISH" | "NEUTRAL">],
  "summary": "<one-sentence punchy verdict>",
  "reasoning": "<3-6 sentences citing the headlines by [n] when possible>"
}

Rules:
- If confidence < 0.55, action MUST be "HOLD".
- BUY_CALL only with BULLISH direction, BUY_PUT only with BEARISH.
- Do not invent the strike price — base strike hints on the live quote shown.
- targetPrice MUST be a realistic dollar number near the live quote (typical move 0.5%-8%, never more than 20%).
- No prose outside the JSON.`;

  let direction: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  let confidence = 0.5;
  let summary = "No verdict produced.";
  let reasoning = "";
  let action: TradeAction = "HOLD";
  let strikeHint = "";
  let expiryHint = "";
  let entryTrigger = "";
  let riskNote = "";
  let targetPrice: number | null = null;

  try {
    const resp = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 3072,
        responseMimeType: "application/json",
      },
    });
    const text = resp.text ?? "";
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = safeJsonExtract(text);
    }
    const grabStr = (key: string): string => {
      const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
      const m = text.match(re);
      return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim() : "";
    };

    if (parsed && typeof parsed === "object") {
      direction = normalizeDirection(parsed.direction);
      const c = Number(parsed.confidence);
      if (Number.isFinite(c)) confidence = Math.max(0, Math.min(1, c));
      if (typeof parsed.summary === "string" && parsed.summary.trim()) summary = parsed.summary.trim();
      if (typeof parsed.reasoning === "string" && parsed.reasoning.trim()) reasoning = parsed.reasoning.trim();
      const a = String(parsed.action ?? "").toUpperCase();
      if (a === "BUY_CALL" || a === "BUY_PUT" || a === "HOLD") action = a;
      if (typeof parsed.strikeHint === "string") strikeHint = parsed.strikeHint.trim();
      if (typeof parsed.expiryHint === "string") expiryHint = parsed.expiryHint.trim();
      if (typeof parsed.entryTrigger === "string") entryTrigger = parsed.entryTrigger.trim();
      if (typeof parsed.riskNote === "string") riskNote = parsed.riskNote.trim();
      const tp = Number(parsed.targetPrice);
      if (Number.isFinite(tp) && tp > 0) targetPrice = tp;
      if (Array.isArray(parsed.headlineSentiments)) {
        for (let i = 0; i < headlines.length; i++) {
          const s = String(parsed.headlineSentiments[i] ?? "").toUpperCase();
          if (s === "BULLISH" || s === "BEARISH" || s === "NEUTRAL") {
            headlines[i].sentiment = s;
          }
        }
      }
    } else {
      // Truncated / malformed JSON — recover the fields with regex.
      const dirM = text.match(/"direction"\s*:\s*"([A-Z_]+)"/i);
      if (dirM) direction = normalizeDirection(dirM[1]);
      const confM = text.match(/"confidence"\s*:\s*([0-9.]+)/);
      if (confM) {
        const c = Number(confM[1]);
        if (Number.isFinite(c)) confidence = Math.max(0, Math.min(1, c));
      }
      const actM = text.match(/"action"\s*:\s*"(BUY_CALL|BUY_PUT|HOLD)"/i);
      if (actM) action = actM[1].toUpperCase() as TradeAction;
      strikeHint = grabStr("strikeHint") || strikeHint;
      expiryHint = grabStr("expiryHint") || expiryHint;
      entryTrigger = grabStr("entryTrigger") || entryTrigger;
      riskNote = grabStr("riskNote") || riskNote;
      summary = grabStr("summary") || summary;
      reasoning = grabStr("reasoning") || text.slice(0, 4000);
      const tpM = text.match(/"targetPrice"\s*:\s*([0-9.]+)/);
      if (tpM) {
        const tp = Number(tpM[1]);
        if (Number.isFinite(tp) && tp > 0) targetPrice = tp;
      }
    }

    // Safety: enforce the rules the model is supposed to follow itself.
    if (confidence < 0.55) action = "HOLD";
    if (action === "BUY_CALL" && direction !== "BULLISH") action = "HOLD";
    if (action === "BUY_PUT" && direction !== "BEARISH") action = "HOLD";

    // Sanity-clip targetPrice to ±20% of live quote so a hallucination doesn't
    // distort the forecast chart.
    if (targetPrice && quote?.price) {
      const move = (targetPrice - quote.price) / quote.price;
      if (move > 0.2) targetPrice = quote.price * 1.2;
      if (move < -0.2) targetPrice = quote.price * 0.8;
    }
    // Fallback: derive a target from direction + confidence if model omitted it
    if (!targetPrice && quote?.price) {
      const horizonScale: Record<string, number> = { "1d": 0.005, "1w": 0.02, "1m": 0.05, "3m": 0.1 };
      const base = horizonScale[args.horizon] ?? 0.02;
      const magnitude = base * (0.5 + confidence);
      if (direction === "BULLISH") targetPrice = quote.price * (1 + magnitude);
      else if (direction === "BEARISH") targetPrice = quote.price * (1 - magnitude);
      else targetPrice = quote.price;
    }

    // Tie sentiments to a quick bullish/bearish/neutral count signal we can show.
    // (No-op for storage — the headline objects already carry .sentiment.)
  } catch (err) {
    logger.error({ err, symbol: args.symbol }, "market prediction failed");
    throw err instanceof Error ? err : new Error(String(err));
  }

  return {
    direction,
    confidence,
    horizon: args.horizon,
    summary,
    reasoning,
    headlines,
    quote,
    action,
    strikeHint,
    expiryHint,
    entryTrigger,
    riskNote,
    targetPrice,
    model: MODEL,
    durationMs: Date.now() - start,
  };
}

const HORIZON_MS: Record<string, number> = {
  "1d": 24 * 3600_000,
  "1w": 7 * 24 * 3600_000,
  "1m": 30 * 24 * 3600_000,
  "3m": 90 * 24 * 3600_000,
};

export function evaluatePrediction(
  p: {
    direction: string;
    horizon: string;
    targetPrice: number | null;
    quote: MarketQuote | null;
    createdAt: Date | string;
  },
  currentPrice: number | null,
): PredictionEvaluation {
  const entry = p.quote?.price ?? null;
  const horizonMs = HORIZON_MS[p.horizon] ?? HORIZON_MS["1w"];
  const created = new Date(p.createdAt).getTime();
  const isDue = Date.now() - created >= horizonMs;

  if (entry == null || currentPrice == null) {
    return { status: entry == null ? "NO_ENTRY" : "PENDING", entryPrice: entry, currentPrice, deltaPct: null, reachedTarget: false, isDue };
  }

  const deltaPct = ((currentPrice - entry) / entry) * 100;
  const dir = p.direction;
  // Did the live price already touch / exceed the target in the right direction?
  let reachedTarget = false;
  if (p.targetPrice != null) {
    if (dir === "BULLISH") reachedTarget = currentPrice >= p.targetPrice;
    else if (dir === "BEARISH") reachedTarget = currentPrice <= p.targetPrice;
  }

  // Direction-correctness threshold: 0.5% to ignore noise
  const noise = 0.5;
  let correct: boolean;
  if (dir === "BULLISH") correct = deltaPct > noise;
  else if (dir === "BEARISH") correct = deltaPct < -noise;
  else correct = Math.abs(deltaPct) <= 2; // NEUTRAL: within ±2%

  let status: EvaluationStatus;
  if (reachedTarget) status = "TARGET_HIT";
  else if (isDue) status = correct ? "CORRECT" : "WRONG";
  else status = correct ? "ON_TRACK" : "OFF_TRACK";

  return { status, entryPrice: entry, currentPrice, deltaPct, reachedTarget, isDue };
}

export function computeIndicators(symbol: string, dailyCloses: number[]): IndicatorsResult {
  const last = dailyCloses.length ? dailyCloses[dailyCloses.length - 1] : null;
  const change = (n: number): number | null => {
    if (last == null || dailyCloses.length <= n) return null;
    const prev = dailyCloses[dailyCloses.length - 1 - n];
    return prev ? ((last - prev) / prev) * 100 : null;
  };
  const sma = (n: number): number | null => {
    if (dailyCloses.length < n) return null;
    let sum = 0;
    for (let i = dailyCloses.length - n; i < dailyCloses.length; i++) sum += dailyCloses[i];
    return sum / n;
  };
  const rsi = (n: number): number | null => {
    if (dailyCloses.length < n + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = dailyCloses.length - n; i < dailyCloses.length; i++) {
      const d = dailyCloses[i] - dailyCloses[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    const avgGain = gains / n;
    const avgLoss = losses / n;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };
  const volatility = (n: number): number | null => {
    if (dailyCloses.length < n + 1) return null;
    const rets: number[] = [];
    for (let i = dailyCloses.length - n; i < dailyCloses.length; i++) {
      const d = dailyCloses[i - 1];
      if (d) rets.push((dailyCloses[i] - d) / d);
    }
    if (!rets.length) return null;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    return Math.sqrt(variance) * 100;
  };
  const window52 = dailyCloses.slice(-252);
  return {
    symbol,
    price: last,
    change1d: change(1),
    change5d: change(5),
    change1m: change(21),
    sma20: sma(20),
    sma50: sma(50),
    rsi14: rsi(14),
    high52w: window52.length ? Math.max(...window52) : null,
    low52w: window52.length ? Math.min(...window52) : null,
    volatility20d: volatility(20),
    asOf: new Date().toISOString(),
  };
}
