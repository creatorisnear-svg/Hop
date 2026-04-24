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
    "Gemini credentials missing. Set GEMINI_API_KEY (and optionally GEMINI_API_KEY_2..GEMINI_API_KEY_20) for direct Google AI keys, or both AI_INTEGRATIONS_GEMINI_BASE_URL and AI_INTEGRATIONS_GEMINI_API_KEY for Replit AI Integrations.",
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

const COOLDOWN_MS = 60_000;
const cooldownUntil: number[] = pool.map(() => 0);
let cursor = 0;

export function geminiKeyCount(): number {
  return pool.length;
}

export function geminiUsesDirectKeys(): boolean {
  return directKeys.length > 0;
}

export function geminiPoolStatus(): { index: number; cooldownMs: number }[] {
  const now = Date.now();
  return cooldownUntil.map((t, i) => ({ index: i, cooldownMs: Math.max(0, t - now) }));
}

function pickClient(): { client: GoogleGenAI; index: number } {
  const now = Date.now();
  for (let i = 0; i < pool.length; i++) {
    const idx = (cursor + i) % pool.length;
    if (cooldownUntil[idx] <= now) {
      cursor = (idx + 1) % pool.length;
      return { client: pool[idx], index: idx };
    }
  }
  let bestIdx = 0;
  let bestT = cooldownUntil[0];
  for (let i = 1; i < pool.length; i++) {
    if (cooldownUntil[i] < bestT) {
      bestT = cooldownUntil[i];
      bestIdx = i;
    }
  }
  cursor = (bestIdx + 1) % pool.length;
  return { client: pool[bestIdx], index: bestIdx };
}

export function getAi(): GoogleGenAI {
  return pickClient().client;
}

function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b(429|quota|rate.?limit|RESOURCE_EXHAUSTED|exceeded)\b/i.test(msg)) return true;
  const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
  return status === 429;
}

async function callWithRotation(path: string[], args: unknown[]): Promise<unknown> {
  if (pool.length === 0) throw new Error("Gemini pool is empty");
  let lastErr: unknown;
  const attempts = Math.max(1, pool.length);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { client, index } = pickClient();
    let target: unknown = client;
    for (let i = 0; i < path.length - 1; i++) {
      target = (target as Record<string, unknown>)?.[path[i]];
    }
    const fnName = path[path.length - 1];
    const fn = (target as Record<string, unknown>)?.[fnName];
    if (typeof fn !== "function") {
      throw new Error(`Gemini client method not found: ${path.join(".")}`);
    }
    try {
      return await (fn as (...a: unknown[]) => Promise<unknown>).apply(target, args);
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err)) throw err;
      cooldownUntil[index] = Date.now() + COOLDOWN_MS;
      // eslint-disable-next-line no-console
      console.warn(
        `[gemini] key #${index + 1} rate-limited; cooling down ${COOLDOWN_MS / 1000}s — rotating to next key (attempt ${attempt + 1}/${attempts})`,
      );
    }
  }
  throw lastErr;
}

function makeAccessor(path: string[]): unknown {
  const fn = function () {} as unknown as object;
  return new Proxy(fn, {
    get(_t, prop) {
      if (typeof prop === "symbol") return undefined;
      return makeAccessor([...path, String(prop)]);
    },
    apply(_t, _thisArg, args) {
      return callWithRotation(path, args);
    },
  });
}

export const ai: GoogleGenAI = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    if (typeof prop === "symbol") return undefined;
    return makeAccessor([String(prop)]);
  },
}) as GoogleGenAI;
