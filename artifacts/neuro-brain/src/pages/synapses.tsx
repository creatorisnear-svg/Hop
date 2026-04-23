import React from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useListSynapses } from "@workspace/api-client-react";
import { Zap, ArrowRight, TrendingUp } from "lucide-react";

const REGION_LABEL: Record<string, string> = {
  sensory_cortex: "Sensory Cortex",
  association_cortex: "Association Cortex",
  hippocampus: "Hippocampus",
  prefrontal_cortex: "Prefrontal Cortex",
  cerebellum: "Cerebellum",
  motor_cortex: "Motor Cortex",
  jarvis: "Jarvis",
};

function label(key: string): string {
  return REGION_LABEL[key] ?? key;
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default function SynapsesPage() {
  const { data: synapses, isLoading } = useListSynapses();

  const sorted = (synapses ?? []).slice().sort((a, b) => b.strength - a.strength);
  const strongest = sorted[0];

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <Zap className="w-8 h-8 text-primary" />
            Synapses
          </h1>
          <p className="text-muted-foreground">
            Region-to-region pathways the brain has learned. Each successful run reinforces the connections it used.
            Jarvis sees the strongest pathways when planning new runs.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No synapses yet</CardTitle>
              <CardDescription>
                Run a few brain sessions and successful pathways will start showing up here.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            {strongest && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    Strongest pathway
                  </CardTitle>
                  <CardDescription>
                    <span className="font-semibold text-foreground">{label(strongest.fromRegion)}</span>
                    <ArrowRight className="inline w-3 h-3 mx-2 align-middle" />
                    <span className="font-semibold text-foreground">{label(strongest.toRegion)}</span>
                    {" — "}
                    {(strongest.strength * 100).toFixed(0)}% confident over {strongest.totalCount} firings
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>All learned connections</CardTitle>
                <CardDescription>{sorted.length} pathways tracked</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {sorted.map((s) => {
                  const pct = Math.round(s.strength * 100);
                  const successPct =
                    s.totalCount > 0 ? Math.round((s.successCount / s.totalCount) * 100) : 0;
                  return (
                    <div
                      key={`${s.fromRegion}->${s.toRegion}`}
                      className="rounded-md border border-border bg-card/40 p-3"
                    >
                      <div className="flex items-center justify-between text-sm mb-2">
                        <div className="flex items-center gap-2 font-medium">
                          <span>{label(s.fromRegion)}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>{label(s.toRegion)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          fired {s.totalCount}× · {successPct}% raw success · {formatRelative(s.lastFiredAt)}
                        </div>
                      </div>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-accent"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground text-right">
                        strength {pct}%
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
