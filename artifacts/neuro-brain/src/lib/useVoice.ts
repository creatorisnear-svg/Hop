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

export function speak(text: string, opts: { rate?: number; pitch?: number } = {}): void {
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
