import React, { useCallback, useEffect, useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Key, RefreshCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface KeyHealth {
  name: string;
  provider: "groq" | "gemini";
  ok: boolean;
  status?: number;
  error?: string;
  checkedAt: string;
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

  const okCount = results.filter((r) => r.ok).length;
  const badCount = results.length - okCount;

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
              <Key className="w-7 h-7 text-primary" /> API Key Health
            </h1>
            <p className="text-muted-foreground">Live validation of every Groq + Gemini key in use.</p>
          </div>
          <Button onClick={() => void recheck()} disabled={busy}>
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking...</> : <><RefreshCw className="w-4 h-4 mr-2" /> Re-check</>}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total keys</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{results.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-green-500">Healthy</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-green-500">{okCount}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-red-500">Failing</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-red-500">{badCount}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Per-key status</CardTitle>
            <CardDescription>
              {checkedAt ? `Last checked ${new Date(checkedAt).toLocaleString()}` : "Not yet checked"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <div className="text-sm text-muted-foreground">Click Re-check to ping every key.</div>
            ) : (
              <div className="divide-y divide-border/60">
                {results.map((r) => (
                  <div key={r.name} className="py-2.5 flex items-center gap-3">
                    {r.ok ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm">{r.name}</div>
                      {r.error && <div className="text-xs text-red-400 truncate">{r.error}</div>}
                    </div>
                    <Badge variant="outline" className="uppercase text-[10px]">{r.provider}</Badge>
                    {r.status !== undefined && (
                      <Badge variant={r.ok ? "secondary" : "destructive"}>{r.status}</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
