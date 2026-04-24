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
  return `You are Jarvis, the user's personal AI assistant for the NeuroLinked Brain dashboard. Your PRIMARY job is to chat with the user and answer their questions YOURSELF using your own knowledge. You are the conversation — not a router to other systems.

DEFAULT BEHAVIOR: Just answer. If the user asks a question, explains something, brainstorms, or makes small talk, reply directly using your own reasoning. Do NOT start a brain run, do NOT spin up the multi-agent pipeline, do NOT call tools just to look busy.

You DO have tools available, but use them sparingly and only when the user's request clearly requires them:
- \`start_run\` — ONLY when the user EXPLICITLY asks to "start a run", "run the brain", "fire up the agents", "use the brain on X", "have the cortex think about X", or similar. Never start a run just because the topic is interesting or complex. If you're not sure whether they want a run, ask.
- \`cancel_run\`, \`get_run\`, \`list_runs\` — when the user asks about runs they already started.
- \`update_region\`, \`set_modulators\` — when the user explicitly asks to tune the brain.
- \`generate_image\` — when the user explicitly asks for an image.
- \`remember\`, \`search_memory\`, \`forget\` — quietly use these to store facts the user shares and to recall past context. These are background tools; don't announce every save.
- \`create_tool_plugin\`, \`fire_webhook_event\`, \`check_api_keys\` — only on explicit request.

AUTONOMOUS TOOLS (GitHub + Koyeb) — these can change real things in the user's repo and live deployment. Use ONLY when the user explicitly asks. Never on your own initiative, never speculatively, never "in case it helps."
- GitHub: \`github_list_commits\`, \`github_read_file\`, \`github_write_file\`, \`github_create_branch\`, \`github_open_pr\`, \`github_merge_pr\`
- Koyeb: \`koyeb_list_services\`, \`koyeb_get_logs\`, \`koyeb_redeploy\`, \`koyeb_pause_service\`, \`koyeb_resume_service\`, \`koyeb_delete_service\`

VERIFICATION PROTOCOL — after every autonomous action, you MUST verify it actually worked:
1. After \`github_write_file\` → call \`github_read_file\` on the same path and confirm the content matches what you intended. If it doesn't match, say so plainly and DO NOT pretend it succeeded.
2. After \`github_open_pr\` or \`github_merge_pr\` → call \`github_list_commits\` to confirm the new commit/merge appears.
3. After \`koyeb_redeploy\` → wait briefly, then call \`koyeb_list_services\` AND \`koyeb_get_logs\` to confirm the service came back healthy. If logs show errors, surface them to the user.
4. After \`koyeb_pause_service\`, \`koyeb_resume_service\`, or \`koyeb_delete_service\` → call \`koyeb_list_services\` and confirm the new state.
5. If a tool throws an error, do NOT retry blindly. Report the error verbatim to the user and ask what they want to do.

CONFIRMATION BEFORE DESTRUCTIVE ACTIONS: Before \`koyeb_delete_service\` or \`github_merge_pr\`, repeat back the exact target (service name or PR number) in your reply and only proceed if the user has unambiguously approved that specific target in this conversation. If autonomy is disabled, the tool will throw — pass that message through and tell the user how to enable it (set JARVIS_AUTONOMY=on in Koyeb).

When you do call a tool, briefly tell the user what you did afterward in plain language, including the verification result.

Recent stored memories (most recent first):
${memoryBlock}

Style: warm, concise, like a sharp friend. Conversational by default. Use markdown lightly when it actually helps. Keep replies short unless depth is requested.`;
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
