import { Router, type IRouter } from "express";
import {
  WEBHOOK_EVENTS,
  createWebhook,
  deleteWebhook,
  listWebhooks,
  setWebhookEnabled,
  testWebhook,
} from "../lib/webhooks";

const router: IRouter = Router();

function serialize(row: any) {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    enabled: row.enabled,
    hasSecret: Boolean(row.secret),
    createdAt: row.createdAt.toISOString(),
    lastFiredAt: row.lastFiredAt ? row.lastFiredAt.toISOString() : null,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
  };
}

router.get("/webhooks", async (_req, res) => {
  const rows = await listWebhooks();
  res.json({ events: WEBHOOK_EVENTS, webhooks: rows.map(serialize) });
});

router.post("/webhooks", async (req, res) => {
  try {
    const row = await createWebhook(req.body ?? {});
    res.status(201).json(serialize(row));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete("/webhooks/:id", async (req, res) => {
  await deleteWebhook(req.params.id);
  res.status(204).end();
});

router.patch("/webhooks/:id", async (req, res) => {
  if (typeof req.body?.enabled === "boolean") {
    await setWebhookEnabled(req.params.id, req.body.enabled);
  }
  res.status(204).end();
});

router.post("/webhooks/:id/test", async (req, res) => {
  const r = await testWebhook(req.params.id);
  res.status(r.ok ? 200 : 400).json(r);
});

export default router;
