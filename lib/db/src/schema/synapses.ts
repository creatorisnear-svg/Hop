import { pgTable, text, integer, real, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const synapsesTable = pgTable(
  "brain_synapses",
  {
    fromRegion: text("from_region").notNull(),
    toRegion: text("to_region").notNull(),
    successCount: integer("success_count").notNull().default(0),
    totalCount: integer("total_count").notNull().default(0),
    strength: real("strength").notNull().default(0.5),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fromRegion, t.toRegion] })],
);

export type SynapseRow = typeof synapsesTable.$inferSelect;
