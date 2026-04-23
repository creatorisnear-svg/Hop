import { db, modulatorsTable, type ModulatorRow } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface Modulators {
  focus: number;
  energy: number;
  calm: number;
  curiosity: number;
}

const DEFAULTS: Modulators = { focus: 0.5, energy: 0.5, calm: 0.5, curiosity: 0.5 };
const ID = "global";

function clamp01(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0.5;
  return Math.max(0, Math.min(1, v));
}

export async function getModulators(): Promise<Modulators> {
  const [row] = await db.select().from(modulatorsTable).where(eq(modulatorsTable.id, ID));
  if (!row) return { ...DEFAULTS };
  return {
    focus: clamp01(row.focus),
    energy: clamp01(row.energy),
    calm: clamp01(row.calm),
    curiosity: clamp01(row.curiosity),
  };
}

export async function setModulators(patch: Partial<Modulators>): Promise<Modulators> {
  const cur = await getModulators();
  const next: Modulators = {
    focus: patch.focus !== undefined ? clamp01(patch.focus) : cur.focus,
    energy: patch.energy !== undefined ? clamp01(patch.energy) : cur.energy,
    calm: patch.calm !== undefined ? clamp01(patch.calm) : cur.calm,
    curiosity: patch.curiosity !== undefined ? clamp01(patch.curiosity) : cur.curiosity,
  };
  await db
    .insert(modulatorsTable)
    .values({ id: ID, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: modulatorsTable.id,
      set: { ...next, updatedAt: new Date() },
    });
  return next;
}

/**
 * Map base region temperature through the current neuromodulator state.
 * - focus pulls temperature down (more deterministic)
 * - curiosity pushes it up (more exploratory)
 * - calm slightly damps it
 * - energy slightly amplifies whatever direction the others pushed
 */
export function effectiveTemperature(base: number, m: Modulators): number {
  const focusPenalty = (m.focus - 0.5) * 0.6; // -0.3..+0.3
  const curiosityBoost = (m.curiosity - 0.5) * 0.7; // -0.35..+0.35
  const calmDamp = (m.calm - 0.5) * 0.2; // -0.1..+0.1
  const energyMul = 1 + (m.energy - 0.5) * 0.4; // 0.8..1.2

  const adjusted = (base - focusPenalty + curiosityBoost - calmDamp) * energyMul;
  return Math.max(0, Math.min(2, adjusted));
}

/** Suggested cap on planned step count, biased by energy. */
export function effectiveMaxSteps(baseMax: number, m: Modulators): number {
  const energyShift = Math.round((m.energy - 0.5) * 6); // -3..+3
  return Math.max(2, Math.min(20, baseMax + energyShift));
}

export function modulatorHintLine(m: Modulators): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    `Current neuromodulator state — focus ${pct(m.focus)}, energy ${pct(m.energy)}, ` +
    `calm ${pct(m.calm)}, curiosity ${pct(m.curiosity)}. ` +
    `High focus → fewer, sharper steps. High curiosity → favor exploratory tools (search_memory, fetch_url) and longer plans. ` +
    `High energy → tolerate more steps. High calm → avoid risky tool calls.`
  );
}
