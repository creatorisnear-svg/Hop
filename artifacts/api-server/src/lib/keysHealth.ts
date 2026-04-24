import { logger } from "./logger";

export interface KeyHealth {
  name: string;
  provider: "groq" | "gemini";
  ok: boolean;
  status?: number;
  error?: string;
  checkedAt: string;
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
    return {
      name,
      provider: "groq",
      ok: res.ok,
      status: res.status,
      error: res.ok ? undefined : `HTTP ${res.status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name,
      provider: "groq",
      ok: false,
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
    return {
      name,
      provider: "gemini",
      ok: res.ok,
      status: res.status,
      error: res.ok ? undefined : `HTTP ${res.status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name,
      provider: "gemini",
      ok: false,
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
      error: "Gemini env vars missing",
      checkedAt: new Date().toISOString(),
    };
  }
  try {
    const { ai } = await import("@workspace/integrations-gemini-ai");
    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
      config: { maxOutputTokens: 8, temperature: 0 },
    });
    const ok = typeof resp.text === "string" && resp.text.length >= 0;
    return {
      name,
      provider: "gemini",
      ok,
      status: 200,
      error: ok ? undefined : "no response",
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name,
      provider: "gemini",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
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
