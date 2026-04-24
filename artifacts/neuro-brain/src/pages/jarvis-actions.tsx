import React, { useEffect, useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldOff, ShieldAlert, Github, Server, CheckCircle2, XCircle } from "lucide-react";

interface AutonomyStatus {
  mode: "off" | "on";
  githubConfigured: boolean;
  koyebConfigured: boolean;
  repo: string | null;
  branch: string;
}

interface ActionRow {
  id: number;
  tool: string;
  params: unknown;
  result: unknown;
  ok: boolean;
  error: string | null;
  durationMs: string | null;
  autonomyMode: string;
  createdAt: string;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function JarvisActionsPage() {
  const [status, setStatus] = useState<AutonomyStatus | null>(null);
  const [actions, setActions] = useState<ActionRow[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  async function refresh() {
    const [s, a] = await Promise.all([
      fetch("/api/jarvis/autonomy").then((r) => r.json()),
      fetch("/api/jarvis/actions?limit=200").then((r) => r.json()),
    ]);
    setStatus(s);
    setActions(a.actions ?? []);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isOn = status?.mode === "on";

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            {isOn ? (
              <ShieldAlert className="w-8 h-8 text-amber-500" />
            ) : (
              <ShieldCheck className="w-8 h-8 text-primary" />
            )}
            Jarvis Actions
          </h1>
          <p className="text-muted-foreground">
            Audit log of every autonomous action Jarvis has taken on your GitHub repo and Koyeb services.
          </p>
        </div>

        {/* Status banner */}
        {!status ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <Card className={isOn ? "border-amber-500/30 bg-amber-500/5" : "border-border"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {isOn ? (
                  <>
                    <ShieldAlert className="w-4 h-4 text-amber-500" />
                    Autonomy is ON
                  </>
                ) : (
                  <>
                    <ShieldOff className="w-4 h-4 text-muted-foreground" />
                    Autonomy is OFF
                  </>
                )}
              </CardTitle>
              <CardDescription>
                {isOn
                  ? "Jarvis can push commits, redeploy, and manage services on his own. Set JARVIS_AUTONOMY=off in Koyeb to stop him immediately."
                  : "Jarvis cannot take any GitHub or Koyeb actions. Set JARVIS_AUTONOMY=on in Koyeb to enable."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Github className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">GitHub:</span>
                  {status.githubConfigured ? (
                    <Badge variant="secondary">
                      {status.repo} · {status.branch}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Not configured
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">Koyeb:</span>
                  {status.koyebConfigured ? (
                    <Badge variant="secondary">Token present</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Not configured
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Recent actions</CardTitle>
            <CardDescription>
              {actions ? `${actions.length} entries` : "Loading…"} · auto-refreshes every 5s
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!actions ? (
              <Skeleton className="h-24 w-full" />
            ) : actions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No actions yet. When Jarvis takes an autonomous action, it will be logged here.
              </p>
            ) : (
              actions.map((a) => {
                const open = expanded.has(a.id);
                return (
                  <div
                    key={a.id}
                    className="rounded-md border border-border bg-card/40"
                  >
                    <button
                      onClick={() => toggle(a.id)}
                      className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {a.ok ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-destructive shrink-0" />
                        )}
                        <code className="text-sm font-mono truncate">{a.tool}</code>
                        {!a.ok && a.error && (
                          <span className="text-xs text-destructive truncate">{a.error}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                        {a.durationMs && <span>{a.durationMs}ms</span>}
                        <span>{relTime(a.createdAt)}</span>
                      </div>
                    </button>
                    {open && (
                      <div className="border-t border-border px-3 py-2 space-y-2 text-xs">
                        <div>
                          <div className="text-muted-foreground mb-1">Params</div>
                          <pre className="bg-muted/40 rounded p-2 overflow-x-auto">
                            {JSON.stringify(a.params, null, 2)}
                          </pre>
                        </div>
                        {a.ok ? (
                          <div>
                            <div className="text-muted-foreground mb-1">Result</div>
                            <pre className="bg-muted/40 rounded p-2 overflow-x-auto max-h-64">
                              {JSON.stringify(a.result, null, 2)}
                            </pre>
                          </div>
                        ) : (
                          <div>
                            <div className="text-muted-foreground mb-1">Error</div>
                            <pre className="bg-destructive/10 text-destructive rounded p-2 overflow-x-auto">
                              {a.error}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
