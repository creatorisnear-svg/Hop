import { logger } from "./logger";

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatOptions {
  baseUrl: string;
  model: string;
  messages: OllamaChatMessage[];
  temperature?: number;
  timeoutMs?: number;
}

export interface OllamaChatResult {
  content: string;
  latencyMs: number;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function ollamaChat(opts: OllamaChatOptions): Promise<OllamaChatResult> {
  const start = Date.now();
  const url = `${normalizeBaseUrl(opts.baseUrl)}/api/chat`;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: false,
        options: {
          temperature: opts.temperature ?? 0.7,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as { message?: { content?: string }; response?: string };
    const content = data.message?.content ?? data.response ?? "";
    return { content: content.trim(), latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaListModels(baseUrl: string, timeoutMs = 8000): Promise<string[]> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/tags`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch (err) {
    logger.warn({ err, baseUrl }, "ollamaListModels failed");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
