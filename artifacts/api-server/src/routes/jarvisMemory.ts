import { Router, type IRouter } from "express";
import { addMemory, deleteMemory, listMemory, searchMemory } from "../lib/jarvisMemory";

const router: IRouter = Router();

router.get("/jarvis/memory", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const limit = Number(req.query.limit ?? 100);
  const items = q ? await searchMemory(q, limit) : await listMemory(limit);
  res.json({ items });
});

router.post("/jarvis/memory", async (req, res) => {
  const body = (req.body ?? {}) as { text?: string; tags?: string[]; source?: string };
  const text = (body.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "text required" });
  const item = await addMemory(text, Array.isArray(body.tags) ? body.tags : [], body.source ?? "user");
  res.status(201).json(item);
});

router.delete("/jarvis/memory/:id", async (req, res) => {
  const ok = await deleteMemory(req.params.id);
  res.json({ ok });
});

export default router;
