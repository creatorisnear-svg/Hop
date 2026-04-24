import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";
import { groqChat, groqKeyCount } from "./groq";

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
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  // MACD trio (12/26/9)
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  // Bollinger Bands (20-period, 2 stddev)
  bbUpper: number | null;
  bbLower: number | null;
  bbMid: number | null;
  bbWidthPct: number | null;        // (upper-lower)/mid * 100
  // Stochastic %K (14)
  stochK14: number | null;
  // Average true range (14) — but we only have closes, so use close-based proxy.
  atr14Pct: number | null;          // mean abs daily return * 100, last 14 days
  high52w: number | null;
  low52w: number | null;
  volatility20d: number | null;
  // Multi-timeframe trend agreement scoring (-3..+3)
  trendScore: number | null;
  // Volume signals — driven by daily/intraday candle volumes when available.
  // Relative volume = today's volume / 20d avg volume (so "unusual volume"
  // is anything > ~1.5x). VWAP and price vs VWAP read intraday institutional
  // bias.
  relVolume: number | null;
  vwap: number | null;
  priceVsVwapPct: number | null;
  // Intraday momentum — used by 1h / 4h / 0DTE scalp predictions. The daily
  // RSI lags too much for short-term options trades; these read live momentum
  // off today's 5-min bars.
  intraRsi5m: number | null;        // RSI14 computed off 5m closes
  intraTrend5m: number | null;      // net % move over the last ~12 bars (1h)
  // Weekly timeframe — used to confirm the daily signal. When daily and
  // weekly agree the call is much higher conviction.
  weeklySma20: number | null;
  priceVsWeeklySma20Pct: number | null;
  weeklyRsi14: number | null;
  weeklyTrendTag: string | null;    // e.g. "weekly bull", "weekly bear", "weekly choppy"
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

export interface EarningsRow {
  date: string;            // ISO when reported (or scheduled)
  fiscalQuarter: string;   // "Q1" | "Q2" | "Q3" | "Q4" | ""
  fiscalYear: number | null;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  surprisePct: number | null;     // (actual - estimate) / |estimate| * 100
  scheduled: boolean;             // true if not reported yet
}

export interface EarningsInfo {
  symbol: string;
  currency: string | null;
  history: EarningsRow[];          // most recent first
  q1Latest: EarningsRow | null;    // most recent Q1 print
  next: EarningsRow | null;        // next scheduled earnings, if any
  fetchedAt: string;
  source: "yahoo" | "unavailable";
}

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
  // New, richer-prediction fields:
  bullCase: string;
  bearCase: string;
  keyDrivers: string[];
  nextCatalysts: string[];
  earnings: EarningsInfo | null;   // snapshot of earnings used to ground the call
  model: string;
  durationMs: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContext {
  symbol: string;
  name: string;
  market: string;
  notes?: string;
}

export interface ChatReply {
  reply: string;
  model: string;
  durationMs: number;
}

export interface CandlePoint {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  // Optional volume — populated from Yahoo's chart endpoint when available.
  // Frontend chart code ignores it; the indicators pipeline uses it for
  // relative-volume and VWAP signals.
  v?: number;
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

// Internal: fetch one RSS feed and parse it. Used by the multi-source headline
// aggregator. Returns [] on any failure (the aggregator can still succeed with
// partial sources).
async function fetchRssFeed(url: string, label: string): Promise<NewsHeadline[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 NeuroLinkedBrain/1.0" },
    });
    if (!res.ok) {
      logger.warn({ status: res.status, source: label }, "rss feed fetch failed");
      return [];
    }
    return parseRssItems(await res.text());
  } catch (err) {
    logger.warn({ err, source: label }, "rss feed fetch error");
    return [];
  } finally {
    clearTimeout(t);
  }
}

// Multi-source news aggregator. Pulls from:
//   1. Google News (general query)                      — broad market chatter
//   2. Google News (recency-filtered, last 24h)         — fresh catalysts
//   3. Yahoo Finance per-ticker RSS                     — market-specific items
// Then dedupes by title, sorts newest-first, and caps at HEADLINE_LIMIT.
// More diverse sources = harder for the model to be fooled by a single biased
// outlet, and the recency filter surfaces same-day catalysts (earnings beats,
// downgrades, M&A) that move puts/calls within hours.
export async function fetchHeadlines(query: string, symbol?: string): Promise<NewsHeadline[]> {
  const sources: Promise<NewsHeadline[]>[] = [
    fetchRssFeed(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      "google-news-general",
    ),
    // `when:1d` filter restricts to past 24h — fresh catalysts only.
    fetchRssFeed(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query + " when:1d")}&hl=en-US&gl=US&ceid=US:en`,
      "google-news-24h",
    ),
  ];
  if (symbol) {
    // Yahoo Finance per-ticker RSS — usually has 10-20 of the most directly
    // relevant items for the ticker (earnings, analyst notes, SEC filings).
    sources.push(
      fetchRssFeed(
        `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`,
        "yahoo-finance-ticker",
      ),
    );
  }
  const results = await Promise.all(sources);
  const seen = new Set<string>();
  const merged: NewsHeadline[] = [];
  for (const arr of results) {
    for (const h of arr) {
      const key = h.title.toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(h);
    }
  }
  // Sort newest-first when publishedAt parses; otherwise preserve order.
  merged.sort((a, b) => {
    const ta = Date.parse(a.publishedAt || "");
    const tb = Date.parse(b.publishedAt || "");
    if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
    if (Number.isFinite(tb)) return 1;
    if (Number.isFinite(ta)) return -1;
    return 0;
  });
  return merged.slice(0, HEADLINE_LIMIT);
}

// ── BROADER MARKET CONTEXT ────────────────────────────────────────────────
// "Is this stock moving WITH the market or against it?" is one of the most
// underrated short-term predictors. A 1% pop in a single name during a -2%
// SPY day usually fades; the same 1% pop during a +1.5% SPY day usually
// continues. We fetch both SPY (broad market) and QQQ (tech beta) so the
// model can place the stock's move in proper context.
export interface MarketContext {
  spy?: { price: number; changePct: number } | null;
  qqq?: { price: number; changePct: number } | null;
}
export async function fetchMarketContext(): Promise<MarketContext> {
  const [spy, qqq] = await Promise.all([
    fetchYahooQuote("SPY"),
    fetchYahooQuote("QQQ"),
  ]);
  const tag = (q: MarketQuote | null) =>
    q && q.price != null && q.changePct != null
      ? { price: q.price, changePct: q.changePct }
      : null;
  return { spy: tag(spy), qqq: tag(qqq) };
}

// ── OPTIONS-MARKET POSITIONING (FREE) ────────────────────────────────────
// Yahoo's options endpoint exposes the entire option chain for free. We pull
// the front-month expiry, sum total *open interest* on calls vs puts, and
// derive a put/call ratio. This is a real-money positioning signal — when
// puts > 1.0× calls, options traders are net-bearish; when << 0.7×, net-
// bullish. For day-trading puts/calls this is one of the most directly
// relevant signals available.
export interface OptionsPositioning {
  putCallOI: number | null;        // total put OI / total call OI
  putCallVolume: number | null;    // today's put volume / today's call volume
  totalCallOI: number;
  totalPutOI: number;
  expiry: string | null;           // ISO date of the expiry analysed
  ivAtmCall: number | null;        // implied vol of the ATM call (% annualised)
  ivAtmPut: number | null;         // implied vol of the ATM put
  ivSkew: number | null;           // (put IV - call IV) percentage points; >0 = puts bid (fear)
}
export async function fetchOptionsPositioning(symbol: string): Promise<OptionsPositioning | null> {
  // Yahoo's options endpoint now requires the same crumb auth as quoteSummary.
  // Without it every call returns "Unauthorized: Invalid Crumb" — which is
  // exactly what was happening before this fix (the model kept saying "options
  // data unavailable" even though we were calling it).
  const auth = await getYahooCrumb();
  const baseUrl = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
  const url = auth ? `${baseUrl}?crumb=${encodeURIComponent(auth.crumb)}` : baseUrl;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        accept: "*/*",
        referer: "https://finance.yahoo.com/",
        ...(auth ? { cookie: auth.cookie } : {}),
      },
    });
    if (!res.ok) {
      logger.warn({ status: res.status, symbol }, "options chain fetch failed");
      return null;
    }
    const data = (await res.json()) as {
      optionChain?: {
        result?: Array<{
          quote?: { regularMarketPrice?: number };
          expirationDates?: number[];
          options?: Array<{
            expirationDate?: number;
            calls?: Array<{
              strike?: number;
              openInterest?: number;
              volume?: number;
              impliedVolatility?: number;
            }>;
            puts?: Array<{
              strike?: number;
              openInterest?: number;
              volume?: number;
              impliedVolatility?: number;
            }>;
          }>;
        }>;
      };
    };
    const r = data.optionChain?.result?.[0];
    const o = r?.options?.[0];
    if (!o || !o.calls || !o.puts) return null;
    const spot = r?.quote?.regularMarketPrice ?? null;
    let totalCallOI = 0, totalPutOI = 0;
    let totalCallVol = 0, totalPutVol = 0;
    for (const c of o.calls) {
      totalCallOI += Number(c.openInterest ?? 0) || 0;
      totalCallVol += Number(c.volume ?? 0) || 0;
    }
    for (const p of o.puts) {
      totalPutOI += Number(p.openInterest ?? 0) || 0;
      totalPutVol += Number(p.volume ?? 0) || 0;
    }
    // ATM call/put = strike closest to spot.
    let atmCall: { strike: number; iv: number | null } | null = null;
    let atmPut: { strike: number; iv: number | null } | null = null;
    if (spot != null) {
      for (const c of o.calls) {
        if (typeof c.strike !== "number") continue;
        if (!atmCall || Math.abs(c.strike - spot) < Math.abs(atmCall.strike - spot)) {
          atmCall = { strike: c.strike, iv: typeof c.impliedVolatility === "number" ? c.impliedVolatility : null };
        }
      }
      for (const p of o.puts) {
        if (typeof p.strike !== "number") continue;
        if (!atmPut || Math.abs(p.strike - spot) < Math.abs(atmPut.strike - spot)) {
          atmPut = { strike: p.strike, iv: typeof p.impliedVolatility === "number" ? p.impliedVolatility : null };
        }
      }
    }
    const ivCall = atmCall?.iv != null ? atmCall.iv * 100 : null;
    const ivPut  = atmPut?.iv  != null ? atmPut.iv  * 100 : null;
    return {
      putCallOI: totalCallOI > 0 ? totalPutOI / totalCallOI : null,
      putCallVolume: totalCallVol > 0 ? totalPutVol / totalCallVol : null,
      totalCallOI,
      totalPutOI,
      expiry: o.expirationDate ? new Date(o.expirationDate * 1000).toISOString().slice(0, 10) : null,
      ivAtmCall: ivCall,
      ivAtmPut: ivPut,
      ivSkew: (ivCall != null && ivPut != null) ? (ivPut - ivCall) : null,
    };
  } catch (err) {
    logger.warn({ err, symbol }, "options positioning fetch error");
    return null;
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
          indicators?: {
            quote?: Array<{
              open?: (number | null)[];
              high?: (number | null)[];
              low?: (number | null)[];
              close?: (number | null)[];
              volume?: (number | null)[];
            }>;
          };
        }>;
      };
    };
    const r = data.chart?.result?.[0];
    if (!r || !r.timestamp) return null;
    const q = r.indicators?.quote?.[0];
    const opens = q?.open ?? [];
    const highs = q?.high ?? [];
    const lows = q?.low ?? [];
    const closes = q?.close ?? [];
    const vols = q?.volume ?? [];
    const candles: CandlePoint[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const c = closes[i];
      const v = vols[i];
      // Only keep bars with a valid close. If open/high/low is missing for any
      // reason (some Yahoo intervals occasionally drop a field), fall back to
      // the close so the bar still renders as a doji-like marker.
      if (typeof c !== "number" || !Number.isFinite(c)) continue;
      const oo = typeof o === "number" && Number.isFinite(o) ? o : c;
      const hh = typeof h === "number" && Number.isFinite(h) ? h : Math.max(oo, c);
      const ll = typeof l === "number" && Number.isFinite(l) ? l : Math.min(oo, c);
      const point: CandlePoint = { t: r.timestamp[i] * 1000, o: oo, h: hh, l: ll, c };
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) point.v = v;
      candles.push(point);
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

function quarterFromDate(d: Date): string {
  const m = d.getUTCMonth(); // 0..11
  if (m <= 2) return "Q1";
  if (m <= 5) return "Q2";
  if (m <= 8) return "Q3";
  return "Q4";
}

// Yahoo's quoteSummary endpoint now requires a per-session crumb + cookie.
// We fetch them once and cache for ~30 minutes.
let yahooCrumbCache: { crumb: string; cookie: string; at: number } | null = null;
const CRUMB_TTL_MS = 30 * 60_000;
// Negative cache: when Yahoo 429s our crumb fetch, remember that for a few
// minutes so we don't immediately re-hammer them on every prediction (which
// just gets us 429d more aggressively). 5 min is short enough that production
// recovers quickly when Yahoo lifts the limit.
let yahooCrumbFailureUntil = 0;
const CRUMB_NEG_TTL_MS = 5 * 60_000;

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  const now = Date.now();
  if (yahooCrumbCache && now - yahooCrumbCache.at < CRUMB_TTL_MS) {
    return { crumb: yahooCrumbCache.crumb, cookie: yahooCrumbCache.cookie };
  }
  if (now < yahooCrumbFailureUntil) {
    // Recently 429d — don't bother trying again, just signal "no crumb" so
    // callers fall through to their unauthenticated path (or skip the call).
    return null;
  }
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
  const baseHeaders = {
    "user-agent": ua,
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    referer: "https://finance.yahoo.com/",
  };
  const crumbHosts = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const seed = await fetch("https://fc.yahoo.com", {
        headers: baseHeaders,
        redirect: "manual",
      });
      const setCookie = seed.headers.get("set-cookie") ?? "";
      const cookie = setCookie
        .split(/,(?=[^;]+=)/)
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
      if (!cookie) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      let cr: Response | null = null;
      let lastStatus = 0;
      for (const host of crumbHosts) {
        cr = await fetch(`https://${host}/v1/test/getcrumb`, {
          headers: { ...baseHeaders, cookie },
        });
        lastStatus = cr.status;
        if (cr.ok) break;
      }
      if (!cr || !cr.ok) {
        logger.warn({ status: lastStatus, attempt }, "yahoo crumb fetch failed");
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      const crumb = (await cr.text()).trim();
      if (!crumb || crumb.length > 64) {
        logger.warn({ crumbLen: crumb.length }, "yahoo crumb invalid");
        return null;
      }
      yahooCrumbCache = { crumb, cookie, at: now };
      yahooCrumbFailureUntil = 0;
      return { crumb, cookie };
    } catch (err) {
      logger.warn({ err, attempt }, "yahoo crumb error");
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  yahooCrumbFailureUntil = Date.now() + CRUMB_NEG_TTL_MS;
  return null;
}

type QuoteSummaryResponse = {
  quoteSummary?: {
    result?: Array<{
      earningsHistory?: {
        history?: Array<{
          quarter?: { fmt?: string; raw?: number };
          epsActual?: { raw?: number };
          epsEstimate?: { raw?: number };
          epsDifference?: { raw?: number };
          surprisePercent?: { raw?: number };
          period?: string;
        }>;
      };
      earnings?: {
        financialsChart?: {
          quarterly?: Array<{
            date?: string;
            revenue?: { raw?: number };
            earnings?: { raw?: number };
          }>;
        };
        earningsChart?: {
          quarterly?: Array<{
            date?: string;
            actual?: { raw?: number };
            estimate?: { raw?: number };
          }>;
          currentQuarterEstimate?: { raw?: number };
          currentQuarterEstimateDate?: string;
          currentQuarterEstimateYear?: number;
          earningsDate?: Array<{ fmt?: string; raw?: number }>;
        };
      };
      calendarEvents?: {
        earnings?: {
          earningsDate?: Array<{ fmt?: string; raw?: number }>;
          earningsAverage?: { raw?: number };
          earningsLow?: { raw?: number };
          earningsHigh?: { raw?: number };
          revenueAverage?: { raw?: number };
        };
      };
      price?: { currency?: string };
    }>;
  };
};

function parseEarningsResponse(symbol: string, data: QuoteSummaryResponse): EarningsInfo {
  const empty = (source: EarningsInfo["source"]): EarningsInfo => ({
    symbol, currency: null, history: [], q1Latest: null, next: null,
    fetchedAt: new Date().toISOString(), source,
  });
  const r = data.quoteSummary?.result?.[0];
  if (!r) return empty("unavailable");
  const currency = r.price?.currency ?? null;
  const revByCode = new Map<string, number>();
  for (const q of r.earnings?.financialsChart?.quarterly ?? []) {
    if (q.date && typeof q.revenue?.raw === "number") {
      revByCode.set(q.date, q.revenue.raw);
    }
  }
  const history: EarningsRow[] = [];
  for (const h of r.earningsHistory?.history ?? []) {
    const dateRaw = h.quarter?.raw;
    const dateIso = typeof dateRaw === "number"
      ? new Date(dateRaw * 1000).toISOString()
      : (h.quarter?.fmt ?? "");
    const d = dateIso ? new Date(dateIso) : null;
    const fiscalQuarter = d && !Number.isNaN(d.getTime()) ? quarterFromDate(d) : "";
    const fiscalYear = d && !Number.isNaN(d.getTime()) ? d.getUTCFullYear() : null;
    const epsActual = typeof h.epsActual?.raw === "number" ? h.epsActual.raw : null;
    const epsEstimate = typeof h.epsEstimate?.raw === "number" ? h.epsEstimate.raw : null;
    let surprisePct = typeof h.surprisePercent?.raw === "number" ? h.surprisePercent.raw : null;
    if (surprisePct == null && epsActual != null && epsEstimate != null && epsEstimate !== 0) {
      surprisePct = ((epsActual - epsEstimate) / Math.abs(epsEstimate)) * 100;
    }
    const code = fiscalQuarter && fiscalYear ? `${fiscalQuarter[1]}Q${fiscalYear}` : "";
    const revenueActual = code && revByCode.has(code) ? revByCode.get(code)! : null;
    history.push({
      date: dateIso, fiscalQuarter, fiscalYear,
      epsActual, epsEstimate, revenueActual, revenueEstimate: null,
      surprisePct, scheduled: false,
    });
  }
  history.sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));
  const q1Latest = history.find((h) => h.fiscalQuarter === "Q1" && h.epsActual != null) ?? null;

  let next: EarningsRow | null = null;
  const cal = r.calendarEvents?.earnings;
  const nextRaw = cal?.earningsDate?.[0]?.raw;
  if (typeof nextRaw === "number") {
    const nextDate = new Date(nextRaw * 1000);
    if (nextDate.getTime() > Date.now()) {
      next = {
        date: nextDate.toISOString(),
        fiscalQuarter: quarterFromDate(nextDate),
        fiscalYear: nextDate.getUTCFullYear(),
        epsActual: null,
        epsEstimate: typeof cal?.earningsAverage?.raw === "number" ? cal.earningsAverage.raw : null,
        revenueActual: null,
        revenueEstimate: typeof cal?.revenueAverage?.raw === "number" ? cal.revenueAverage.raw : null,
        surprisePct: null,
        scheduled: true,
      };
    }
  }
  return {
    symbol, currency, history: history.slice(0, 8),
    q1Latest, next,
    fetchedAt: new Date().toISOString(), source: "yahoo",
  };
}

/**
 * Fetch the latest quarterly earnings history for a stock from Yahoo Finance.
 * Yahoo's v10 quoteSummary requires a per-session crumb + cookie. We cache
 * those for ~30 minutes and silently retry once if the crumb has expired.
 */
export async function fetchEarnings(symbol: string): Promise<EarningsInfo> {
  const empty = (source: EarningsInfo["source"]): EarningsInfo => ({
    symbol, currency: null, history: [], q1Latest: null, next: null,
    fetchedAt: new Date().toISOString(), source,
  });

  const auth = await getYahooCrumb();
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
  const base = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
    symbol,
  )}?modules=earningsHistory,earnings,calendarEvents,price`;
  const url = auth ? `${base}&crumb=${encodeURIComponent(auth.crumb)}` : base;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": ua,
        ...(auth ? { cookie: auth.cookie } : {}),
      },
    });
    if (res.status === 401 || res.status === 403) {
      yahooCrumbCache = null;
      const fresh = await getYahooCrumb();
      if (fresh) {
        const retryUrl = `${base}&crumb=${encodeURIComponent(fresh.crumb)}`;
        const r2 = await fetch(retryUrl, {
          signal: ctrl.signal,
          headers: { "user-agent": ua, cookie: fresh.cookie },
        });
        if (r2.ok) {
          const retryData = (await r2.json()) as QuoteSummaryResponse;
          return parseEarningsResponse(symbol, retryData);
        }
      }
      logger.warn({ symbol, status: res.status }, "earnings auth failed");
      return empty("unavailable");
    }
    if (!res.ok) {
      logger.warn({ symbol, status: res.status }, "earnings fetch failed");
      return empty("unavailable");
    }
    const data = (await res.json()) as QuoteSummaryResponse;
    return parseEarningsResponse(symbol, data);
  } catch (err) {
    logger.warn({ err, symbol }, "earnings fetch error");
    return empty("unavailable");
  } finally {
    clearTimeout(t);
  }
}

function fmtUsd(n: number | null): string {
  if (n == null) return "n/a";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function earningsBlock(e: EarningsInfo | null): string {
  if (!e || e.source === "unavailable" || e.history.length === 0) {
    return "(earnings unavailable for this asset)";
  }
  const lines: string[] = [];
  if (e.q1Latest) {
    const q = e.q1Latest;
    lines.push(
      `Most recent Q1 (${q.fiscalYear ?? ""}): EPS actual ${q.epsActual ?? "n/a"} vs est ${q.epsEstimate ?? "n/a"}` +
        (q.surprisePct != null ? ` (surprise ${q.surprisePct.toFixed(1)}%)` : "") +
        (q.revenueActual != null ? `, revenue ${fmtUsd(q.revenueActual)}` : ""),
    );
  }
  lines.push("Last 4 quarters:");
  for (const h of e.history.slice(0, 4)) {
    lines.push(
      `  - ${h.fiscalQuarter} ${h.fiscalYear ?? ""}: EPS ${h.epsActual ?? "n/a"} vs est ${h.epsEstimate ?? "n/a"}` +
        (h.surprisePct != null ? ` (${h.surprisePct >= 0 ? "+" : ""}${h.surprisePct.toFixed(1)}%)` : "") +
        (h.revenueActual != null ? `, rev ${fmtUsd(h.revenueActual)}` : ""),
    );
  }
  if (e.next) {
    lines.push(
      `Next earnings: ${new Date(e.next.date).toUTCString().slice(0, 16)} (${e.next.fiscalQuarter} ${e.next.fiscalYear}), EPS est ${e.next.epsEstimate ?? "n/a"}`,
    );
  }
  return lines.join("\n");
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
  // Ensemble runs (default 1). When >1 we call the model multiple times in
  // parallel with slightly different temperatures and majority-vote the
  // direction + average targetPrice/confidence — significantly tighter
  // than a single-shot call.
  ensemble?: number;
  // Self-calibration: pass in the model's own past predictions on this watch
  // (most recent first). The prompt embeds them as a "TRACK RECORD" block so
  // the model can spot its own systematic biases ("I overcall BULLISH on this
  // ticker — tone confidence down").
  pastResults?: PastPredictionRow[];
}

function indicatorsBlock(ind: IndicatorsResult | null): string {
  if (!ind || ind.price == null) return "(indicators unavailable)";
  const lines: string[] = [];
  lines.push(`Last close: ${ind.price.toFixed(2)}`);
  if (ind.change1d != null) lines.push(`1d change: ${ind.change1d.toFixed(2)}%`);
  if (ind.change5d != null) lines.push(`5d change: ${ind.change5d.toFixed(2)}%`);
  if (ind.change1m != null) lines.push(`1m change: ${ind.change1m.toFixed(2)}%`);
  if (ind.sma20 != null) lines.push(`SMA20: ${ind.sma20.toFixed(2)} (price ${ind.price > ind.sma20 ? "above" : "below"})`);
  if (ind.sma50 != null) lines.push(`SMA50: ${ind.sma50.toFixed(2)} (price ${ind.price > ind.sma50 ? "above" : "below"})`);
  if (ind.ema12 != null && ind.ema26 != null) {
    lines.push(`EMA12/26: ${ind.ema12.toFixed(2)} / ${ind.ema26.toFixed(2)} (${ind.ema12 > ind.ema26 ? "bull cross" : "bear cross"})`);
  }
  if (ind.macd != null && ind.macdSignal != null && ind.macdHist != null) {
    const macdTag = ind.macdHist > 0
      ? (ind.macd > 0 ? "bullish momentum" : "bullish recovery")
      : (ind.macd < 0 ? "bearish momentum" : "bearish weakening");
    lines.push(`MACD(12,26,9): macd ${ind.macd.toFixed(3)} · signal ${ind.macdSignal.toFixed(3)} · hist ${ind.macdHist >= 0 ? "+" : ""}${ind.macdHist.toFixed(3)} (${macdTag})`);
  }
  if (ind.bbUpper != null && ind.bbLower != null && ind.bbMid != null) {
    const pos = ind.bbUpper !== ind.bbLower
      ? ((ind.price - ind.bbLower) / (ind.bbUpper - ind.bbLower)) * 100 : 50;
    const tag = pos >= 100 ? "above upper band (overbought)"
      : pos <= 0 ? "below lower band (oversold)"
      : pos >= 80 ? "near upper band"
      : pos <= 20 ? "near lower band"
      : "mid-band";
    lines.push(`Bollinger(20,2): ${ind.bbLower.toFixed(2)} · ${ind.bbMid.toFixed(2)} · ${ind.bbUpper.toFixed(2)} — width ${ind.bbWidthPct?.toFixed(1)}% — price at ${pos.toFixed(0)}% (${tag})`);
  }
  if (ind.stochK14 != null) {
    const stochTag = ind.stochK14 >= 80 ? "overbought" : ind.stochK14 <= 20 ? "oversold" : "neutral";
    lines.push(`Stoch %K(14): ${ind.stochK14.toFixed(1)} (${stochTag})`);
  }
  if (ind.atr14Pct != null) lines.push(`ATR-proxy(14): ${ind.atr14Pct.toFixed(2)}% avg daily move`);
  if (ind.rsi14 != null) {
    const rsiTag = ind.rsi14 >= 70 ? "overbought" : ind.rsi14 <= 30 ? "oversold" : "neutral";
    lines.push(`RSI14: ${ind.rsi14.toFixed(1)} (${rsiTag})`);
  }
  if (ind.trendScore != null) {
    const tag = ind.trendScore >= 2 ? "strong uptrend"
      : ind.trendScore <= -2 ? "strong downtrend"
      : ind.trendScore > 0 ? "mild uptrend"
      : ind.trendScore < 0 ? "mild downtrend" : "no trend";
    lines.push(`Multi-timeframe trend score (sma 20/50/200): ${ind.trendScore >= 0 ? "+" : ""}${ind.trendScore} (${tag})`);
  }
  if (ind.high52w != null && ind.low52w != null) {
    const pos = ind.high52w !== ind.low52w
      ? ((ind.price - ind.low52w) / (ind.high52w - ind.low52w)) * 100
      : null;
    lines.push(`52w high: ${ind.high52w.toFixed(2)} · low: ${ind.low52w.toFixed(2)}${pos != null ? ` (price at ${pos.toFixed(0)}% of range)` : ""}`);
  }
  if (ind.volatility20d != null) lines.push(`20d daily volatility: ${ind.volatility20d.toFixed(2)}%`);

  // Volume signals
  if (ind.relVolume != null) {
    const rvTag = ind.relVolume >= 2 ? "MASSIVE volume — possible institutional"
      : ind.relVolume >= 1.5 ? "elevated volume — confirms move"
      : ind.relVolume >= 0.7 ? "normal volume"
      : "low volume — move lacks conviction";
    lines.push(`Relative volume: ${ind.relVolume.toFixed(2)}x 20d avg (${rvTag})`);
  }
  if (ind.vwap != null && ind.priceVsVwapPct != null) {
    const vTag = ind.priceVsVwapPct > 0.3 ? "above VWAP (intraday bullish)"
      : ind.priceVsVwapPct < -0.3 ? "below VWAP (intraday bearish)"
      : "at VWAP (neutral)";
    lines.push(`Intraday VWAP: ${ind.vwap.toFixed(2)} — price ${ind.priceVsVwapPct >= 0 ? "+" : ""}${ind.priceVsVwapPct.toFixed(2)}% vs VWAP (${vTag})`);
  }

  // Weekly timeframe — confirms or contradicts the daily call.
  if (ind.weeklySma20 != null && ind.priceVsWeeklySma20Pct != null) {
    const wTag = ind.weeklyTrendTag ?? (ind.priceVsWeeklySma20Pct > 0 ? "weekly above SMA20" : "weekly below SMA20");
    lines.push(`Weekly SMA20: ${ind.weeklySma20.toFixed(2)} — price ${ind.priceVsWeeklySma20Pct >= 0 ? "+" : ""}${ind.priceVsWeeklySma20Pct.toFixed(2)}% (${wTag})`);
  }
  if (ind.weeklyRsi14 != null) {
    const wRsiTag = ind.weeklyRsi14 >= 70 ? "weekly overbought"
      : ind.weeklyRsi14 <= 30 ? "weekly oversold"
      : "weekly neutral";
    lines.push(`Weekly RSI14: ${ind.weeklyRsi14.toFixed(1)} (${wRsiTag})`);
  }
  // Intraday momentum — critical for 1h / 4h / 0DTE scalps. The daily RSI is
  // too slow to catch a 30-minute reversal; the 5-min RSI shows it instantly.
  if (ind.intraRsi5m != null) {
    const iTag = ind.intraRsi5m >= 75 ? "5m overbought (reversal risk)"
      : ind.intraRsi5m >= 60 ? "5m strong upward momentum"
      : ind.intraRsi5m <= 25 ? "5m oversold (bounce risk)"
      : ind.intraRsi5m <= 40 ? "5m strong downward momentum"
      : "5m neutral";
    lines.push(`Intraday RSI14 (5m bars): ${ind.intraRsi5m.toFixed(1)} (${iTag})`);
  }
  if (ind.intraTrend5m != null) {
    const tTag = ind.intraTrend5m >= 0.6 ? "intraday uptrend (last 12 bars net up)"
      : ind.intraTrend5m <= -0.6 ? "intraday downtrend (last 12 bars net down)"
      : "intraday choppy";
    lines.push(`Intraday short-trend (last 1h, 5m bars): ${ind.intraTrend5m >= 0 ? "+" : ""}${(ind.intraTrend5m * 100).toFixed(1)}% net move (${tTag})`);
  }
  return lines.join("\n");
}

// Compact formatter for the model's own past predictions on this watch — used
// for self-calibration ("you've been overconfident on bullish calls — tone it
// down"). The model sees only outcomes, not prices, so it focuses on its
// hit rate per direction / action / horizon.
export interface PastPredictionRow {
  direction: string;
  action: string | null;
  horizon: string;
  confidence: number | null;
  status: EvaluationStatus;
  deltaPct: number | null;
  daysAgo: number;
}

function pastResultsBlock(rows: PastPredictionRow[]): string {
  if (!rows.length) return "(no prior predictions on this watch yet)";
  // Aggregate counters first so the model sees the headline rate.
  const dirCounts: Record<string, { settled: number; correct: number }> = {};
  let settled = 0, correct = 0;
  for (const r of rows) {
    const isSettled = r.status === "CORRECT" || r.status === "WRONG" || r.status === "TARGET_HIT";
    if (!isSettled) continue;
    settled++;
    const ok = r.status === "CORRECT" || r.status === "TARGET_HIT";
    if (ok) correct++;
    const d = (dirCounts[r.direction] ??= { settled: 0, correct: 0 });
    d.settled++;
    if (ok) d.correct++;
  }
  const lines: string[] = [];
  const overallPct = settled ? Math.round((correct / settled) * 100) : null;
  lines.push(`Overall hit rate: ${correct}/${settled} settled = ${overallPct ?? "n/a"}%`);
  for (const dir of ["BULLISH", "BEARISH", "NEUTRAL"]) {
    const d = dirCounts[dir];
    if (d && d.settled) {
      const pct = Math.round((d.correct / d.settled) * 100);
      lines.push(`  ${dir}: ${d.correct}/${d.settled} = ${pct}%`);
    }
  }
  // Per-row recent history (most recent first).
  lines.push("Recent calls (most recent first):");
  for (const r of rows.slice(0, 10)) {
    const moveStr = r.deltaPct != null ? `${r.deltaPct >= 0 ? "+" : ""}${r.deltaPct.toFixed(2)}%` : "—";
    const confStr = r.confidence != null ? ` @ conf ${r.confidence.toFixed(2)}` : "";
    lines.push(`  ${r.daysAgo}d ago: ${r.direction}/${r.action ?? "HOLD"} (${r.horizon})${confStr} → ${r.status} (${moveStr})`);
  }
  return lines.join("\n");
}

function intradayBlock(s: CandleSeries | null): string {
  if (!s || s.candles.length === 0) return "(intraday data unavailable)";
  const c = s.candles;
  const last = c[c.length - 1];
  const first = c[0];
  let hi = -Infinity;
  let lo = Infinity;
  for (const k of c) {
    if (k.h > hi) hi = k.h;
    if (k.l < lo) lo = k.l;
  }
  const session = ((last.c - first.o) / first.o) * 100;
  // Last ~20 bars summarised so the model can see momentum without 200 lines.
  const tail = c.slice(-20);
  const recent = tail
    .map((k) => `${new Date(k.t).toISOString().slice(11, 16)} O${k.o.toFixed(2)} H${k.h.toFixed(2)} L${k.l.toFixed(2)} C${k.c.toFixed(2)}`)
    .join("\n");
  return `Bars: ${c.length} · Session range: ${lo.toFixed(2)} – ${hi.toFixed(2)}\nSession move (open→close): ${session.toFixed(2)}%\nLast 20 bars (${s.interval}):\n${recent}`;
}

export async function predictMarket(args: PredictArgs): Promise<PredictionResult> {
  const start = Date.now();
  const query = `${args.name} ${args.symbol} stock market news`;
  // Earnings are only relevant for actual stocks. Skip the API call for crypto,
  // forex and indexes — they'll just say "unavailable" anyway.
  const isStockLike = args.market === "stock" || args.market === "etf";
  const [
    headlines,
    quote,
    earnings,
    dailyCandles,
    intraCandles,
    weeklyCandles,
    marketCtx,
    optionsPos,
  ] = await Promise.all([
    // Multi-source: Google general + Google 24h-recency + Yahoo per-ticker.
    fetchHeadlines(query, isStockLike ? args.symbol : undefined),
    fetchYahooQuote(args.symbol),
    isStockLike ? fetchEarnings(args.symbol) : Promise.resolve<EarningsInfo | null>(null),
    fetchYahooCandles(args.symbol, "1d", "1y"),
    fetchYahooCandles(args.symbol, "5m", "1d"),
    // Weekly bars over 2 years — used to compute the weekly trend timeframe
    // confirmation (weekly SMA20 + weekly RSI14). Failure is non-fatal.
    fetchYahooCandles(args.symbol, "1wk", "2y"),
    // Broader-market context (SPY/QQQ) — tells the model whether this stock's
    // move is idiosyncratic or just market beta. Always-on (cheap and small).
    fetchMarketContext(),
    // Options chain: put/call OI ratio + ATM IV skew. Stock-like only.
    isStockLike
      ? fetchOptionsPositioning(args.symbol)
      : Promise.resolve<OptionsPositioning | null>(null),
  ]);

  const indicators = dailyCandles
    ? computeIndicators(
        args.symbol,
        dailyCandles.candles.map((k) => k.c),
        {
          dailyVolumes: dailyCandles.candles.map((k) => k.v),
          weeklyCloses: weeklyCandles?.candles.map((k) => k.c),
          intradayCandles: intraCandles?.candles,
        },
      )
    : null;

  // Tag each headline with how fresh it is — "(2h ago)" / "(1d ago)" — so the
  // model can weight same-day catalysts higher than week-old chatter.
  const nowTs = Date.now();
  const ageTag = (publishedAt: string): string => {
    const t = Date.parse(publishedAt);
    if (!Number.isFinite(t)) return "";
    const mins = Math.max(0, Math.round((nowTs - t) / 60_000));
    if (mins < 60) return ` (${mins}m ago)`;
    const hrs = Math.round(mins / 60);
    if (hrs < 36) return ` (${hrs}h ago)`;
    const days = Math.round(hrs / 24);
    return ` (${days}d ago)`;
  };
  const headlineBlock = headlines.length
    ? headlines
        .map((h, i) => `[${i + 1}]${ageTag(h.publishedAt)} ${h.title}${h.source ? ` — ${h.source}` : ""}`)
        .join("\n")
    : "(no recent headlines fetched)";

  const quoteBlock = quote
    ? `Symbol: ${quote.symbol}\nLast price: ${quote.price ?? "n/a"}${
        quote.currency ? ` ${quote.currency}` : ""
      }\nIntraday change: ${quote.changePct?.toFixed(2) ?? "n/a"}%\nMarket state: ${
        quote.marketState ?? "n/a"
      }`
    : "(no live quote available)";

  // Broader-market context block. Computes "relative strength" (this stock vs
  // SPY/QQQ today) which is one of the cleanest day-trade signals: a stock
  // ripping +2% on a flat SPY day is FAR more bullish than +2% on a +2% SPY.
  const marketBlock = (() => {
    const lines: string[] = [];
    if (marketCtx.spy) lines.push(`SPY (S&P 500): ${marketCtx.spy.price.toFixed(2)} (${marketCtx.spy.changePct >= 0 ? "+" : ""}${marketCtx.spy.changePct.toFixed(2)}% today)`);
    if (marketCtx.qqq) lines.push(`QQQ (Nasdaq-100): ${marketCtx.qqq.price.toFixed(2)} (${marketCtx.qqq.changePct >= 0 ? "+" : ""}${marketCtx.qqq.changePct.toFixed(2)}% today)`);
    if (quote?.changePct != null && marketCtx.spy?.changePct != null) {
      const rs = quote.changePct - marketCtx.spy.changePct;
      const tag = rs > 0.5 ? "OUTPERFORMING SPY (relative strength)"
        : rs < -0.5 ? "UNDERPERFORMING SPY (relative weakness)"
        : "moving with SPY (no edge)";
      lines.push(`Relative strength vs SPY today: ${rs >= 0 ? "+" : ""}${rs.toFixed(2)}pp (${tag})`);
    }
    return lines.length ? lines.join("\n") : "(market context unavailable)";
  })();

  // Options-market positioning block. The put/call OI ratio is real-money
  // sentiment among options traders. Big skew between ATM put-IV and call-IV
  // shows what side is being bid for protection.
  const optionsBlock = (() => {
    if (!optionsPos) return "(options chain unavailable)";
    const lines: string[] = [];
    if (optionsPos.expiry) lines.push(`Front-month expiry analysed: ${optionsPos.expiry}`);
    if (optionsPos.putCallOI != null) {
      const tag = optionsPos.putCallOI >= 1.2 ? "BEARISH (puts > 1.2× calls)"
        : optionsPos.putCallOI >= 0.9 ? "neutral-bearish"
        : optionsPos.putCallOI >= 0.65 ? "neutral-bullish"
        : "BULLISH (calls dominate)";
      lines.push(`Put/Call open interest: ${optionsPos.putCallOI.toFixed(2)} (${tag})`);
    }
    if (optionsPos.putCallVolume != null) {
      const tag = optionsPos.putCallVolume >= 1.2 ? "today's flow is BEARISH"
        : optionsPos.putCallVolume >= 0.9 ? "today's flow is balanced/bearish-leaning"
        : optionsPos.putCallVolume >= 0.65 ? "today's flow is balanced/bullish-leaning"
        : "today's flow is BULLISH";
      lines.push(`Put/Call volume (today): ${optionsPos.putCallVolume.toFixed(2)} (${tag})`);
    }
    if (optionsPos.ivAtmCall != null && optionsPos.ivAtmPut != null) {
      lines.push(`ATM IV — call: ${optionsPos.ivAtmCall.toFixed(1)}% · put: ${optionsPos.ivAtmPut.toFixed(1)}%`);
    }
    if (optionsPos.ivSkew != null) {
      const tag = optionsPos.ivSkew >= 3 ? "DOWNSIDE FEAR (puts paid up)"
        : optionsPos.ivSkew >= 1 ? "mild downside hedging"
        : optionsPos.ivSkew >= -1 ? "balanced"
        : optionsPos.ivSkew >= -3 ? "upside chase"
        : "GREED (calls paid up)";
      lines.push(`IV skew (put-IV − call-IV): ${optionsPos.ivSkew >= 0 ? "+" : ""}${optionsPos.ivSkew.toFixed(1)}pp (${tag})`);
    }
    return lines.length ? lines.join("\n") : "(options chain returned no rows)";
  })();

  const prompt = `You are a quantitative market analyst inside the NeuroLinked Brain. Produce a probabilistic forecast AND an options trade signal for the asset below. Ground EVERY claim in the data shown — no speculation.

ASSET
- Symbol: ${args.symbol}
- Name: ${args.name}
- Market: ${args.market}
- Horizon: ${args.horizon}
- "Now" timestamp: ${new Date().toISOString()}
${args.notes ? `- User notes: ${args.notes}` : ""}

LIVE QUOTE
${quoteBlock}

BROADER MARKET TODAY (use this to judge if the move is idiosyncratic vs market beta)
${marketBlock}

OPTIONS-MARKET POSITIONING (real-money sentiment from the option chain)
${optionsBlock}

TECHNICAL INDICATORS (daily, last 1y — includes intraday RSI for scalping)
${indicatorsBlock(indicators)}

INTRADAY ACTION (today, 5m bars)
${intradayBlock(intraCandles)}

EARNINGS CONTEXT
${earningsBlock(earnings)}

RECENT HEADLINES (newest first; freshness in parens)
${headlineBlock}

YOUR TRACK RECORD ON THIS WATCH (self-calibration — adjust your confidence accordingly)
${pastResultsBlock(args.pastResults ?? [])}

TASK — work through this internally, then emit only the JSON:
A. SCORE each input on a -2..+2 scale and tally:
   • Trend (price vs SMA20/SMA50)
   • Momentum (RSI14 + 5d/1m % change + intraday session move)
   • Mean-reversion risk (RSI extremes, position vs 52w high/low)
   • Earnings (most recent Q1 surprise + proximity of next earnings date)
   • News tone (count of clearly bullish vs bearish headlines)
B. Pick direction from the SUM (positive → BULLISH, negative → BEARISH, |sum|≤1 → NEUTRAL).
C. Confidence = clamp(0.4 + 0.1*|sum| + 0.05*(news_signal_strength), 0, 0.95).
   Lower confidence whenever signals contradict each other.
D. Compute targetPrice with this CALIBRATED expected-value formula, NOT a guess:
     expected_pct ≈ direction_sign * (0.25 + 0.4*confidence) * min(MAX_PCT, k * volatility20d * sqrt(horizon_days))
   where:
     • volatility20d is the realised DAILY volatility (typical equity ≈ 1.5%, crypto ≈ 4%).
     • k = 1.0 for stocks/ETFs, 1.5 for crypto/forex/index/leveraged ETFs.
     • horizon_days are session-equivalents: stocks "1h"=0.15, "4h"=0.6, "1d"=1, "1w"=5, "2w"=10, "1m"=21, "3m"=63.
       For 24/7 markets (crypto/forex), "1h"=0.04, "4h"=0.17, "1d"=1, "1w"=7, "2w"=14, "1m"=30, "3m"=90 (calendar days).
     • The (0.25 + 0.4*confidence) factor is the EXPECTED VALUE of the move conditional on direction —
       roughly 25%-65% of one σ. This is statistically honest: even at confidence 0.95 you should NOT
       expect a full 1-σ move — that's already a 32% probability event. Picking targets near 1-σ
       systematically overshoots (the actual outcome lands closer to 0.5σ on average for skill > random).
   Then round to a clean tradeable tick near the live quote.
   Horizon → MAX_PCT HARD CAP (3-σ tail event, almost never to be exceeded):
     "1h"=1.5, "4h"=3.0, "1d"=5, "1w"=10, "2w"=14, "1m"=20, "3m"=30.
   WORKED EXAMPLE — equity "1h" scalp, vol=1.5%, confidence=0.7:
     1.0 * 0.015 * sqrt(0.15) * (0.25 + 0.4*0.7) ≈ 0.30% → small but real scalp on 0DTE.
   WORKED EXAMPLE — crypto "1d", vol=4%, confidence=0.7:
     1.5 * 0.04 * sqrt(1) * (0.25 + 0.4*0.7) ≈ 3.2% → a calibrated 1d crypto target.
   A target smaller than 0.15% on any horizon is useless for puts/calls (premium decay
   will eat the trade). If your computed move is < 0.15%, drop confidence below 0.55 so
   action becomes HOLD. Never emit a near-zero target with high confidence — that's worse
   than no signal at all. Never inflate a low-conviction target to look "tradeable" — the
   server will floor it for you ONLY when confidence ≥ 0.70.

OVEREXTENSION GUARD — refuse to chase parabolic moves:
  • If you want to go BULLISH and RSI14 ≥ 75 AND price is already above the upper Bollinger band
    (or > 2% above intraday VWAP), you must EITHER drop confidence to ≤ 0.55 (forces HOLD)
    OR flip to NEUTRAL — buying late into an already-stretched move is the #1 way day-traders lose.
  • Symmetric for BEARISH: if RSI14 ≤ 25 and price is below the lower BB (or > 2% below VWAP),
    do not pile on the short — exhaustion bounces are common at those extremes.
  • The only exception is a fresh same-day catalyst headline (≤ 6h old) that materially changes
    the fundamental story — earnings beat, macro print, hack, listing, partnership.

CONTEXT — THIS IS A DAY-TRADING PUTS-AND-CALLS ASSISTANT:
The user is overwhelmingly trading short-dated options (0DTE / weeklies). When the
horizon is "1h", "4h", or "1d", treat this as an intraday options scalp:
  - Lean on the LATEST intraday session move, pre-market gap, RSI14, and any
    same-day news. Multi-month earnings cycles matter much less for a 1h trade.
  - strikeHint should usually be ATM or 1-strike OTM (the cheapest delta-aware
    contract that benefits from the predicted move within the time window).
  - expiryHint should match the horizon literally: "0DTE" for 1h/4h/1d when
    same-day expiries exist (SPY/QQQ/major liquid names), otherwise the next
    weekly Friday. Never suggest 30-45 DTE for a 1h horizon.
  - entryTrigger should be a level the user can watch on a 1m / 5m chart RIGHT
    NOW (e.g. "Break above today's VWAP" or "Reject from yesterday's high").
For longer horizons ("1w", "1m", "3m"), behave normally: weekly/monthly contracts,
strikes can be 1-2 OTM, expiries 7-45 DTE depending on horizon.
E. Translate to options signal:
   - BUY_CALL when BULLISH and confidence ≥ 0.55
   - BUY_PUT when BEARISH and confidence ≥ 0.55
   - HOLD otherwise
F. Recommend strike (ATM / slightly-OTM / slightly-ITM) and expiry that fits the horizon.
G. Give a clear "entry trigger" — observable condition (e.g. "Close above $275" or "If pre-market dips below $268").
H. One-line risk note for what would invalidate the thesis.
I. Spell out the BULL CASE and BEAR CASE in 1-2 sentences each.
J. List 2-4 KEY DRIVERS citing concrete numbers from the data above.
K. List 1-3 NEXT CATALYSTS — upcoming events with approx dates if known.

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
  "bullCase": "<1-2 sentences laying out the upside thesis>",
  "bearCase": "<1-2 sentences laying out the downside thesis>",
  "keyDrivers": [<2-4 short bullet strings, each ≤ 90 chars>],
  "nextCatalysts": [<1-3 short bullet strings naming an event + approx date if known>],
  "headlineSentiments": [<one entry per headline above in order: "BULLISH" | "BEARISH" | "NEUTRAL">],
  "summary": "<one-sentence punchy verdict>",
  "reasoning": "<4-7 sentences. MUST EXPLICITLY cite: (1) the SPY/QQQ relative-strength read from BROADER MARKET TODAY, (2) the put/call ratio or IV skew from OPTIONS-MARKET POSITIONING, (3) intraday RSI / VWAP from the technicals block, (4) at least one headline by [n]. Skipping any of these = the prediction is incomplete>"
}

Rules:
- If confidence < 0.55, action MUST be "HOLD".
- BUY_CALL only with BULLISH direction, BUY_PUT only with BEARISH.
- Do not invent the strike price — base strike hints on the live quote shown.
- targetPrice MUST obey the horizon CAP in step D — there is server-side enforcement, but if you exceed it your number gets trimmed and looks unprofessional. Stay inside the cap.
- targetPrice MUST follow the volatility formula in step D. Round to a reasonable tick (e.g. $0.50 for stocks > $50, $0.10 for crypto < $5).
- If volatility20d is unavailable, assume 1.5% daily vol for stocks/ETFs, 4% for crypto.
- If earnings were unavailable, you may say so in reasoning but still produce the forecast.
- Cite headlines by [n] when you reference them; cite specific numbers (RSI value, % change, SMA price, put/call ratio) when you cite technicals or positioning.
- For 1h / 4h horizons: weight intraday RSI(5m), VWAP, options put/call flow, and SPY relative-strength FAR more than weekly/monthly trends. The latter barely move within 1 hour.
- For 1w / 1m / 3m horizons: weight daily/weekly trend, earnings, and headline themes more than intraday noise.
- No prose outside the JSON.`;

  // ── PARSING HELPERS (shared across ensemble runs) ────────────────────────
  type ParsedRun = {
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    confidence: number;
    summary: string;
    reasoning: string;
    action: TradeAction;
    strikeHint: string;
    expiryHint: string;
    entryTrigger: string;
    riskNote: string;
    targetPrice: number | null;
    bullCase: string;
    bearCase: string;
    keyDrivers: string[];
    nextCatalysts: string[];
    headlineSentiments: (Sentiment | null)[];
  };

  const parseRun = (text: string): ParsedRun => {
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(text); }
    catch { parsed = safeJsonExtract(text); }
    const grabStr = (key: string): string => {
      const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
      const m = text.match(re);
      return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim() : "";
    };
    const cleanList = (raw: unknown, max: number): string[] => {
      if (!Array.isArray(raw)) return [];
      const out: string[] = [];
      for (const item of raw) {
        if (typeof item !== "string") continue;
        const s = item.trim();
        if (s) out.push(s.length > 140 ? s.slice(0, 137) + "…" : s);
        if (out.length >= max) break;
      }
      return out;
    };
    const out: ParsedRun = {
      direction: "NEUTRAL", confidence: 0.5, summary: "", reasoning: "",
      action: "HOLD", strikeHint: "", expiryHint: "", entryTrigger: "", riskNote: "",
      targetPrice: null, bullCase: "", bearCase: "",
      keyDrivers: [], nextCatalysts: [],
      headlineSentiments: new Array(headlines.length).fill(null),
    };
    if (parsed && typeof parsed === "object") {
      out.direction = normalizeDirection(parsed.direction);
      const c = Number(parsed.confidence);
      if (Number.isFinite(c)) out.confidence = Math.max(0, Math.min(1, c));
      if (typeof parsed.summary === "string") out.summary = parsed.summary.trim();
      if (typeof parsed.reasoning === "string") out.reasoning = parsed.reasoning.trim();
      const a = String(parsed.action ?? "").toUpperCase();
      if (a === "BUY_CALL" || a === "BUY_PUT" || a === "HOLD") out.action = a;
      if (typeof parsed.strikeHint === "string") out.strikeHint = parsed.strikeHint.trim();
      if (typeof parsed.expiryHint === "string") out.expiryHint = parsed.expiryHint.trim();
      if (typeof parsed.entryTrigger === "string") out.entryTrigger = parsed.entryTrigger.trim();
      if (typeof parsed.riskNote === "string") out.riskNote = parsed.riskNote.trim();
      if (typeof parsed.bullCase === "string") out.bullCase = parsed.bullCase.trim();
      if (typeof parsed.bearCase === "string") out.bearCase = parsed.bearCase.trim();
      out.keyDrivers = cleanList(parsed.keyDrivers, 4);
      out.nextCatalysts = cleanList(parsed.nextCatalysts, 3);
      const tp = Number(parsed.targetPrice);
      if (Number.isFinite(tp) && tp > 0) out.targetPrice = tp;
      if (Array.isArray(parsed.headlineSentiments)) {
        for (let i = 0; i < headlines.length; i++) {
          const s = String(parsed.headlineSentiments[i] ?? "").toUpperCase();
          if (s === "BULLISH" || s === "BEARISH" || s === "NEUTRAL") {
            out.headlineSentiments[i] = s as Sentiment;
          }
        }
      }
    } else {
      // Recover with regex from truncated JSON.
      const dirM = text.match(/"direction"\s*:\s*"([A-Z_]+)"/i);
      if (dirM) out.direction = normalizeDirection(dirM[1]);
      const confM = text.match(/"confidence"\s*:\s*([0-9.]+)/);
      if (confM) {
        const c = Number(confM[1]);
        if (Number.isFinite(c)) out.confidence = Math.max(0, Math.min(1, c));
      }
      const actM = text.match(/"action"\s*:\s*"(BUY_CALL|BUY_PUT|HOLD)"/i);
      if (actM) out.action = actM[1].toUpperCase() as TradeAction;
      out.strikeHint = grabStr("strikeHint");
      out.expiryHint = grabStr("expiryHint");
      out.entryTrigger = grabStr("entryTrigger");
      out.riskNote = grabStr("riskNote");
      out.bullCase = grabStr("bullCase");
      out.bearCase = grabStr("bearCase");
      out.summary = grabStr("summary");
      out.reasoning = grabStr("reasoning") || text.slice(0, 4000);
      const tpM = text.match(/"targetPrice"\s*:\s*([0-9.]+)/);
      if (tpM) {
        const tp = Number(tpM[1]);
        if (Number.isFinite(tp) && tp > 0) out.targetPrice = tp;
      }
      const arrayOf = (key: string): string[] => {
        const re = new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`);
        const m = text.match(re);
        if (!m) return [];
        const items = m[1].match(/"((?:[^"\\]|\\.)*)"/g) ?? [];
        return items.map((s) => s.slice(1, -1).replace(/\\"/g, '"').trim()).filter(Boolean);
      };
      out.keyDrivers = cleanList(arrayOf("keyDrivers"), 4);
      out.nextCatalysts = cleanList(arrayOf("nextCatalysts"), 3);
    }
    return out;
  };

  // ── HYBRID ENSEMBLE: mix Gemini + Groq for cheaper, more diverse predictions ─
  // The prediction quality of an ensemble comes from MODEL DIVERSITY (different
  // architectures often disagree in informative ways) far more than it does
  // from temperature diversity within a single model. By keeping ONE Gemini
  // call as the anchor (Gemini 2.5 Flash is our highest-fidelity reasoner)
  // and filling the remaining ensemble slots with Groq's free, high-quality
  // models (Kimi K2 1T params + Llama 3.3 70B + GPT-OSS 120B), we cut Gemini
  // token usage by ~67% per prediction without sacrificing accuracy — we
  // actually GAIN architectural diversity vs running 3× same-model Gemini.
  // If Groq isn't configured, we transparently fall back to all-Gemini.
  const ensemble = Math.max(1, Math.min(5, args.ensemble ?? 1));
  const haveGroq = groqKeyCount() > 0;

  type Slot =
    | { kind: "gemini"; temperature: number; label: string }
    | { kind: "groq"; model: string; temperature: number; label: string };

  // Default ensemble lineup — Gemini stays the anchor at moderate temp; the
  // rest is Groq when available. Order doesn't matter (parallel execution).
  const groqLineup: Slot[] = [
    { kind: "groq", model: "moonshotai/kimi-k2-instruct", temperature: 0.2, label: "kimi-k2 1T" },
    { kind: "groq", model: "llama-3.3-70b-versatile",     temperature: 0.5, label: "llama-3.3 70b" },
    { kind: "groq", model: "openai/gpt-oss-120b",         temperature: 0.7, label: "gpt-oss 120b" },
    { kind: "groq", model: "qwen/qwen3-32b",              temperature: 0.4, label: "qwen3 32b" },
  ];
  const slots: Slot[] = [];
  if (haveGroq) {
    // 1 Gemini + (ensemble - 1) Groq, capped at 4 Groq lineup variants. If
    // ensemble > 5, the extras roll over to a second Gemini call.
    slots.push({ kind: "gemini", temperature: 0.4, label: "gemini-2.5-flash" });
    for (let i = 0; i < ensemble - 1; i++) {
      slots.push(groqLineup[i % groqLineup.length]);
    }
  } else {
    // No Groq keys configured — fall back to the legacy all-Gemini ensemble
    // with the original temperature spread.
    const temps = [0.1, 0.25, 0.4, 0.55, 0.7].slice(0, ensemble);
    for (const t of temps) slots.push({ kind: "gemini", temperature: t, label: "gemini-2.5-flash" });
  }

  // Helper: fire one model call and parse it. Captures the underlying error
  // string so we can surface a meaningful message if the entire ensemble
  // fails (instead of a generic "rate-limited" guess).
  const errors: string[] = [];
  const callSlot = async (slot: Slot): Promise<ParsedRun | null> => {
    try {
      let text = "";
      if (slot.kind === "gemini") {
        const res = await ai.models.generateContent({
          model: MODEL,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          // Note: no responseMimeType — prompt already instructs JSON output
          // and safeJsonExtract handles partially-formatted responses.
          config: { temperature: slot.temperature, maxOutputTokens: 6144 },
        });
        text = (res.text ?? "").trim();
      } else {
        const res = await groqChat({
          model: slot.model,
          temperature: slot.temperature,
          messages: [
            { role: "system", content: "You are a precise quantitative analyst. Respond with ONLY the requested JSON object — no prose, no markdown fences." },
            { role: "user", content: prompt },
          ],
        });
        text = (res.content ?? "").trim();
      }
      if (!text) {
        logger.warn({ symbol: args.symbol, slot: slot.label }, "ensemble run returned empty response");
        errors.push(`${slot.label}: empty response`);
        return null;
      }
      const parsed = parseRun(text);
      if (parsed) {
        logger.info({ symbol: args.symbol, slot: slot.label, dir: parsed.direction, conf: parsed.confidence }, "ensemble slot ok");
      } else {
        errors.push(`${slot.label}: unparseable JSON`);
      }
      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, symbol: args.symbol, slot: slot.label }, "ensemble run failed");
      errors.push(`${slot.label}: ${msg.slice(0, 160)}`);
      return null;
    }
  };

  let runs: ParsedRun[] = [];

  // Primary: run all slots in parallel.
  const primary = await Promise.all(slots.map(callSlot));
  runs = primary.filter((r): r is ParsedRun => r !== null);

  // Fallback: if ALL parallel runs failed, try once more on Gemini at the
  // most deterministic temperature before giving up.
  if (runs.length === 0) {
    logger.warn({ symbol: args.symbol, ensemble }, "all primary ensemble runs failed — attempting single Gemini fallback");
    const fallback = await callSlot({ kind: "gemini", temperature: 0.1, label: "gemini-2.5-flash (fallback)" });
    if (fallback) runs = [fallback];
  }

  if (runs.length === 0) {
    const allRateLimited =
      errors.length > 0 && errors.every((e) => /\b(429|quota|rate.?limit|RESOURCE_EXHAUSTED)\b/i.test(e));
    const sample = errors[0] ?? "unknown error";
    if (allRateLimited) {
      throw new Error(
        `All Gemini keys are currently rate-limited for ${args.symbol}. The pool will recover automatically as per-minute quota resets (≈60s). ` +
        `If this persists, check the API Keys page to see which keys are exhausted, or add more keys via GEMINI_API_KEY_2..GEMINI_API_KEY_20.`,
      );
    }
    throw new Error(
      `Prediction failed for ${args.symbol}: ${sample}`,
    );
  }

  // Aggregate direction by weighted vote (weighted by per-run confidence).
  const dirWeights: Record<"BULLISH" | "BEARISH" | "NEUTRAL", number> = {
    BULLISH: 0, BEARISH: 0, NEUTRAL: 0,
  };
  for (const r of runs) dirWeights[r.direction] += Math.max(0.05, r.confidence);
  let direction: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  let bestWeight = -1;
  for (const d of ["BULLISH", "BEARISH", "NEUTRAL"] as const) {
    if (dirWeights[d] > bestWeight) { bestWeight = dirWeights[d]; direction = d; }
  }
  // Confidence: mean of agreeing runs, then upweight when ALL runs agree
  // (consensus bonus) and downweight on disagreement.
  const agreeing = runs.filter((r) => r.direction === direction);
  const meanConf = agreeing.length
    ? agreeing.reduce((a, r) => a + r.confidence, 0) / agreeing.length
    : 0.5;
  const agreementRatio = agreeing.length / runs.length;     // 0..1
  // Stricter calibration: unanimous gets a small bonus, super-majority is
  // neutral, anything <2/3 agreement is treated as a real disagreement and
  // pushed toward HOLD via a hard confidence cut. We also cap absolute
  // confidence at 0.92 because models routinely emit 0.95+ on coin-flip
  // setups; trimming the upper end prevents over-sized "high conviction"
  // trades that aren't actually any more reliable than 0.80 calls.
  const consensusAdj =
    agreementRatio === 1     ? +0.05
    : agreementRatio >= 0.66 ?  0.00
    : agreementRatio >= 0.50 ? -0.15   // bare majority — meaningfully less reliable
    :                          -0.30;  // model disagreement — almost certainly noise
  let confidence = Math.max(0, Math.min(0.92, meanConf + consensusAdj));

  // Target price: median of agreeing runs (median = robust to outliers).
  const targets = agreeing.map((r) => r.targetPrice).filter((v): v is number => v != null);
  let targetPrice: number | null = null;
  if (targets.length) {
    const sorted = [...targets].sort((a, b) => a - b);
    targetPrice = sorted[Math.floor(sorted.length / 2)];
  }

  // Pick the highest-confidence agreeing run for the qualitative fields so the
  // copy stays internally consistent (instead of mixing pieces from different
  // runs which would read incoherently).
  const winner = agreeing.length
    ? agreeing.slice().sort((a, b) => b.confidence - a.confidence)[0]
    : runs[0];
  let action: TradeAction = winner.action;
  let summary = winner.summary || "No verdict produced.";
  let reasoning = winner.reasoning || "";
  let strikeHint = winner.strikeHint;
  let expiryHint = winner.expiryHint;
  let entryTrigger = winner.entryTrigger;
  let riskNote = winner.riskNote;
  let bullCase = winner.bullCase;
  let bearCase = winner.bearCase;
  let keyDrivers = winner.keyDrivers;
  let nextCatalysts = winner.nextCatalysts;

  // Apply headline sentiments — prefer the winner's, fill any gaps from others.
  for (let i = 0; i < headlines.length; i++) {
    const win = winner.headlineSentiments[i];
    if (win) { headlines[i].sentiment = win; continue; }
    for (const r of runs) {
      if (r.headlineSentiments[i]) { headlines[i].sentiment = r.headlineSentiments[i]!; break; }
    }
  }

  // Append a one-line ensemble note to reasoning so the user can see how
  // many independent runs voted for this direction.
  if (ensemble > 1) {
    const tag = `[Ensemble: ${agreeing.length}/${runs.length} runs agreed on ${direction}; consensus ${Math.round(agreementRatio * 100)}%]`;
    reasoning = reasoning ? `${reasoning}\n\n${tag}` : tag;
  }

  try {
    // ── TRACK-RECORD CALIBRATION ────────────────────────────────────────────
    // If the model has been wrong on this watch lately, downweight confidence.
    // If it's been crushing it, give it a small bump. This is the closed-loop
    // that lets the system learn — without it, a streak of wrong calls keeps
    // emitting BUY_CALL/BUY_PUT at the same confidence as a clean track record.
    const past = (args.pastResults ?? []).filter(
      (r) => r.status === "CORRECT" || r.status === "WRONG" || r.status === "TARGET_HIT",
    );
    if (past.length >= 5) {
      const correct = past.filter((r) => r.status === "CORRECT" || r.status === "TARGET_HIT").length;
      const hitRate = correct / past.length;
      let cal = 0;
      if (hitRate < 0.35)      cal = -0.18;   // bad streak — strongly downweight
      else if (hitRate < 0.45) cal = -0.10;
      else if (hitRate < 0.55) cal = -0.04;   // ~coin flip — mild trim
      else if (hitRate > 0.70) cal = +0.05;   // earned the upside
      else if (hitRate > 0.60) cal = +0.02;
      confidence = Math.max(0, Math.min(0.92, confidence + cal));
    }

    // ── OVEREXTENSION VETO ─────────────────────────────────────────────────
    // The single biggest source of bad day-trading calls is chasing a move
    // that already happened. When daily RSI ≥ 75 + price stretched above the
    // upper Bollinger band OR > 2% above intraday VWAP, going long is a
    // statistically losing trade absent a fresh catalyst. Symmetric on the
    // bearish side. We DOWNGRADE the confidence (and thus action) instead of
    // outright vetoing the direction so the model's qualitative reasoning
    // still surfaces — the user just won't get a CALL/PUT signal on it.
    if (indicators) {
      const rsi = indicators.rsi14 ?? null;
      const bbUpper = indicators.bbUpper ?? null;
      const bbLower = indicators.bbLower ?? null;
      const vwapPct = indicators.priceVsVwapPct ?? null;
      const px = indicators.price ?? quote?.price ?? null;
      const isCryptoLike = args.market === "crypto" || args.market === "forex";
      // Crypto runs hotter — push the RSI thresholds out a bit so we don't
      // over-veto perfectly normal crypto trends.
      const rsiHi = isCryptoLike ? 80 : 75;
      const rsiLo = isCryptoLike ? 20 : 25;
      const overext_bull =
        direction === "BULLISH" &&
        ((rsi != null && rsi >= rsiHi) ||
         (px != null && bbUpper != null && px > bbUpper) ||
         (vwapPct != null && vwapPct > 2.0));
      const overext_bear =
        direction === "BEARISH" &&
        ((rsi != null && rsi <= rsiLo) ||
         (px != null && bbLower != null && px < bbLower) ||
         (vwapPct != null && vwapPct < -2.0));
      // Same-day catalyst override: if a fresh (≤6h) headline exists we don't
      // veto — earnings beats, hacks, listings, macro prints all justify
      // chasing an extended move.
      const nowMs = Date.now();
      const freshCatalyst = headlines.some((h) => {
        const t = Date.parse(h.publishedAt);
        return Number.isFinite(t) && nowMs - t <= 6 * 3600_000;
      });
      if ((overext_bull || overext_bear) && !freshCatalyst) {
        const before = confidence;
        confidence = Math.min(confidence, 0.54);   // forces HOLD via the next rule
        const tag = overext_bull ? "OVEREXTENSION-VETO BULLISH" : "OVEREXTENSION-VETO BEARISH";
        reasoning = `${reasoning}\n\n[${tag}: confidence ${before.toFixed(2)} → ${confidence.toFixed(2)}; ` +
          `RSI14=${rsi?.toFixed(1) ?? "?"}, vs VWAP=${vwapPct?.toFixed(2) ?? "?"}%, ` +
          `no fresh catalyst headline within 6h. Chasing extended moves is the #1 way to lose on options.]`;
      }
    }

    // ── HARD CONSENSUS GATE ────────────────────────────────────────────────
    // Even if confidence is high, refuse to issue a directional trade when
    // <2/3 of the ensemble agreed on the direction. The disagreement itself
    // is the signal — the setup is unclear and the trade is a coin flip.
    if (agreementRatio < 0.66 && action !== "HOLD") {
      action = "HOLD";
      reasoning = `${reasoning}\n\n[CONSENSUS-GATE: only ${Math.round(agreementRatio * 100)}% of ${runs.length} ` +
        `ensemble runs agreed on ${direction} — forcing HOLD because model disagreement on a directional trade ` +
        `is itself a strong sign the setup is unclear.]`;
    }

    // Safety: enforce the rules the model is supposed to follow itself.
    if (confidence < 0.55) action = "HOLD";
    if (action === "BUY_CALL" && direction !== "BULLISH") action = "HOLD";
    if (action === "BUY_PUT" && direction !== "BEARISH") action = "HOLD";

    // Horizon-aware sanity cap on targetPrice. The previous flat ±20% cap was
    // way too generous for short horizons — a 20% intraday move is a once-a-year
    // event for most names. These caps reflect the actual statistical envelope
    // for each horizon (≈ 3-sigma at typical equity vol). Anything outside is
    // almost certainly a model hallucination, so we trim it back instead of
    // letting it distort the forecast chart and the option-trade signal.
    const HORIZON_TARGET_CAP: Record<string, number> = {
      "1h":  0.015,  // ±1.5%  in 1 hour (a strong scalp, ≈ 3σ at 1.5% daily vol)
      "4h":  0.030,  // ±3.0%  in 4 hours
      "1d":  0.050,  // ±5.0%  in a day
      "1w":  0.10,   // ±10%   in a week
      "2w":  0.14,   // ±14%   in two weeks
      "1m":  0.20,   // ±20%   in a month
      "3m":  0.30,   // ±30%   in three months
    };
    // Same horizons need a FLOOR for the day-trading use case. A 0.05% target
    // is technically inside the cap but utterly useless for puts/calls — the
    // bid/ask spread alone eats more than that. We bump tiny targets up to
    // ~1/3 of the cap when direction is BULLISH/BEARISH, so the contract has
    // a real chance to make money inside the horizon.
    //
    // CALIBRATION FIX: only apply the floor when confidence is HIGH (≥0.70).
    // Previously we floored every directional call regardless of conviction,
    // which inflated low-conviction "maybe BULLISH" targets to look like a
    // 1.2% scalp — misleading. If the model isn't confident, the small target
    // is a feature, not a bug: it tells the user "directional bias but not
    // worth a trade" and pairs with the action being HOLD.
    const HORIZON_TARGET_FLOOR: Record<string, number> = {
      "1h":  0.0030, // 0.30% — typical 1h scalp move on liquid equity
      "4h":  0.0060, // 0.60%
      "1d":  0.0100, // 1.00%
      "1w":  0.0220, // 2.2%
      "2w":  0.0320,
      "1m":  0.0450,
      "3m":  0.0750,
    };
    const cap = HORIZON_TARGET_CAP[args.horizon] ?? 0.18;
    const rawFloor = HORIZON_TARGET_FLOOR[args.horizon] ?? 0.0;
    // Floor only kicks in when confidence ≥ 0.70 — otherwise leave the small
    // target alone so it honestly reflects the model's uncertainty.
    const floor = confidence >= 0.70 ? rawFloor : 0;
    if (targetPrice && quote?.price) {
      const move = (targetPrice - quote.price) / quote.price;
      // Cap (down): trim 3σ-tail predictions back to realistic envelope.
      if (move >  cap) targetPrice = quote.price * (1 + cap);
      if (move < -cap) targetPrice = quote.price * (1 - cap);
      // Floor (up): if the model picked a HIGH-CONVICTION directional view
      // but with a target too small to scalp, expand toward floor so the
      // chart reflects a tradeable expected move (still bounded by cap above).
      if (floor > 0 && Math.abs(move) < floor) {
        if (direction === "BULLISH") targetPrice = quote.price * (1 + floor);
        else if (direction === "BEARISH") targetPrice = quote.price * (1 - floor);
        // NEUTRAL keeps the tiny target — no floor, since no trade.
      }
    }
    // Fallback: derive a target from direction + confidence if model omitted
    // it. Now covers intraday horizons too, scaled by √t so the synthetic
    // target obeys the same vol-scaling math the prompt uses.
    if (!targetPrice && quote?.price) {
      // Per-horizon σ proxy. Crypto/forex doubled because daily vol is ~2-3x
      // equity. Multiplier (0.25 + 0.4*conf) matches the prompt's calibrated
      // expected-value formula so synthetic targets don't overshoot the
      // model's own targets.
      const isCryptoLike = args.market === "crypto" || args.market === "forex";
      const base = (() => {
        const stockBase: Record<string, number> = {
          "1h":  0.004, "4h":  0.009, "1d":  0.017,
          "1w":  0.028, "2w":  0.040, "1m":  0.060, "3m":  0.100,
        };
        const cryptoBase: Record<string, number> = {
          "1h":  0.008, "4h":  0.018, "1d":  0.040,
          "1w":  0.060, "2w":  0.085, "1m":  0.130, "3m":  0.220,
        };
        const tbl = isCryptoLike ? cryptoBase : stockBase;
        return tbl[args.horizon] ?? 0.025;
      })();
      const magnitude = base * (0.25 + 0.4 * confidence);
      if (direction === "BULLISH") targetPrice = quote.price * (1 + magnitude);
      else if (direction === "BEARISH") targetPrice = quote.price * (1 - magnitude);
      else targetPrice = quote.price;
    }
  } catch (err) {
    logger.error({ err, symbol: args.symbol }, "market prediction post-processing failed");
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
    bullCase,
    bearCase,
    keyDrivers,
    nextCatalysts,
    earnings,
    model: MODEL,
    durationMs: Date.now() - start,
  };
}

/**
 * Chat with Gemini about a specific watch. Pulls live quote + headlines + the
 * latest earnings each time so the AI's answer is always current. Chat history
 * is supplied by the caller (the UI keeps it in memory) so the conversation
 * has continuity without us needing a DB table.
 */
export async function chatAboutMarket(
  ctx: ChatContext,
  history: ChatMessage[],
  userMessage: string,
): Promise<ChatReply> {
  const start = Date.now();
  const isStockLike = ctx.market === "stock" || ctx.market === "etf";
  const query = `${ctx.name} ${ctx.symbol} stock market news`;
  const [headlines, quote, earnings] = await Promise.all([
    fetchHeadlines(query, isStockLike ? ctx.symbol : undefined),
    fetchYahooQuote(ctx.symbol),
    isStockLike ? fetchEarnings(ctx.symbol) : Promise.resolve<EarningsInfo | null>(null),
  ]);

  const headlineBlock = headlines.length
    ? headlines.slice(0, 8).map((h, i) => `[${i + 1}] ${h.title}${h.source ? ` (${h.source})` : ""}`).join("\n")
    : "(no recent headlines)";
  const quoteBlock = quote
    ? `Last ${quote.price ?? "n/a"}${quote.currency ? ` ${quote.currency}` : ""}, intraday ${quote.changePct?.toFixed(2) ?? "n/a"}%, marketState ${quote.marketState ?? "n/a"}`
    : "(no live quote)";

  const systemPrompt = `You are a focused market-analysis chatbot inside the NeuroLinked Brain. The user is currently looking at this asset:

ASSET: ${ctx.symbol} — ${ctx.name} (${ctx.market})
${ctx.notes ? `User notes: ${ctx.notes}` : ""}

LIVE QUOTE: ${quoteBlock}

EARNINGS:
${earningsBlock(earnings)}

RECENT HEADLINES:
${headlineBlock}

Rules:
- Answer the user's question directly and concisely (2-6 sentences).
- Cite headlines as [n] when you use them, and reference Q1 / Q2 / etc. when you cite earnings.
- If the user asks for a price target, give a number AND say what would have to be true for it.
- If the question is off-topic for this asset, briefly steer back.
- No disclaimers about "I'm just an AI". This is a research tool; the user knows.
- No markdown headings or code fences. Plain prose.`;

  // Convert chat history into Gemini's "contents" format. Gemini uses "model"
  // for assistant turns. We prepend the system prompt as a leading user turn
  // followed by an empty model ack so the model treats it as system context.
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Understood. Ask me anything about this asset." }] },
  ];
  for (const m of history.slice(-12)) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content ?? "").slice(0, 4000) }],
    });
  }
  contents.push({ role: "user", parts: [{ text: userMessage.slice(0, 4000) }] });

  let reply = "";
  try {
    const resp = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: { temperature: 0.4, maxOutputTokens: 1024 },
    });
    reply = (resp.text ?? "").trim();
    if (!reply) reply = "I couldn't generate a reply for that — try rephrasing.";
  } catch (err) {
    logger.error({ err, symbol: ctx.symbol }, "market chat failed");
    throw err instanceof Error ? err : new Error(String(err));
  }
  return { reply, model: MODEL, durationMs: Date.now() - start };
}

const HORIZON_MS: Record<string, number> = {
  "1h": 1 * 3600_000,
  "4h": 4 * 3600_000,
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

export interface IndicatorOptions {
  /** Per-day volume aligned 1:1 with dailyCloses (last entry = today). */
  dailyVolumes?: (number | null | undefined)[];
  /** Weekly closes for the same asset (e.g. last 2y of weekly bars). */
  weeklyCloses?: number[];
  /** Today's intraday bars (for VWAP). Need .v populated to be useful. */
  intradayCandles?: CandlePoint[];
}

export function computeIndicators(
  symbol: string,
  dailyCloses: number[],
  opts: IndicatorOptions = {},
): IndicatorsResult {
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
  // EMA computed across the entire series (so MACD uses a stable history).
  const emaSeries = (n: number): number[] => {
    if (dailyCloses.length < n) return [];
    const k = 2 / (n + 1);
    let prev = 0;
    for (let i = 0; i < n; i++) prev += dailyCloses[i];
    prev /= n;
    const out: number[] = new Array(n - 1).fill(prev);
    out.push(prev);
    for (let i = n; i < dailyCloses.length; i++) {
      prev = dailyCloses[i] * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
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
  // Bollinger bands: 20-period SMA ± 2 stddev.
  const bollinger = (n = 20, k = 2) => {
    if (dailyCloses.length < n) return { mid: null, upper: null, lower: null } as const;
    const slice = dailyCloses.slice(-n);
    const mid = slice.reduce((a, b) => a + b, 0) / n;
    const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / n;
    const sd = Math.sqrt(variance);
    return { mid, upper: mid + k * sd, lower: mid - k * sd } as const;
  };
  // Stochastic %K over the last n closes (proxy without intra-bar high/low).
  const stochK = (n = 14): number | null => {
    if (dailyCloses.length < n) return null;
    const slice = dailyCloses.slice(-n);
    const hi = Math.max(...slice);
    const lo = Math.min(...slice);
    if (hi === lo) return 50;
    return ((slice[slice.length - 1] - lo) / (hi - lo)) * 100;
  };
  // ATR-style proxy from close-to-close moves (we lack intra-bar H/L here).
  const atrPct = (n = 14): number | null => {
    if (dailyCloses.length < n + 1) return null;
    let sum = 0;
    for (let i = dailyCloses.length - n; i < dailyCloses.length; i++) {
      const prev = dailyCloses[i - 1];
      if (!prev) continue;
      sum += Math.abs(dailyCloses[i] - prev) / prev;
    }
    return (sum / n) * 100;
  };
  // MACD (12,26,9)
  const ema12s = emaSeries(12);
  const ema26s = emaSeries(26);
  let macd: number | null = null;
  let macdSignal: number | null = null;
  let macdHist: number | null = null;
  if (ema12s.length === dailyCloses.length && ema26s.length === dailyCloses.length && dailyCloses.length >= 35) {
    const macdSeries: number[] = [];
    for (let i = 0; i < dailyCloses.length; i++) macdSeries.push(ema12s[i] - ema26s[i]);
    // 9-period EMA of MACD line
    const k = 2 / (9 + 1);
    let prev = 0;
    const start = Math.max(0, macdSeries.length - 50);
    let count = 0;
    for (let i = start; i < start + 9 && i < macdSeries.length; i++) { prev += macdSeries[i]; count++; }
    if (count > 0) prev /= count;
    for (let i = start + 9; i < macdSeries.length; i++) {
      prev = macdSeries[i] * k + prev * (1 - k);
    }
    macd = macdSeries[macdSeries.length - 1];
    macdSignal = prev;
    macdHist = macd - macdSignal;
  }
  const bb = bollinger(20, 2);
  const bbWidthPct = bb.mid && bb.upper != null && bb.lower != null
    ? ((bb.upper - bb.lower) / bb.mid) * 100 : null;

  // Multi-timeframe trend agreement score: +1 each for short / medium / long
  // direction agreement. -3..+3.
  const sma20v = sma(20);
  const sma50v = sma(50);
  const sma200v = sma(200);
  let trendScore: number | null = null;
  if (last != null && sma20v != null) {
    let s = 0;
    if (sma20v != null) s += last > sma20v ? 1 : -1;
    if (sma50v != null) s += last > sma50v ? 1 : -1;
    if (sma200v != null) s += last > sma200v ? 1 : -1;
    trendScore = s;
  }
  const window52 = dailyCloses.slice(-252);

  // ── Volume signals ────────────────────────────────────────────────────────
  // Relative volume = today's daily volume / 20d avg daily volume.
  let relVolume: number | null = null;
  if (opts.dailyVolumes && opts.dailyVolumes.length === dailyCloses.length) {
    const vols = opts.dailyVolumes
      .map((v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null))
      .filter((v): v is number => v != null);
    if (vols.length >= 21) {
      const today = vols[vols.length - 1];
      const past20 = vols.slice(-21, -1);
      const avg = past20.reduce((a, b) => a + b, 0) / past20.length;
      if (avg > 0 && today >= 0) relVolume = today / avg;
    }
  }
  // Intraday VWAP = Σ(price·volume) / Σ(volume) across today's bars.
  let vwap: number | null = null;
  let priceVsVwapPct: number | null = null;
  if (opts.intradayCandles && opts.intradayCandles.length) {
    let pv = 0;
    let v = 0;
    for (const k of opts.intradayCandles) {
      const typical = (k.h + k.l + k.c) / 3;
      const vol = k.v ?? 0;
      if (vol > 0) { pv += typical * vol; v += vol; }
    }
    if (v > 0) {
      vwap = pv / v;
      if (last != null && vwap > 0) priceVsVwapPct = ((last - vwap) / vwap) * 100;
    }
  }

  // ── Weekly timeframe ─────────────────────────────────────────────────────
  // Compute weekly SMA20 + RSI14 to confirm/contradict the daily call.
  let weeklySma20: number | null = null;
  let weeklyRsi14: number | null = null;
  let priceVsWeeklySma20Pct: number | null = null;
  let weeklyTrendTag: string | null = null;
  const wk = opts.weeklyCloses ?? [];
  if (wk.length >= 20) {
    const slice = wk.slice(-20);
    weeklySma20 = slice.reduce((a, b) => a + b, 0) / slice.length;
    if (last != null && weeklySma20) {
      priceVsWeeklySma20Pct = ((last - weeklySma20) / weeklySma20) * 100;
    }
  }
  if (wk.length >= 15) {
    let g = 0, l = 0;
    for (let i = wk.length - 14; i < wk.length; i++) {
      const d = wk[i] - wk[i - 1];
      if (d >= 0) g += d; else l -= d;
    }
    const ag = g / 14, al = l / 14;
    weeklyRsi14 = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  if (weeklySma20 != null && last != null && weeklyRsi14 != null) {
    const above = last > weeklySma20;
    if (above && weeklyRsi14 >= 55) weeklyTrendTag = "weekly bull";
    else if (!above && weeklyRsi14 <= 45) weeklyTrendTag = "weekly bear";
    else weeklyTrendTag = "weekly choppy";
  }

  // ── Intraday momentum (5-min RSI + last-hour net move) ──────────────────
  // Critical for short-dated options scalps. Uses today's 5m close series.
  let intraRsi5m: number | null = null;
  let intraTrend5m: number | null = null;
  if (opts.intradayCandles && opts.intradayCandles.length >= 15) {
    const closes = opts.intradayCandles.map((k) => k.c);
    // RSI14 on 5m closes
    let g = 0, l = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) g += d; else l -= d;
    }
    const ag = g / 14, al = l / 14;
    intraRsi5m = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    // Net % move over the last 12 bars (~1h of 5m bars).
    if (closes.length >= 13) {
      const past = closes[closes.length - 13];
      const now = closes[closes.length - 1];
      if (past) intraTrend5m = (now - past) / past;
    }
  }

  return {
    symbol,
    price: last,
    change1d: change(1),
    change5d: change(5),
    change1m: change(21),
    sma20: sma20v,
    sma50: sma50v,
    ema12: ema12s.length ? ema12s[ema12s.length - 1] : null,
    ema26: ema26s.length ? ema26s[ema26s.length - 1] : null,
    rsi14: rsi(14),
    macd, macdSignal, macdHist,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    bbMid: bb.mid,
    bbWidthPct,
    stochK14: stochK(14),
    atr14Pct: atrPct(14),
    high52w: window52.length ? Math.max(...window52) : null,
    low52w: window52.length ? Math.min(...window52) : null,
    volatility20d: volatility(20),
    trendScore,
    relVolume,
    vwap,
    priceVsVwapPct,
    weeklySma20,
    priceVsWeeklySma20Pct,
    weeklyRsi14,
    weeklyTrendTag,
    intraRsi5m,
    intraTrend5m,
    asOf: new Date().toISOString(),
  };
}
