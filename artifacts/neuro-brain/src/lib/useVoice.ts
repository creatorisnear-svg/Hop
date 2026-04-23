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

export function speak(text: string, opts: { rate?: number; pitch?: number } = {}): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const stripped = text
    .replace(/```[\s\S]*?```/g, " (code block) ")
    .replace(/[#*_>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return;
  const u = new SpeechSynthesisUtterance(stripped.slice(0, 1500));
  u.rate = opts.rate ?? 1.05;
  u.pitch = opts.pitch ?? 1;
  // Try to pick a male/neutral English voice for "Jarvis" feel
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => /en[-_]?(GB|US)/i.test(v.lang) && /(male|daniel|google.*uk|alex)/i.test(v.name)) ??
    voices.find((v) => /en/i.test(v.lang));
  if (preferred) u.voice = preferred;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
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
