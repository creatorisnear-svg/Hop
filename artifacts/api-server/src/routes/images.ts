import { Router, type IRouter } from "express";
import { generateImage, listImages, getImage, deleteImage } from "../lib/images";

const router: IRouter = Router();

router.get("/images", async (req, res) => {
  const limit = Number(req.query.limit ?? 30);
  const items = await listImages(limit);
  // Strip base64 from list to keep response small; clients use /images/:id/raw
  res.json({
    items: items.map((i) => ({
      id: i.id,
      prompt: i.prompt,
      mimeType: i.mimeType,
      source: i.source,
      createdAt: i.createdAt,
      url: `/api/images/${i.id}/raw`,
    })),
  });
});

router.post("/images", async (req, res) => {
  const body = (req.body ?? {}) as { prompt?: string };
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return res.status(400).json({ error: "prompt required" });
  try {
    const img = await generateImage(prompt, "user");
    res.status(201).json({
      id: img.id,
      prompt: img.prompt,
      mimeType: img.mimeType,
      createdAt: img.createdAt,
      url: `/api/images/${img.id}/raw`,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/images/:id/raw", async (req, res) => {
  const img = await getImage(req.params.id);
  if (!img) return res.status(404).end();
  const buf = Buffer.from(img.dataB64, "base64");
  res.setHeader("Content-Type", img.mimeType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(buf);
});

router.delete("/images/:id", async (req, res) => {
  const ok = await deleteImage(req.params.id);
  res.json({ ok });
});

export default router;
