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
  targetPrice: real("target_price"),
  bullCase: text("bull_case").notNull().default(""),
  bearCase: text("bear_case").notNull().default(""),
  keyDrivers: jsonb("key_drivers").notNull().default([]),
  nextCatalysts: jsonb("next_catalysts").notNull().default([]),
  earnings: jsonb("earnings"),
  model: text("model").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// User-marked trades. When the user clicks "I took this trade" on a prediction
// card we record an entry so we can track live P/L against the latest quote
// even after the prediction itself ages out.
export const marketUserTradesTable = pgTable("market_user_trades", {
  id: text("id").primaryKey(),
  watchId: text("watch_id").notNull(),
  predictionId: text("prediction_id"),               // optional — manual trades have no prediction
  symbol: text("symbol").notNull(),
  action: text("action").notNull(),                  // BUY_CALL | BUY_PUT
  entryPrice: real("entry_price").notNull(),
  targetPrice: real("target_price"),
  horizon: text("horizon").notNull().default("1w"),
  strikeHint: text("strike_hint").notNull().default(""),
  expiryHint: text("expiry_hint").notNull().default(""),
  quantity: real("quantity").notNull().default(1),    // contracts (informational)
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("OPEN"),  // OPEN | CLOSED
  closePrice: real("close_price"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MarketWatchRow = typeof marketWatchesTable.$inferSelect;
export type MarketPredictionRow = typeof marketPredictionsTable.$inferSelect;
export type MarketUserTradeRow = typeof marketUserTradesTable.$inferSelect;
