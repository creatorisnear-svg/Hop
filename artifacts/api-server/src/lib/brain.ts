import { randomUUID } from "node:crypto";
import { db, regionsTable, runsTable, messagesTable, type RegionRow } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { ollamaChat, type OllamaChatMessage } from "./ollama";
import { brainBus } from "./eventBus";
import { logger } from "./logger";

const ROLE_TO_KEY: Record<string, string> = {
  researcher: "sensory_cortex",
  planner: "association_cortex",
  executor: "prefrontal_cortex",
  memory: "hippocampus",
  critic: "cerebellum",
  summarizer: "motor_cortex",
};

const cancelled = new Set<string>();

export function requestCancel(runId: string) {
  cancelled.add(runId);
}

async function loadRegions(): Promise<Record<string, RegionRow>> {
  const rows = await db.select().from(regionsTable);
  const byKey: Record<string, RegionRow> = {};
  for (const r of rows) byKey[r.key] = r;
  return byKey;
}

function regionByRole(regions: Record<string, RegionRow>, role: string): RegionRow | null {
  const key = ROLE_TO_KEY[role];
  if (!key) return null;
  return regions[key] ?? null;
}

async function recordMessage(
  runId: string,
  region: RegionRow,
  iteration: number,
  content: string,
  latencyMs: number,
) {
  const id = randomUUID();
  const createdAt = new Date();
  await db.insert(messagesTable).values({
    id,
    runId,
    region: region.key,
    role: region.role,
    content,
    iteration,
    latencyMs,
    createdAt,
  });
  brainBus.emitRun(runId, {
    type: "message",
    runId,
    payload: {
      id,
      runId,
      region: region.key,
      role: region.role,
      content,
      iteration,
      latencyMs,
      createdAt: createdAt.toISOString(),
    },
  });
}

async function callRegion(
  runId: string,
  region: RegionRow,
  iteration: number,
  userPrompt: string,
): Promise<string> {
  if (!region.enabled) {
    const skip = `[${region.name} disabled — skipped]`;
    await recordMessage(runId, region, iteration, skip, 0);
    return skip;
  }
  if (!region.ollamaUrl) {
    throw new Error(
      `${region.name} has no Ollama URL configured. Open Regions and paste your Koyeb URL.`,
    );
  }
  const messages: OllamaChatMessage[] = [
    { role: "system", content: region.systemPrompt },
    { role: "user", content: userPrompt },
  ];
  const result = await ollamaChat({
    baseUrl: region.ollamaUrl,
    model: region.model,
    messages,
    temperature: region.temperature,
  });
  await recordMessage(runId, region, iteration, result.content, result.latencyMs);
  return result.content;
}

async function fetchPriorMemory(currentRunId: string, goal: string): Promise<string> {
  const prior = await db
    .select({ goal: runsTable.goal, finalAnswer: runsTable.finalAnswer })
    .from(runsTable)
    .where(sql`${runsTable.status} = 'succeeded' AND ${runsTable.id} <> ${currentRunId}`)
    .orderBy(desc(runsTable.completedAt))
    .limit(5);
  if (prior.length === 0) return "No prior memories available.";
  return prior
    .map((p, i) => `Memory ${i + 1}:\nGoal: ${p.goal}\nOutcome: ${(p.finalAnswer ?? "").slice(0, 400)}`)
    .join("\n\n");
}

async function setRunStatus(
  runId: string,
  patch: Partial<{
    status: string;
    iterations: number;
    finalAnswer: string;
    error: string;
    completedAt: Date | null;
  }>,
) {
  await db.update(runsTable).set(patch).where(eq(runsTable.id, runId));
  brainBus.emitRun(runId, { type: "status", runId, payload: patch });
}

export async function runBrain(runId: string, goal: string, maxIterations: number) {
  try {
    await setRunStatus(runId, { status: "running" });
    const regions = await loadRegions();

    const sensory = regionByRole(regions, "researcher")!;
    const association = regionByRole(regions, "planner")!;
    const hippocampus = regionByRole(regions, "memory")!;
    const prefrontal = regionByRole(regions, "executor")!;
    const cerebellum = regionByRole(regions, "critic")!;
    const motor = regionByRole(regions, "summarizer")!;

    const checkCancel = () => {
      if (cancelled.has(runId)) {
        cancelled.delete(runId);
        throw new Error("__CANCELLED__");
      }
    };

    // 1. Sensory Cortex — observe
    checkCancel();
    const observations = await callRegion(
      runId,
      sensory,
      0,
      `Goal: ${goal}\n\nProvide your observations.`,
    );

    // 2. Association Cortex — plan
    checkCancel();
    const plan = await callRegion(
      runId,
      association,
      0,
      `Goal: ${goal}\n\nObservations:\n${observations}\n\nProduce the plan.`,
    );

    // 3. Hippocampus — recall
    checkCancel();
    const memoryDump = await fetchPriorMemory(runId, goal);
    const memory = await callRegion(
      runId,
      hippocampus,
      0,
      `Goal: ${goal}\n\nPlan:\n${plan}\n\nPrior runs:\n${memoryDump}`,
    );

    // 4. Loop: Prefrontal -> Cerebellum until APPROVED or max iterations
    let lastOutput = "";
    let lastCritique = "";
    let approved = false;
    let iter = 1;
    for (; iter <= maxIterations; iter++) {
      checkCancel();
      const execPrompt =
        `Goal: ${goal}\n\nPlan:\n${plan}\n\nRelevant memory:\n${memory}` +
        (lastCritique
          ? `\n\nPrior attempt was REJECTED with this critique. Address every point:\n${lastCritique}\n\nPrior attempt:\n${lastOutput}`
          : "");
      lastOutput = await callRegion(runId, prefrontal, iter, execPrompt);

      checkCancel();
      const critique = await callRegion(
        runId,
        cerebellum,
        iter,
        `Goal: ${goal}\n\nExecutor output:\n${lastOutput}`,
      );
      lastCritique = critique;
      await db.update(runsTable).set({ iterations: iter }).where(eq(runsTable.id, runId));

      if (/^\s*VERDICT:\s*APPROVED/im.test(critique)) {
        approved = true;
        break;
      }
    }

    // 5. Motor Cortex — final
    checkCancel();
    const finalAnswer = await callRegion(
      runId,
      motor,
      iter,
      `Goal: ${goal}\n\nApproved output:\n${lastOutput}` +
        (approved ? "" : "\n\nNote: Max iterations reached without explicit approval. Deliver the best available answer."),
    );

    const completedAt = new Date();
    await setRunStatus(runId, {
      status: "succeeded",
      finalAnswer,
      iterations: Math.min(iter, maxIterations),
      completedAt,
    });
    brainBus.emitRun(runId, { type: "done", runId, payload: { finalAnswer } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "__CANCELLED__") {
      await setRunStatus(runId, { status: "cancelled", completedAt: new Date() });
      brainBus.emitRun(runId, { type: "done", runId, payload: { cancelled: true } });
      return;
    }
    logger.error({ err, runId }, "brain run failed");
    await setRunStatus(runId, { status: "failed", error: message, completedAt: new Date() });
    brainBus.emitRun(runId, { type: "error", runId, payload: { error: message } });
  }
}

export async function ensureRegionsSeeded(defaults: { key: string; role: string; name: string; description: string; systemPrompt: string; temperature: number }[]) {
  const existing = await db.select({ key: regionsTable.key }).from(regionsTable);
  const have = new Set(existing.map((r) => r.key));
  const toInsert = defaults.filter((d) => !have.has(d.key));
  if (toInsert.length === 0) return;
  await db.insert(regionsTable).values(
    toInsert.map((d) => ({
      key: d.key,
      role: d.role,
      name: d.name,
      description: d.description,
      systemPrompt: d.systemPrompt,
      temperature: d.temperature,
      ollamaUrl: "",
      model: "qwen2.5:1.5b-instruct",
      enabled: true,
    })),
  );
}
