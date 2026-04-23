import { pgTable, text, real, timestamp } from "drizzle-orm/pg-core";

export const modulatorsTable = pgTable("brain_modulators", {
  id: text("id").primaryKey(), // "global"
  focus: real("focus").notNull().default(0.5),
  energy: real("energy").notNull().default(0.5),
  calm: real("calm").notNull().default(0.5),
  curiosity: real("curiosity").notNull().default(0.5),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ModulatorRow = typeof modulatorsTable.$inferSelect;
