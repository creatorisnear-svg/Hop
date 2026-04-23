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
let cursor = 0;

function nextKey(): { key: string; index: number } {
  if (KEYS.length === 0) {
    throw new Error(
      "No Groq API keys configured. Set GROQ_API_KEY (and optionally GROQ_API_KEY_2..GROQ_API_KEY_10) in Secrets.",
    );
  }
  const index = cursor % KEYS.length;
  cursor = (cursor + 1) % KEYS.length;
  return { key: KEYS[index], index };
}

export function groqKeyCount(): number {
  return KEYS.length;
}

export async function groqChat(opts: GroqChatOptions): Promise<GroqChatResult> {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxRetries = opts.maxRetries ?? Math.min(KEYS.length, 4);

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
        logger.warn({ status: res.status, keyIndex: index, attempt }, "groq rate-limited; rotating key");
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
