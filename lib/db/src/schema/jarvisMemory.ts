import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const jarvisMemoryTable = pgTable(
  "jarvis_memory",
  {
    id: text("id").primaryKey(),
    text: text("text").notNull(),
    tags: text("tags").notNull().default(""), // comma-separated
    source: text("source").notNull().default("jarvis"), // "jarvis" | "user"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jarvis_memory_created_idx").on(t.createdAt)],
);

export type JarvisMemoryRow = typeof jarvisMemoryTable.$inferSelect;
