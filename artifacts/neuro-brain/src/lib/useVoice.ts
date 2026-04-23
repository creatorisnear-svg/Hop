import { useEffect, useRef, useState } from "react";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSR(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const VOICE_PREF_KEY = "neurolinked.voice.autospeak";

export function getAutoSpeak(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(VOICE_PREF_KEY) === "1";
}

export function setAutoSpeak(on: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(VOICE_PREF_KEY, on ? "1" : "0");
  window.dispatchEvent(new CustomEvent("voice:autospeak", { detail: on }));
}

export function useAutoSpeak(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(getAutoSpeak());
  useEffect(() => {
    const handler = (e: Event) => setOn(Boolean((e as CustomEvent).detail));
    window.addEventListener("voice:autospeak", handler);
    return () => window.removeEventListener("voice:autospeak", handler);
  }, []);
  return [on, (v) => setAutoSpeak(v)];
}

// Pick the best available British male voice — the Jarvis / Iron Man feel.
// Ordered by quality / closeness to that calm, posh-butler timbre.
function pickJarvisVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const isGB = (v: SpeechSynthesisVoice) => /en[-_]?GB/i.test(v.lang);
  const byName = (re: RegExp) => voices.find((v) => isGB(v) && re.test(v.name));

  // 1. Specific high-quality British male voices on common platforms
  const named =
    byName(/daniel/i) ??                                  // macOS / iOS — closest to Jarvis
    byName(/google.*uk.*english.*male/i) ??               // Chrome/Android
    byName(/google.*uk.*male/i) ??
    byName(/microsoft.*(ryan|george|thomas|oliver)/i) ??  // Windows / Edge natural voices
    byName(/(ryan|george|thomas|oliver|arthur)/i);
  if (named) return named;

  // 2. Any British voice that mentions "male"
  const gbMale = voices.find((v) => isGB(v) && /male/i.test(v.name));
  if (gbMale) return gbMale;

  // 3. Any en-GB voice at all (often male by default)
  const anyGB = voices.find(isGB);
  if (anyGB) return anyGB;

  // 4. Last resort: any English voice
  return voices.find((v) => /^en/i.test(v.lang)) ?? null;
}

let voicesReadyPromise: Promise<void> | null = null;
function waitForVoices(): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve();
  if (voicesReadyPromise) return voicesReadyPromise;
  voicesReadyPromise = new Promise<void>((resolve) => {
    const onChange = () => {
      if (window.speechSynthesis.getVoices().length > 0) {
        window.speechSynthesis.removeEventListener("voiceschanged", onChange);
        resolve();
      }
    };
    window.speechSynthesis.addEventListener("voiceschanged", onChange);
    // Safety timeout — some browsers never fire the event
    setTimeout(() => resolve(), 1500);
  });
  return voicesReadyPromise;
}

export function speak(text: string, opts: { rate?: number; pitch?: number; onStart?: () => void; onEnd?: () => void } = {}): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const stripped = text
    .replace(/```[\s\S]*?```/g, " (code block) ")
    .replace(/[#*_>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return;

  const utter = () => {
    const u = new SpeechSynthesisUtterance(stripped.slice(0, 1500));
    // Calm, slightly lower-pitched butler cadence
    u.rate = opts.rate ?? 0.98;
    u.pitch = opts.pitch ?? 0.92;
    const voice = pickJarvisVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = "en-GB";
    }
    if (opts.onStart) u.onstart = () => opts.onStart!();
    if (opts.onEnd) {
      u.onend = () => opts.onEnd!();
      u.onerror = () => opts.onEnd!();
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  if (window.speechSynthesis.getVoices().length === 0) {
    void waitForVoices().then(utter);
  } else {
    utter();
  }
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export interface UseVoiceInput {
  supported: boolean;
  listening: boolean;
  transcript: string;
  start: () => void;
  stop: () => void;
}

export interface UseWakeWord {
  supported: boolean;
  listening: boolean;
  mode: "wake" | "command";
  heardCommand: string;
}

/**
 * Continuously listens for a wake phrase ("hey jarvis", "jarvis", ...).
 * Once heard, captures the words spoken after it and fires onCommand when the
 * user pauses. Auto-restarts the underlying recognition session.
 *
 * Pauses while `paused` is true (e.g. while Jarvis is speaking) so it doesn't
 * trigger itself from speaker echo.
 */
export function useWakeWord(params: {
  enabled: boolean;
  paused?: boolean;
  onCommand: (text: string) => void;
  wakePhrases?: string[];
}): UseWakeWord {
  const { enabled, paused = false, onCommand } = params;
  const wakePhrases = (params.wakePhrases ?? ["hey jarvis", "ok jarvis", "okay jarvis", "jarvis"]).map((p) =>
    p.toLowerCase(),
  );
  const SR = getSR();
  const supported = !!SR;

  const [listening, setListening] = useState(false);
  const [mode, setMode] = useState<"wake" | "command">("wake");
  const [heardCommand, setHeardCommand] = useState("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const commandTimerRef = useRef<number | null>(null);
  const commandTextRef = useRef<string>("");
  const modeRef = useRef<"wake" | "command">("wake");
  const onCommandRef = useRef(onCommand);
  const wantRunningRef = useRef(false);

  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);

  const fireCommand = () => {
    const text = commandTextRef.current.trim();
    commandTextRef.current = "";
    setHeardCommand("");
    modeRef.current = "wake";
    setMode("wake");
    if (text) onCommandRef.current(text);
  };

  const stopRecognition = () => {
    if (restartTimerRef.current != null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (commandTimerRef.current != null) {
      window.clearTimeout(commandTimerRef.current);
      commandTimerRef.current = null;
    }
    const r = recognitionRef.current;
    recognitionRef.current = null;
    if (r) {
      try { r.onresult = null; r.onerror = null; r.onend = null; r.stop(); } catch {}
    }
    setListening(false);
  };

  const startRecognition = () => {
    if (!SR || !wantRunningRef.current) return;
    if (recognitionRef.current) return;
    let r: SpeechRecognitionLike;
    try {
      r = new SR();
    } catch {
      return;
    }
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      // Build the most recent transcript chunk (the latest result group)
      const last = e.results[e.results.length - 1];
      const chunk: string = (last?.[0]?.transcript ?? "").toString();
      const isFinal: boolean = !!last?.isFinal;
      const lower = chunk.toLowerCase();

      if (modeRef.current === "wake") {
        // Look for any wake phrase in the latest chunk
        let wakeIdx = -1;
        let matched = "";
        for (const phrase of wakePhrases) {
          const idx = lower.lastIndexOf(phrase);
          if (idx > wakeIdx) {
            wakeIdx = idx;
            matched = phrase;
          }
        }
        if (wakeIdx >= 0) {
          modeRef.current = "command";
          setMode("command");
          // Capture anything spoken AFTER the wake phrase in the same breath
          const after = chunk.slice(wakeIdx + matched.length).trim();
          commandTextRef.current = after;
          setHeardCommand(after);
          // If the chunk is final and there's already a command, send it
          if (isFinal && after) {
            if (commandTimerRef.current != null) window.clearTimeout(commandTimerRef.current);
            commandTimerRef.current = window.setTimeout(fireCommand, 200);
          } else {
            // Otherwise, give the user a moment to say the command
            if (commandTimerRef.current != null) window.clearTimeout(commandTimerRef.current);
            commandTimerRef.current = window.setTimeout(() => {
              if (modeRef.current === "command") fireCommand();
            }, 5000);
          }
        }
      } else {
        // We're in command mode — accumulate / replace with the latest chunk
        commandTextRef.current = chunk.trim();
        setHeardCommand(commandTextRef.current);
        if (commandTimerRef.current != null) window.clearTimeout(commandTimerRef.current);
        if (isFinal) {
          commandTimerRef.current = window.setTimeout(fireCommand, 250);
        } else {
          commandTimerRef.current = window.setTimeout(fireCommand, 1800);
        }
      }
    };
    r.onerror = () => {
      // Will be auto-restarted by onend
    };
    r.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      if (wantRunningRef.current) {
        // Brief delay before restarting to avoid tight loops
        if (restartTimerRef.current != null) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null;
          startRecognition();
        }, 300);
      }
    };
    try {
      r.start();
      recognitionRef.current = r;
      setListening(true);
    } catch {
      // Probably already started elsewhere — bail
    }
  };

  useEffect(() => {
    wantRunningRef.current = enabled && !paused;
    if (!supported) return;
    if (enabled && !paused) {
      startRecognition();
    } else {
      stopRecognition();
      // Reset state so the next session starts in wake mode
      modeRef.current = "wake";
      setMode("wake");
      commandTextRef.current = "";
      setHeardCommand("");
    }
    return () => {
      wantRunningRef.current = false;
      stopRecognition();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, paused, supported]);

  return { supported, listening, mode, heardCommand };
}

export function useVoiceInput(onFinal: (text: string) => void): UseVoiceInput {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const SR = getSR();
  const supported = !!SR;

  const start = () => {
    if (!SR) return;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    const r = new SR();
    r.lang = "en-US";
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let full = "";
      let isFinal = false;
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        full += res[0]?.transcript ?? "";
        if (res.isFinal) isFinal = true;
      }
      setTranscript(full);
      if (isFinal && full.trim()) onFinal(full.trim());
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recognitionRef.current = r;
    setTranscript("");
    setListening(true);
    r.start();
  };

  const stop = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { supported, listening, transcript, start, stop };
}
