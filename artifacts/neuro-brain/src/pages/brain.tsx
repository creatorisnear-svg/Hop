import React, { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { BrainVisual } from "@/components/brain-visual";
import { useListRuns, useListSynapses } from "@workspace/api-client-react";
import { Activity, Brain, Maximize2, Minimize2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REGION_LABELS: Record<string, string> = {
  jarvis: "Jarvis",
  sensory_cortex: "Sensory",
  association_cortex: "Association",
  hippocampus: "Hippocampus",
  prefrontal_cortex: "Prefrontal",
  cerebellum: "Cerebellum",
  motor_cortex: "Motor",
};
const REGION_ORDER = [
  "jarvis",
  "sensory_cortex",
  "association_cortex",
  "hippocampus",
  "prefrontal_cortex",
  "cerebellum",
  "motor_cortex",
] as const;
const REGION_DOT: Record<string, string> = {
  jarvis: "bg-white",
  sensory_cortex: "bg-cyan-400",
  association_cortex: "bg-orange-400",
  hippocampus: "bg-emerald-400",
  prefrontal_cortex: "bg-violet-400",
  cerebellum: "bg-lime-400",
  motor_cortex: "bg-rose-400",
};

interface BrainMessageLite {
  id: string;
  region: string;
  createdAt: string;
}

export default function BrainTopologyPage() {
  // Find the most recent active (or any) run to mirror its activity onto the
  // global topology view.
  const { data: runs } = useListRuns(
    { limit: 5 },
    { query: { refetchInterval: 4000 } },
  );
  const activeRun = useMemo(() => {
    const list = runs ?? [];
    return (
      list.find((r) => r.status === "running" || r.status === "pending") ??
      list[0]
    );
  }, [runs]);
  const runId = activeRun?.id;
  const isLive =
    activeRun?.status === "running" || activeRun?.status === "pending";

  const { data: synapses } = useListSynapses({
    query: { refetchInterval: isLive ? 2500 : 12000 },
  });

  const [activeRegion, setActiveRegion] = useState<string | undefined>();
  const [recentByRegion, setRecentByRegion] = useState<Record<string, number>>({});
  const [fullscreen, setFullscreen] = useState(false);

  // Subscribe to SSE for the most recent run so the global topology lights
  // up with whatever the brain is doing right now.
  useEffect(() => {
    if (!runId || !isLive) {
      setActiveRegion(undefined);
      return;
    }
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === "message" && parsed.message?.region) {
          setActiveRegion(parsed.message.region);
          setRecentByRegion((prev) => ({
            ...prev,
            [parsed.message.region]: (prev[parsed.message.region] ?? 0) + 1,
          }));
        } else if (parsed.type === "done") {
          setActiveRegion(undefined);
          es.close();
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [runId, isLive]);

  // Reset region counters when switching to a different run.
  useEffect(() => {
    setRecentByRegion({});
  }, [runId]);

  // Top synapses for the side panel.
  const topSynapses = useMemo(() => {
    return [...(synapses ?? [])]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 8);
  }, [synapses]);

  const synapseCount = synapses?.length ?? 0;
  const strongCount = (synapses ?? []).filter((s) => s.strength > 0.5).length;

  return (
    <Layout>
      <div className={cn("flex flex-col gap-4", fullscreen && "fixed inset-0 z-50 bg-background p-4")}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10 border border-primary/20">
              <Brain className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Live Brain Topology</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Real-time 3D map of regions, learned synapses, and signal flow.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>

        {/* Main grid: brain (hero) + side panel */}
        <div className={cn(
          "grid gap-4",
          fullscreen ? "grid-cols-1 flex-1 min-h-0" : "grid-cols-1 lg:grid-cols-4",
        )}>
          {/* Brain canvas */}
          <div className={cn(
            "relative rounded-xl border border-border bg-card overflow-hidden shadow-xl shadow-primary/5",
            fullscreen ? "min-h-0 flex-1" : "lg:col-span-3",
          )}>
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
              <span className={cn(
                "text-[10px] font-mono px-2 py-1 rounded-full border backdrop-blur",
                isLive
                  ? "bg-accent/10 text-accent border-accent/40 animate-pulse"
                  : "bg-background/60 text-muted-foreground border-border",
              )}>
                {isLive ? "● LIVE" : "○ IDLE"}
              </span>
              {activeRun && (
                <span className="text-[10px] font-mono px-2 py-1 rounded bg-background/60 text-muted-foreground border border-border backdrop-blur max-w-[40vw] truncate">
                  {activeRun.goal || activeRun.id.slice(0, 8)}
                </span>
              )}
            </div>
            <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-1">
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-background/60 text-muted-foreground border border-border backdrop-blur">
                {synapseCount} synapses · {strongCount} strong
              </span>
            </div>
            <div className={cn(
              "w-full",
              fullscreen
                ? "h-full"
                : "h-[60vh] sm:h-[70vh] lg:h-[calc(100vh-12rem)] min-h-[360px] max-h-[860px]",
            )}>
              <BrainVisual activeRegion={activeRegion} />
            </div>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground bg-background/40 backdrop-blur px-2 py-0.5 rounded">
              drag · pinch · double-tap to reset
            </div>
          </div>

          {/* Side panel — region activity + learned synapses */}
          {!fullscreen && (
            <div className="space-y-4">
              {/* Region activity */}
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-3.5 h-3.5 text-primary" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Region Activity
                  </h3>
                </div>
                <div className="space-y-1.5">
                  {REGION_ORDER.map((key) => {
                    const fires = recentByRegion[key] ?? 0;
                    const isActive = activeRegion === key;
                    return (
                      <div
                        key={key}
                        className={cn(
                          "flex items-center justify-between gap-2 px-2 py-1.5 rounded border text-xs transition-all",
                          isActive
                            ? "border-accent/60 bg-accent/10 shadow-[0_0_10px_hsl(var(--accent)/0.25)]"
                            : "border-border/60 bg-muted/20",
                        )}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full shrink-0",
                              REGION_DOT[key],
                              isActive ? "animate-pulse" : "opacity-60",
                            )}
                          />
                          <span className="truncate">{REGION_LABELS[key]}</span>
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                          {fires}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Strongest synapses */}
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Strongest Synapses
                  </h3>
                </div>
                {topSynapses.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">
                    No learned pathways yet — run the brain to start forming synapses.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {topSynapses.map((s) => (
                      <div
                        key={`${s.fromRegion}->${s.toRegion}`}
                        className="px-2 py-1.5 rounded border border-border/60 bg-muted/20 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono truncate text-[11px]">
                            <span className="text-foreground">{REGION_LABELS[s.fromRegion] ?? s.fromRegion}</span>
                            <span className="text-muted-foreground mx-1">→</span>
                            <span className="text-foreground">{REGION_LABELS[s.toRegion] ?? s.toRegion}</span>
                          </span>
                          <span className="font-mono text-[10px] text-amber-400 tabular-nums">
                            {(s.strength * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500/80 to-amber-300"
                            style={{ width: `${Math.min(100, s.strength * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
