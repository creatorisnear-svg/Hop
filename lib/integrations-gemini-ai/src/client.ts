import { GoogleGenAI } from "@google/genai";

const replitBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const replitApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const directApiKey = process.env.GEMINI_API_KEY;

if (!directApiKey && (!replitBaseUrl || !replitApiKey)) {
  throw new Error(
    "Gemini credentials missing. Set GEMINI_API_KEY (direct Google AI key) or both AI_INTEGRATIONS_GEMINI_BASE_URL and AI_INTEGRATIONS_GEMINI_API_KEY (Replit AI Integrations).",
  );
}

export const ai = directApiKey
  ? new GoogleGenAI({ apiKey: directApiKey })
  : new GoogleGenAI({
      apiKey: replitApiKey!,
      httpOptions: {
        apiVersion: "",
        baseUrl: replitBaseUrl!,
      },
    });
