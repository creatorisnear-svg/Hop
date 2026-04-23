import { Router, type IRouter } from "express";
import { listChatMessages, clearChatMessages, runChatTurn, deleteChatMessage } from "../lib/jarvisChat";

const router: IRouter = Router();

router.get("/jarvis/messages", async (_req, res) => {
  const limit = Math.min(Math.max(Number((_req.query as { limit?: string }).limit ?? 100), 1), 500);
  const messages = await listChatMessages(limit);
  res.json({ messages });
});

router.delete("/jarvis/messages", async (_req, res) => {
  await clearChatMessages();
  res.json({ ok: true });
});

router.delete("/jarvis/messages/:id", async (req, res) => {
  const ok = await deleteChatMessage(req.params.id);
  res.json({ ok });
});

router.post("/jarvis/chat", async (req, res) => {
  const body = (req.body ?? {}) as { message?: string };
  const text = (body.message ?? "").trim();
  if (!text) return res.status(400).json({ error: "message required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (type: string, payload: unknown) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const ka = setInterval(() => res.write(`: keepalive\n\n`), 25000);
  let closed = false;
  res.on("close", () => {
    closed = true;
    clearInterval(ka);
  });

  try {
    for await (const evt of runChatTurn(text)) {
      if (closed) break;
      send(evt.type, evt);
      if (evt.type === "done") break;
    }
  } catch (err) {
    send("error", { error: err instanceof Error ? err.message : String(err) });
  } finally {
    clearInterval(ka);
    if (!closed) res.end();
  }
});

export default router;
