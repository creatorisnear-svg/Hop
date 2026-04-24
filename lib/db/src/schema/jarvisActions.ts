import { pgTable, text, timestamp, jsonb, serial, boolean } from "drizzle-orm/pg-core";

export const jarvisActionsTable = pgTable("jarvis_actions", {
  id: serial("id").primaryKey(),
  tool: text("tool").notNull(),
  params: jsonb("params"),
  result: jsonb("result"),
  ok: boolean("ok").notNull().default(false),
  error: text("error"),
  durationMs: text("duration_ms"),
  autonomyMode: text("autonomy_mode").notNull().default("off"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JarvisActionRow = typeof jarvisActionsTable.$inferSelect;
