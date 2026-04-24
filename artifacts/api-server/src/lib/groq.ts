import { logger } from "./logger";

export interface GroqChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqChatOptions {
  model: string;
  messages: GroqChatMessage[];
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface GroqChatResult {
  content: string;
  latencyMs: number;
  keyIndex: number;
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

function loadKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY);
  for (let i = 2; i <= 20; i++) {
    const v = process.env[`GROQ_API_KEY_${i}`];
    if (v) keys.push(v);
  }
  return keys;
}

const KEYS = loadKeys();
const COOLDOWN_MS = 60_000;
const cooldownUntil: number[] = KEYS.map(() => 0);
let cursor = 0;

function nextKey(): { key: string; index: number } {
  if (KEYS.length === 0) {
    throw new Error(
      "No Groq API keys configured. Set GROQ_API_KEY (and optionally GROQ_API_KEY_2..GROQ_API_KEY_20) in Secrets.",
    );
  }
  const now = Date.now();
  // Prefer the next key not in cooldown, scanning round-robin from cursor.
  // This is the fix for "I added new keys but predictions still say
  // rate-limited": once a key trips its quota we pin a 60s cooldown on it
  // and skip it for subsequent calls instead of cycling back into the dead
  // key on every request.
  for (let i = 0; i < KEYS.length; i++) {
    const idx = (cursor + i) % KEYS.length;
    if (cooldownUntil[idx] <= now) {
      cursor = (idx + 1) % KEYS.length;
      return { key: KEYS[idx], index: idx };
    }
  }
  // All keys in cooldown — pick the one whose cooldown expires soonest so
  // we at least try something instead of hard-failing.
  let bestIdx = 0;
  let bestT = cooldownUntil[0];
  for (let i = 1; i < KEYS.length; i++) {
    if (cooldownUntil[i] < bestT) {
      bestT = cooldownUntil[i];
      bestIdx = i;
    }
  }
  cursor = (bestIdx + 1) % KEYS.length;
  return { key: KEYS[bestIdx], index: bestIdx };
}

export function groqKeyCount(): number {
  return KEYS.length;
}

export function groqPoolStatus(): { index: number; cooldownMs: number }[] {
  const now = Date.now();
  return cooldownUntil.map((t, i) => ({ index: i, cooldownMs: Math.max(0, t - now) }));
}

export async function groqChat(opts: GroqChatOptions): Promise<GroqChatResult> {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxRetries = opts.maxRetries ?? Math.max(1, KEYS.length);

  let lastErr: unknown;
  let usedIndex = -1;

  for (let attempt = 0; attempt < Math.max(1, maxRetries); attempt++) {
    const { key, index } = nextKey();
    usedIndex = index;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0.7,
          stream: false,
        }),
      });

      if (res.status === 429 || res.status === 503) {
        const text = await res.text().catch(() => "");
        lastErr = new Error(`Groq HTTP ${res.status} on key #${index + 1}: ${text.slice(0, 200)}`);
        cooldownUntil[index] = Date.now() + COOLDOWN_MS;
        logger.warn(
          { status: res.status, keyIndex: index, attempt, cooldownSec: COOLDOWN_MS / 1000 },
          "groq rate-limited; cooling down key and rotating",
        );
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Groq HTTP ${res.status}: ${text.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      return { content: content.trim(), latencyMs: Date.now() - start, keyIndex: index };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("aborted")) {
        logger.warn({ keyIndex: usedIndex, attempt }, "groq request aborted (timeout)");
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Groq request failed");
}

export const GROQ_MODELS: { id: string; label: string }[] = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Versatile)" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (Instant)" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
  { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2 Instruct" },
  { id: "qwen/qwen3-32b", label: "Qwen3 32B" },
];
