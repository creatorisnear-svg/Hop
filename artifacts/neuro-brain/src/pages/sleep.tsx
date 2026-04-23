import React, { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useListInsights,
  useGetSleepStatus,
  runSleep,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Moon, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

const KIND_BADGE: Record<string, string> = {
  pattern: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  lesson: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  preference: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
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

export default function SleepPage() {
  const { data: insights, isLoading } = useListInsights();
  const { data: status } = useGetSleepStatus({ query: { refetchInterval: 5000 } });
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const onTrigger = async () => {
    setRunning(true);
    try {
      const r = await runSleep();
      if (r.insightsCreated > 0) {
        toast.success(`Wrote ${r.insightsCreated} new insight(s) from ${r.consideredRuns} run(s)`);
      } else {
        toast.message("Sleep finished", {
          description: r.skippedReason ?? `Considered ${r.consideredRuns} run(s); nothing new to consolidate.`,
        });
      }
      await qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <Moon className="w-8 h-8 text-primary" />
            Sleep & Consolidation
          </h1>
          <p className="text-muted-foreground">
            When the brain is idle, it reviews recent successful runs and writes durable insights it can use the next time
            Jarvis plans a run.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Status
            </CardTitle>
            <CardDescription>
              {status?.isSleeping ? "Currently consolidating…" : "Idle — auto-runs roughly every 30 min when no runs are active."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Last run started</div>
              <div className="font-medium">{formatRelative(status?.lastRunAt ?? null)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Last sleep cycle</div>
              <div className="font-medium">{formatRelative(status?.lastSleepAt ?? null)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Insights last cycle</div>
              <div className="font-medium">{status?.insightsLastCycle ?? 0}</div>
            </div>
            <div className="md:col-span-3">
              <Button onClick={onTrigger} disabled={running || status?.isSleeping}>
                {running || status?.isSleeping ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Moon className="w-4 h-4 mr-2" />
                )}
                Sleep now
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Insights</CardTitle>
            <CardDescription>
              {insights?.length ?? 0} stored. Jarvis includes the most recent few in every planning prompt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (insights ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No insights yet — let the brain run a few tasks then try "Sleep now".</p>
            ) : (
              (insights ?? []).map((i) => (
                <div key={i.id} className="rounded-md border border-border bg-card/40 p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={
                        "px-2 py-0.5 rounded text-[10px] uppercase tracking-wide border " +
                        (KIND_BADGE[i.kind] ?? "bg-muted text-muted-foreground border-border")
                      }
                    >
                      {i.kind}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelative(i.createdAt)} · {i.sourceRunIds.length} source run(s)
                    </span>
                  </div>
                  <div>{i.content}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
