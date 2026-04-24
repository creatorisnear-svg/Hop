import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ELEVEN_API = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5";

function isConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
}

router.get("/api/jarvis/voice-status", (_req, res) => {
  res.json({
    enabled: isConfigured(),
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? null,
    model: DEFAULT_MODEL,
  });
});

router.post("/api/jarvis/speak", async (req, res) => {
  if (!isConfigured()) {
    res.status(503).json({ error: "ElevenLabs not configured" });
    return;
  }
  const text = String((req.body?.text ?? "")).trim();
  if (!text) {
    res.status(400).json({ error: "text required" });
    return;
  }
  // Strip markdown noise to keep the voice clean
  const clean = text
    .replace(/```[\s\S]*?```/g, " (code block) ")
    .replace(/[#*_>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);

  const voiceId = process.env.ELEVENLABS_VOICE_ID!;
  const url = `${ELEVEN_API}/text-to-speech/${encodeURIComponent(voiceId)}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: clean,
        model_id: DEFAULT_MODEL,
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.85,
          style: 0.25,
          use_speaker_boost: true,
        },
      }),
    });
    if (!r.ok || !r.body) {
      const errText = await r.text().catch(() => "");
      logger.warn({ status: r.status, errText }, "ElevenLabs TTS failed");
      res.status(502).json({ error: `ElevenLabs ${r.status}: ${errText.slice(0, 200)}` });
      return;
    }
    res.setHeader("content-type", "audio/mpeg");
    res.setHeader("cache-control", "no-store");
    const reader = r.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    logger.error({ err }, "ElevenLabs TTS exception");
    if (!res.headersSent) {
      res.status(500).json({ error: err instanceof Error ? err.message : "tts failed" });
    } else {
      res.end();
    }
  }
});

export default router;
