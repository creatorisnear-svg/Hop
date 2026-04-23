import { pgTable, text, real, boolean, timestamp } from "drizzle-orm/pg-core";

export const regionsTable = pgTable("regions", {
  key: text("key").primaryKey(),
  role: text("role").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  ollamaUrl: text("ollama_url").notNull().default(""),
  model: text("model").notNull().default("llama-3.3-70b-versatile"),
  systemPrompt: text("system_prompt").notNull(),
  temperature: real("temperature").notNull().default(0.7),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RegionRow = typeof regionsTable.$inferSelect;
