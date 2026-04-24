import { logger } from "./logger";

export type KeyState = "ready" | "rate_limited" | "invalid" | "unreachable" | "missing";

export interface KeyHealth {
  name: string;
  provider: "groq" | "gemini";
  ok: boolean;
  state: KeyState;
  status?: number;
  error?: string;
  checkedAt: string;
}

function classifyHttp(status: number, errBody?: string): { state: KeyState; ok: boolean } {
  if (status === 200 || (status >= 200 && status < 300)) {
    return { state: "ready", ok: true };
  }
  if (status === 429) return { state: "rate_limited", ok: false };
  if (status === 401 || status === 403) return { state: "invalid", ok: false };
  if (status === 0) return { state: "unreachable", ok: false };
  // Some Gemini quota errors come back as 400 with RESOURCE_EXHAUSTED
  if (status === 400 && errBody && /RESOURCE_EXHAUSTED|quota/i.test(errBody)) {
    return { state: "rate_limited", ok: false };
  }
  return { state: "unreachable", ok: false };
}

let cache: KeyHealth[] = [];
let lastCheck = 0;

function groqKeyEntries(): { name: string; key: string }[] {
  const out: { name: string; key: string }[] = [];
  if (process.env.GROQ_API_KEY) out.push({ name: "GROQ_API_KEY", key: process.env.GROQ_API_KEY });
  for (let i = 2; i <= 20; i++) {
    const v = process.env[`GROQ_API_KEY_${i}`];
    if (v) out.push({ name: `GROQ_API_KEY_${i}`, key: v });
  }
  return out;
}

async function checkGroq(name: string, key: string): Promise<KeyHealth> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    let body: string | undefined;
    if (!res.ok) body = (await res.text().catch(() => "")).slice(0, 300);
    const { state, ok } = classifyHttp(res.status, body);
    return {
      name,
      provider: "groq",
      ok,
      state,
      status: res.status,
      error: ok ? undefined : `HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name,
      provider: "groq",
      ok: false,
      state: "unreachable",
      error: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(t);
  }
}

function geminiKeyEntries(): { name: string; key: string }[] {
  const out: { name: string; key: string }[] = [];
  if (process.env.GEMINI_API_KEY) out.push({ name: "GEMINI_API_KEY", key: process.env.GEMINI_API_KEY });
  for (let i = 2; i <= 20; i++) {
    const v = process.env[`GEMINI_API_KEY_${i}`];
    if (v) out.push({ name: `GEMINI_API_KEY_${i}`, key: v });
  }
  return out;
}

async function checkGeminiDirect(name: string, key: string): Promise<KeyHealth> {
  // Use the REST endpoint with the explicit key so we test THIS key, not the
  // pool. listModels is a free, unmetered endpoint — perfect for liveness.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { signal: ctrl.signal },
    );
    let body: string | undefined;
    if (!res.ok) body = (await res.text().catch(() => "")).slice(0, 400);
    const { state, ok } = classifyHttp(res.status, body);
    return {
      name,
      provider: "gemini",
      ok,
      state,
      status: res.status,
      error: ok ? undefined : `HTTP ${res.status}${body ? `: ${body.slice(0, 140)}` : ""}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name,
      provider: "gemini",
      ok: false,
      state: "unreachable",
      error: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(t);
  }
}

async function checkGeminiReplit(): Promise<KeyHealth> {
  const name = "AI_INTEGRATIONS_GEMINI_API_KEY";
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!apiKey || !baseUrl) {
    return {
      name,
      provider: "gemini",
      ok: false,
      state: "missing",
      error: "Gemini env vars missing",
      checkedAt: new Date().toISOString(),
    };
  }
  try {
    const { ai } = await import("@workspace/integrations-gemini-ai");
    await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
      config: { maxOutputTokens: 8, temperature: 0 },
    });
    // If we got here without throwing, the key is reachable and not rate-limited.
    return {
      name,
      provider: "gemini",
      ok: true,
      state: "ready",
      status: 200,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isLimit = /\b(429|quota|rate.?limit|RESOURCE_EXHAUSTED)\b/i.test(msg);
    const isInvalid = /\b(401|403|API.?key|UNAUTHENTICATED|PERMISSION_DENIED)\b/i.test(msg);
    return {
      name,
      provider: "gemini",
      ok: false,
      state: isLimit ? "rate_limited" : isInvalid ? "invalid" : "unreachable",
      error: msg,
      checkedAt: new Date().toISOString(),
    };
  }
}

export async function checkAllKeys(): Promise<KeyHealth[]> {
  const groqEntries = groqKeyEntries();
  const geminiEntries = geminiKeyEntries();
  const geminiChecks: Promise<KeyHealth>[] =
    geminiEntries.length > 0
      ? geminiEntries.map((e) => checkGeminiDirect(e.name, e.key))
      : [checkGeminiReplit()];
  const results = await Promise.all([
    ...groqEntries.map((e) => checkGroq(e.name, e.key)),
    ...geminiChecks,
  ]);
  cache = results;
  lastCheck = Date.now();
  return results;
}

export function getCachedKeyHealth(): { results: KeyHealth[]; checkedAt: number } {
  return { results: cache, checkedAt: lastCheck };
}

export async function runStartupKeyCheck(): Promise<void> {
  try {
    const groqCount = groqKeyEntries().length;
    const geminiCount = geminiKeyEntries().length;
    logger.info(
      {
        groqKeys: groqCount,
        geminiDirectKeys: geminiCount,
        geminiReplitConfigured: !!process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
      },
      "API key inventory at startup",
    );
    const results = await checkAllKeys();
    const bad = results.filter((r) => !r.ok);
    const ok = results.length - bad.length;
    const okGemini = results.filter((r) => r.provider === "gemini" && r.ok).length;
    const totalGemini = results.filter((r) => r.provider === "gemini").length;
    const okGroq = results.filter((r) => r.provider === "groq" && r.ok).length;
    const totalGroq = results.filter((r) => r.provider === "groq").length;
    logger.info(
      { ok, bad: bad.length, total: results.length, gemini: `${okGemini}/${totalGemini}`, groq: `${okGroq}/${totalGroq}` },
      "API key health check complete",
    );
    for (const b of bad) {
      logger.warn({ name: b.name, provider: b.provider, error: b.error, status: b.status }, "API key unhealthy");
    }
  } catch (err) {
    logger.warn({ err }, "Key health check failed");
  }
}
