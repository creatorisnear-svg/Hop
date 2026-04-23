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

export const ai: GoogleGenAI = new Proxy({} as GoogleGenAI, {
  get(_target, prop, receiver) {
    const client = getAi();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as GoogleGenAI;
