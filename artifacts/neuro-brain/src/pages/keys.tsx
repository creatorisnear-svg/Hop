import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Key, RefreshCw, CheckCircle2, XCircle, Loader2, AlertTriangle, Gauge } from "lucide-react";

type KeyState = "ready" | "rate_limited" | "invalid" | "unreachable" | "missing";

interface KeyHealth {
  name: string;
  provider: "groq" | "gemini";
  ok: boolean;
  state?: KeyState;
  status?: number;
  error?: string;
  checkedAt: string;
}

const STATE_META: Record<KeyState, { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }> = {
  ready: {
    label: "READY — no rate limit reached",
    tone: "text-green-500 border-green-500/40 bg-green-500/10",
    icon: CheckCircle2,
  },
  rate_limited: {
    label: "RATE LIMIT REACHED",
    tone: "text-amber-400 border-amber-400/40 bg-amber-400/10",
    icon: Gauge,
  },
  invalid: {
    label: "INVALID KEY",
    tone: "text-red-500 border-red-500/40 bg-red-500/10",
    icon: XCircle,
  },
  unreachable: {
    label: "UNREACHABLE",
    tone: "text-red-400 border-red-400/30 bg-red-400/10",
    icon: AlertTriangle,
  },
  missing: {
    label: "NOT CONFIGURED",
    tone: "text-muted-foreground border-border/60 bg-muted/30",
    icon: AlertTriangle,
  },
};

function deriveState(r: KeyHealth): KeyState {
  if (r.state) return r.state;
  if (r.ok) return "ready";
  if (r.status === 429) return "rate_limited";
  if (r.status === 401 || r.status === 403) return "invalid";
  return "unreachable";
}

export default function KeysPage() {
  const [results, setResults] = useState<KeyHealth[]>([]);
  const [checkedAt, setCheckedAt] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/keys/health");
    const data = await r.json();
    setResults(data.results ?? []);
    setCheckedAt(data.checkedAt ?? 0);
  }, []);

  const recheck = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/keys/health/check", { method: "POST" });
      const data = await r.json();
      setResults(data.results ?? []);
      setCheckedAt(data.checkedAt ?? Date.now());
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => {
    const gemini = results.filter((r) => r.provider === "gemini");
    const groq = results.filter((r) => r.provider === "groq");
    return { gemini, groq };
  }, [results]);

  const summary = useMemo(() => {
    const counts = { ready: 0, rate_limited: 0, invalid: 0, unreachable: 0, missing: 0 } as Record<KeyState, number>;
    for (const r of results) counts[deriveState(r)]++;
    return counts;
  }, [results]);

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
              <Key className="w-7 h-7 text-primary" /> API Key Health
            </h1>
            <p className="text-muted-foreground">
              Live check for every Groq + Gemini key. Working keys are clearly marked
              <span className="text-green-500 font-semibold"> READY — no rate limit reached</span>.
            </p>
          </div>
          <Button onClick={() => void recheck()} disabled={busy}>
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking...</> : <><RefreshCw className="w-4 h-4 mr-2" /> Re-check</>}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard label="Total" value={results.length} tone="text-foreground" />
          <SummaryCard label="Ready" value={summary.ready} tone="text-green-500" />
          <SummaryCard label="Rate-limited" value={summary.rate_limited} tone="text-amber-400" />
          <SummaryCard label="Invalid" value={summary.invalid} tone="text-red-500" />
          <SummaryCard label="Unreachable" value={summary.unreachable + summary.missing} tone="text-red-400" />
        </div>

        <ProviderBlock
          title="Gemini keys"
          description="Pool of Google AI keys (rotates on rate limits). Each shows its live ready / limit status."
          rows={groups.gemini}
          checkedAt={checkedAt}
        />

        <ProviderBlock
          title="Groq keys"
          description="Pool of Groq inference keys for Llama / Qwen / Kimi models."
          rows={groups.groq}
          checkedAt={checkedAt}
        />
      </div>
    </Layout>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ProviderBlock({
  title,
  description,
  rows,
  checkedAt,
}: {
  title: string;
  description: string;
  rows: KeyHealth[];
  checkedAt: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{title}</span>
          <Badge variant="outline" className="text-xs font-mono">{rows.length} keys</Badge>
        </CardTitle>
        <CardDescription>
          {description}
          {checkedAt ? <> · Last checked {new Date(checkedAt).toLocaleTimeString()}</> : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No keys configured. Add them as Replit secrets.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => <KeyRow key={r.name} row={r} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KeyRow({ row }: { row: KeyHealth }) {
  const state = deriveState(row);
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-md border px-3 py-2.5 ${meta.tone}`}>
      <Icon className={`w-5 h-5 shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-sm truncate text-foreground/90">{row.name}</div>
        <div className="text-xs font-semibold tracking-wide">{meta.label}</div>
        {state !== "ready" && row.error && (
          <div className="text-[11px] mt-0.5 opacity-80 truncate">{row.error}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {row.status !== undefined && (
          <Badge variant="outline" className="text-[10px] font-mono">HTTP {row.status}</Badge>
        )}
        <Badge variant="outline" className="text-[10px] uppercase">{row.provider}</Badge>
      </div>
    </div>
  );
}
