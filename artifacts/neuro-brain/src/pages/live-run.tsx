import React, { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { BrainVisual } from "@/components/brain-visual";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGetRun, getGetRunQueryKey, useCancelRun } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BrainMessage, RunStatus } from "@workspace/api-client-react/src/generated/api.schemas";
import { BrainCircuit, Clock, XCircle, Terminal, Layers, Volume2, VolumeX } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { speak, stopSpeaking, useAutoSpeak } from "@/lib/useVoice";

export default function LiveRun() {
  const [, params] = useRoute("/run/:id");
  const runId = params?.id || "";
  const queryClient = useQueryClient();
  const cancelRun = useCancelRun();

  const [streamMessages, setStreamMessages] = useState<BrainMessage[]>([]);
  const [activeRegion, setActiveRegion] = useState<string | undefined>();
  const [autoSpeak, setAutoSpeakState] = useAutoSpeak();
  const spokenForRunRef = React.useRef<string | null>(null);

  const { data, isLoading, isError } = useGetRun(runId, {
    query: {
      enabled: !!runId,
      queryKey: getGetRunQueryKey(runId),
      // Polling fallback: while a run is still pending/running, poll every 2s
      // so the UI updates reliably even if SSE drops or misses the `done` event.
      refetchInterval: (q) => {
        const r = (q.state.data as { run?: { status?: string } } | undefined)?.run;
        if (!r) return 2000;
        return r.status === "running" || r.status === "pending" ? 2000 : false;
      },
      refetchOnWindowFocus: true,
    }
  });

  const run = data?.run;
  const initialMessages = data?.messages || [];
  
  // Combine initial messages + streamed messages, deduplicating by ID
  const allMessages = [...initialMessages];
  streamMessages.forEach(sm => {
    if (!allMessages.find(m => m.id === sm.id)) {
      allMessages.push(sm);
    }
  });
  allMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Track terminal status in a ref so we don't re-open SSE every status change.
  const terminalRef = React.useRef(false);
  useEffect(() => {
    if (!runId) return;
    if (run && (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled')) {
      terminalRef.current = true;
      return;
    }
    if (terminalRef.current) return;

    const eventSource = new EventSource(`/api/runs/${runId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'message') {
          setStreamMessages(prev => [...prev, parsed.message]);
          setActiveRegion(parsed.message.region);
        } else if (parsed.type === 'status' || parsed.type === 'done') {
          // Refetch the full run state to get the final answer / status change
          queryClient.invalidateQueries({ queryKey: getGetRunQueryKey(runId) });
          if (parsed.type === 'done') {
            setActiveRegion(undefined);
            terminalRef.current = true;
            eventSource.close();
            // Belt-and-suspenders: refetch once more shortly after, in case the
            // server hadn't fully committed the finalAnswer when `done` fired.
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: getGetRunQueryKey(runId) });
            }, 400);
          }
        }
      } catch (e) {
        console.error("SSE parse error", e);
      }
    };

    eventSource.onerror = (e) => {
      console.error("SSE error", e);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [runId, run?.status, queryClient]);

  // Auto-speak the final answer once per run when it arrives.
  useEffect(() => {
    if (!autoSpeak) return;
    if (!run?.finalAnswer) return;
    if (run.status !== "succeeded") return;
    if (spokenForRunRef.current === run.id) return;
    spokenForRunRef.current = run.id;
    speak(run.finalAnswer);
  }, [autoSpeak, run?.id, run?.finalAnswer, run?.status]);

  useEffect(() => () => stopSpeaking(), []);

  const handleCancel = () => {
    cancelRun.mutate({ runId }, {
      onSuccess: () => {
        toast.success("Run cancelled");
        queryClient.invalidateQueries({ queryKey: getGetRunQueryKey(runId) });
      },
      onError: (err: any) => toast.error(err.message || "Failed to cancel")
    });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-12 w-1/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Layout>
    );
  }

  if (isError || !run) {
    return (
      <Layout>
        <div className="text-center py-12 text-destructive">Failed to load run details.</div>
      </Layout>
    );
  }

  // Build a "recently fired" map from the message stream so we can render
  // small activity meters next to each region label, both on mobile (where the
  // 3D scene is the hero) and desktop (where it sits in the side column).
  const REGION_ORDER = [
    "jarvis",
    "sensory_cortex",
    "association_cortex",
    "hippocampus",
    "prefrontal_cortex",
    "cerebellum",
    "motor_cortex",
  ] as const;
  const REGION_LABELS: Record<string, string> = {
    jarvis: "Jarvis",
    sensory_cortex: "Sensory",
    association_cortex: "Association",
    hippocampus: "Hippocampus",
    prefrontal_cortex: "Prefrontal",
    cerebellum: "Cerebellum",
    motor_cortex: "Motor",
  };
  const REGION_DOT: Record<string, string> = {
    jarvis: "bg-white",
    sensory_cortex: "bg-cyan-400",
    association_cortex: "bg-orange-400",
    hippocampus: "bg-emerald-400",
    prefrontal_cortex: "bg-violet-400",
    cerebellum: "bg-lime-400",
    motor_cortex: "bg-rose-400",
  };
  const regionFireCount: Record<string, number> = {};
  for (const m of allMessages) {
    if (!m.region) continue;
    regionFireCount[m.region] = (regionFireCount[m.region] ?? 0) + 1;
  }
  const isRunning = run.status === "running" || run.status === "pending";

  const BrainPanel = (
    <Card className="bg-card border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Live Brain Topology
        </h3>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
            isRunning
              ? "bg-accent/10 text-accent border-accent/30 animate-pulse"
              : "bg-muted text-muted-foreground border-border"
          }`}>
            {isRunning ? "LIVE" : "IDLE"}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
            iter {run.iterations}
          </span>
        </div>
      </div>
      <div className="relative w-full h-[55vh] sm:h-[60vh] lg:h-[calc(100vh-18rem)] min-h-[320px] max-h-[760px]">
        <BrainVisual
          activeRegion={isRunning ? activeRegion || "prefrontal_cortex" : undefined}
        />
      </div>
      <div className="px-3 py-3 border-t border-border bg-background/40">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-1.5">
          {REGION_ORDER.map((key) => {
            const fires = regionFireCount[key] ?? 0;
            const isActive = activeRegion === key && isRunning;
            return (
              <div
                key={key}
                className={`flex items-center justify-between gap-2 px-2 py-1 rounded border text-[10px] font-mono transition-all ${
                  isActive
                    ? "border-accent/60 bg-accent/10 shadow-[0_0_8px_hsl(var(--accent)/0.3)]"
                    : "border-border bg-muted/30"
                }`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${REGION_DOT[key]} ${isActive ? "animate-pulse" : "opacity-60"}`}
                  />
                  <span className="truncate">{REGION_LABELS[key]}</span>
                </span>
                <span className="text-muted-foreground tabular-nums">{fires}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground text-center">
          Drag to orbit · pinch / scroll to zoom · tap a label to focus · double-tap to reset
        </p>
        {isRunning && (
          <Button
            variant="destructive"
            size="sm"
            className="w-full mt-2"
            onClick={handleCancel}
            disabled={cancelRun.isPending}
          >
            <XCircle className="w-3.5 h-3.5 mr-1.5" />
            Abort Process
          </Button>
        )}
      </div>
    </Card>
  );

  return (
    <Layout>
      {/* Mobile: brain is the hero, stacked above transcript.
          Desktop: brain becomes a sticky right column. */}
      <div className="lg:hidden mb-6">{BrainPanel}</div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8">
        {/* Main Content: Goal & Transcript */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="bg-card border-primary/20">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <BrainCircuit className="w-5 h-5 text-primary" />
                  Objective
                </CardTitle>
                <div className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                  run.status === 'succeeded' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                  run.status === 'failed' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                  run.status === 'cancelled' ? 'bg-muted text-muted-foreground border-border' :
                  'bg-accent/10 text-accent border-accent/20 animate-pulse'
                }`}>
                  {run.status.toUpperCase()}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-lg leading-relaxed">{run.goal}</p>
            </CardContent>
          </Card>

          {run.finalAnswer && (
            <Card className="bg-primary/5 border-primary/30 shadow-[0_0_15px_hsl(var(--primary)/0.1)]">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-primary flex items-center gap-2">
                    <Terminal className="w-5 h-5" />
                    Final Synthesis
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => speak(run.finalAnswer ?? "")}
                    >
                      <Volume2 className="w-3.5 h-3.5 mr-1.5" />
                      Speak
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={autoSpeak ? "default" : "outline"}
                      onClick={() => {
                        setAutoSpeakState(!autoSpeak);
                        if (autoSpeak) stopSpeaking();
                      }}
                      title="Auto-speak future answers"
                    >
                      {autoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="prose prose-invert max-w-none text-foreground">
                  <pre className="whitespace-pre-wrap font-sans text-sm bg-transparent p-0 m-0 border-0">{run.finalAnswer}</pre>
                </div>
              </CardContent>
            </Card>
          )}

          {run.error && (
            <Card className="bg-destructive/5 border-destructive/30">
              <CardContent className="pt-6">
                <p className="text-destructive font-mono text-sm">{run.error}</p>
              </CardContent>
            </Card>
          )}

          <div className="space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2 mt-8">
              <Layers className="w-5 h-5" />
              Cognitive Transcript
            </h3>
            
            {allMessages.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg">
                Waiting for regions to fire...
              </div>
            ) : (
              <div className="space-y-4">
                {allMessages.map((msg, i) => (
                  <Card key={msg.id || i} className="bg-card border-border relative overflow-hidden group">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/50 group-hover:bg-primary transition-colors" />
                    <CardHeader className="py-3 px-5 bg-muted/20 border-b border-border flex flex-row items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-bold text-primary">{msg.region}</span>
                        <span className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full">
                          {msg.role}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>Iter {msg.iteration}</span>
                        {msg.latencyMs && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {msg.latencyMs}ms
                          </span>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="py-4 px-5">
                      <div className="prose prose-invert max-w-none text-sm text-foreground/90">
                        <pre className="whitespace-pre-wrap font-sans bg-transparent p-0 m-0 border-0 text-sm leading-relaxed">{msg.content}</pre>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Desktop side panel: sticky brain */}
        <div className="hidden lg:block lg:col-span-2">
          <div className="sticky top-6">{BrainPanel}</div>
        </div>
      </div>
    </Layout>
  );
}
