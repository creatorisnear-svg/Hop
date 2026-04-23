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

  useEffect(() => {
    if (!runId) return;

    // Only connect SSE if we know the run is running or pending
    if (run && (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled')) {
      return;
    }

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
            eventSource.close();
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

  return (
    <Layout>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Main Content: Goal & Transcript */}
        <div className="lg:col-span-2 space-y-6">
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

        {/* Side Panel: Live Brain & Controls */}
        <div className="space-y-6">
          <Card className="bg-card border-border flex flex-col items-center justify-center p-6 min-h-[300px] sticky top-6">
            <div className="w-full flex justify-between items-center mb-6">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Live Activity</h3>
              <div className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded">
                Iter {run.iterations}
              </div>
            </div>
            
            <BrainVisual activeRegion={run.status === 'running' ? (activeRegion || "prefrontal_cortex") : undefined} className="mb-6" />

            {run.status === 'running' && (
              <Button 
                variant="destructive" 
                className="w-full" 
                onClick={handleCancel}
                disabled={cancelRun.isPending}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Abort Process
              </Button>
            )}
          </Card>
        </div>

      </div>
    </Layout>
  );
}
