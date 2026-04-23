import React, { useEffect, useRef, useState, useCallback } from "react";
import { Bot, Send, Trash2, Maximize2, Minimize2, X, Wrench, CheckCircle2, AlertCircle, Sparkles, Mic, MicOff, Volume2, VolumeX, Ear, EarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { speak, stopSpeaking, useVoiceInput, useWakeWord } from "@/lib/useVoice";

const VOICE_REPLY_KEY = "jarvis_chat_voice_reply_v1";
const WAKE_WORD_KEY = "jarvis_chat_wake_word_v1";

interface ToolCall {
  name: string;
  args: unknown;
  result?: unknown;
  ok?: boolean;
  error?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  createdAt: string;
}

const STORAGE_KEY = "jarvis_chat_open_v1";

function summarizeArgs(args: unknown): string {
  try {
    const s = JSON.stringify(args);
    if (s.length <= 80) return s;
    return s.slice(0, 77) + "...";
  } catch {
    return "(args)";
  }
}

function ToolCallRow({ call, status }: { call: ToolCall; status: "pending" | "done" }) {
  const isOk = call.ok !== false && status === "done";
  return (
    <div className="flex items-start gap-2 text-xs rounded-md border border-border/60 bg-muted/40 px-2 py-1.5">
      {status === "pending" ? (
        <Wrench className="w-3.5 h-3.5 mt-0.5 text-yellow-500 animate-pulse shrink-0" />
      ) : isOk ? (
        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-green-500 shrink-0" />
      ) : (
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-red-500 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-mono text-foreground">{call.name}</div>
        <div className="font-mono text-muted-foreground truncate">{summarizeArgs(call.args)}</div>
        {call.error && <div className="text-red-400 mt-1">{call.error}</div>}
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="w-7 h-7 shrink-0 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mt-1">
          <Bot className="w-4 h-4 text-primary" />
        </div>
      )}
      <div className={cn("max-w-[85%] space-y-1.5", isUser ? "items-end" : "items-start")}>
        {m.toolCalls?.map((c, i) => <ToolCallRow key={i} call={c} status="done" />)}
        {m.content && (
          <div
            className={cn(
              "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
              isUser
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground border border-border/60",
            )}
          >
            {m.content}
          </div>
        )}
      </div>
    </div>
  );
}

export function JarvisChat() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingTools, setPendingTools] = useState<ToolCall[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceReply, setVoiceReply] = useState<boolean>(() => {
    try { return localStorage.getItem(VOICE_REPLY_KEY) === "1"; } catch { return false; }
  });
  const [wakeEnabled, setWakeEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(WAKE_WORD_KEY) === "1"; } catch { return false; }
  });
  const [speaking, setSpeaking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const sendRef = useRef<(text?: string) => void>(() => {});

  // Voice input (push-to-talk) — when a final transcript arrives, auto-send it.
  const voice = useVoiceInput((finalText) => {
    sendRef.current(finalText);
  });

  // Wake-word listener — pause it while Jarvis is busy, push-to-talking, or
  // currently speaking, to avoid mic feedback or overlap.
  const wake = useWakeWord({
    enabled: wakeEnabled && open,
    paused: busy || voice.listening || speaking,
    onCommand: (text) => sendRef.current(text),
  });

  useEffect(() => {
    try { localStorage.setItem(VOICE_REPLY_KEY, voiceReply ? "1" : "0"); } catch {}
    if (!voiceReply) stopSpeaking();
  }, [voiceReply]);

  useEffect(() => {
    try { localStorage.setItem(WAKE_WORD_KEY, wakeEnabled ? "1" : "0"); } catch {}
  }, [wakeEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      // ignore
    }
  }, [open]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/jarvis/messages");
      const data = await r.json();
      setMessages(data.messages ?? []);
      scrollToBottom();
    } catch {
      // ignore
    }
  }, [scrollToBottom]);

  useEffect(() => {
    if (open && messages.length === 0) void loadHistory();
  }, [open, messages.length, loadHistory]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, pendingTools, streamingText, scrollToBottom]);

  const send = useCallback(async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || busy) return;
    if (voice.listening) voice.stop();
    if (voiceReply) stopSpeaking();
    setBusy(true);
    setDraft("");
    setPendingTools([]);
    setStreamingText("");

    try {
      const resp = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let tools: ToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const lines = block.split("\n");
          let evtType = "message";
          let dataLine = "";
          for (const ln of lines) {
            if (ln.startsWith("event: ")) evtType = ln.slice(7).trim();
            else if (ln.startsWith("data: ")) dataLine += ln.slice(6);
          }
          if (!dataLine) continue;
          let payload: any;
          try { payload = JSON.parse(dataLine); } catch { continue; }

          if (evtType === "user_saved") {
            setMessages((m) => [...m, payload.message as ChatMessage]);
          } else if (evtType === "tool_call") {
            tools = [...tools, { name: payload.name, args: payload.args }];
            setPendingTools(tools);
          } else if (evtType === "tool_result") {
            tools = tools.map((t, i) =>
              i === tools.length - 1 && t.name === payload.name
                ? { ...t, ok: payload.ok, result: payload.result, error: payload.error }
                : t,
            );
            setPendingTools(tools);
            // Invalidate caches when state-mutating tools were called
            const mutating = ["start_run", "cancel_run", "update_region", "set_modulators",
              "remember", "forget", "generate_image", "create_tool_plugin",
              "inject_run_step", "replace_upcoming_steps", "fire_webhook_event"];
            if (mutating.includes(payload.name)) {
              qc.invalidateQueries();
            }
          } else if (evtType === "assistant_text") {
            setStreamingText(payload.text ?? "");
          } else if (evtType === "done") {
            const finalMsg = payload.message as ChatMessage;
            setMessages((m) => [...m, finalMsg]);
            setPendingTools([]);
            setStreamingText("");
            if (voiceReply && finalMsg.content) {
              setSpeaking(true);
              speak(finalMsg.content, {
                onStart: () => setSpeaking(true),
                onEnd: () => setSpeaking(false),
              });
            }
          } else if (evtType === "error") {
            setMessages((m) => [
              ...m,
              {
                id: `err-${Date.now()}`,
                role: "assistant",
                content: `Error: ${payload.error}`,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
        }
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: `Network error: ${err instanceof Error ? err.message : String(err)}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
      setPendingTools([]);
      setStreamingText("");
    }
  }, [draft, busy, qc, voice, voiceReply]);

  // Keep ref in sync so the voice-input callback always calls the latest send.
  useEffect(() => {
    sendRef.current = (text?: string) => { void send(text); };
  }, [send]);

  const clearHistory = useCallback(async () => {
    if (!confirm("Clear all Jarvis chat history?")) return;
    await fetch("/api/jarvis/messages", { method: "DELETE" });
    setMessages([]);
  }, []);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 group flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 px-4 py-3 hover:scale-105 transition-transform"
        aria-label="Open Jarvis chat"
      >
        <Sparkles className="w-5 h-5" />
        <span className="font-medium hidden sm:inline">Jarvis</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed z-50 flex flex-col rounded-xl border border-border bg-background/95 backdrop-blur shadow-2xl shadow-primary/10",
        expanded
          ? "inset-4 sm:inset-10"
          : "bottom-4 right-4 left-4 sm:left-auto sm:right-5 sm:bottom-5 w-auto sm:w-[420px] h-[70vh] sm:h-[600px] max-h-[calc(100vh-2rem)]",
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="font-semibold text-sm">Jarvis</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              full site control
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearHistory} title="Clear history">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? "Shrink" : "Expand"}
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} title="Close">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 px-3 py-3" viewportRef={scrollRef as never}>
        <div className="space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-8 space-y-2">
              <Bot className="w-10 h-10 mx-auto text-primary/60" />
              <div className="font-medium text-foreground">Hi, I'm Jarvis.</div>
              <div className="text-xs px-4">
                Talk to me — by typing or by voice. I'll answer myself for chat. Ask me to "start a run on X" if you want to wake the full brain.
              </div>
              <div className="flex flex-wrap gap-1 justify-center pt-2 px-2">
                {[
                  "How are you, Jarvis?",
                  "Explain how my brain regions work",
                  "What runs have I done?",
                  "Start a run on the future of AI",
                ].map((s) => (
                  <Badge
                    key={s}
                    variant="outline"
                    className="cursor-pointer hover:bg-primary/10"
                    onClick={() => setDraft(s)}
                  >
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}
          {(pendingTools.length > 0 || streamingText || busy) && (
            <div className="flex gap-2 justify-start">
              <div className="w-7 h-7 shrink-0 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mt-1">
                <Bot className="w-4 h-4 text-primary animate-pulse" />
              </div>
              <div className="max-w-[85%] space-y-1.5">
                {pendingTools.map((c, i) => (
                  <ToolCallRow key={i} call={c} status={c.ok === undefined ? "pending" : "done"} />
                ))}
                {streamingText && (
                  <div className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap bg-muted text-foreground border border-border/60">
                    {streamingText}
                  </div>
                )}
                {busy && pendingTools.length === 0 && !streamingText && (
                  <div className="rounded-lg px-3 py-2 text-sm bg-muted text-muted-foreground border border-border/60">
                    Thinking...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-2.5">
        {(voice.listening || (wakeEnabled && wake.supported)) && (
          <div className="mb-1.5 flex items-center gap-2 text-xs px-1">
            {voice.listening ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span className="truncate text-primary">{voice.transcript || "Listening..."}</span>
              </>
            ) : wake.mode === "command" ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                <span className="truncate text-green-500">
                  {wake.heardCommand || "Yes, sir? Go on..."}
                </span>
              </>
            ) : (
              <>
                <span className={cn(
                  "h-2 w-2 rounded-full",
                  speaking ? "bg-yellow-500 animate-pulse" : busy ? "bg-yellow-500/50" : wake.listening ? "bg-green-500/70" : "bg-muted-foreground/40",
                )} />
                <span className="truncate text-muted-foreground">
                  {speaking
                    ? "Speaking…"
                    : busy
                      ? "Thinking…"
                      : wake.listening
                        ? "Say \"Hey Jarvis\""
                        : "Wake word paused"}
                </span>
              </>
            )}
          </div>
        )}
        <div className="flex gap-1.5 items-end">
          {voice.supported && (
            <Button
              type="button"
              size="icon"
              variant={voice.listening ? "default" : "outline"}
              className={cn("shrink-0", voice.listening && "animate-pulse")}
              onClick={() => (voice.listening ? voice.stop() : voice.start())}
              disabled={busy}
              title={voice.listening ? "Stop listening" : "Talk to Jarvis (push to talk)"}
            >
              {voice.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
          )}
          {wake.supported && (
            <Button
              type="button"
              size="icon"
              variant={wakeEnabled ? "default" : "outline"}
              className="shrink-0"
              onClick={() => setWakeEnabled((v) => !v)}
              title={wakeEnabled ? "\"Hey Jarvis\" wake word on" : "Enable hands-free \"Hey Jarvis\""}
            >
              {wakeEnabled ? <Ear className="w-4 h-4" /> : <EarOff className="w-4 h-4" />}
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant={voiceReply ? "default" : "outline"}
            className="shrink-0"
            onClick={() => setVoiceReply((v) => !v)}
            title={voiceReply ? "Voice replies on" : "Voice replies off"}
          >
            {voiceReply ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </Button>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={voice.listening ? "Listening..." : "Talk to Jarvis..."}
            rows={1}
            className="min-h-9 max-h-32 resize-none text-sm"
            disabled={busy}
          />
          <Button onClick={() => void send()} disabled={busy || !draft.trim()} size="icon" className="shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
