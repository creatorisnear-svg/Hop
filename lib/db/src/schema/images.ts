import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const generatedImagesTable = pgTable(
  "generated_images",
  {
    id: text("id").primaryKey(),
    prompt: text("prompt").notNull(),
    mimeType: text("mime_type").notNull().default("image/png"),
    dataB64: text("data_b64").notNull(),
    source: text("source").notNull().default("user"), // "user" | "jarvis"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("generated_images_created_idx").on(t.createdAt)],
);

export type GeneratedImageRow = typeof generatedImagesTable.$inferSelect;
