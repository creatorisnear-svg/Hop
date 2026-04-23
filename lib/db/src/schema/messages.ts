import { pgTable, text, integer, real, timestamp, index } from "drizzle-orm/pg-core";

export const messagesTable = pgTable(
  "brain_messages",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    region: text("region").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    iteration: integer("iteration").notNull().default(0),
    latencyMs: real("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_run_idx").on(t.runId, t.createdAt)],
);

export type MessageRow = typeof messagesTable.$inferSelect;
