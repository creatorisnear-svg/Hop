import { pgTable, text, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const insightsTable = pgTable("brain_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: text("kind").notNull(), // "pattern" | "lesson" | "preference"
  content: text("content").notNull(),
  sourceRunIds: jsonb("source_run_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsightRow = typeof insightsTable.$inferSelect;
