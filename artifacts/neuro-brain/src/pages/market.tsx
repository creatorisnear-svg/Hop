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
}

interface CandleSeries {
  symbol: string;
  interval: string;
  range: string;
  currency: string | null;
  marketState: string | null;
  previousClose: number | null;
  candles: { t: number; c: number }[];
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
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [horizon, setHorizon] = useState("1w");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/market/watches/${watch.id}/predictions`);
      const data = await r.json();
      setPredictions(data.predictions ?? []);
    } finally {
      setLoading(false);
    }
  }, [watch.id]);

  useEffect(() => { void load(); }, [load]);

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

function LivePriceChart({
  watch,
  prediction,
}: {
  watch: Watch;
  prediction: Prediction | null;
}) {
  const [series, setSeries] = useState<CandleSeries | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [livePoints, setLivePoints] = useState<{ t: number; c: number }[]>([]);
  const [tickAt, setTickAt] = useState<number>(0);

  // Fetch base intraday candles every 30s.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/market/candles/${encodeURIComponent(watch.symbol)}?interval=5m&range=1d`);
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
  }, [watch.symbol]);

  // Poll the live quote every second and append to the live tail.
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
            // keep last 5 minutes of 1-second ticks
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

  const allPoints = useMemo(() => {
    const base = series?.candles ?? [];
    const lastBaseT = base.length ? base[base.length - 1].t : 0;
    const tail = livePoints.filter((p) => p.t > lastBaseT);
    return [...base, ...tail];
  }, [series, livePoints]);

  const horizon = prediction?.horizon ?? "1w";
  const projectionMs = HORIZON_MS[horizon] ?? HORIZON_MS["1w"];

  const dims = { w: 760, h: 280, padL: 50, padR: 16, padT: 12, padB: 28 };

  const view = useMemo(() => {
    if (allPoints.length === 0) return null;
    const lastPoint = allPoints[allPoints.length - 1];
    const tMin = allPoints[0].t;
    const tMaxLive = lastPoint.t;
    // Stretch the X axis to also fit the projected end-point.
    const tMax = prediction?.targetPrice ? tMaxLive + projectionMs : tMaxLive;

    let pMin = Number.POSITIVE_INFINITY;
    let pMax = Number.NEGATIVE_INFINITY;
    for (const p of allPoints) {
      if (p.c < pMin) pMin = p.c;
      if (p.c > pMax) pMax = p.c;
    }
    if (prediction?.targetPrice) {
      pMin = Math.min(pMin, prediction.targetPrice);
      pMax = Math.max(pMax, prediction.targetPrice);
    }
    if (series?.previousClose) {
      pMin = Math.min(pMin, series.previousClose);
      pMax = Math.max(pMax, series.previousClose);
    }
    if (pMin === pMax) { pMin -= 1; pMax += 1; }
    const pad = (pMax - pMin) * 0.08;
    pMin -= pad; pMax += pad;

    const xOf = (t: number) => dims.padL + ((t - tMin) / Math.max(tMax - tMin, 1)) * (dims.w - dims.padL - dims.padR);
    const yOf = (c: number) => dims.padT + (1 - (c - pMin) / Math.max(pMax - pMin, 0.0001)) * (dims.h - dims.padT - dims.padB);

    const path = allPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(p.t).toFixed(2)} ${yOf(p.c).toFixed(2)}`).join(" ");

    let projection: { x1: number; y1: number; x2: number; y2: number; color: string } | null = null;
    if (prediction?.targetPrice) {
      const x1 = xOf(lastPoint.t);
      const y1 = yOf(lastPoint.c);
      const x2 = xOf(tMaxLive + projectionMs);
      const y2 = yOf(prediction.targetPrice);
      const color = prediction.direction === "BULLISH" ? "#22c55e" : prediction.direction === "BEARISH" ? "#ef4444" : "#fbbf24";
      projection = { x1, y1, x2, y2, color };
    }

    const prevCloseY = series?.previousClose ? yOf(series.previousClose) : null;

    return { xOf, yOf, path, projection, lastPoint, pMin, pMax, prevCloseY, tMin, tMax, tMaxLive };
  }, [allPoints, prediction, projectionMs, series]);

  const fmtPrice = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 2 : 4 });
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
            <CardDescription className="flex items-center gap-2 mt-0.5">
              <span>5-min candles + 1s live ticks · projection out to {horizon}</span>
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
      </CardHeader>
      <CardContent>
        {!view ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            Loading market data…
          </div>
        ) : (
          <svg viewBox={`0 0 ${dims.w} ${dims.h}`} className="w-full h-[280px]" preserveAspectRatio="none">
            {/* horizontal grid */}
            {[0.25, 0.5, 0.75].map((f) => {
              const y = dims.padT + f * (dims.h - dims.padT - dims.padB);
              return (
                <line key={f} x1={dims.padL} x2={dims.w - dims.padR} y1={y} y2={y}
                  stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="2 4" />
              );
            })}
            {/* y axis labels */}
            {[0, 0.5, 1].map((f) => {
              const y = dims.padT + f * (dims.h - dims.padT - dims.padB);
              const v = view.pMax - f * (view.pMax - view.pMin);
              return (
                <text key={f} x={dims.padL - 6} y={y + 3} textAnchor="end" fontSize="10"
                  fill="hsl(var(--muted-foreground))" fontFamily="monospace">{fmtPrice(v)}</text>
              );
            })}
            {/* previous close reference */}
            {view.prevCloseY != null && (
              <>
                <line x1={dims.padL} x2={dims.w - dims.padR} y1={view.prevCloseY} y2={view.prevCloseY}
                  stroke="hsl(var(--muted-foreground))" strokeWidth={0.7} strokeDasharray="3 3" opacity={0.6} />
                <text x={dims.w - dims.padR - 4} y={view.prevCloseY - 3} textAnchor="end" fontSize="9"
                  fill="hsl(var(--muted-foreground))">prev close</text>
              </>
            )}
            {/* divider where "now" is */}
            {view.projection && (
              <line x1={view.projection.x1} x2={view.projection.x1} y1={dims.padT} y2={dims.h - dims.padB}
                stroke="hsl(var(--muted-foreground))" strokeDasharray="2 3" opacity={0.5} />
            )}
            {/* historical price line */}
            <path d={view.path} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.6} />
            {/* projection line */}
            {view.projection && (
              <>
                <line x1={view.projection.x1} y1={view.projection.y1}
                  x2={view.projection.x2} y2={view.projection.y2}
                  stroke={view.projection.color} strokeWidth={2} strokeDasharray="6 4" />
                <circle cx={view.projection.x2} cy={view.projection.y2} r={4}
                  fill={view.projection.color} />
                <text x={view.projection.x2 - 4} y={view.projection.y2 - 8} textAnchor="end"
                  fontSize="10" fill={view.projection.color} fontFamily="monospace">
                  target {prediction?.targetPrice ? fmtPrice(prediction.targetPrice) : ""}
                </text>
              </>
            )}
            {/* current live dot */}
            {livePrice != null && view && (
              <>
                <circle cx={view.xOf(view.lastPoint.t)} cy={view.yOf(view.lastPoint.c)} r={4}
                  fill="hsl(var(--primary))" />
                <circle cx={view.xOf(view.lastPoint.t)} cy={view.yOf(view.lastPoint.c)} r={8}
                  fill="hsl(var(--primary))" opacity={0.25}>
                  <animate attributeName="r" values="4;10;4" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0;0.4" dur="1.4s" repeatCount="indefinite" />
                </circle>
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
              {prediction.headlines.map((h, i) => (
                <li key={i} className="text-xs flex items-start gap-2">
                  <span className="text-muted-foreground font-mono">[{i + 1}]</span>
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
              ))}
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
