import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCreateRun } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Brain, Play, Sparkles, Mic, MicOff, Plus, ExternalLink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useVoiceInput } from "@/lib/useVoice";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

const THREAD_KEY = "neurolinked_run_thread_v1";

type Status = "pending" | "running" | "succeeded" | "failed" | "cancelled";

interface RunRow {
  id: string;
  goal: string;
  status: Status;
  finalAnswer?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

function loadThread(): string[] {
  try {
    const raw = localStorage.getItem(THREAD_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveThread(ids: string[]) {
  try {
    localStorage.setItem(THREAD_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "succeeded") {
    return (
      <Badge variant="outline" className="text-green-500 border-green-500/40 bg-green-500/10">
        <CheckCircle2 className="w-3 h-3 mr-1" /> done
      </Badge>
    );
  }
  if (status === "failed" || status === "cancelled") {
    return (
      <Badge variant="outline" className="text-red-500 border-red-500/40 bg-red-500/10">
        <AlertCircle className="w-3 h-3 mr-1" /> {status}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-yellow-500 border-yellow-500/40 bg-yellow-500/10">
      <Loader2 className="w-3 h-3 mr-1 animate-spin" /> {status}
    </Badge>
  );
}

export default function NewRun() {
  const [goal, setGoal] = useState("");
  const [maxIterations, setMaxIterations] = useState(6);
  const [threadIds, setThreadIds] = useState<string[]>(() => loadThread());
  const [runs, setRuns] = useState<Record<string, RunRow>>({});
  const createRun = useCreateRun();
  const queryClient = useQueryClient();
  const voice = useVoiceInput((text) => setGoal((g) => (g.trim() ? `${g.trim()} ${text}` : text)));
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveThread(threadIds);
  }, [threadIds]);

  // Hydrate run details for thread
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = threadIds.filter((id) => !runs[id]);
      if (missing.length === 0) return;
      const fetched: Record<string, RunRow> = {};
      await Promise.all(
        missing.map(async (id) => {
          try {
            const r = await fetch(`/api/runs/${id}`);
            if (!r.ok) return;
            const data = await r.json();
            if (data?.run) fetched[id] = data.run as RunRow;
          } catch {
            // ignore
          }
        }),
      );
      if (!cancelled && Object.keys(fetched).length > 0) {
        setRuns((prev) => ({ ...prev, ...fetched }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadIds, runs]);

  // Poll any in-flight runs in the thread
  useEffect(() => {
    const inFlight = threadIds.filter((id) => {
      const r = runs[id];
      return !r || r.status === "pending" || r.status === "running";
    });
    if (inFlight.length === 0) return;
    const t = setInterval(async () => {
      await Promise.all(
        inFlight.map(async (id) => {
          try {
            const r = await fetch(`/api/runs/${id}`);
            if (!r.ok) return;
            const data = await r.json();
            if (data?.run) setRuns((prev) => ({ ...prev, [id]: data.run as RunRow }));
          } catch {
            // ignore
          }
        }),
      );
    }, 2500);
    return () => clearInterval(t);
  }, [threadIds, runs]);

  // Auto-scroll thread on new content
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [threadIds, runs]);

  const orderedThread = useMemo(
    () => threadIds.map((id) => runs[id]).filter((r): r is RunRow => Boolean(r)),
    [threadIds, runs],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = goal.trim();
      if (!trimmed) {
        toast.error("Please enter a goal");
        return;
      }

      const priorRunIds = threadIds.slice(-10);

      // The generated client doesn't know about the new optional field, so call
      // fetch directly. We still surface success/failure via the same UX.
      createRun.mutate(
        { data: { goal: trimmed, maxIterations, priorRunIds } as never },
        {
          onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["/api/runs"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
            const newId = (data as { id: string }).id;
            setRuns((prev) => ({
              ...prev,
              [newId]: { id: newId, goal: trimmed, status: "pending", createdAt: new Date().toISOString() },
            }));
            setThreadIds((prev) => [...prev, newId]);
            setGoal("");
          },
          onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : "Failed to start run";
            toast.error(msg);
          },
        },
      );
    },
    [goal, maxIterations, threadIds, createRun, queryClient],
  );

  const startNewConversation = useCallback(() => {
    if (threadIds.length === 0) return;
    if (!confirm("Start a fresh conversation? Previous runs stay in your history but won't be used as context anymore.")) return;
    setThreadIds([]);
  }, [threadIds.length]);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto py-6 flex flex-col h-[calc(100dvh-4rem)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center p-2 bg-primary/10 rounded-md border border-primary/20">
              <Brain className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Brain Conversation</h1>
              <p className="text-sm text-muted-foreground">
                Each message launches the full autonomous brain. Replies stay in this thread so follow-up runs build on what came before.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={startNewConversation} disabled={threadIds.length === 0}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> New conversation
          </Button>
        </div>

        <div className="flex-1 min-h-0 mb-3">
          <ScrollArea className="h-full pr-2" viewportRef={scrollRef as never}>
            <div className="space-y-4 pb-2">
              {orderedThread.length === 0 && (
                <Card className="bg-card/60 border-dashed border-border">
                  <CardContent className="py-10 text-center space-y-2">
                    <Sparkles className="w-8 h-8 mx-auto text-primary/60" />
                    <div className="text-sm text-muted-foreground">
                      Start a conversation. The brain will remember each turn so follow-ups have context.
                    </div>
                  </CardContent>
                </Card>
              )}
              {orderedThread.map((r) => {
                const isDone = r.status === "succeeded" || r.status === "failed" || r.status === "cancelled";
                const reply =
                  r.status === "succeeded"
                    ? r.finalAnswer || "(no answer)"
                    : r.status === "failed"
                      ? `Failed: ${r.error || "unknown error"}`
                      : r.status === "cancelled"
                        ? "Cancelled."
                        : "Brain is thinking…";
                return (
                  <div key={r.id} className="space-y-2">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap bg-primary text-primary-foreground">
                        {r.goal}
                      </div>
                    </div>
                    <div className="flex justify-start gap-2">
                      <div className="w-7 h-7 shrink-0 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mt-1">
                        <Brain className={cn("w-4 h-4 text-primary", !isDone && "animate-pulse")} />
                      </div>
                      <div className="max-w-[85%] space-y-1.5">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={r.status} />
                          <Link href={`/run/${r.id}`} className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                            transcript <ExternalLink className="w-3 h-3" />
                          </Link>
                        </div>
                        <div className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap bg-muted text-foreground border border-border/60">
                          {reply}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <form onSubmit={handleSubmit} className="shrink-0">
          <Card className="bg-card border-primary/20 shadow-xl shadow-primary/5">
            <CardContent className="p-3 space-y-3">
              <div className="flex items-start gap-2">
                <Textarea
                  id="goal"
                  placeholder={
                    threadIds.length > 0
                      ? "Reply or ask a follow-up… (Shift+Enter for newline)"
                      : "Define a goal for the brain to work on…"
                  }
                  className="min-h-[60px] max-h-48 resize-none bg-background/50 border-border focus-visible:ring-primary text-sm"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e as unknown as React.FormEvent);
                    }
                  }}
                />
                <div className="flex flex-col gap-1.5">
                  {voice.supported && (
                    <Button
                      type="button"
                      size="icon"
                      variant={voice.listening ? "default" : "outline"}
                      onClick={() => (voice.listening ? voice.stop() : voice.start())}
                      title={voice.listening ? "Stop listening" : "Voice input"}
                    >
                      {voice.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </Button>
                  )}
                  <Button
                    type="submit"
                    size="icon"
                    disabled={createRun.isPending || !goal.trim()}
                    title="Engage brain"
                  >
                    {createRun.isPending ? (
                      <Sparkles className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-3 px-1">
                <Label className="text-xs text-muted-foreground shrink-0">Max iterations</Label>
                <Slider
                  min={1}
                  max={20}
                  step={1}
                  value={[maxIterations]}
                  onValueChange={(vals) => setMaxIterations(vals[0])}
                  className="flex-1"
                />
                <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md w-16 text-center">
                  {maxIterations}
                </span>
              </div>
              {voice.listening && (
                <p className="text-xs text-primary animate-pulse px-1">
                  🎙️ Listening… {voice.transcript && <span className="italic">"{voice.transcript}"</span>}
                </p>
              )}
            </CardContent>
          </Card>
          {threadIds.length > 0 && (
            <p className="text-[11px] text-muted-foreground text-center mt-2">
              Sending {Math.min(threadIds.length, 10)} prior turn{Math.min(threadIds.length, 10) === 1 ? "" : "s"} as context. Click "New conversation" to start fresh.
            </p>
          )}
        </form>
      </div>
    </Layout>
  );
}
