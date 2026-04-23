import { db, webhooksTable, type WebhookRow } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { logger } from "./logger";

export const WEBHOOK_EVENTS = [
  "run.started",
  "run.succeeded",
  "run.failed",
  "run.cancelled",
  "insight.created",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookCreate {
  url: string;
  events: string[];
  secret?: string;
  enabled?: boolean;
}

export async function listWebhooks(): Promise<WebhookRow[]> {
  return db.select().from(webhooksTable).orderBy(webhooksTable.createdAt);
}

export async function createWebhook(input: WebhookCreate): Promise<WebhookRow> {
  const events = input.events.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!input.url || !/^https?:\/\//i.test(input.url)) throw new Error("url must be http(s)");
  if (events.length === 0) throw new Error("at least one event required");
  const [row] = await db
    .insert(webhooksTable)
    .values({
      url: input.url,
      events,
      secret: input.secret || null,
      enabled: input.enabled !== false,
    })
    .returning();
  return row!;
}

export async function deleteWebhook(id: string): Promise<void> {
  await db.delete(webhooksTable).where(eq(webhooksTable.id, id));
}

export async function setWebhookEnabled(id: string, enabled: boolean): Promise<void> {
  await db.update(webhooksTable).set({ enabled }).where(eq(webhooksTable.id, id));
}

interface FireOpts {
  event: WebhookEvent;
  data: unknown;
}

async function deliver(hook: WebhookRow, payload: { event: string; timestamp: string; data: unknown }) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-brain-event": payload.event,
  };
  if (hook.secret) {
    const sig = createHmac("sha256", hook.secret).update(body).digest("hex");
    headers["x-brain-signature"] = `sha256=${sig}`;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const resp = await fetch(hook.url, { method: "POST", headers, body, signal: ctrl.signal });
    await db
      .update(webhooksTable)
      .set({
        lastFiredAt: new Date(),
        lastStatus: resp.status,
        lastError: resp.ok ? null : `HTTP ${resp.status}`,
      })
      .where(eq(webhooksTable.id, hook.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(webhooksTable)
      .set({ lastFiredAt: new Date(), lastStatus: 0, lastError: message.slice(0, 500) })
      .where(eq(webhooksTable.id, hook.id));
    logger.warn({ url: hook.url, err: message }, "webhook delivery failed");
  } finally {
    clearTimeout(t);
  }
}

/** Fire-and-forget — never blocks the caller. */
export function fireWebhookEvent(opts: FireOpts): void {
  const payload = { event: opts.event, timestamp: new Date().toISOString(), data: opts.data };
  void (async () => {
    try {
      const hooks = await listWebhooks();
      const matches = hooks.filter((h) => h.enabled && h.events.includes(opts.event));
      await Promise.all(matches.map((h) => deliver(h, payload)));
    } catch (err) {
      logger.warn({ err }, "fireWebhookEvent failed");
    }
  })();
}

export async function testWebhook(id: string): Promise<{ ok: boolean; error?: string }> {
  const [hook] = await db.select().from(webhooksTable).where(eq(webhooksTable.id, id));
  if (!hook) return { ok: false, error: "not found" };
  try {
    await deliver(hook, {
      event: "test",
      timestamp: new Date().toISOString(),
      data: { message: "Hello from NeuroLinked Brain" },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
