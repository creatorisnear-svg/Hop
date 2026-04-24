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
  model: string;
  durationMs: number;
  createdAt: string;
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

function PredictionCard({ prediction, headline }: { prediction: Prediction; headline?: boolean }) {
  const meta = directionMeta(prediction.direction);
  const Icon = meta.Icon;
  const pct = Math.round(prediction.confidence * 100);
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
