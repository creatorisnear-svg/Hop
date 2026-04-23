import { db, synapsesTable, type SynapseRow } from "@workspace/db";
import { sql, desc } from "drizzle-orm";

const SMOOTH_ALPHA = 1; // Laplace smoothing
const SMOOTH_BETA = 2;

function computeStrength(success: number, total: number): number {
  return (success + SMOOTH_ALPHA) / (total + SMOOTH_BETA);
}

/**
 * Reinforce the consecutive region pairs that fired during a run.
 * `outcome` is 1 for an approved/successful run, 0 for failure, and a
 * fractional value (e.g. 0.5) for runs that succeeded only after multiple
 * iterations.
 */
export async function reinforcePath(
  regionSequence: string[],
  outcome: number,
): Promise<void> {
  if (regionSequence.length < 2) return;
  const success = Math.max(0, Math.min(1, outcome));
  const now = new Date();

  const seen = new Set<string>();
  for (let i = 0; i < regionSequence.length - 1; i++) {
    const from = regionSequence[i];
    const to = regionSequence[i + 1];
    if (from === to) continue;
    const key = `${from}->${to}`;
    if (seen.has(key)) continue;
    seen.add(key);

    await db
      .insert(synapsesTable)
      .values({
        fromRegion: from,
        toRegion: to,
        successCount: success > 0 ? 1 : 0,
        totalCount: 1,
        strength: computeStrength(success > 0 ? 1 : 0, 1),
        lastFiredAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [synapsesTable.fromRegion, synapsesTable.toRegion],
        set: {
          successCount: sql`${synapsesTable.successCount} + ${success}`,
          totalCount: sql`${synapsesTable.totalCount} + 1`,
          strength: sql`(${synapsesTable.successCount} + ${success} + ${SMOOTH_ALPHA}) / (${synapsesTable.totalCount} + 1 + ${SMOOTH_BETA})::float`,
          lastFiredAt: now,
          updatedAt: now,
        },
      });
  }
}

export async function listSynapses(): Promise<SynapseRow[]> {
  return db.select().from(synapsesTable).orderBy(desc(synapsesTable.strength));
}

/** Top-N region pairs by strength (only those with at least `minTotal` firings). */
export async function topPairs(n = 5, minTotal = 2): Promise<SynapseRow[]> {
  const all = await db.select().from(synapsesTable);
  return all
    .filter((s) => s.totalCount >= minTotal)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, n);
}

/** A short human-readable hint Jarvis can include in his planning prompt. */
export async function planningHint(): Promise<string> {
  const top = await topPairs(5, 2);
  const { recentInsightLines } = await import("./sleep");
  const insightLines = await recentInsightLines(3);

  const sections: string[] = [];
  if (top.length > 0) {
    const lines = top.map(
      (s) =>
        `- ${s.fromRegion} → ${s.toRegion} (strength ${(s.strength * 100).toFixed(0)}%, fired ${s.totalCount}x)`,
    );
    sections.push(`Proven region pathways from past runs (prefer these when relevant):\n${lines.join("\n")}`);
  }
  if (insightLines.length > 0) {
    sections.push(`Insights consolidated during sleep:\n${insightLines.join("\n")}`);
  }
  return sections.join("\n\n");
}
