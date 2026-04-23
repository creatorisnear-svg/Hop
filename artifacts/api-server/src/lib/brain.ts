import { randomUUID } from "node:crypto";
import { db, regionsTable, runsTable, messagesTable, type RegionRow } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ollamaChat, type OllamaChatMessage } from "./ollama";
import { brainBus } from "./eventBus";
import { logger } from "./logger";
import { jarvisPlan, jarvisSynthesize, type JarvisPlan, type RegionKey } from "./jarvis";

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

async function recordMessage(
  runId: string,
  region: string,
  role: string,
  iteration: number,
  content: string,
  latencyMs: number,
) {
  const id = randomUUID();
  const createdAt = new Date();
  await db.insert(messagesTable).values({
    id,
    runId,
    region,
    role,
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
      region,
      role,
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
    await recordMessage(runId, region.key, region.role, iteration, skip, 0);
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
  await recordMessage(runId, region.key, region.role, iteration, result.content, result.latencyMs);
  return result.content;
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

function formatPlanMessage(plan: JarvisPlan): string {
  const lines = [
    `**Reasoning:** ${plan.reasoning}`,
    "",
    "**Planned sequence:**",
    ...plan.steps.map((s, i) => `${i + 1}. \`${s.region}\` — ${s.instruction}`),
  ];
  return lines.join("\n");
}

export async function runBrain(runId: string, goal: string, maxIterations: number) {
  const checkCancel = () => {
    if (cancelled.has(runId)) {
      cancelled.delete(runId);
      throw new Error("__CANCELLED__");
    }
  };

  try {
    await setRunStatus(runId, { status: "running" });
    const regions = await loadRegions();

    // ----- Jarvis plans the run -----
    checkCancel();
    const planStart = Date.now();
    const plan = await jarvisPlan(goal);
    await recordMessage(
      runId,
      "jarvis",
      "coordinator",
      0,
      formatPlanMessage(plan),
      Date.now() - planStart,
    );

    // Cap to maxIterations as a safety rail (each step counts as one)
    const cappedSteps = plan.steps.slice(0, Math.max(maxIterations, plan.steps.length));

    // ----- Execute the planned sequence -----
    const synthInputs: { region: RegionKey; instruction: string; output: string }[] = [];
    let priorContext = "";
    let stepIndex = 0;
    for (const step of cappedSteps) {
      checkCancel();
      stepIndex += 1;
      const region = regions[step.region];
      if (!region) {
        const msg = `[Jarvis] Region ${step.region} not found in DB — skipping.`;
        await recordMessage(runId, "jarvis", "coordinator", stepIndex, msg, 0);
        continue;
      }
      const prompt =
        `Goal: ${goal}\n\nJarvis instruction for you: ${step.instruction}` +
        (priorContext ? `\n\nWhat earlier regions produced:\n${priorContext}` : "");
      const output = await callRegion(runId, region, stepIndex, prompt);
      synthInputs.push({ region: step.region, instruction: step.instruction, output });
      priorContext +=
        (priorContext ? "\n\n" : "") + `[${step.region}] ${output.slice(0, 1200)}`;
      await db.update(runsTable).set({ iterations: stepIndex }).where(eq(runsTable.id, runId));
    }

    // ----- Jarvis synthesizes the final answer -----
    checkCancel();
    const synthStart = Date.now();
    const finalAnswer = await jarvisSynthesize(goal, synthInputs);
    await recordMessage(
      runId,
      "jarvis",
      "coordinator",
      stepIndex + 1,
      finalAnswer,
      Date.now() - synthStart,
    );

    const completedAt = new Date();
    await setRunStatus(runId, {
      status: "succeeded",
      finalAnswer,
      iterations: stepIndex,
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

export async function ensureRegionsSeeded(
  defaults: {
    key: string;
    role: string;
    name: string;
    description: string;
    systemPrompt: string;
    temperature: number;
  }[],
) {
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
