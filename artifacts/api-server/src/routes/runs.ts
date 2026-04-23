import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { db, runsTable, messagesTable, type RunRow, type MessageRow } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { CreateRunBody, ListRunsQueryParams, GetRunParams, CancelRunParams } from "@workspace/api-zod";
import { runBrain, requestCancel, injectStep, replaceUpcomingSteps, getPendingAdjustments, isRunActive } from "../lib/brain";
import type { RegionKey } from "../lib/jarvis";
import { brainBus, type BrainEvent } from "../lib/eventBus";

const router: IRouter = Router();

function summarize(r: RunRow) {
  return {
    id: r.id,
    goal: r.goal,
    status: r.status,
    iterations: r.iterations,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : undefined,
    finalAnswer: r.finalAnswer ?? undefined,
    error: r.error ?? undefined,
  };
}

function messageOut(m: MessageRow) {
  return {
    id: m.id,
    runId: m.runId,
    region: m.region,
    role: m.role,
    content: m.content,
    iteration: m.iteration,
    latencyMs: m.latencyMs ?? undefined,
    createdAt: m.createdAt.toISOString(),
  };
}

router.get("/runs", async (req, res) => {
  const { limit } = ListRunsQueryParams.parse(req.query);
  const rows = await db.select().from(runsTable).orderBy(desc(runsTable.createdAt)).limit(limit);
  res.json(rows.map(summarize));
});

router.post("/runs", async (req, res) => {
  const body = CreateRunBody.parse(req.body);
  const id = randomUUID();
  const [row] = await db
    .insert(runsTable)
    .values({
      id,
      goal: body.goal,
      maxIterations: body.maxIterations ?? 6,
      status: "pending",
    })
    .returning();
  // Fire and forget — orchestrator runs in background
  runBrain(id, body.goal, body.maxIterations ?? 6).catch(() => {});
  res.status(201).json(summarize(row));
});

router.get("/runs/:runId", async (req, res) => {
  const { runId } = GetRunParams.parse(req.params);
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
  if (!run) return res.status(404).json({ error: "Run not found" });
  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.runId, runId))
    .orderBy(messagesTable.createdAt);
  res.json({ run: summarize(run), messages: messages.map(messageOut) });
});

router.post("/runs/:runId/cancel", async (req, res) => {
  const { runId } = CancelRunParams.parse(req.params);
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
  if (!run) return res.status(404).json({ error: "Run not found" });
  requestCancel(runId);
  res.json(summarize(run));
});

router.post("/runs/:runId/adjust", async (req, res) => {
  const { runId } = GetRunParams.parse(req.params);
  if (!isRunActive(runId)) return res.status(409).json({ error: "Run is not currently executing" });
  const body = (req.body ?? {}) as {
    inject?: { region: string; instruction: string }[];
    replace?: { region: string; instruction: string }[];
  };
  try {
    if (Array.isArray(body.replace)) {
      replaceUpcomingSteps(
        runId,
        body.replace.map((s) => ({ region: s.region as RegionKey, instruction: s.instruction })),
      );
    }
    if (Array.isArray(body.inject)) {
      for (const s of body.inject) {
        injectStep(runId, { region: s.region as RegionKey, instruction: s.instruction });
      }
    }
    res.json({ ok: true, pending: getPendingAdjustments(runId) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/runs/:runId/adjust", async (req, res) => {
  const { runId } = GetRunParams.parse(req.params);
  res.json({ active: isRunActive(runId), pending: getPendingAdjustments(runId) });
});

router.get("/runs/:runId/stream", async (req, res) => {
  const { runId } = GetRunParams.parse(req.params);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (evt: BrainEvent) => {
    res.write(`event: ${evt.type}\n`);
    res.write(`data: ${JSON.stringify(evt.payload)}\n\n`);
  };

  // Send initial snapshot
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
  if (run) {
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.runId, runId))
      .orderBy(messagesTable.createdAt);
    for (const m of msgs) {
      send({ type: "message", runId, payload: messageOut(m) });
    }
    send({ type: "status", runId, payload: { status: run.status } });
    if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
      send({ type: "done", runId, payload: { status: run.status, finalAnswer: run.finalAnswer ?? undefined } });
      res.end();
      return;
    }
  }

  const handler = (evt: BrainEvent) => {
    send(evt);
    if (evt.type === "done" || evt.type === "error") {
      brainBus.offRun(runId, handler);
      res.end();
    }
  };
  brainBus.onRun(runId, handler);

  // Keepalive
  const ka = setInterval(() => res.write(`: keepalive\n\n`), 25000);

  req.on("close", () => {
    clearInterval(ka);
    brainBus.offRun(runId, handler);
  });
});

export default router;
