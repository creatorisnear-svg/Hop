import { pgTable, text, varchar, timestamp, boolean, jsonb, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const webhooksTable = pgTable("brain_webhooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  url: text("url").notNull(),
  events: jsonb("events").$type<string[]>().notNull().default([]),
  secret: text("secret"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
});

export type WebhookRow = typeof webhooksTable.$inferSelect;
