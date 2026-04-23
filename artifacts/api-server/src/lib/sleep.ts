import { db, runsTable, insightsTable, type InsightRow } from "@workspace/db";
import { desc, eq, gt } from "drizzle-orm";
import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";

const MODEL = "gemini-2.5-flash";

const CONSOLIDATE_SYSTEM = `You are the sleep/consolidation phase of a multi-region brain.

You will receive a batch of recent successful runs (the user's goal + the brain's final answer for each). Your job is to extract durable INSIGHTS the brain should remember next time it plans a run.

Reply ONLY with JSON of the shape:
{
  "insights": [
    { "kind": "pattern" | "lesson" | "preference", "content": "<one short imperative sentence>" }
  ]
}

Rules:
- Produce 1 to 5 insights, each under 200 characters.
- Prefer general lessons that apply beyond a single goal.
- "pattern" = a kind of goal that tends to come up; "lesson" = something that worked or failed; "preference" = a user preference inferred from goals or feedback.
- If there is nothing genuinely new worth remembering, return { "insights": [] }.`;

interface SleepStatus {
  lastRunAt: number;
  lastSleepAt: number;
  isSleeping: boolean;
  insightsLastCycle: number;
}

const status: SleepStatus = {
  lastRunAt: 0,
  lastSleepAt: 0,
  isSleeping: false,
  insightsLastCycle: 0,
};

export function noteRunActivity(): void {
  status.lastRunAt = Date.now();
}

export function getSleepStatus(): SleepStatus {
  return { ...status };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object found");
  return JSON.parse(raw.slice(start, end + 1));
}

export async function consolidate(opts: { force?: boolean } = {}): Promise<{
  insightsCreated: number;
  consideredRuns: number;
  skippedReason?: string;
}> {
  if (status.isSleeping) {
    return { insightsCreated: 0, consideredRuns: 0, skippedReason: "already sleeping" };
  }
  status.isSleeping = true;
  try {
    const sinceTs = new Date(status.lastSleepAt || 0);
    const candidateRuns = await db
      .select()
      .from(runsTable)
      .where(opts.force ? eq(runsTable.status, "succeeded") : gt(runsTable.completedAt, sinceTs))
      .orderBy(desc(runsTable.completedAt))
      .limit(15);
    const succeeded = candidateRuns.filter((r) => r.status === "succeeded");
    if (succeeded.length < (opts.force ? 1 : 2)) {
      return {
        insightsCreated: 0,
        consideredRuns: succeeded.length,
        skippedReason: "not enough new succeeded runs",
      };
    }

    const transcript = succeeded
      .map(
        (r, i) =>
          `### Run ${i + 1} (${r.id})\nGoal: ${r.goal}\nFinal answer: ${(r.finalAnswer ?? "(none)").slice(0, 1200)}`,
      )
      .join("\n\n");

    const resp = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: `Recent successful runs:\n\n${transcript}` }] }],
      config: {
        systemInstruction: CONSOLIDATE_SYSTEM,
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        temperature: 0.4,
      },
    });
    const parsed = extractJson(resp.text ?? "") as { insights?: { kind?: string; content?: string }[] };
    const insights = (parsed.insights ?? []).filter(
      (i): i is { kind: string; content: string } =>
        typeof i?.content === "string" && i.content.length > 0,
    );

    if (insights.length > 0) {
      await db.insert(insightsTable).values(
        insights.map((i) => ({
          kind: ["pattern", "lesson", "preference"].includes(i.kind) ? i.kind : "lesson",
          content: i.content.slice(0, 500),
          sourceRunIds: succeeded.map((r) => r.id),
        })),
      );
    }

    status.lastSleepAt = Date.now();
    status.insightsLastCycle = insights.length;
    return { insightsCreated: insights.length, consideredRuns: succeeded.length };
  } catch (err) {
    logger.warn({ err }, "sleep consolidation failed");
    return {
      insightsCreated: 0,
      consideredRuns: 0,
      skippedReason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    status.isSleeping = false;
  }
}

export async function listInsights(limit = 30): Promise<InsightRow[]> {
  return db.select().from(insightsTable).orderBy(desc(insightsTable.createdAt)).limit(limit);
}

export async function recentInsightLines(limit = 3): Promise<string[]> {
  const rows = await listInsights(limit);
  return rows.map((r) => `- [${r.kind}] ${r.content}`);
}

let intervalHandle: NodeJS.Timeout | null = null;

/** Idle scheduler: every 10 min, if no run started in the last 5 min, try to consolidate. */
export function startSleepScheduler(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(async () => {
    const idleMs = Date.now() - status.lastRunAt;
    if (status.lastRunAt === 0 || idleMs < 5 * 60_000) return;
    if (Date.now() - status.lastSleepAt < 30 * 60_000) return; // don't oversleep
    const r = await consolidate();
    if (r.insightsCreated > 0) {
      logger.info({ insights: r.insightsCreated }, "sleep cycle wrote insights");
    }
  }, 10 * 60_000);
}
