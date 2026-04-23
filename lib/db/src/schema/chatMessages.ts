import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const chatMessagesTable = pgTable(
  "jarvis_chat_messages",
  {
    id: text("id").primaryKey(),
    role: text("role").notNull(), // "user" | "assistant" | "tool"
    content: text("content").notNull().default(""),
    toolCalls: jsonb("tool_calls").$type<{ name: string; args: unknown; result?: unknown; ok?: boolean }[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jarvis_chat_messages_created_idx").on(t.createdAt)],
);

export type ChatMessageRow = typeof chatMessagesTable.$inferSelect;
