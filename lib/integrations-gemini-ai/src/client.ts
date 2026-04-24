import { GoogleGenAI } from "@google/genai";

const replitBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const replitApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

function loadDirectKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 20; i++) {
    const v = process.env[`GEMINI_API_KEY_${i}`];
    if (v) keys.push(v);
  }
  return keys;
}

const directKeys = loadDirectKeys();

if (directKeys.length === 0 && (!replitBaseUrl || !replitApiKey)) {
  throw new Error(
    "Gemini credentials missing. Set GEMINI_API_KEY (and optionally GEMINI_API_KEY_2..GEMINI_API_KEY_10) for direct Google AI keys, or both AI_INTEGRATIONS_GEMINI_BASE_URL and AI_INTEGRATIONS_GEMINI_API_KEY for Replit AI Integrations.",
  );
}

const pool: GoogleGenAI[] =
  directKeys.length > 0
    ? directKeys.map((apiKey) => new GoogleGenAI({ apiKey }))
    : [
        new GoogleGenAI({
          apiKey: replitApiKey!,
          httpOptions: { apiVersion: "", baseUrl: replitBaseUrl! },
        }),
      ];

let cursor = 0;

export function geminiKeyCount(): number {
  return pool.length;
}

export function geminiUsesDirectKeys(): boolean {
  return directKeys.length > 0;
}

export function getAi(): GoogleGenAI {
  const client = pool[cursor % pool.length];
  cursor = (cursor + 1) % pool.length;
  return client;
}

function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|quota|rate.?limit|RESOURCE_EXHAUSTED)\b/i.test(msg);
}

/**
 * Wrap a method on the Gemini client so that if the call fails with a 429 /
 * quota error we transparently rotate to the next API key and retry, up to
 * `pool.length - 1` more times. This means a mid-conversation rate-limit hit
 * just slides over to the next key with the full request body intact (Gemini
 * is stateless — the conversation history is in the request body).
 */
function wrapRetry<F extends (...args: any[]) => Promise<any>>(fn: F, owner: any): F {
  return (async (...args: any[]) => {
    let lastErr: unknown;
    const maxAttempts = Math.max(1, pool.length);
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn.apply(owner, args);
      } catch (err) {
        lastErr = err;
        if (!isRateLimitError(err) || i === maxAttempts - 1) throw err;
        // Rotate to next key by rebinding fn to the next client's same path
        const next = getAi();
        // Re-resolve fn on the next client, walking the same property path we
        // were originally called on — but since the proxy below resolves fresh
        // each call, easiest is to just rethrow if we can't, and let proxy
        // pick a new client for the next caller. For chained methods like
        // `ai.models.generateContent` we need to re-traverse `models` on the
        // new client.
        if ((owner as any)?.__path) {
          let target: any = next;
          for (const seg of (owner as any).__path) target = target?.[seg];
          owner = target;
          fn = target?.[(fn as any).__name]?.bind(target) ?? fn;
        } else {
          // Top-level method on the client
          const name = (fn as any).__name;
          if (name && typeof (next as any)[name] === "function") {
            fn = (next as any)[name].bind(next);
          }
        }
      }
    }
    throw lastErr;
  }) as F;
}

function makeProxy(client: GoogleGenAI, path: string[] = []): GoogleGenAI {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target as object, prop, receiver);
      if (typeof value === "function") {
        const bound = value.bind(target);
        (bound as any).__name = prop;
        (target as any).__path = path;
        return wrapRetry(bound as any, target);
      }
      if (value && typeof value === "object") {
        return makeProxy(value as any, [...path, String(prop)]);
      }
      return value;
    },
  }) as GoogleGenAI;
}

export const ai: GoogleGenAI = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    const client = getAi();
    return (makeProxy(client) as any)[prop];
  },
}) as GoogleGenAI;
