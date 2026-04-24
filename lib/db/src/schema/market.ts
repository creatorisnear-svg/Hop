import { pgTable, text, real, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const marketWatchesTable = pgTable("market_watches", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  market: text("market").notNull().default("stock"),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketPredictionsTable = pgTable("market_predictions", {
  id: text("id").primaryKey(),
  watchId: text("watch_id").notNull(),
  symbol: text("symbol").notNull(),
  horizon: text("horizon").notNull().default("1w"),
  direction: text("direction").notNull(),
  confidence: real("confidence").notNull().default(0),
  summary: text("summary").notNull().default(""),
  reasoning: text("reasoning").notNull().default(""),
  headlines: jsonb("headlines").notNull().default([]),
  quote: jsonb("quote"),
  action: text("action").notNull().default("HOLD"),
  strikeHint: text("strike_hint").notNull().default(""),
  expiryHint: text("expiry_hint").notNull().default(""),
  entryTrigger: text("entry_trigger").notNull().default(""),
  riskNote: text("risk_note").notNull().default(""),
  model: text("model").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MarketWatchRow = typeof marketWatchesTable.$inferSelect;
export type MarketPredictionRow = typeof marketPredictionsTable.$inferSelect;
