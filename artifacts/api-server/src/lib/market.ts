import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";

export interface NewsHeadline {
  title: string;
  source: string;
  link: string;
  publishedAt: string;
}

export interface MarketQuote {
  symbol: string;
  price: number | null;
  changePct: number | null;
  currency: string | null;
  marketState: string | null;
  asOf: string;
}

export interface PredictionResult {
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  horizon: string;
  summary: string;
  reasoning: string;
  headlines: NewsHeadline[];
  quote: MarketQuote | null;
  model: string;
  durationMs: number;
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

  const prompt = `You are a market analysis assistant inside the NeuroLinked Brain. Produce a probabilistic forecast for the asset below.

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
Weigh the headlines, sentiment and quote to predict the most likely directional bias for the given horizon. Be honest about uncertainty.

Respond with STRICT JSON only, matching this shape:
{
  "direction": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": <number between 0 and 1>,
  "summary": "<one-sentence punchy verdict>",
  "reasoning": "<3-6 sentences citing the headlines by [n] when possible>"
}

Do not include any prose outside the JSON. Do not invent prices.`;

  let direction: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  let confidence = 0.5;
  let summary = "No verdict produced.";
  let reasoning = "";

  try {
    const resp = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 2048,
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
    if (parsed && typeof parsed === "object") {
      direction = normalizeDirection(parsed.direction);
      const c = Number(parsed.confidence);
      if (Number.isFinite(c)) confidence = Math.max(0, Math.min(1, c));
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        summary = parsed.summary.trim();
      }
      if (typeof parsed.reasoning === "string" && parsed.reasoning.trim()) {
        reasoning = parsed.reasoning.trim();
      }
    } else {
      // Truncated / malformed JSON — recover the fields with regex.
      const dirM = text.match(/"direction"\s*:\s*"([A-Z]+)"/i);
      if (dirM) direction = normalizeDirection(dirM[1]);
      const confM = text.match(/"confidence"\s*:\s*([0-9.]+)/);
      if (confM) {
        const c = Number(confM[1]);
        if (Number.isFinite(c)) confidence = Math.max(0, Math.min(1, c));
      }
      const sumM = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (sumM) summary = sumM[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim() || summary;
      const reaM = text.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
      if (reaM) reasoning = reaM[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
      else reasoning = text.slice(0, 4000);
    }
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
    model: MODEL,
    durationMs: Date.now() - start,
  };
}
