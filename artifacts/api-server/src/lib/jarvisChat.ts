import { randomUUID } from "node:crypto";
import { ai } from "@workspace/integrations-gemini-ai";
import { db, chatMessagesTable, type ChatMessageRow } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import { listJarvisTools, getJarvisTool } from "./jarvisTools";
import { getRecentMemorySummary } from "./jarvisMemory";

const MODEL = "gemini-2.5-flash";
const MAX_TOOL_HOPS = 8;
const MAX_HISTORY = 30;

export interface ChatToolCall {
  name: string;
  args: unknown;
  result?: unknown;
  ok?: boolean;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ChatToolCall[];
  createdAt: string;
}

function rowOut(r: ChatMessageRow): ChatMessage {
  return {
    id: r.id,
    role: r.role as ChatMessage["role"],
    content: r.content,
    toolCalls: r.toolCalls ?? undefined,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listChatMessages(limit = 100): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.reverse().map(rowOut);
}

export async function clearChatMessages(): Promise<void> {
  await db.delete(chatMessagesTable);
}

async function saveMessage(role: ChatMessage["role"], content: string, toolCalls?: ChatToolCall[]) {
  const id = randomUUID();
  const [row] = await db
    .insert(chatMessagesTable)
    .values({ id, role, content, toolCalls: toolCalls ?? null })
    .returning();
  return rowOut(row);
}

async function buildSystemInstruction(): Promise<string> {
  const memoryBlock = await getRecentMemorySummary(8);
  return `You are Jarvis, the user's personal AI assistant for the NeuroLinked Brain dashboard.

You have FULL CONTROL of the site. The user has authorized you to:
- start, cancel, inspect, and adjust brain runs at any time
- change region configurations (model, prompt, temperature, enabled)
- change neuromodulator levels
- generate images
- store and recall long-term memories about the user, their projects, and your own decisions
- create new brain tools at runtime by writing plugin code
- fire webhook events
- check API key health

Be proactive. When the user asks for something, just do it — call the tools you need without asking for permission. After you act, briefly tell the user what you did. If a request is ambiguous in a meaningful way, ask one clarifying question, then act.

When the user mentions a fact, preference, project, or context worth retaining, call the \`remember\` tool. When you reference past context, prefer searching memory first.

Recent stored memories (most recent first):
${memoryBlock}

Style: concise, friendly, technical when needed. Format with markdown when it helps.`;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { content: unknown } };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

async function loadHistoryAsContents(): Promise<GeminiContent[]> {
  const rows = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(MAX_HISTORY);
  const ordered = rows.reverse();
  const out: GeminiContent[] = [];
  for (const r of ordered) {
    if (r.role === "user") {
      out.push({ role: "user", parts: [{ text: r.content }] });
    } else if (r.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (r.content) parts.push({ text: r.content });
      // We do NOT replay function calls in history — too noisy and may not match current tool schema.
      if (parts.length > 0) out.push({ role: "model", parts });
    }
  }
  return out;
}

function buildToolDeclarations() {
  return [
    {
      functionDeclarations: listJarvisTools().map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters as never,
      })),
    },
  ];
}

export type ChatStreamEvent =
  | { type: "user_saved"; message: ChatMessage }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; ok: boolean; result?: unknown; error?: string }
  | { type: "assistant_text"; text: string }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; error: string };

export async function* runChatTurn(userText: string): AsyncGenerator<ChatStreamEvent> {
  const userMsg = await saveMessage("user", userText);
  yield { type: "user_saved", message: userMsg };

  const systemInstruction = await buildSystemInstruction();
  const contents = await loadHistoryAsContents();
  const collectedToolCalls: ChatToolCall[] = [];

  try {
    let finalText = "";
    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      const resp = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
          systemInstruction,
          tools: buildToolDeclarations(),
          temperature: 0.6,
          maxOutputTokens: 4096,
        },
      });

      const calls = resp.functionCalls ?? [];
      const textOut = resp.text ?? "";

      if (calls.length === 0) {
        finalText = textOut;
        if (textOut) yield { type: "assistant_text", text: textOut };
        break;
      }

      // Append the model turn (its function-call request) to history
      contents.push({
        role: "model",
        parts: calls.map((c) => ({
          functionCall: { name: c.name as string, args: (c.args as Record<string, unknown>) ?? {} },
        })),
      });

      // Execute each call sequentially and append a function-response part for each
      const responseParts: GeminiPart[] = [];
      for (const call of calls) {
        const name = call.name as string;
        const args = (call.args as Record<string, unknown>) ?? {};
        yield { type: "tool_call", name, args };
        const tool = getJarvisTool(name);
        let resultPayload: unknown;
        let ok = true;
        let err: string | undefined;
        if (!tool) {
          ok = false;
          err = `Unknown tool: ${name}`;
          resultPayload = { error: err };
        } else {
          try {
            const r = await tool.run(args);
            resultPayload = r;
          } catch (e) {
            ok = false;
            err = e instanceof Error ? e.message : String(e);
            resultPayload = { error: err };
          }
        }
        collectedToolCalls.push({ name, args, result: resultPayload, ok, error: err });
        yield { type: "tool_result", name, ok, result: ok ? resultPayload : undefined, error: err };
        responseParts.push({
          functionResponse: { name, response: { content: resultPayload } },
        });
      }
      contents.push({ role: "user", parts: responseParts });
    }

    if (!finalText) finalText = "(done)";
    const saved = await saveMessage("assistant", finalText, collectedToolCalls.length ? collectedToolCalls : undefined);
    yield { type: "done", message: saved };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "jarvis chat turn failed");
    const saved = await saveMessage(
      "assistant",
      `Sorry — something went wrong while I was working on that.\n\nError: ${message}`,
      collectedToolCalls.length ? collectedToolCalls : undefined,
    );
    yield { type: "error", error: message };
    yield { type: "done", message: saved };
  }
}

export async function deleteChatMessage(id: string): Promise<boolean> {
  const res = await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, id)).returning();
  return res.length > 0;
}
