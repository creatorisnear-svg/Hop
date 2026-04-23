import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const runsTable = pgTable("runs", {
  id: text("id").primaryKey(),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("pending"),
  maxIterations: integer("max_iterations").notNull().default(6),
  iterations: integer("iterations").notNull().default(0),
  finalAnswer: text("final_answer"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type RunRow = typeof runsTable.$inferSelect;
