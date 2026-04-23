import { GoogleGenAI, Modality } from "@google/genai";

const _replitBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const _replitApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const _directApiKey = process.env.GEMINI_API_KEY;

if (!_directApiKey && (!_replitBaseUrl || !_replitApiKey)) {
  throw new Error(
    "Gemini credentials missing. Set GEMINI_API_KEY or both AI_INTEGRATIONS_GEMINI_BASE_URL and AI_INTEGRATIONS_GEMINI_API_KEY.",
  );
}

export const ai = _directApiKey
  ? new GoogleGenAI({ apiKey: _directApiKey })
  : new GoogleGenAI({
      apiKey: _replitApiKey!,
      httpOptions: {
        apiVersion: "",
        baseUrl: _replitBaseUrl!,
      },
    });

export async function generateImage(
  prompt: string
): Promise<{ b64_json: string; mimeType: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData
  );

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image data in response");
  }

  return {
    b64_json: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}
