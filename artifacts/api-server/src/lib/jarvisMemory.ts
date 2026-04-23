import { randomUUID } from "node:crypto";
import { db, jarvisMemoryTable, type JarvisMemoryRow } from "@workspace/db";
import { desc, eq, like, or } from "drizzle-orm";

export interface JarvisMemory {
  id: string;
  text: string;
  tags: string[];
  source: string;
  createdAt: string;
}

function rowOut(r: JarvisMemoryRow): JarvisMemory {
  return {
    id: r.id,
    text: r.text,
    tags: r.tags ? r.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    source: r.source,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function addMemory(text: string, tags: string[] = [], source = "jarvis"): Promise<JarvisMemory> {
  const id = randomUUID();
  const [row] = await db
    .insert(jarvisMemoryTable)
    .values({ id, text, tags: tags.join(","), source })
    .returning();
  return rowOut(row);
}

export async function listMemory(limit = 100): Promise<JarvisMemory[]> {
  const rows = await db
    .select()
    .from(jarvisMemoryTable)
    .orderBy(desc(jarvisMemoryTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map(rowOut);
}

export async function searchMemory(query: string, limit = 10): Promise<JarvisMemory[]> {
  const pat = `%${query}%`;
  const rows = await db
    .select()
    .from(jarvisMemoryTable)
    .where(or(like(jarvisMemoryTable.text, pat), like(jarvisMemoryTable.tags, pat)))
    .orderBy(desc(jarvisMemoryTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows.map(rowOut);
}

export async function deleteMemory(id: string): Promise<boolean> {
  const res = await db.delete(jarvisMemoryTable).where(eq(jarvisMemoryTable.id, id)).returning();
  return res.length > 0;
}

export async function getRecentMemorySummary(limit = 8): Promise<string> {
  const recent = await listMemory(limit);
  if (recent.length === 0) return "(no stored memories yet)";
  return recent
    .map((m) => `- [${m.createdAt.slice(0, 10)}] ${m.text}${m.tags.length ? ` (${m.tags.join(", ")})` : ""}`)
    .join("\n");
}
