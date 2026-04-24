import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Newspaper,
  Sparkles,
  Loader2,
  Trash2,
  Plus,
  RefreshCw,
  LineChart,
  ExternalLink,
  Activity,
} from "lucide-react";
import { toast } from "sonner";

interface Watch {
  id: string;
  symbol: string;
  name: string;
  market: string;
  notes: string;
  createdAt: string;
}

interface Headline {
  title: string;
  source: string;
  link: string;
  publishedAt: string;
}

interface Quote {
  symbol: string;
  price: number | null;
  changePct: number | null;
  currency: string | null;
  marketState: string | null;
  asOf: string;
}

type TradeAction = "BUY_CALL" | "BUY_PUT" | "HOLD";

interface Prediction {
  id: string;
  watchId: string;
  symbol: string;
  horizon: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  summary: string;
  reasoning: string;
  headlines: Headline[];
  quote: Quote | null;
  action: TradeAction;
  strikeHint: string;
  expiryHint: string;
  entryTrigger: string;
  riskNote: string;
  targetPrice: number | null;
  model: string;
  durationMs: number;
  createdAt: string;
  evaluation?: PredictionEvaluation;
}

interface HeadlineWithSentiment {
  title: string;
  source: string;
  link: string;
  publishedAt: string;
  sentiment?: "BULLISH" | "BEARISH" | "NEUTRAL";
}

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface CandleSeries {
  symbol: string;
  interval: string;
  range: string;
  currency: string | null;
  marketState: string | null;
  previousClose: number | null;
  candles: Candle[];
}

type EvalStatus =
  | "PENDING" | "ON_TRACK" | "OFF_TRACK"
  | "CORRECT" | "WRONG" | "TARGET_HIT" | "NO_ENTRY";

interface PredictionEvaluation {
  status: EvalStatus;
  entryPrice: number | null;
  currentPrice: number | null;
  deltaPct: number | null;
  reachedTarget: boolean;
  isDue: boolean;
}

interface TrackRecord {
  total: number;
  correct: number;
  accuracy: number | null;
  byDirection: Record<string, { total: number; correct: number }>;
  byAction: Record<string, { total: number; correct: number }>;
  live: { onTrack: number; offTrack: number; targetHits: number };
  currentPrice: number | null;
}

interface Indicators {
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

const MARKET_OPTIONS = [
  { value: "stock", label: "Stock" },
  { value: "crypto", label: "Crypto" },
  { value: "etf", label: "ETF / Index" },
  { value: "forex", label: "Forex" },
  { value: "commodity", label: "Commodity" },
];

const HORIZON_OPTIONS = [
  { value: "1d", label: "1 day" },
  { value: "1w", label: "1 week" },
  { value: "1m", label: "1 month" },
  { value: "3m", label: "3 months" },
];

export default function MarketPage() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadWatches = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/market/watches");
      const data = await r.json();
      setWatches(data.watches ?? []);
      if (!selectedId && data.watches?.[0]) setSelectedId(data.watches[0].id);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void loadWatches(); }, [loadWatches]);

  const selected = useMemo(
    () => watches.find((w) => w.id === selectedId) ?? null,
    [watches, selectedId],
  );

  const removeWatch = useCallback(async (id: string) => {
    await fetch(`/api/market/watches/${id}`, { method: "DELETE" });
    setWatches((prev) => prev.filter((w) => w.id !== id));
    if (selectedId === id) setSelectedId(null);
    toast.success("Watch removed");
  }, [selectedId]);

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <LineChart className="w-7 h-7 text-primary" />
            Market Predictor
          </h1>
          <p className="text-muted-foreground">
            Pick a market to watch. The brain pulls fresh news plus a live quote, then asks
            Gemini for a directional forecast you can rerun on demand.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
          <div className="space-y-6">
            <AddWatchForm onAdded={(w) => { setWatches((prev) => [w, ...prev]); setSelectedId(w.id); }} />
            <WatchList
              watches={watches}
              loading={loading}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRemove={removeWatch}
            />
          </div>
          <div>
            {selected ? (
              <WatchDetail watch={selected} />
            ) : (
              <Card>
                <CardContent className="py-16 text-center text-muted-foreground">
                  Select or add a market on the left to start predicting.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function AddWatchForm({ onAdded }: { onAdded: (w: Watch) => void }) {
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [market, setMarket] = useState("stock");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim()) {
      toast.error("Symbol is required (e.g. AAPL, BTC-USD, ^GSPC)");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/market/watches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, name: name || symbol, market, notes }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to add");
      toast.success(`Watching ${data.watch.symbol}`);
      onAdded(data.watch);
      setSymbol(""); setName(""); setNotes(""); setMarket("stock");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add watch");
    } finally {
      setBusy(false);
    }
  }, [symbol, name, market, notes, onAdded]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" /> Add a market to watch
        </CardTitle>
        <CardDescription>Use a Yahoo-Finance ticker. e.g. <span className="font-mono">AAPL</span>, <span className="font-mono">BTC-USD</span>, <span className="font-mono">^GSPC</span>.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Symbol</Label>
              <Input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="AAPL"
                className="font-mono"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Market</Label>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MARKET_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Display name (optional)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Apple Inc." />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Notes for the model (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Watching earnings reaction, focus on supply chain..."
              className="text-sm min-h-[60px]"
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Watch market
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function WatchList({
  watches, loading, selectedId, onSelect, onRemove,
}: {
  watches: Watch[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Watch list</CardTitle>
        <CardDescription>{watches.length ? `${watches.length} markets` : "Nothing watched yet"}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : watches.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">Add a ticker above to begin.</div>
        ) : (
          <div className="space-y-1">
            {watches.map((w) => {
              const active = w.id === selectedId;
              return (
                <div
                  key={w.id}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-2 cursor-pointer border transition ${active ? "bg-primary/10 border-primary/40" : "border-transparent hover:bg-muted"}`}
                  onClick={() => onSelect(w.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm font-semibold truncate">{w.symbol}</div>
                    <div className="text-xs text-muted-foreground truncate">{w.name}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase">{w.market}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    onClick={(e) => { e.stopPropagation(); onRemove(w.id); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WatchDetail({ watch }: { watch: Watch }) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [trackRecord, setTrackRecord] = useState<TrackRecord | null>(null);
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [horizon, setHorizon] = useState("1w");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [predRes, indRes] = await Promise.all([
        fetch(`/api/market/watches/${watch.id}/predictions`),
        fetch(`/api/market/indicators/${encodeURIComponent(watch.symbol)}`),
      ]);
      const predData = await predRes.json();
      setPredictions(predData.predictions ?? []);
      setTrackRecord(predData.trackRecord ?? null);
      if (indRes.ok) {
        const indData = await indRes.json();
        setIndicators(indData.indicators ?? null);
      } else {
        setIndicators(null);
      }
    } finally {
      setLoading(false);
    }
  }, [watch.id, watch.symbol]);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh evaluations every 30s so badges flip live as the price moves.
  useEffect(() => {
    const id = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const runPredict = useCallback(async () => {
    setPredicting(true);
    try {
      const r = await fetch(`/api/market/watches/${watch.id}/predict`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ horizon }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Prediction failed");
      setPredictions((prev) => [data.prediction, ...prev]);
      toast.success(`${data.prediction.direction} verdict for ${watch.symbol}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Prediction failed");
    } finally {
      setPredicting(false);
    }
  }, [watch.id, watch.symbol, horizon]);

  const latest = predictions[0];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <span className="font-mono">{watch.symbol}</span>
                <span className="text-base text-muted-foreground font-normal">· {watch.name}</span>
              </CardTitle>
              <CardDescription className="mt-1">
                {watch.market.toUpperCase()} watch · added {new Date(watch.createdAt).toLocaleString()}
              </CardDescription>
              {watch.notes && (
                <p className="text-xs text-muted-foreground mt-2 italic">“{watch.notes}”</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Select value={horizon} onValueChange={setHorizon}>
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HORIZON_OPTIONS.map((h) => (
                    <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={runPredict} disabled={predicting}>
                {predicting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Predicting…</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Predict now</>
                )}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => void load()}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <LivePriceChart watch={watch} prediction={latest ?? null} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrackRecordCard track={trackRecord} loading={loading} />
        <IndicatorsCard indicators={indicators} loading={loading} />
      </div>

      {latest && <PredictionCard prediction={latest} headline />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
          <CardDescription>{predictions.length} predictions on file</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : predictions.length <= 1 ? (
            <div className="text-sm text-muted-foreground italic">
              No prior predictions yet. Hit "Predict now" again later to build history.
            </div>
          ) : (
            <div className="space-y-3">
              {predictions.slice(1).map((p) => (
                <PredictionCard key={p.id} prediction={p} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function directionMeta(d: Prediction["direction"]) {
  if (d === "BULLISH") return { Icon: TrendingUp, tone: "text-green-500 bg-green-500/10 border-green-500/30" };
  if (d === "BEARISH") return { Icon: TrendingDown, tone: "text-red-500 bg-red-500/10 border-red-500/30" };
  return { Icon: Minus, tone: "text-amber-300 bg-amber-300/10 border-amber-300/30" };
}

const HORIZON_MS: Record<string, number> = {
  "1d": 24 * 3600_000,
  "1w": 7 * 24 * 3600_000,
  "1m": 30 * 24 * 3600_000,
  "3m": 90 * 24 * 3600_000,
};

const RANGE_PRESETS: Record<string, { interval: string; range: string; label: string }> = {
  "1D": { interval: "1m",  range: "1d",  label: "1D" },
  "5D": { interval: "15m", range: "5d",  label: "5D" },
  "1M": { interval: "1h",  range: "1mo", label: "1M" },
  "6M": { interval: "1d",  range: "6mo", label: "6M" },
  "1Y": { interval: "1d",  range: "1y",  label: "1Y" },
};

const RANGE_BUCKET_MS: Record<string, number> = {
  "1D": 60_000,         // 1 minute candles
  "5D": 15 * 60_000,    // 15 minute candles
  "1M": 60 * 60_000,    // 1 hour candles
  "6M": 24 * 3600_000,  // 1 day candles
  "1Y": 24 * 3600_000,  // 1 day candles
};

function LivePriceChart({
  watch,
  prediction,
}: {
  watch: Watch;
  prediction: Prediction | null;
}) {
  const [rangeKey, setRangeKey] = useState<keyof typeof RANGE_PRESETS>("1D");
  const [series, setSeries] = useState<CandleSeries | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [livePoints, setLivePoints] = useState<{ t: number; c: number }[]>([]);
  const [tickAt, setTickAt] = useState<number>(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Fetch base candles for the chosen range every 30s.
  useEffect(() => {
    let cancelled = false;
    const preset = RANGE_PRESETS[rangeKey];
    const load = async () => {
      try {
        const r = await fetch(
          `/api/market/candles/${encodeURIComponent(watch.symbol)}?interval=${preset.interval}&range=${preset.range}`,
        );
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) {
          setSeries(data.series);
          setLivePoints([]);
        }
      } catch { /* ignore */ }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [watch.symbol, rangeKey]);

  // Poll the live quote every second.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/market/quote/${encodeURIComponent(watch.symbol)}`);
        if (!r.ok) return;
        const data = await r.json();
        const p = data.quote?.price;
        if (typeof p === "number" && !cancelled) {
          const now = Date.now();
          setLivePrice(p);
          setTickAt(now);
          setLivePoints((prev) => {
            const next = [...prev, { t: now, c: p }];
            const cutoff = now - 5 * 60_000;
            return next.filter((pt) => pt.t >= cutoff);
          });
        }
      } catch { /* ignore */ }
    };
    void tick();
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [watch.symbol]);

  // On the intraday range, fold the 1-second live ticks into a "live forming"
  // candle so the wick reflects real-time volatility since the last completed
  // bar. On longer ranges the 1s ticks are meaningless and would distort scale.
  const histCandles = useMemo<Candle[]>(() => {
    const base = series?.candles ?? [];
    if (rangeKey !== "1D") return base;
    if (!livePoints.length) return base;

    const bucketMs = RANGE_BUCKET_MS["1D"];
    const lastBaseT = base.length ? base[base.length - 1].t : 0;
    // Only consider live ticks past the last completed historical bucket.
    const tail = livePoints.filter((p) => p.t > lastBaseT + bucketMs - 1);
    if (!tail.length) return base;

    const out: Candle[] = [...base];
    let cur: Candle | null = null;
    for (const tick of tail) {
      const bucketStart = Math.floor(tick.t / bucketMs) * bucketMs;
      if (!cur || cur.t !== bucketStart) {
        if (cur) out.push(cur);
        cur = { t: bucketStart, o: tick.c, h: tick.c, l: tick.c, c: tick.c };
      } else {
        if (tick.c > cur.h) cur.h = tick.c;
        if (tick.c < cur.l) cur.l = tick.c;
        cur.c = tick.c;
      }
    }
    if (cur) out.push(cur);
    return out;
  }, [series, livePoints, rangeKey]);

  const liveCandleCount = useMemo(() => {
    if (rangeKey !== "1D") return 0;
    const baseLen = series?.candles.length ?? 0;
    return Math.max(0, histCandles.length - baseLen);
  }, [histCandles, series, rangeKey]);

  const horizon = prediction?.horizon ?? "1w";
  const projectionMs = HORIZON_MS[horizon] ?? HORIZON_MS["1w"];

  // Layout: 760×280 viewBox. If we have a prediction, split into a 70% history
  // panel and a 30% forecast panel — each with its OWN y-scale so today's tiny
  // moves don't get squashed by a far-away forecast target.
  const dims = useMemo(() => {
    const w = 760, h = 280, padL = 50, padR = 18, padT = 12, padB = 28;
    const inner = w - padL - padR;
    const hasForecast = prediction?.targetPrice != null;
    const splitX = hasForecast ? padL + inner * 0.7 : w - padR;
    return { w, h, padL, padR, padT, padB, hasForecast, splitX };
  }, [prediction]);

  const histView = useMemo(() => {
    if (histCandles.length === 0) return null;
    const tMin = histCandles[0].t;
    const tMax = histCandles[histCandles.length - 1].t;

    // Scale to wick extremes (high / low), not just close — otherwise the
    // wicks get clipped and you can't see real intraday volatility.
    let pMin = Number.POSITIVE_INFINITY;
    let pMax = Number.NEGATIVE_INFINITY;
    for (const c of histCandles) {
      if (c.l < pMin) pMin = c.l;
      if (c.h > pMax) pMax = c.h;
    }
    // For the intraday view, anchor the y-range to previous close so daily
    // change is readable. (Skip on multi-day ranges to avoid stretching.)
    if (rangeKey === "1D" && series?.previousClose) {
      pMin = Math.min(pMin, series.previousClose);
      pMax = Math.max(pMax, series.previousClose);
    }
    if (pMin === pMax) { pMin -= 1; pMax += 1; }
    const pad = (pMax - pMin) * 0.08;
    pMin -= pad; pMax += pad;

    const x0 = dims.padL;
    const x1 = dims.splitX;
    const y0 = dims.padT;
    const y1 = dims.h - dims.padB;
    const innerW = x1 - x0;
    const xOf = (t: number) => x0 + ((t - tMin) / Math.max(tMax - tMin, 1)) * (x1 - x0);
    const yOf = (c: number) => y0 + (1 - (c - pMin) / Math.max(pMax - pMin, 1e-9)) * (y1 - y0);
    // Body width: leave ~30% of the slot as gap, clamp to a sane visual range.
    const slot = innerW / Math.max(histCandles.length, 1);
    const bodyW = Math.max(1, Math.min(12, slot * 0.7));
    const lastCandle = histCandles[histCandles.length - 1];
    return { xOf, yOf, pMin, pMax, tMin, tMax, lastCandle, x0, x1, y0, y1, bodyW, slot };
  }, [histCandles, rangeKey, series, dims]);

  const fcastView = useMemo(() => {
    if (!dims.hasForecast || !histView || !prediction?.targetPrice) return null;
    const start = histView.lastCandle.c;
    const target = prediction.targetPrice;
    const lo = Math.min(start, target);
    const hi = Math.max(start, target);
    const span = Math.max(hi - lo, Math.abs(start) * 0.005);
    const pad = span * 0.4;
    const pMin = lo - pad;
    const pMax = hi + pad;

    const x0 = dims.splitX;
    const x1 = dims.w - dims.padR;
    const y0 = dims.padT;
    const y1 = dims.h - dims.padB;
    const tStart = histView.lastCandle.t;
    const tEnd = tStart + projectionMs;
    const xOf = (t: number) => x0 + ((t - tStart) / Math.max(tEnd - tStart, 1)) * (x1 - x0);
    const yOf = (c: number) => y0 + (1 - (c - pMin) / Math.max(pMax - pMin, 1e-9)) * (y1 - y0);

    const color = prediction.direction === "BULLISH" ? "#22c55e"
      : prediction.direction === "BEARISH" ? "#ef4444"
      : "#fbbf24";
    return {
      xOf, yOf, pMin, pMax, color, tStart, tEnd, target,
      startY: yOf(start), endY: yOf(target),
      startX: x0, endX: x1, y0, y1,
    };
  }, [dims, histView, prediction, projectionMs]);

  const fmtPrice = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 2 : 4 });
  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    if (rangeKey === "1D") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (rangeKey === "5D") return d.toLocaleString([], { weekday: "short", hour: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };
  const currency = series?.currency ?? prediction?.quote?.currency ?? "";
  const change = livePrice != null && series?.previousClose
    ? ((livePrice - series.previousClose) / series.previousClose) * 100
    : null;
  const changeTone = change == null ? "text-muted-foreground" : change >= 0 ? "text-green-400" : "text-red-400";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary animate-pulse" />
              Live chart · {watch.symbol}
            </CardTitle>
            <CardDescription className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span>{rangeKey === "1D" ? "1-min candles + 1s live ticks" : `${RANGE_PRESETS[rangeKey].interval} candles · ${RANGE_PRESETS[rangeKey].range}`}</span>
              {prediction?.targetPrice && <span>· forecast to {horizon}</span>}
              {series?.marketState && (
                <Badge variant="outline" className="text-[10px] uppercase">{series.marketState}</Badge>
              )}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-mono font-bold tabular-nums">
              {livePrice != null ? `${fmtPrice(livePrice)}` : "—"}
              {currency && <span className="text-xs text-muted-foreground ml-1">{currency}</span>}
            </div>
            <div className={`text-xs ${changeTone}`}>
              {change != null ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}% today` : ""}
              {tickAt ? <span className="ml-2 text-muted-foreground">· {new Date(tickAt).toLocaleTimeString()}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex gap-1 pt-1">
          {Object.keys(RANGE_PRESETS).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={rangeKey === k ? "default" : "outline"}
              className="h-6 px-2 text-[11px]"
              onClick={() => setRangeKey(k as keyof typeof RANGE_PRESETS)}
            >{k}</Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {!histView ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            Loading market data…
          </div>
        ) : (
          <svg viewBox={`0 0 ${dims.w} ${dims.h}`} className="w-full h-[280px]">
            {/* HISTORY PANEL */}
            {/* horizontal grid */}
            {[0.25, 0.5, 0.75].map((f) => {
              const y = histView.y0 + f * (histView.y1 - histView.y0);
              return <line key={`hg${f}`} x1={histView.x0} x2={histView.x1} y1={y} y2={y}
                stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="2 4" />;
            })}
            {/* y labels (history) */}
            {[0, 0.5, 1].map((f) => {
              const y = histView.y0 + f * (histView.y1 - histView.y0);
              const v = histView.pMax - f * (histView.pMax - histView.pMin);
              return <text key={`hy${f}`} x={histView.x0 - 6} y={y + 3} textAnchor="end" fontSize="10"
                fill="hsl(var(--muted-foreground))" fontFamily="monospace">{fmtPrice(v)}</text>;
            })}
            {/* x labels (history) */}
            {[0, 0.5, 1].map((f) => {
              const x = histView.x0 + f * (histView.x1 - histView.x0);
              const t = histView.tMin + f * (histView.tMax - histView.tMin);
              return <text key={`hx${f}`} x={x} y={dims.h - 8} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
                fontSize="10" fill="hsl(var(--muted-foreground))" fontFamily="monospace">{fmtTime(t)}</text>;
            })}
            {/* prev close reference (intraday only) */}
            {rangeKey === "1D" && series?.previousClose && (
              <>
                <line
                  x1={histView.x0}
                  x2={histView.x1}
                  y1={histView.yOf(series.previousClose)}
                  y2={histView.yOf(series.previousClose)}
                  stroke="hsl(var(--muted-foreground))" strokeWidth={0.7} strokeDasharray="3 3" opacity={0.6}
                />
                <text x={histView.x1 - 4} y={histView.yOf(series.previousClose) - 3}
                  textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))">prev close</text>
              </>
            )}
            {/* OHLC candles — wick = high/low, body = open/close */}
            {histCandles.map((c, i) => {
              const x = histView.xOf(c.t);
              const yH = histView.yOf(c.h);
              const yL = histView.yOf(c.l);
              const yO = histView.yOf(c.o);
              const yC = histView.yOf(c.c);
              const up = c.c >= c.o;
              const color = up ? "#22c55e" : "#ef4444";
              const bodyTop = Math.min(yO, yC);
              // Doji guard: ensure the body is visible even when o == c.
              const bodyH = Math.max(1, Math.abs(yC - yO));
              const baseLen = series?.candles.length ?? 0;
              const isLive = rangeKey === "1D" && i >= baseLen;
              const dimmed = hoverIdx != null && hoverIdx !== i;
              return (
                <g key={`cdl${i}`} opacity={dimmed ? 0.45 : 1}>
                  <line
                    x1={x} x2={x} y1={yH} y2={yL}
                    stroke={color} strokeWidth={1}
                    strokeLinecap="round"
                  />
                  <rect
                    x={x - histView.bodyW / 2}
                    y={bodyTop}
                    width={histView.bodyW}
                    height={bodyH}
                    fill={up ? color : color}
                    opacity={isLive ? 0.65 : 1}
                    stroke={color}
                    strokeWidth={isLive ? 1.2 : 0.5}
                  />
                </g>
              );
            })}
            {/* Invisible hover hit-areas — one per slot — so the cursor can pick
                even thin candles. Drawn on top so they capture mouse events. */}
            {histCandles.map((c, i) => {
              const x = histView.xOf(c.t);
              const w = Math.max(histView.bodyW + 2, histView.slot);
              return (
                <rect
                  key={`hit${i}`}
                  x={x - w / 2}
                  y={histView.y0}
                  width={w}
                  height={histView.y1 - histView.y0}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                />
              );
            })}
            {/* Live pulse on the most recent candle's close */}
            {livePrice != null && histView.lastCandle && (
              <>
                <circle
                  cx={histView.xOf(histView.lastCandle.t)}
                  cy={histView.yOf(histView.lastCandle.c)}
                  r={3}
                  fill="hsl(var(--primary))"
                />
                <circle
                  cx={histView.xOf(histView.lastCandle.t)}
                  cy={histView.yOf(histView.lastCandle.c)}
                  r={7}
                  fill="hsl(var(--primary))"
                  opacity={0.25}
                >
                  <animate attributeName="r" values="3;9;3" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0;0.4" dur="1.4s" repeatCount="indefinite" />
                </circle>
              </>
            )}
            {/* OHLC tooltip for hovered candle */}
            {hoverIdx != null && histCandles[hoverIdx] && (() => {
              const c = histCandles[hoverIdx];
              const x = histView.xOf(c.t);
              const tipW = 116;
              const tipH = 78;
              // Anchor tooltip to whichever side has more room.
              const tipX = x + tipW + 4 > histView.x1
                ? Math.max(histView.x0, x - tipW - 6)
                : x + 6;
              const tipY = Math.max(histView.y0, histView.yOf(c.h) - tipH - 4);
              const up = c.c >= c.o;
              const baseLen = series?.candles.length ?? 0;
              const isLive = rangeKey === "1D" && hoverIdx >= baseLen;
              const tipColor = up ? "#22c55e" : "#ef4444";
              return (
                <g pointerEvents="none">
                  {/* crosshair */}
                  <line x1={x} x2={x} y1={histView.y0} y2={histView.y1}
                    stroke="hsl(var(--muted-foreground))" strokeDasharray="2 3" opacity={0.5} />
                  <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={4}
                    fill="hsl(var(--background))" stroke={tipColor} strokeWidth={1} opacity={0.95} />
                  <text x={tipX + 6} y={tipY + 13} fontSize="9.5" fontFamily="monospace"
                    fill="hsl(var(--muted-foreground))">
                    {fmtTime(c.t)}{isLive ? " · live" : ""}
                  </text>
                  <text x={tipX + 6} y={tipY + 27} fontSize="10" fontFamily="monospace" fill="hsl(var(--foreground))">
                    O <tspan fill={tipColor}>{fmtPrice(c.o)}</tspan>
                  </text>
                  <text x={tipX + 6} y={tipY + 40} fontSize="10" fontFamily="monospace" fill="hsl(var(--foreground))">
                    H <tspan fill="#22c55e">{fmtPrice(c.h)}</tspan>
                  </text>
                  <text x={tipX + 6} y={tipY + 53} fontSize="10" fontFamily="monospace" fill="hsl(var(--foreground))">
                    L <tspan fill="#ef4444">{fmtPrice(c.l)}</tspan>
                  </text>
                  <text x={tipX + 6} y={tipY + 66} fontSize="10" fontFamily="monospace" fill="hsl(var(--foreground))">
                    C <tspan fill={tipColor}>{fmtPrice(c.c)}</tspan>
                  </text>
                </g>
              );
            })()}

            {/* DIVIDER + FORECAST PANEL */}
            {fcastView && (
              <>
                <line x1={dims.splitX} x2={dims.splitX} y1={dims.padT} y2={dims.h - dims.padB}
                  stroke="hsl(var(--muted-foreground))" strokeDasharray="2 3" opacity={0.6} />
                <text x={dims.splitX + 4} y={dims.padT + 10} fontSize="9" fill="hsl(var(--muted-foreground))">now</text>
                {/* forecast grid */}
                {[0.25, 0.5, 0.75].map((f) => {
                  const y = fcastView.y0 + f * (fcastView.y1 - fcastView.y0);
                  return <line key={`fg${f}`} x1={fcastView.startX} x2={fcastView.endX} y1={y} y2={y}
                    stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="2 4" />;
                })}
                {/* forecast y-labels (right side) */}
                {[0, 1].map((f) => {
                  const y = fcastView.y0 + f * (fcastView.y1 - fcastView.y0);
                  const v = fcastView.pMax - f * (fcastView.pMax - fcastView.pMin);
                  return <text key={`fy${f}`} x={fcastView.endX + 2} y={y + 3} textAnchor="start"
                    fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="monospace">{fmtPrice(v)}</text>;
                })}
                {/* x label at forecast end */}
                <text x={fcastView.endX} y={dims.h - 8} textAnchor="end" fontSize="10"
                  fill={fcastView.color} fontFamily="monospace">{horizon}</text>
                {/* projection line */}
                <line x1={fcastView.startX} y1={fcastView.startY}
                  x2={fcastView.endX} y2={fcastView.endY}
                  stroke={fcastView.color} strokeWidth={2.2} strokeDasharray="6 4" />
                {/* projection envelope */}
                <path d={`M${fcastView.startX} ${fcastView.startY} L${fcastView.endX} ${fcastView.endY} L${fcastView.endX} ${fcastView.y1} L${fcastView.startX} ${fcastView.y1} Z`}
                  fill={fcastView.color} opacity={0.06} />
                {/* target dot + label */}
                <circle cx={fcastView.endX} cy={fcastView.endY} r={4} fill={fcastView.color} />
                <text x={fcastView.endX - 4} y={fcastView.endY - 8} textAnchor="end"
                  fontSize="10" fill={fcastView.color} fontFamily="monospace">
                  target {prediction?.targetPrice ? fmtPrice(prediction.targetPrice) : ""}
                </text>
              </>
            )}
          </svg>
        )}
        {prediction?.targetPrice && livePrice != null && (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
            <span>
              Forecast {horizon}: <span className="font-mono text-foreground">{fmtPrice(prediction.targetPrice)}</span>
              <span className={prediction.targetPrice >= livePrice ? "text-green-400 ml-1" : "text-red-400 ml-1"}>
                ({((prediction.targetPrice - livePrice) / livePrice * 100 >= 0 ? "+" : "")}{(((prediction.targetPrice - livePrice) / livePrice) * 100).toFixed(2)}%)
              </span>
            </span>
            <span>·</span>
            <span>From last prediction at {new Date(prediction.createdAt).toLocaleTimeString()}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function evalMeta(s: EvalStatus | undefined) {
  switch (s) {
    case "CORRECT": return { label: "✓ Correct", tone: "bg-green-500/15 text-green-400 border-green-500/40" };
    case "TARGET_HIT": return { label: "★ Target hit", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" };
    case "WRONG": return { label: "✗ Wrong", tone: "bg-red-500/15 text-red-400 border-red-500/40" };
    case "ON_TRACK": return { label: "↗ On track", tone: "bg-green-500/10 text-green-300 border-green-500/30" };
    case "OFF_TRACK": return { label: "↘ Off track", tone: "bg-red-500/10 text-red-300 border-red-500/30" };
    case "PENDING": return { label: "⏳ Pending", tone: "bg-muted text-muted-foreground border-border" };
    case "NO_ENTRY": return { label: "n/a", tone: "bg-muted text-muted-foreground border-border" };
    default: return { label: "—", tone: "bg-muted text-muted-foreground border-border" };
  }
}

function TrackRecordCard({ track, loading }: { track: TrackRecord | null; loading: boolean }) {
  const accPct = track?.accuracy != null ? Math.round(track.accuracy * 100) : null;
  const accTone =
    accPct == null ? "text-muted-foreground"
    : accPct >= 65 ? "text-green-400"
    : accPct >= 50 ? "text-amber-300"
    : "text-red-400";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" /> Track record
        </CardTitle>
        <CardDescription>How often this predictor has been right on {track ? "settled" : "past"} calls.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && !track ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !track || track.total === 0 ? (
          <div className="space-y-2">
            <div className={`text-3xl font-bold ${accTone}`}>—</div>
            <div className="text-xs text-muted-foreground">
              No predictions have settled yet (need horizon to elapse). Live status of open calls is shown below.
            </div>
            {track && (
              <div className="flex flex-wrap gap-2 pt-2 text-xs">
                <Badge variant="outline" className="text-green-300 border-green-500/40">
                  ↗ On track: {track.live.onTrack}
                </Badge>
                <Badge variant="outline" className="text-red-300 border-red-500/40">
                  ↘ Off track: {track.live.offTrack}
                </Badge>
                <Badge variant="outline" className="text-emerald-300 border-emerald-500/40">
                  ★ Target hit: {track.live.targetHits}
                </Badge>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <div className={`text-4xl font-bold tabular-nums ${accTone}`}>{accPct}%</div>
              <div className="text-sm text-muted-foreground">
                {track.correct}/{track.total} settled correctly
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {(["BULLISH", "BEARISH", "NEUTRAL"] as const).map((d) => {
                const row = track.byDirection[d];
                const pct = row.total ? Math.round((row.correct / row.total) * 100) : null;
                return (
                  <div key={d} className="rounded border border-border/60 px-2 py-1.5 bg-muted/30">
                    <div className="text-[10px] uppercase text-muted-foreground">{d}</div>
                    <div className="font-mono text-sm">
                      {pct != null ? `${pct}%` : "—"}
                      <span className="text-muted-foreground text-[11px] ml-1">({row.correct}/{row.total})</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {(["BUY_CALL", "BUY_PUT", "HOLD"] as const).map((a) => {
                const row = track.byAction[a];
                const pct = row.total ? Math.round((row.correct / row.total) * 100) : null;
                return (
                  <div key={a} className="rounded border border-border/60 px-2 py-1.5 bg-muted/30">
                    <div className="text-[10px] uppercase text-muted-foreground">{a.replace("_"," ")}</div>
                    <div className="font-mono text-sm">
                      {pct != null ? `${pct}%` : "—"}
                      <span className="text-muted-foreground text-[11px] ml-1">({row.correct}/{row.total})</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 text-xs pt-1">
              <Badge variant="outline" className="text-green-300 border-green-500/40">↗ Open on track: {track.live.onTrack}</Badge>
              <Badge variant="outline" className="text-red-300 border-red-500/40">↘ Open off track: {track.live.offTrack}</Badge>
              <Badge variant="outline" className="text-emerald-300 border-emerald-500/40">★ Target hits: {track.live.targetHits}</Badge>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function IndicatorsCard({ indicators, loading }: { indicators: Indicators | null; loading: boolean }) {
  const fmt = (v: number | null, opts?: { pct?: boolean; digits?: number }) =>
    v == null ? "—" : `${v.toFixed(opts?.digits ?? 2)}${opts?.pct ? "%" : ""}`;
  const tone = (v: number | null) => v == null ? "text-muted-foreground" : v >= 0 ? "text-green-400" : "text-red-400";
  const rsiTone = (v: number | null) =>
    v == null ? "text-muted-foreground"
    : v >= 70 ? "text-red-400"
    : v <= 30 ? "text-green-400"
    : "text-foreground";
  const rsiHint = (v: number | null) =>
    v == null ? "" : v >= 70 ? "overbought" : v <= 30 ? "oversold" : "neutral";

  // Where is price in its 52-week range? (0% = at 52w low, 100% = at 52w high)
  const pos52 =
    indicators?.price && indicators.high52w && indicators.low52w && indicators.high52w > indicators.low52w
      ? ((indicators.price - indicators.low52w) / (indicators.high52w - indicators.low52w)) * 100
      : null;

  // Trend from SMA cross
  let trend: { label: string; tone: string } | null = null;
  if (indicators?.sma20 != null && indicators.sma50 != null && indicators.price != null) {
    if (indicators.price > indicators.sma20 && indicators.sma20 > indicators.sma50) {
      trend = { label: "Uptrend (price > 20 > 50)", tone: "text-green-400" };
    } else if (indicators.price < indicators.sma20 && indicators.sma20 < indicators.sma50) {
      trend = { label: "Downtrend (price < 20 < 50)", tone: "text-red-400" };
    } else {
      trend = { label: "Mixed / consolidating", tone: "text-amber-300" };
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <LineChart className="w-4 h-4 text-primary" /> Technical context
        </CardTitle>
        <CardDescription>Quick-glance signals to sanity-check the AI's call.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading && !indicators ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !indicators ? (
          <div className="text-sm text-muted-foreground italic">Indicators unavailable for this symbol.</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border border-border/60 px-2 py-1.5 bg-muted/30">
                <div className="text-[10px] uppercase text-muted-foreground">1d</div>
                <div className={`font-mono ${tone(indicators.change1d)}`}>{fmt(indicators.change1d, { pct: true })}</div>
              </div>
              <div className="rounded border border-border/60 px-2 py-1.5 bg-muted/30">
                <div className="text-[10px] uppercase text-muted-foreground">5d</div>
                <div className={`font-mono ${tone(indicators.change5d)}`}>{fmt(indicators.change5d, { pct: true })}</div>
              </div>
              <div className="rounded border border-border/60 px-2 py-1.5 bg-muted/30">
                <div className="text-[10px] uppercase text-muted-foreground">1m</div>
                <div className={`font-mono ${tone(indicators.change1m)}`}>{fmt(indicators.change1m, { pct: true })}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-border/60 px-2 py-1.5 bg-muted/30">
                <div className="text-[10px] uppercase text-muted-foreground">SMA 20</div>
                <div className="font-mono">{fmt(indicators.sma20)}</div>
              </div>
              <div className="rounded border border-border/60 px-2 py-1.5 bg-muted/30">
                <div className="text-[10px] uppercase text-muted-foreground">SMA 50</div>
                <div className="font-mono">{fmt(indicators.sma50)}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-border/60 px-2 py-1.5 bg-muted/30">
                <div className="text-[10px] uppercase text-muted-foreground">RSI 14</div>
                <div className={`font-mono ${rsiTone(indicators.rsi14)}`}>
                  {fmt(indicators.rsi14, { digits: 1 })}
                  <span className="text-muted-foreground text-[10px] ml-1">{rsiHint(indicators.rsi14)}</span>
                </div>
              </div>
              <div className="rounded border border-border/60 px-2 py-1.5 bg-muted/30">
                <div className="text-[10px] uppercase text-muted-foreground">Volatility (20d)</div>
                <div className="font-mono">{fmt(indicators.volatility20d, { pct: true, digits: 2 })}</div>
              </div>
            </div>

            {pos52 != null && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">52-week range</span>
                  <span className="font-mono">
                    {fmt(indicators.low52w)} – {fmt(indicators.high52w)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden relative">
                  <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-500/40 via-amber-300/40 to-green-500/40 w-full" />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2 h-3 bg-foreground rounded-sm"
                    style={{ left: `calc(${pos52.toFixed(1)}% - 4px)` }}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground text-right">
                  Price at {pos52.toFixed(0)}% of 52w range
                </div>
              </div>
            )}

            {trend && (
              <div className={`text-xs font-medium ${trend.tone}`}>
                Trend: {trend.label}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function actionMeta(a: TradeAction) {
  if (a === "BUY_CALL") return {
    label: "BUY CALL",
    tone: "bg-green-500/15 border-green-500/50 text-green-400",
    Icon: TrendingUp,
    blurb: "Bullish — open a CALL option",
  };
  if (a === "BUY_PUT") return {
    label: "BUY PUT",
    tone: "bg-red-500/15 border-red-500/50 text-red-400",
    Icon: TrendingDown,
    blurb: "Bearish — open a PUT option",
  };
  return {
    label: "HOLD / WAIT",
    tone: "bg-amber-300/10 border-amber-300/40 text-amber-300",
    Icon: Minus,
    blurb: "Conviction too low — stay flat for now",
  };
}

function PredictionCard({ prediction, headline }: { prediction: Prediction; headline?: boolean }) {
  const meta = directionMeta(prediction.direction);
  const Icon = meta.Icon;
  const pct = Math.round(prediction.confidence * 100);
  const trade = actionMeta(prediction.action);
  const TradeIcon = trade.Icon;
  return (
    <Card className={headline ? "border-primary/40" : undefined}>
      <CardContent className="pt-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold ${meta.tone}`}>
            <Icon className="w-3.5 h-3.5" /> {prediction.direction}
          </div>
          <Badge variant="outline" className="text-[10px] uppercase">Horizon {prediction.horizon}</Badge>
          <Badge variant="outline" className="text-[10px]">Confidence {pct}%</Badge>
          {prediction.evaluation && (
            <Badge variant="outline" className={`text-[10px] ${evalMeta(prediction.evaluation.status).tone}`}>
              {evalMeta(prediction.evaluation.status).label}
              {prediction.evaluation.deltaPct != null && (
                <span className="ml-1 opacity-80 font-mono">
                  {prediction.evaluation.deltaPct >= 0 ? "+" : ""}
                  {prediction.evaluation.deltaPct.toFixed(2)}%
                </span>
              )}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {new Date(prediction.createdAt).toLocaleString()}
          </span>
        </div>

        <div className={`rounded-lg border p-4 ${trade.tone}`}>
          <div className="flex items-center gap-2 text-lg font-extrabold tracking-wide">
            <TradeIcon className="w-5 h-5" /> {trade.label}
          </div>
          <div className="text-xs opacity-90 mt-0.5">{trade.blurb}</div>
          {(prediction.strikeHint || prediction.expiryHint || prediction.entryTrigger || prediction.riskNote) && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs text-foreground">
              {prediction.strikeHint && (
                <div><span className="font-semibold opacity-80">Strike:</span> {prediction.strikeHint}</div>
              )}
              {prediction.expiryHint && (
                <div><span className="font-semibold opacity-80">Expiry:</span> {prediction.expiryHint}</div>
              )}
              {prediction.entryTrigger && (
                <div className="sm:col-span-2"><span className="font-semibold opacity-80">Enter when:</span> {prediction.entryTrigger}</div>
              )}
              {prediction.riskNote && (
                <div className="sm:col-span-2 text-amber-300/90"><span className="font-semibold">Invalidated if:</span> {prediction.riskNote}</div>
              )}
            </div>
          )}
        </div>

        <div className="text-base font-medium leading-snug">{prediction.summary}</div>

        {prediction.quote && (
          <div className="text-xs text-muted-foreground font-mono">
            Quote at run: {prediction.quote.price ?? "n/a"}
            {prediction.quote.currency ? ` ${prediction.quote.currency}` : ""}
            {typeof prediction.quote.changePct === "number" ? (
              <span className={prediction.quote.changePct >= 0 ? "text-green-400" : "text-red-400"}>
                {" "}({prediction.quote.changePct.toFixed(2)}%)
              </span>
            ) : null}
            {prediction.quote.marketState ? ` · ${prediction.quote.marketState}` : ""}
          </div>
        )}

        {prediction.reasoning && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {prediction.reasoning}
          </p>
        )}

        {prediction.headlines?.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-border/40">
            <div className="text-xs uppercase font-semibold text-muted-foreground flex items-center gap-1.5">
              <Newspaper className="w-3.5 h-3.5" /> Headlines used
            </div>
            <ul className="space-y-1">
              {(prediction.headlines as HeadlineWithSentiment[]).map((h, i) => {
                const sentTone =
                  h.sentiment === "BULLISH" ? "bg-green-500" :
                  h.sentiment === "BEARISH" ? "bg-red-500" :
                  h.sentiment === "NEUTRAL" ? "bg-amber-300" : "bg-muted-foreground/30";
                return (
                  <li key={i} className="text-xs flex items-start gap-2">
                    <span className="text-muted-foreground font-mono">[{i + 1}]</span>
                    <span
                      title={h.sentiment ?? "no sentiment"}
                      className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${sentTone}`}
                    />
                    <a
                      href={h.link}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline text-foreground/90 flex-1"
                    >
                      {h.title}
                      {h.source && <span className="text-muted-foreground"> · {h.source}</span>}
                      <ExternalLink className="inline w-3 h-3 ml-1 opacity-60" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="text-[10px] text-muted-foreground font-mono">
          model: {prediction.model} · {prediction.durationMs} ms
        </div>
      </CardContent>
    </Card>
  );
}
