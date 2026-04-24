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

AUTONOMOUS ACTIONS (GitHub + Koyeb) — split into two tiers:

TIER 1 — Read-only, fast-path (callable directly from chat):
- \`github_list_commits\`, \`github_read_file\`, \`koyeb_list_services\`, \`koyeb_get_logs\`
- Use these when the user just wants information ("what's deployed?", "show me the latest logs", "what's in App.tsx?"). They are audited and kill-switch-gated but skip the full brain run for speed.

TIER 2 — Write/mutating (MUST go through the brain via \`start_run\`):
- \`github_write_file\`, \`github_create_branch\`, \`github_open_pr\`, \`github_merge_pr\`, \`koyeb_redeploy\`, \`koyeb_pause_service\`, \`koyeb_resume_service\`, \`koyeb_delete_service\`
- You do NOT have direct access to these. For ANY write/mutating request, call \`start_run\` with a clear, action-oriented goal. The 6-region pipeline plans it, motor_cortex executes the tool, the other regions verify and synthesize.

How to phrase the goal so the brain plans well:
- Be explicit about the action AND the verification. Example: "Redeploy the Koyeb service named 'neuro-brain-web' and verify it came back healthy by checking koyeb_list_services and tailing koyeb_get_logs for errors."
- Example: "Read the file artifacts/neuro-brain/src/App.tsx from the repo and summarize what routes are registered."
- Example: "On a new branch 'fix-typo-readme', update README.md to fix the typo on line 12 ('teh' → 'the'), open a PR titled 'Fix typo in README', and verify the commit appears via github_list_commits."
- Always include the explicit target (service name, file path, PR number) in the goal — never something vague like "fix the bug".

After calling start_run, briefly tell the user "starting brain run <id> to handle that — you can watch it on the live run page" and stop. Do NOT poll or retry; the user will see the result on the run page.

CONFIRMATION BEFORE DESTRUCTIVE ACTIONS: Before starting a run for \`koyeb_delete_service\` or \`github_merge_pr\`, repeat back the exact target (service name or PR number) in your reply and only proceed if the user has unambiguously approved that specific target in this conversation.

MULTI-ACCOUNT: GitHub and Koyeb each support up to 2 configured accounts. Every autonomy tool accepts an optional \`account\` parameter (1 or 2). Account 1 is the default if not specified. If the user mentions "the second", "the other", "account 2", or names something only account 2 covers, pass \`account: 2\`. For \`koyeb_list_services\` you can also pass \`account: "all"\` to merge both accounts in one call. If a chosen account isn't configured, the tool will throw a clear error — pass that error back to the user.

If autonomy is disabled (JARVIS_AUTONOMY env var off), the brain run will fail the tool step with "autonomy disabled" — that's expected, just pass it back to the user with how to enable it (set JARVIS_AUTONOMY=on in Koyeb).

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
