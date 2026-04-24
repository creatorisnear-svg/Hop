import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  CalendarClock,
  MessageSquare,
  Send,
  Target,
  Flame,
  Search,
  FlaskConical,
  CheckCircle2,
  XCircle,
  Clock,
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
  bullCase?: string;
  bearCase?: string;
  keyDrivers?: string[];
  nextCatalysts?: string[];
  earnings?: Earnings | null;
  model: string;
  durationMs: number;
  createdAt: string;
  evaluation?: PredictionEvaluation;
}

interface EarningsRow {
  date: string;
  fiscalQuarter: string;
  fiscalYear: number | null;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  surprisePct: number | null;
  scheduled: boolean;
}

interface Earnings {
  symbol: string;
  currency: string | null;
  history: EarningsRow[];
  q1Latest: EarningsRow | null;
  next: EarningsRow | null;
  fetchedAt: string;
  source: "yahoo" | "unavailable";
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  ts: number;
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

type BacktestDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
type BacktestOutcome = "CORRECT" | "WRONG" | "SKIP";

interface BacktestBar {
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

interface BacktestDirectionStats {
  total: number;
  correct: number;
  hitRate: number | null;
}

interface BacktestResult {
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
    byDirection: Record<BacktestDirection, BacktestDirectionStats>;
    avgConfidence: number | null;
    avgWinPct: number | null;
    avgLossPct: number | null;
    edgeRatio: number | null;
    expectedValue: number | null;
    maxWinStreak: number;
    maxLossStreak: number;
    signalQuality: string;
  };
  fetchedAt: string;
}

interface Indicators {
  symbol: string;
  price: number | null;
  change1d: number | null;
  change5d: number | null;
  change1m: number | null;
  sma20: number | null;
  sma50: number | null;
  ema12?: number | null;
  ema26?: number | null;
  rsi14: number | null;
  macd?: number | null;
  macdSignal?: number | null;
  macdHist?: number | null;
  bbUpper?: number | null;
  bbLower?: number | null;
  bbMid?: number | null;
  bbWidthPct?: number | null;
  stochK14?: number | null;
  atr14Pct?: number | null;
  trendScore?: number | null;
  high52w: number | null;
  low52w: number | null;
  volatility20d: number | null;
  asOf: string;
}

// User-marked trade — what the backend returns from /api/market/trades
// (the row plus computed live P/L fields).
interface UserTrade {
  id: string;
  watchId: string;
  predictionId: string | null;
  symbol: string;
  action: "BUY_CALL" | "BUY_PUT";
  entryPrice: number;
  targetPrice: number | null;
  horizon: string;
  strikeHint: string;
  expiryHint: string;
  quantity: number;
  notes: string;
  status: "OPEN" | "CLOSED";
  closePrice: number | null;
  closedAt: string | null;
  openedAt: string;
  livePrice: number | null;
  pnlPct: number | null;
  pnlAbs: number | null;
  targetProgressPct: number | null;
  reachedTarget: boolean;
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
      <div className="space-y-6 lg:space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1.5 sm:mb-2 flex items-center gap-2 sm:gap-3">
            <LineChart className="w-6 h-6 sm:w-7 sm:h-7 text-primary" />
            Market Predictor
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Pick a market to watch. The brain pulls fresh news plus a live quote, then asks
            Gemini for a directional forecast you can rerun on demand.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 lg:gap-6">
          {/* On mobile we put the detail FIRST (with a compact watch picker)
              so the user lands on the chart, not on the form. */}
          <div className="space-y-4 lg:space-y-6 order-2 lg:order-1">
            <AddWatchForm onAdded={(w) => { setWatches((prev) => [w, ...prev]); setSelectedId(w.id); }} />
            <WatchList
              watches={watches}
              loading={loading}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRemove={removeWatch}
            />
          </div>
          <div className="order-1 lg:order-2 min-w-0">
            {watches.length > 0 && (
              <div className="lg:hidden mb-3">
                <Select value={selectedId ?? undefined} onValueChange={(v) => setSelectedId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a market" />
                  </SelectTrigger>
                  <SelectContent>
                    {watches.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        <span className="font-mono font-semibold">{w.symbol}</span>
                        <span className="text-muted-foreground ml-2">{w.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {selected ? (
              <WatchDetail watch={selected} />
            ) : (
              <Card>
                <CardContent className="py-12 sm:py-16 text-center text-muted-foreground text-sm">
                  {watches.length === 0
                    ? "Add a market below to start predicting."
                    : "Pick a market to see its chart and forecast."}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

type SearchHit = {
  symbol: string;
  name: string;
  market: string;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
};

function AddWatchForm({ onAdded }: { onAdded: (w: Watch) => void }) {
  const [query, setQuery] = useState("");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [market, setMarket] = useState("stock");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search-by-name → ticker lookup. Yahoo's free search endpoint
  // returns matches by company name, ticker, ISIN, etc.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`);
        const data = await r.json();
        setResults(Array.isArray(data?.results) ? data.results : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const pick = useCallback((hit: SearchHit) => {
    setSymbol(hit.symbol);
    setName(hit.name);
    setMarket(hit.market);
    setQuery(`${hit.symbol} · ${hit.name}`);
    setShowResults(false);
  }, []);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      toast.error("Pick a market from the search results, or enter a ticker manually");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/market/watches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: sym, name: name || sym, market, notes }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to add");
      toast.success(`Watching ${data.watch.symbol}`);
      onAdded(data.watch);
      setQuery(""); setSymbol(""); setName(""); setNotes(""); setMarket("stock");
      setResults([]); setShowResults(false); setAdvanced(false);
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
        <CardDescription>
          Search by name or ticker — e.g. <span className="font-mono">apple</span>,{" "}
          <span className="font-mono">tesla</span>, <span className="font-mono">bitcoin</span>,{" "}
          <span className="font-mono">s&amp;p 500</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          {/* Searchable combobox */}
          <div className="relative">
            <Label className="text-xs text-muted-foreground">Search</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowResults(true); setSymbol(""); }}
                onFocus={() => setShowResults(true)}
                onBlur={() => setTimeout(() => setShowResults(false), 180)}
                placeholder="Type a company, ticker, crypto…"
                className="pl-8"
                autoComplete="off"
              />
              {searching && (
                <Loader2 className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
            {showResults && results.length > 0 && (
              <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-lg">
                {results.map((hit) => (
                  <button
                    key={`${hit.symbol}-${hit.exchange}`}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); pick(hit); }}
                    className="w-full text-left px-3 py-2 hover:bg-accent flex items-start justify-between gap-2 border-b border-border/40 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold truncate">{hit.symbol}</div>
                      <div className="text-xs text-muted-foreground truncate">{hit.name}</div>
                      {(hit.sector || hit.industry) && (
                        <div className="text-[10px] text-muted-foreground/70 truncate">
                          {[hit.sector, hit.industry].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase text-primary">{hit.market}</div>
                      {hit.exchange && (
                        <div className="text-[10px] text-muted-foreground">{hit.exchange}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {showResults && !searching && query.trim() && results.length === 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground">
                No matches. Try a different name or use Advanced to enter a ticker manually.
              </div>
            )}
          </div>

          {/* Compact selected-asset preview */}
          {symbol && (
            <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-sm font-semibold">{symbol}</div>
                <div className="text-xs text-muted-foreground truncate">{name}</div>
              </div>
              <span className="text-[10px] uppercase text-primary shrink-0">{market}</span>
            </div>
          )}

          {/* Notes — visible always so users can add intent before watching */}
          <div>
            <Label className="text-xs text-muted-foreground">Notes for the model (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Watching earnings reaction, focus on supply chain..."
              className="text-sm min-h-[56px]"
            />
          </div>

          {/* Manual entry fallback */}
          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            {advanced ? "Hide" : "Advanced"}: enter ticker manually
          </button>
          {advanced && (
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
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Display name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Apple Inc." />
              </div>
            </div>
          )}

          <Button type="submit" disabled={busy || !symbol} className="w-full">
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
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [earningsLoading, setEarningsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [horizon, setHorizon] = useState("1w");
  const [trades, setTrades] = useState<UserTrade[]>([]);

  const loadTrades = useCallback(async () => {
    try {
      const r = await fetch(`/api/market/trades?watchId=${encodeURIComponent(watch.id)}`);
      if (!r.ok) return;
      const data = await r.json();
      setTrades((data.trades as UserTrade[]) ?? []);
    } catch { /* ignore */ }
  }, [watch.id]);

  // Refresh trades every 5s so the live PnL chip on the chart stays current.
  useEffect(() => {
    void loadTrades();
    const id = setInterval(() => { void loadTrades(); }, 5_000);
    return () => clearInterval(id);
  }, [loadTrades]);

  const tradedPredictionIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of trades) {
      if (t.predictionId && t.status === "OPEN") s.add(t.predictionId);
    }
    return s;
  }, [trades]);

  const handleMarkTrade = useCallback(async (p: Prediction) => {
    try {
      const r = await fetch("/api/market/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          watchId: watch.id,
          predictionId: p.id,
          symbol: p.symbol,
          action: p.action,
          targetPrice: p.targetPrice,
          horizon: p.horizon,
          strikeHint: p.strikeHint,
          expiryHint: p.expiryHint,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not mark trade");
      toast.success(`Trade tracked at ${data.trade.entryPrice}`);
      void loadTrades();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark trade");
    }
  }, [watch.id, loadTrades]);

  const handleCloseTrade = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/market/trades/${id}/close`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not close trade");
      toast.success(`Trade closed at ${data.trade.closePrice} (${data.trade.pnlPct?.toFixed(2)}%)`);
      void loadTrades();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close trade");
    }
  }, [loadTrades]);

  const handleDeleteTrade = useCallback(async (id: string) => {
    try {
      await fetch(`/api/market/trades/${id}`, { method: "DELETE" });
      void loadTrades();
    } catch { /* ignore */ }
  }, [loadTrades]);

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

  // Earnings have their own slower cadence — fetched once per watch + on
  // refresh, with a 30-min server-side cache.
  const loadEarnings = useCallback(async () => {
    setEarningsLoading(true);
    try {
      const r = await fetch(`/api/market/earnings/${encodeURIComponent(watch.symbol)}`);
      if (!r.ok) {
        setEarnings(null);
      } else {
        const data = await r.json();
        setEarnings((data.earnings as Earnings | undefined) ?? null);
      }
    } catch {
      setEarnings(null);
    } finally {
      setEarningsLoading(false);
    }
  }, [watch.symbol]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadEarnings(); }, [loadEarnings]);

  // Auto-refresh evaluations every 30s so badges flip live as the price moves.
  useEffect(() => {
    const id = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Track whether the user wants the prediction to re-run automatically in the
  // background. Default ON so the chart's projection always reflects the
  // freshest model call without burning the user out clicking "Predict" again.
  const [autoPredict, setAutoPredict] = useState(true);
  const predictingRef = useRef(false);
  useEffect(() => { predictingRef.current = predicting; }, [predicting]);

  const runPredict = useCallback(async (silent = false) => {
    if (predictingRef.current) return;
    predictingRef.current = true;
    if (!silent) setPredicting(true);
    try {
      const r = await fetch(`/api/market/watches/${watch.id}/predict`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ horizon }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Prediction failed");
      setPredictions((prev) => [data.prediction, ...prev]);
      if (!silent) toast.success(`${data.prediction.direction} verdict for ${watch.symbol}`);
    } catch (err) {
      if (!silent) toast.error(err instanceof Error ? err.message : "Prediction failed");
    } finally {
      predictingRef.current = false;
      if (!silent) setPredicting(false);
    }
  }, [watch.id, watch.symbol, horizon]);

  // Silent auto re-prediction every 60s when enabled. The chart's projection
  // line still re-anchors every second to the latest live tick — this loop
  // refreshes the underlying AI verdict + target price periodically so the
  // projection stays current with breaking news / earnings moves.
  useEffect(() => {
    if (!autoPredict) return;
    // Re-run the ensemble every 3 minutes (was 60s). Live-price ticks still
    // animate every second on the chart, so the projection line stays
    // visually current — this only paces how often we burn Gemini quota
    // refreshing the underlying AI verdict. 3 min × 3-call ensemble = 60
    // calls/hour per watch, vs the old 5 × 60 = 300 calls/hour.
    const id = setInterval(() => { void runPredict(true); }, 180_000);
    return () => clearInterval(id);
  }, [autoPredict, runPredict]);

  const latest = predictions[0];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 flex-wrap">
                <span className="font-mono">{watch.symbol}</span>
                <span className="text-sm sm:text-base text-muted-foreground font-normal truncate">· {watch.name}</span>
              </CardTitle>
              <CardDescription className="mt-1 text-xs sm:text-sm">
                {watch.market.toUpperCase()} watch · added {new Date(watch.createdAt).toLocaleDateString()}
              </CardDescription>
              {watch.notes && (
                <p className="text-xs text-muted-foreground mt-2 italic line-clamp-2">“{watch.notes}”</p>
              )}
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Select value={horizon} onValueChange={setHorizon}>
                <SelectTrigger className="flex-1 sm:flex-initial sm:w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HORIZON_OPTIONS.map((h) => (
                    <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => void runPredict(false)} disabled={predicting} className="flex-1 sm:flex-initial">
                {predicting ? (
                  <><Loader2 className="w-4 h-4 sm:mr-2 animate-spin" /><span className="hidden sm:inline">Predicting…</span></>
                ) : (
                  <><Sparkles className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Predict now</span><span className="sm:hidden">Predict</span></>
                )}
              </Button>
              <Button
                variant={autoPredict ? "default" : "outline"}
                size="sm"
                onClick={() => setAutoPredict((v) => !v)}
                className="shrink-0"
                title="Re-run the AI prediction every 60 seconds in the background"
              >
                Auto {autoPredict ? "ON" : "OFF"}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => void load()} className="shrink-0">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <LivePriceChart watch={watch} prediction={latest ?? null} trades={trades} />

      <OpenTradesPanel
        trades={trades}
        onClose={handleCloseTrade}
        onDelete={handleDeleteTrade}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrackRecordCard track={trackRecord} loading={loading} />
        <IndicatorsCard indicators={indicators} loading={loading} />
      </div>

      <BacktestPanel watchId={watch.id} watchSymbol={watch.symbol} defaultHorizon={horizon} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
        <EarningsCard earnings={earnings} loading={earningsLoading} onRefresh={loadEarnings} watchMarket={watch.market} />
        <MarketChat watch={watch} />
      </div>

      {latest && (
        <PredictionCard
          prediction={latest}
          headline
          onMarkTrade={handleMarkTrade}
          alreadyTradedIds={tradedPredictionIds}
        />
      )}

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
  trades = [],
}: {
  watch: Watch;
  prediction: Prediction | null;
  trades?: UserTrade[];
}) {
  const [rangeKey, setRangeKey] = useState<keyof typeof RANGE_PRESETS>("1D");
  const [series, setSeries] = useState<CandleSeries | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [livePoints, setLivePoints] = useState<{ t: number; c: number }[]>([]);
  const [tickAt, setTickAt] = useState<number>(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // 1-second tick that drives the live projection animation inside the chart.
  const [nowMs, setNowMs] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Track real pixel size of the chart container so the SVG renders at 1:1
  // and we don't get the "letterboxed and squashed" look on phones. We use
  // useLayoutEffect for the initial measurement so the very first paint
  // already has the correct width — otherwise the SVG mounts with the
  // default 760 viewBox, gets squished into the actual (narrower) container
  // by `preserveAspectRatio="none"`, and only "unsquishes" a frame later
  // once the ResizeObserver fires. That visible flicker is exactly what
  // users were seeing on mobile after page load.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(760);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      Math.max(280, Math.floor(el.getBoundingClientRect().width));
    setContainerW(measure());
    const ro = new ResizeObserver(() => {
      const w = measure();
      setContainerW((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const isNarrow = containerW < 520;

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

  // SINGLE-PANEL layout: history candles + forecast extension share one x-axis
  // and one y-axis so the prediction is rendered INSIDE the same chart, not
  // off to the side. We bias slightly more vertical room when a forecast is
  // present because the y-range has to accommodate the projected target too.
  const dims = useMemo(() => {
    const w = containerW;
    const hasForecast = prediction?.targetPrice != null;
    const h = isNarrow ? (hasForecast ? 360 : 320) : (hasForecast ? 460 : 420);
    const padL = isNarrow ? 44 : 54;
    const padR = isNarrow ? 6 : 22;
    const padT = isNarrow ? 10 : 18;
    const padB = isNarrow ? 22 : 32;
    return { w, h, padL, padR, padT, padB, hasForecast };
  }, [prediction, containerW, isNarrow]);

  // The live "now" point used to anchor the projection. Falls back to last
  // candle close if we haven't gotten a live tick yet.
  const livePivot = useMemo(() => {
    if (histCandles.length === 0) return null;
    const last = histCandles[histCandles.length - 1];
    const t = livePrice != null ? Math.max(last.t, tickAt || nowMs) : last.t;
    const c = livePrice ?? last.c;
    return { t, c };
  }, [histCandles, livePrice, tickAt, nowMs]);

  // One unified scale shared by history AND forecast. Prediction line lives
  // inside the same chart, on the same axes — no split, no separate panel.
  const view = useMemo(() => {
    if (histCandles.length === 0 || !livePivot) return null;
    const tMin = histCandles[0].t;
    const histTMax = histCandles[histCandles.length - 1].t;
    const fcastEnd = dims.hasForecast ? livePivot.t + projectionMs : histTMax;
    const tMax = Math.max(histTMax, fcastEnd);

    let pMin = Number.POSITIVE_INFINITY;
    let pMax = Number.NEGATIVE_INFINITY;
    for (const c of histCandles) {
      if (c.l < pMin) pMin = c.l;
      if (c.h > pMax) pMax = c.h;
    }
    if (rangeKey === "1D" && series?.previousClose) {
      pMin = Math.min(pMin, series.previousClose);
      pMax = Math.max(pMax, series.previousClose);
    }
    if (livePrice != null) {
      pMin = Math.min(pMin, livePrice);
      pMax = Math.max(pMax, livePrice);
    }
    // Pull the forecast target into the y-range so the projected line is in
    // bounds (if we have one).
    if (dims.hasForecast && prediction?.targetPrice != null) {
      pMin = Math.min(pMin, prediction.targetPrice);
      pMax = Math.max(pMax, prediction.targetPrice);
    }
    if (pMin === pMax) { pMin -= 1; pMax += 1; }
    const pad = (pMax - pMin) * 0.1;
    pMin -= pad; pMax += pad;

    const x0 = dims.padL;
    const x1 = dims.w - dims.padR;
    const y0 = dims.padT;
    const y1 = dims.h - dims.padB;
    // Reserve roughly 30% of the chart's x-axis for the forecast tail so the
    // projection has room to breathe instead of being squeezed at the edge.
    const fcastFrac = dims.hasForecast ? (isNarrow ? 0.32 : 0.3) : 0;
    const histFrac = 1 - fcastFrac;
    const histPxStart = x0;
    const histPxEnd = x0 + (x1 - x0) * histFrac;
    const fcastPxEnd = x1;

    const xOfHist = (t: number) => {
      const span = Math.max(histTMax - tMin, 1);
      return histPxStart + ((t - tMin) / span) * (histPxEnd - histPxStart);
    };
    const xOfForecast = (t: number) => {
      const fStart = livePivot.t;
      const fEnd = fcastEnd;
      const span = Math.max(fEnd - fStart, 1);
      return histPxEnd + Math.min(1, Math.max(0, (t - fStart) / span)) * (fcastPxEnd - histPxEnd);
    };
    const xOf = (t: number) => (t <= histTMax ? xOfHist(t) : xOfForecast(t));
    const yOf = (c: number) => y0 + (1 - (c - pMin) / Math.max(pMax - pMin, 1e-9)) * (y1 - y0);
    const slot = (histPxEnd - histPxStart) / Math.max(histCandles.length, 1);
    const bodyW = Math.max(1, Math.min(14, slot * 0.7));
    const lastCandle = histCandles[histCandles.length - 1];

    const fcastColor =
      prediction?.direction === "BULLISH" ? "#22c55e"
      : prediction?.direction === "BEARISH" ? "#ef4444"
      : "#fbbf24";

    return {
      xOf, yOf, pMin, pMax, tMin, tMax,
      histTMax, histPxStart, histPxEnd, fcastPxEnd,
      x0, x1, y0, y1, slot, bodyW, lastCandle,
      fcastColor, fcastEnd,
    };
  }, [histCandles, rangeKey, series, dims, livePrice, livePivot, prediction, projectionMs, isNarrow]);

  // The live projected line: anchored at the *current* live price, sloping to
  // the prediction's target. Re-evaluated every second via `nowMs` so the
  // chart visibly "breathes" — the tail end stays at the target but the head
  // tracks every tick.
  const liveProjection = useMemo(() => {
    if (!view || !dims.hasForecast || !livePivot || prediction?.targetPrice == null) return null;
    const startT = livePivot.t;
    const startC = livePivot.c;
    const endT = view.fcastEnd;
    const endC = prediction.targetPrice;
    return {
      x1: view.xOf(startT),
      y1: view.yOf(startC),
      x2: view.xOf(endT),
      y2: view.yOf(endC),
      startC,
      endC,
      changePct: ((endC - startC) / startC) * 100,
    };
  }, [view, dims.hasForecast, livePivot, prediction, nowMs]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <div className="text-lg sm:text-2xl font-mono font-bold tabular-nums leading-tight">
              {livePrice != null ? `${fmtPrice(livePrice)}` : "—"}
              {currency && <span className="text-[10px] sm:text-xs text-muted-foreground ml-1">{currency}</span>}
            </div>
            <div className={`text-[11px] sm:text-xs ${changeTone}`}>
              {change != null ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}% today` : ""}
              {tickAt ? <span className="ml-2 text-muted-foreground hidden sm:inline">· {new Date(tickAt).toLocaleTimeString()}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex gap-1 pt-1">
          {Object.keys(RANGE_PRESETS).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={rangeKey === k ? "default" : "outline"}
              className="h-7 sm:h-6 flex-1 sm:flex-initial px-2 text-[11px]"
              onClick={() => setRangeKey(k as keyof typeof RANGE_PRESETS)}
            >{k}</Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-6">
        <div ref={containerRef} className="w-full overflow-hidden" style={{ height: dims.h }}>
        {!view ? (
          <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
            Loading market data…
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${dims.w} ${dims.h}`}
            width={dims.w}
            height={dims.h}
            preserveAspectRatio="xMinYMin meet"
            className="block max-w-full"
          >
            {/* horizontal grid (full width including forecast zone) */}
            {[0.2, 0.4, 0.6, 0.8].map((f) => {
              const y = view.y0 + f * (view.y1 - view.y0);
              return <line key={`hg${f}`} x1={view.x0} x2={view.x1} y1={y} y2={y}
                stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="2 4" />;
            })}
            {/* y labels (left, shared scale) */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const y = view.y0 + f * (view.y1 - view.y0);
              const v = view.pMax - f * (view.pMax - view.pMin);
              return <text key={`hy${f}`} x={view.x0 - 4} y={y + 3} textAnchor="end" fontSize={isNarrow ? "9" : "10"}
                fill="hsl(var(--muted-foreground))" fontFamily="monospace">{fmtPrice(v)}</text>;
            })}
            {/* x labels for the history portion */}
            {[0, 0.5, 1].map((f) => {
              const x = view.histPxStart + f * (view.histPxEnd - view.histPxStart);
              const t = view.tMin + f * (view.histTMax - view.tMin);
              return <text key={`hx${f}`} x={x} y={dims.h - 6} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
                fontSize={isNarrow ? "8" : "10"} fill="hsl(var(--muted-foreground))" fontFamily="monospace">{fmtTime(t)}</text>;
            })}
            {/* prev close reference (intraday only) — extends across full chart */}
            {rangeKey === "1D" && series?.previousClose && (
              <>
                <line
                  x1={view.x0}
                  x2={view.x1}
                  y1={view.yOf(series.previousClose)}
                  y2={view.yOf(series.previousClose)}
                  stroke="hsl(var(--muted-foreground))" strokeWidth={0.7} strokeDasharray="3 3" opacity={0.6}
                />
                <text x={view.histPxEnd - 4} y={view.yOf(series.previousClose) - 3}
                  textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))">prev close</text>
              </>
            )}
            {/* OHLC candles — wick = high/low, body = open/close */}
            {histCandles.map((c, i) => {
              const x = view.xOf(c.t);
              const yH = view.yOf(c.h);
              const yL = view.yOf(c.l);
              const yO = view.yOf(c.o);
              const yC = view.yOf(c.c);
              const up = c.c >= c.o;
              const color = up ? "#22c55e" : "#ef4444";
              const bodyTop = Math.min(yO, yC);
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
                    x={x - view.bodyW / 2}
                    y={bodyTop}
                    width={view.bodyW}
                    height={bodyH}
                    fill={color}
                    opacity={isLive ? 0.65 : 1}
                    stroke={color}
                    strokeWidth={isLive ? 1.2 : 0.5}
                  />
                </g>
              );
            })}
            {/* Hover hit-areas */}
            {histCandles.map((c, i) => {
              const x = view.xOf(c.t);
              const w = Math.max(view.bodyW + 2, view.slot);
              return (
                <rect
                  key={`hit${i}`}
                  x={x - w / 2}
                  y={view.y0}
                  width={w}
                  height={view.y1 - view.y0}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                />
              );
            })}

            {/* PREDICTION OVERLAY — drawn INSIDE the chart, sharing the axes */}
            {liveProjection && view && (
              <g>
                {/* "now" divider — soft separator between past and projection */}
                <line x1={view.histPxEnd} x2={view.histPxEnd}
                  y1={view.y0} y2={view.y1}
                  stroke="hsl(var(--muted-foreground))" strokeDasharray="2 3" opacity={0.45} />
                {/* shaded forecast zone */}
                <rect x={view.histPxEnd} y={view.y0}
                  width={view.fcastPxEnd - view.histPxEnd}
                  height={view.y1 - view.y0}
                  fill={view.fcastColor} opacity={0.05} />
                {/* projection envelope (triangle shading toward target) */}
                <path d={`M${liveProjection.x1} ${liveProjection.y1} L${liveProjection.x2} ${liveProjection.y2} L${liveProjection.x2} ${view.y1} L${liveProjection.x1} ${view.y1} Z`}
                  fill={view.fcastColor} opacity={0.08} />
                {/* projection line — re-drawn every second from current live price */}
                <line x1={liveProjection.x1} y1={liveProjection.y1}
                  x2={liveProjection.x2} y2={liveProjection.y2}
                  stroke={view.fcastColor} strokeWidth={2.4} strokeDasharray="6 4">
                  <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1.2s" repeatCount="indefinite" />
                </line>
                {/* target dot at horizon end */}
                <circle cx={liveProjection.x2} cy={liveProjection.y2} r={5}
                  fill={view.fcastColor} stroke="hsl(var(--background))" strokeWidth={1.5} />
                {/* PREDICTION LABEL inside the chart */}
                {(() => {
                  const labelX = view.histPxEnd + (view.fcastPxEnd - view.histPxEnd) * 0.5;
                  const labelY = view.y0 + 4;
                  const dirText = prediction?.direction ?? "NEUTRAL";
                  const changeStr = `${liveProjection.changePct >= 0 ? "+" : ""}${liveProjection.changePct.toFixed(2)}%`;
                  return (
                    <g pointerEvents="none">
                      <rect
                        x={labelX - (isNarrow ? 56 : 72)}
                        y={labelY}
                        width={isNarrow ? 112 : 144}
                        height={isNarrow ? 38 : 44}
                        rx={6}
                        fill="hsl(var(--background))"
                        stroke={view.fcastColor}
                        strokeWidth={1}
                        opacity={0.92}
                      />
                      <text x={labelX} y={labelY + (isNarrow ? 14 : 16)} textAnchor="middle"
                        fontSize={isNarrow ? "9" : "10"} fontFamily="monospace"
                        fill={view.fcastColor} fontWeight="bold" letterSpacing="1">
                        PREDICTION · {horizon.toUpperCase()}
                      </text>
                      <text x={labelX} y={labelY + (isNarrow ? 28 : 33)} textAnchor="middle"
                        fontSize={isNarrow ? "10" : "12"} fontFamily="monospace"
                        fill="hsl(var(--foreground))" fontWeight="600">
                        {dirText} <tspan fill={view.fcastColor}>{changeStr}</tspan>
                      </text>
                    </g>
                  );
                })()}
                {/* target price label below the dot */}
                {prediction?.targetPrice != null && (
                  <text x={liveProjection.x2 - 6} y={liveProjection.y2 + 14} textAnchor="end"
                    fontSize="10" fill={view.fcastColor} fontFamily="monospace" fontWeight="600">
                    → {fmtPrice(prediction.targetPrice)}
                  </text>
                )}
              </g>
            )}

            {/* USER TRADE ENTRY MARKERS — drawn for every open trade on this watch.
               Shown as a horizontal dotted line at the entry price plus an arrow
               (▲ for CALL, ▼ for PUT) and a live PnL % chip on the right. */}
            {view && trades.filter((t) => t.status === "OPEN").map((t, i) => {
              if (t.entryPrice < view.pMin || t.entryPrice > view.pMax) return null;
              const y = view.yOf(t.entryPrice);
              const isCall = t.action === "BUY_CALL";
              const color = isCall ? "#22c55e" : "#ef4444";
              const arrow = isCall ? "▲" : "▼";
              const pnl = t.pnlPct;
              const pnlStr = pnl == null ? "—"
                : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`;
              const pnlColor = pnl == null ? "hsl(var(--muted-foreground))"
                : pnl >= 0 ? "#22c55e" : "#ef4444";
              const chipW = isNarrow ? 60 : 78;
              const chipH = 16;
              const chipX = view.x1 - chipW - 2;
              return (
                <g key={`trade${t.id}`} pointerEvents="none">
                  <line x1={view.x0} x2={view.x1} y1={y} y2={y}
                    stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
                  <text x={view.x0 + 6} y={y - 3}
                    fontSize={isNarrow ? "9" : "10"}
                    fontFamily="monospace" fill={color} fontWeight="bold">
                    {arrow} {isCall ? "CALL" : "PUT"} @ {fmtPrice(t.entryPrice)}
                  </text>
                  <rect x={chipX} y={y - chipH / 2}
                    width={chipW} height={chipH} rx={3}
                    fill="hsl(var(--background))" stroke={pnlColor} strokeWidth={1} opacity={0.95} />
                  <text x={chipX + chipW / 2} y={y + 3.5}
                    textAnchor="middle"
                    fontSize={isNarrow ? "9" : "10"}
                    fontFamily="monospace" fill={pnlColor} fontWeight="bold">
                    {pnlStr}
                  </text>
                  {/* tiny stagger marker so multiple trades at similar prices don't fully overlap */}
                  {i > 0 && (
                    <circle cx={view.x0 + 1} cy={y} r={1.5} fill={color} />
                  )}
                </g>
              );
            })}

            {/* Live pulse on the most recent live point — sits on top of overlay */}
            {livePrice != null && livePivot && view && (
              <>
                <circle
                  cx={view.xOf(livePivot.t)}
                  cy={view.yOf(livePivot.c)}
                  r={3.5}
                  fill="hsl(var(--primary))"
                />
                <circle
                  cx={view.xOf(livePivot.t)}
                  cy={view.yOf(livePivot.c)}
                  r={8}
                  fill="hsl(var(--primary))"
                  opacity={0.25}
                >
                  <animate attributeName="r" values="3;10;3" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.45;0;0.45" dur="1.4s" repeatCount="indefinite" />
                </circle>
              </>
            )}

            {/* OHLC tooltip for hovered candle */}
            {hoverIdx != null && histCandles[hoverIdx] && (() => {
              const c = histCandles[hoverIdx];
              const x = view.xOf(c.t);
              const tipW = 120;
              const tipH = 80;
              const tipX = x + tipW + 4 > view.histPxEnd
                ? Math.max(view.x0, x - tipW - 6)
                : x + 6;
              const tipY = Math.max(view.y0, view.yOf(c.h) - tipH - 4);
              const up = c.c >= c.o;
              const baseLen = series?.candles.length ?? 0;
              const isLive = rangeKey === "1D" && hoverIdx >= baseLen;
              const tipColor = up ? "#22c55e" : "#ef4444";
              return (
                <g pointerEvents="none">
                  <line x1={x} x2={x} y1={view.y0} y2={view.y1}
                    stroke="hsl(var(--muted-foreground))" strokeDasharray="2 3" opacity={0.5} />
                  <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={4}
                    fill="hsl(var(--background))" stroke={tipColor} strokeWidth={1} opacity={0.95} />
                  <text x={tipX + 6} y={tipY + 13} fontSize="9.5" fontFamily="monospace"
                    fill="hsl(var(--muted-foreground))">
                    {fmtTime(c.t)}{isLive ? " · live" : ""}
                  </text>
                  <text x={tipX + 6} y={tipY + 28} fontSize="10" fontFamily="monospace" fill="hsl(var(--foreground))">
                    O <tspan fill={tipColor}>{fmtPrice(c.o)}</tspan>
                  </text>
                  <text x={tipX + 6} y={tipY + 42} fontSize="10" fontFamily="monospace" fill="hsl(var(--foreground))">
                    H <tspan fill="#22c55e">{fmtPrice(c.h)}</tspan>
                  </text>
                  <text x={tipX + 6} y={tipY + 56} fontSize="10" fontFamily="monospace" fill="hsl(var(--foreground))">
                    L <tspan fill="#ef4444">{fmtPrice(c.l)}</tspan>
                  </text>
                  <text x={tipX + 6} y={tipY + 70} fontSize="10" fontFamily="monospace" fill="hsl(var(--foreground))">
                    C <tspan fill={tipColor}>{fmtPrice(c.c)}</tspan>
                  </text>
                </g>
              );
            })()}
          </svg>
        )}
        </div>
        {prediction?.targetPrice && livePrice != null && (
          <div className="mt-2 px-3 sm:px-0 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
            <span>
              Live projection · target {horizon}:{" "}
              <span className="font-mono text-foreground">{fmtPrice(prediction.targetPrice)}</span>
              <span className={prediction.targetPrice >= livePrice ? "text-green-400 ml-1" : "text-red-400 ml-1"}>
                ({((prediction.targetPrice - livePrice) / livePrice * 100 >= 0 ? "+" : "")}{(((prediction.targetPrice - livePrice) / livePrice) * 100).toFixed(2)}% from now)
              </span>
            </span>
            <span>·</span>
            <span>Updates every second · last call {new Date(prediction.createdAt).toLocaleTimeString()}</span>
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

// ── My open trades — live P/L from the user's manually-marked entries ──────
function OpenTradesPanel({
  trades,
  onClose,
  onDelete,
}: {
  trades: UserTrade[];
  onClose: (id: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}) {
  const open = trades.filter((t) => t.status === "OPEN");
  const closed = trades.filter((t) => t.status === "CLOSED").slice(0, 5);
  if (open.length === 0 && closed.length === 0) return null;

  // Roll-up stats for the header.
  const totalPnlPct = open.length
    ? open.reduce((acc, t) => acc + (t.pnlPct ?? 0), 0) / open.length
    : null;
  const winners = open.filter((t) => (t.pnlPct ?? 0) > 0).length;
  const losers = open.filter((t) => (t.pnlPct ?? 0) < 0).length;

  const fmt = (v: number | null, digits = 2) =>
    v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
  const tone = (v: number | null) =>
    v == null ? "text-muted-foreground" : v >= 0 ? "text-green-400" : "text-red-400";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> My trades
            </CardTitle>
            <CardDescription>
              {open.length} open · {closed.length} recently closed
              {totalPnlPct != null && (
                <> · avg open P/L <span className={`font-mono ${tone(totalPnlPct)}`}>
                  {totalPnlPct >= 0 ? "+" : ""}{fmt(totalPnlPct)}%
                </span></>
              )}
            </CardDescription>
          </div>
          {open.length > 0 && (
            <div className="flex gap-2 text-[11px]">
              <Badge variant="outline" className="text-green-300 border-green-500/40">↑ {winners} winning</Badge>
              <Badge variant="outline" className="text-red-300 border-red-500/40">↓ {losers} losing</Badge>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {open.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            No open trades. Click "I took this trade" on any BUY signal to start tracking your live P/L here.
          </div>
        ) : (
          open.map((t) => {
            const isCall = t.action === "BUY_CALL";
            const sideColor = isCall ? "text-green-400 border-green-500/40" : "text-red-400 border-red-500/40";
            const sideIcon = isCall ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />;
            const pnlTone = tone(t.pnlPct);
            return (
              <div key={t.id} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className={`text-[10px] uppercase ${sideColor}`}>
                    {sideIcon} {isCall ? "CALL" : "PUT"}
                  </Badge>
                  <span className="font-mono font-bold">{t.symbol}</span>
                  <Badge variant="outline" className="text-[10px] uppercase">{t.horizon}</Badge>
                  {t.reachedTarget && (
                    <Badge variant="outline" className="text-emerald-300 border-emerald-500/40 text-[10px]">
                      ★ TARGET HIT
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    Opened {new Date(t.openedAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Entry</div>
                    <div className="font-mono">{fmt(t.entryPrice)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Live</div>
                    <div className="font-mono">{fmt(t.livePrice)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">P/L %</div>
                    <div className={`font-mono font-bold ${pnlTone}`}>
                      {t.pnlPct == null ? "—"
                        : `${t.pnlPct >= 0 ? "+" : ""}${fmt(t.pnlPct)}%`}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Target</div>
                    <div className="font-mono">{fmt(t.targetPrice)}</div>
                  </div>
                </div>
                {t.targetProgressPct != null && (
                  <div className="mt-2">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={isCall ? "h-full bg-green-500" : "h-full bg-red-500"}
                        style={{ width: `${Math.max(0, Math.min(100, t.targetProgressPct))}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground text-right mt-0.5">
                      {t.targetProgressPct.toFixed(0)}% of the way to target
                    </div>
                  </div>
                )}
                {(t.strikeHint || t.expiryHint) && (
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    {t.strikeHint && <span>Strike: <span className="text-foreground">{t.strikeHint}</span></span>}
                    {t.expiryHint && <span>Expiry: <span className="text-foreground">{t.expiryHint}</span></span>}
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void onClose(t.id)} className="h-7 text-xs">
                    Close at live price
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void onDelete(t.id)} className="h-7 text-xs text-muted-foreground hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
        {closed.length > 0 && (
          <div className="pt-2 border-t border-border/40 space-y-1">
            <div className="text-[10px] uppercase text-muted-foreground">Recently closed</div>
            {closed.map((t) => {
              const isCall = t.action === "BUY_CALL";
              return (
                <div key={t.id} className="flex flex-wrap items-center gap-2 text-xs py-1">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {isCall ? "CALL" : "PUT"} · {t.symbol}
                  </Badge>
                  <span className="font-mono">{fmt(t.entryPrice)} → {fmt(t.closePrice)}</span>
                  <span className={`font-mono font-bold ${tone(t.pnlPct)}`}>
                    {t.pnlPct == null ? "—"
                      : `${t.pnlPct >= 0 ? "+" : ""}${fmt(t.pnlPct)}%`}
                  </span>
                  <span className="text-muted-foreground ml-auto">
                    {t.closedAt && new Date(t.closedAt).toLocaleString()}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void onDelete(t.id)} className="h-6 w-6 p-0">
                    <Trash2 className="w-3 h-3" />
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

function PredictionCard({
  prediction,
  headline,
  onMarkTrade,
  alreadyTradedIds,
}: {
  prediction: Prediction;
  headline?: boolean;
  onMarkTrade?: (p: Prediction) => Promise<void> | void;
  alreadyTradedIds?: Set<string>;
}) {
  const meta = directionMeta(prediction.direction);
  const Icon = meta.Icon;
  const pct = Math.round(prediction.confidence * 100);
  const trade = actionMeta(prediction.action);
  const TradeIcon = trade.Icon;
  const [submitting, setSubmitting] = useState(false);
  const canMark = prediction.action === "BUY_CALL" || prediction.action === "BUY_PUT";
  const alreadyMarked = alreadyTradedIds?.has(prediction.id) ?? false;
  const handleMark = async () => {
    if (!onMarkTrade || !canMark || alreadyMarked || submitting) return;
    setSubmitting(true);
    try { await onMarkTrade(prediction); }
    finally { setSubmitting(false); }
  };
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
          {onMarkTrade && canMark && (
            <div className="mt-3 pt-3 border-t border-current/15 flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant={alreadyMarked ? "outline" : "default"}
                disabled={alreadyMarked || submitting}
                onClick={handleMark}
                className="h-8"
              >
                {alreadyMarked ? "✓ Trade tracked"
                  : submitting ? "Marking…"
                  : "I took this trade"}
              </Button>
              <span className="text-[11px] opacity-75">
                Locks in current live price as your entry — we'll track the live P/L for you.
              </span>
            </div>
          )}
        </div>

        <div className="text-base font-medium leading-snug">{prediction.summary}</div>

        {(prediction.bullCase || prediction.bearCase) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {prediction.bullCase && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-400">
                  <TrendingUp className="w-3.5 h-3.5" /> Bull case
                </div>
                <p className="text-sm text-foreground/90 mt-1.5 leading-relaxed">{prediction.bullCase}</p>
              </div>
            )}
            {prediction.bearCase && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-red-400">
                  <TrendingDown className="w-3.5 h-3.5" /> Bear case
                </div>
                <p className="text-sm text-foreground/90 mt-1.5 leading-relaxed">{prediction.bearCase}</p>
              </div>
            )}
          </div>
        )}

        {(prediction.keyDrivers && prediction.keyDrivers.length > 0) && (
          <div className="rounded-lg border border-border/60 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <Target className="w-3.5 h-3.5" /> Key drivers
            </div>
            <ul className="mt-1.5 space-y-1">
              {prediction.keyDrivers.map((d, i) => (
                <li key={i} className="text-sm text-foreground/90 flex gap-2">
                  <span className="text-muted-foreground mt-1">•</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(prediction.nextCatalysts && prediction.nextCatalysts.length > 0) && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-400">
              <Flame className="w-3.5 h-3.5" /> Next catalysts
            </div>
            <ul className="mt-1.5 space-y-1">
              {prediction.nextCatalysts.map((c, i) => (
                <li key={i} className="text-sm text-foreground/90 flex gap-2">
                  <span className="text-amber-500/70 mt-1">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

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

// ── Earnings panel ──────────────────────────────────────────────────────────
function fmtMoney(v: number | null, currency: string | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B ${currency ?? ""}`.trim();
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M ${currency ?? ""}`.trim();
  return `${v.toFixed(2)} ${currency ?? ""}`.trim();
}
function fmtEps(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function EarningsCard({
  earnings,
  loading,
  onRefresh,
  watchMarket,
}: {
  earnings: Earnings | null;
  loading: boolean;
  onRefresh: () => void;
  watchMarket: string;
}) {
  const isStockLike = watchMarket === "stock" || watchMarket === "etf";
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-primary" /> Q1 Earnings
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading} className="h-7 w-7 p-0">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <CardDescription className="text-xs">
          Latest fiscal Q1 result + next scheduled report
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isStockLike ? (
          <div className="text-xs text-muted-foreground">
            Earnings only apply to stocks and ETFs.
          </div>
        ) : loading ? (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading earnings…
          </div>
        ) : !earnings || earnings.source === "unavailable" ? (
          <div className="text-xs text-muted-foreground">
            Earnings data is currently unavailable for this symbol.
          </div>
        ) : (
          <>
            {earnings.q1Latest ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase font-bold tracking-wide text-primary">
                    {earnings.q1Latest.fiscalQuarter}
                    {earnings.q1Latest.fiscalYear ? ` ${earnings.q1Latest.fiscalYear}` : ""}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {fmtDate(earnings.q1Latest.date)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2 text-sm">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">EPS actual</div>
                    <div className="font-mono font-bold">{fmtEps(earnings.q1Latest.epsActual)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">EPS estimate</div>
                    <div className="font-mono">{fmtEps(earnings.q1Latest.epsEstimate)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Revenue</div>
                    <div className="font-mono">{fmtMoney(earnings.q1Latest.revenueActual, earnings.currency)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Surprise</div>
                    <div
                      className={`font-mono font-bold ${
                        earnings.q1Latest.surprisePct == null
                          ? ""
                          : earnings.q1Latest.surprisePct >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                      }`}
                    >
                      {earnings.q1Latest.surprisePct == null
                        ? "—"
                        : `${earnings.q1Latest.surprisePct >= 0 ? "+" : ""}${earnings.q1Latest.surprisePct.toFixed(2)}%`}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No fiscal Q1 result on file yet.</div>
            )}

            {earnings.next && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase font-bold tracking-wide text-amber-400">
                    Next: {earnings.next.fiscalQuarter}
                    {earnings.next.fiscalYear ? ` ${earnings.next.fiscalYear}` : ""}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {fmtDate(earnings.next.date)}
                  </div>
                </div>
                {earnings.next.epsEstimate != null && (
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    EPS estimate <span className="font-mono text-foreground">{fmtEps(earnings.next.epsEstimate)}</span>
                  </div>
                )}
              </div>
            )}

            {earnings.history && earnings.history.length > 0 && (
              <div className="pt-1">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Recent quarters</div>
                <div className="space-y-1">
                  {earnings.history.slice(0, 4).map((row, i) => (
                    <div
                      key={`${row.date}-${i}`}
                      className="flex items-center justify-between text-xs font-mono border-b border-border/30 pb-1 last:border-0"
                    >
                      <span className="text-muted-foreground">
                        {row.fiscalQuarter}
                        {row.fiscalYear ? ` ${row.fiscalYear}` : ""}
                      </span>
                      <span>{fmtEps(row.epsActual)} <span className="opacity-60">vs {fmtEps(row.epsEstimate)}</span></span>
                      <span
                        className={
                          row.surprisePct == null
                            ? "text-muted-foreground"
                            : row.surprisePct >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                        }
                      >
                        {row.surprisePct == null
                          ? "—"
                          : `${row.surprisePct >= 0 ? "+" : ""}${row.surprisePct.toFixed(1)}%`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Chat with AI about the current asset ────────────────────────────────────
function MarketChat({ watch }: { watch: Watch }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Reset the conversation when the user switches watch.
  useEffect(() => {
    setMessages([]);
    setInput("");
  }, [watch.id]);

  // Keep the transcript pinned to the bottom as it grows.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    const userMsg: ChatMsg = { role: "user", content: text, ts: Date.now() };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    try {
      const r = await fetch(`/api/market/watches/${watch.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.error ?? `chat failed (${r.status})`);
      }
      const data = await r.json();
      const reply: ChatMsg = {
        role: "assistant",
        content: String(data?.reply?.content ?? ""),
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, reply]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Chat failed: ${msg}`);
      // Roll back the optimistic user message so they can retry.
      setMessages((prev) => prev.filter((m) => m !== userMsg));
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [input, sending, messages, watch.id]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" /> Ask about {watch.symbol}
        </CardTitle>
        <CardDescription className="text-xs">
          Live chat — pulls fresh quote, headlines, and earnings on every reply.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        <div
          ref={scrollRef}
          className="flex-1 min-h-[180px] max-h-[320px] overflow-y-auto rounded-md border border-border/60 bg-background/40 p-3 space-y-2.5 text-sm"
        >
          {messages.length === 0 && !sending && (
            <div className="text-xs text-muted-foreground italic">
              Try: "What's driving the move today?", "Should I worry about earnings?", or
              "Give me a price target with conditions."
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-primary/15 border border-primary/30 text-foreground"
                    : "bg-muted/40 border border-border/50 text-foreground"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-lg px-3 py-2 bg-muted/40 border border-border/50 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={`Ask anything about ${watch.symbol}…`}
            rows={2}
            className="resize-none text-sm"
            disabled={sending}
          />
          <Button onClick={() => void send()} disabled={sending || !input.trim()} className="self-end">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── BacktestPanel ─────────────────────────────────────────────────────────────

function hitRateColor(rate: number | null): string {
  if (rate == null) return "text-muted-foreground";
  if (rate >= 0.65) return "text-emerald-400";
  if (rate >= 0.5)  return "text-yellow-400";
  return "text-red-400";
}

function hitRateBg(rate: number | null): string {
  if (rate == null) return "bg-muted/30";
  if (rate >= 0.65) return "bg-emerald-500/10 border-emerald-500/30";
  if (rate >= 0.5)  return "bg-yellow-500/10 border-yellow-500/30";
  return "bg-red-500/10 border-red-500/30";
}

function directionBar(rate: number | null): string {
  if (rate == null) return "bg-muted/40";
  if (rate >= 0.65) return "bg-emerald-500";
  if (rate >= 0.5)  return "bg-yellow-500";
  return "bg-red-500";
}

function outcomeIcon(outcome: BacktestOutcome) {
  if (outcome === "CORRECT") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  if (outcome === "WRONG")   return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  return <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
}

function directionBadgeClass(d: BacktestDirection): string {
  if (d === "BULLISH") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (d === "BEARISH") return "bg-red-500/15 text-red-400 border-red-500/30";
  return "bg-muted/50 text-muted-foreground border-border/50";
}

type SignalQuality = "STRONG" | "MODERATE" | "WEAK" | "POOR";

function signalBadge(q: SignalQuality) {
  const map: Record<SignalQuality, { label: string; cls: string }> = {
    STRONG:   { label: "Strong edge",   cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40 ring-1 ring-emerald-500/20" },
    MODERATE: { label: "Moderate edge", cls: "bg-blue-500/15 text-blue-400 border-blue-500/40 ring-1 ring-blue-500/20" },
    WEAK:     { label: "Weak edge",     cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40 ring-1 ring-yellow-500/20" },
    POOR:     { label: "No edge",       cls: "bg-red-500/15 text-red-400 border-red-500/40 ring-1 ring-red-500/20" },
  };
  const { label, cls } = map[q];
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-semibold tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function BacktestPanel({
  watchId,
  watchSymbol,
  defaultHorizon,
}: {
  watchId: string;
  watchSymbol: string;
  defaultHorizon: string;
}) {
  const [horizon, setHorizon] = useState(defaultHorizon);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [showBars, setShowBars] = useState(false);

  const run = useCallback(async (h: string) => {
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch(`/api/market/watches/${watchId}/backtest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ horizon: h, lookback: 30 }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Backtest failed");
      setResult(data.backtest as BacktestResult);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setRunning(false);
    }
  }, [watchId]);

  const s = result?.summary;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-primary" /> Predictor Backtest
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Replays the indicator + scoring pipeline over the last 30 trading days — no LLM calls, purely rule-based. Results are instant and deterministic.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Select value={horizon} onValueChange={(v) => { setHorizon(v); setResult(null); }}>
              <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HORIZON_OPTIONS.map((h) => (
                  <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => void run(horizon)} disabled={running} size="sm" className="gap-1.5">
              {running
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
                : <><FlaskConical className="w-3.5 h-3.5" /> Run backtest</>}
            </Button>
          </div>
        </div>
      </CardHeader>

      {result && s && (
        <CardContent className="space-y-5">

          {/* ── Signal quality banner ─────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
            <div className="flex items-center gap-3">
              {signalBadge(s.signalQuality as SignalQuality)}
              <span className="text-xs text-muted-foreground">
                {result.horizon} horizon · {result.lookback}-day window · {new Date(result.fetchedAt).toLocaleTimeString()}
              </span>
            </div>
            {s.expectedValue != null && (
              <span className={`text-xs font-semibold ${s.expectedValue >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                EV {s.expectedValue >= 0 ? "+" : ""}{s.expectedValue.toFixed(2)}% per trade
              </span>
            )}
          </div>

          {/* ── Top stat row ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Overall */}
            <div className={`rounded-xl border p-3 text-center ${hitRateBg(s.hitRate)}`}>
              <div className={`text-3xl font-bold tabular-nums ${hitRateColor(s.hitRate)}`}>
                {s.hitRate != null ? `${Math.round(s.hitRate * 100)}%` : "—"}
              </div>
              <div className="text-[11px] font-medium text-muted-foreground mt-1">Overall hit rate</div>
              <div className="text-[10px] text-muted-foreground">{s.correct}/{s.total} settled</div>
            </div>

            {/* Edge Ratio */}
            <div className={`rounded-xl border p-3 text-center ${s.edgeRatio != null && s.edgeRatio >= 1 ? "bg-emerald-500/10 border-emerald-500/30" : "bg-muted/20 border-border/60"}`}>
              <div className={`text-3xl font-bold tabular-nums ${s.edgeRatio != null && s.edgeRatio >= 1 ? "text-emerald-400" : "text-red-400"}`}>
                {s.edgeRatio != null ? s.edgeRatio.toFixed(2) : "—"}
              </div>
              <div className="text-[11px] font-medium text-muted-foreground mt-1">Edge ratio</div>
              <div className="text-[10px] text-muted-foreground">avg win / avg loss</div>
            </div>

            {/* Avg win */}
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-center">
              <div className="text-3xl font-bold tabular-nums text-emerald-400">
                {s.avgWinPct != null ? `+${s.avgWinPct.toFixed(2)}%` : "—"}
              </div>
              <div className="text-[11px] font-medium text-muted-foreground mt-1">Avg winner</div>
              <div className="text-[10px] text-muted-foreground">{s.correct} correct calls</div>
            </div>

            {/* Avg loss */}
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-center">
              <div className="text-3xl font-bold tabular-nums text-red-400">
                {s.avgLossPct != null ? `-${s.avgLossPct.toFixed(2)}%` : "—"}
              </div>
              <div className="text-[11px] font-medium text-muted-foreground mt-1">Avg loser</div>
              <div className="text-[10px] text-muted-foreground">{s.wrong} wrong calls</div>
            </div>
          </div>

          {/* ── Direction breakdown with progress bars ────────────────── */}
          <div className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Direction breakdown</div>
            {(["BULLISH", "BEARISH", "NEUTRAL"] as BacktestDirection[]).map((d) => {
              const ds = s.byDirection[d];
              const pct = ds.hitRate != null ? ds.hitRate * 100 : 0;
              const icon = d === "BULLISH" ? "▲" : d === "BEARISH" ? "▼" : "—";
              const label = d.charAt(0) + d.slice(1).toLowerCase();
              return (
                <div key={d} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className={d === "BULLISH" ? "text-emerald-400" : d === "BEARISH" ? "text-red-400" : "text-muted-foreground"}>
                        {icon}
                      </span>
                      <span className="font-medium">{label}</span>
                      <span className="text-muted-foreground">({ds.correct}/{ds.total})</span>
                    </span>
                    <span className={`font-bold tabular-nums ${hitRateColor(ds.hitRate)}`}>
                      {ds.hitRate != null ? `${Math.round(pct)}%` : "n/a"}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${directionBar(ds.hitRate)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Secondary stats row ───────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
              <div className="text-base font-bold tabular-nums">{Math.round((s.avgConfidence ?? 0) * 100)}%</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Avg confidence</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
              <div className="text-base font-bold tabular-nums text-emerald-400">{s.maxWinStreak}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Best win streak</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
              <div className="text-base font-bold tabular-nums text-red-400">{s.maxLossStreak}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Worst loss streak</div>
            </div>
          </div>

          {/* ── Day-by-day outcome strip ──────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">Day-by-day outcomes (oldest → newest)</span>
              <button
                className="text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => setShowBars((v) => !v)}
              >
                {showBars ? "Hide detail" : "Show detail"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {result.bars.map((b, i) => {
                const dirColor =
                  b.predictedDirection === "BULLISH" ? "border-emerald-500/60"
                  : b.predictedDirection === "BEARISH" ? "border-red-400/60"
                  : "border-border/40";
                return (
                  <div
                    key={i}
                    title={`${b.date} | ${b.predictedDirection} | ${b.outcome}${b.actualChangePct != null ? ` | ${b.actualChangePct >= 0 ? "+" : ""}${b.actualChangePct.toFixed(2)}%` : ""}`}
                    className={`h-6 w-6 rounded border-2 flex items-center justify-center text-[8px] font-bold ${dirColor} ${
                      b.outcome === "CORRECT"
                        ? "bg-emerald-500/60"
                        : b.outcome === "WRONG"
                          ? "bg-red-400/60"
                          : "bg-muted/30"
                    }`}
                  >
                    {b.predictedDirection === "BULLISH" ? "▲" : b.predictedDirection === "BEARISH" ? "▼" : "—"}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/60 border-2 border-emerald-500/60 inline-block" /> Correct</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400/60 border-2 border-red-400/60 inline-block" /> Wrong</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-muted/30 border-2 border-border/40 inline-block" /> Pending</span>
              <span className="flex items-center gap-1 ml-2">▲ = Bullish call · ▼ = Bearish call · — = Neutral</span>
            </div>
          </div>

          {/* ── Detailed table ────────────────────────────────────────── */}
          {showBars && (
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Entry</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Exit</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Signal</th>
                    <th className="text-center px-3 py-2.5 font-medium text-muted-foreground">Score</th>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Actual %</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {result.bars.map((b, i) => (
                    <tr key={i} className={`border-b border-border/40 last:border-0 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{b.date}</td>
                      <td className="px-3 py-2 font-mono">{b.entryPrice < 1 ? b.entryPrice.toFixed(4) : b.entryPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">
                        {b.exitPrice != null ? (b.exitPrice < 1 ? b.exitPrice.toFixed(4) : b.exitPrice.toFixed(2)) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${directionBadgeClass(b.predictedDirection)}`}>
                          {b.predictedDirection === "BULLISH" ? "▲" : b.predictedDirection === "BEARISH" ? "▼" : "—"}{" "}
                          {b.predictedDirection.charAt(0) + b.predictedDirection.slice(1).toLowerCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-center">
                        <span className={b.score >= 3 ? "text-emerald-400" : b.score <= -3 ? "text-red-400" : "text-muted-foreground"}>
                          {b.score >= 0 ? "+" : ""}{b.score.toFixed(1)}
                        </span>
                      </td>
                      <td className={`px-3 py-2 font-mono text-right ${b.actualChangePct == null ? "text-muted-foreground" : b.actualChangePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {b.actualChangePct != null ? `${b.actualChangePct >= 0 ? "+" : ""}${b.actualChangePct.toFixed(2)}%` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1">
                          {outcomeIcon(b.outcome)}
                          <span className={b.outcome === "CORRECT" ? "text-emerald-400" : b.outcome === "WRONG" ? "text-red-400" : "text-muted-foreground"}>
                            {b.outcome.charAt(0) + b.outcome.slice(1).toLowerCase()}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </CardContent>
      )}

      {!result && !running && (
        <CardContent>
          <div className="text-sm text-muted-foreground italic py-6 text-center">
            Click "Run backtest" to replay {watchSymbol}'s last 30 trading days through the indicator pipeline and see projected hit rates.
          </div>
        </CardContent>
      )}

      {running && (
        <CardContent>
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Fetching 2 years of daily bars and replaying the pipeline…
          </div>
        </CardContent>
      )}
    </Card>
  );
}
