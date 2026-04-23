import { promises as fs } from "node:fs";
import path from "node:path";
import { db, runsTable, messagesTable } from "@workspace/db";
import { desc, eq, like, or } from "drizzle-orm";
import { registerTool } from "./index";

const SANDBOX = "/tmp/brain-tools";

async function ensureSandbox(): Promise<void> {
  await fs.mkdir(SANDBOX, { recursive: true });
}

function safePath(rel: string): string {
  const resolved = path.resolve(SANDBOX, rel);
  if (!resolved.startsWith(SANDBOX + path.sep) && resolved !== SANDBOX) {
    throw new Error("Path escapes sandbox");
  }
  return resolved;
}

export function registerBuiltinTools(): void {
  registerTool({
    name: "current_time",
    description: "Returns the current server time as ISO and a friendly local string.",
    paramsSchema: { type: "object", properties: {} },
    async run() {
      const now = new Date();
      return {
        iso: now.toISOString(),
        local: now.toString(),
        unixMs: now.getTime(),
      };
    },
  });

  registerTool({
    name: "fetch_url",
    description: "HTTP GET a URL and return its text body (truncated to 8 KB).",
    paramsSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "Absolute http(s) URL" },
      },
    },
    async run(params: unknown) {
      const { url } = params as { url?: string };
      if (!url || !/^https?:\/\//i.test(url)) throw new Error("url required (http/https)");
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      try {
        const resp = await fetch(url, { signal: ctrl.signal });
        const text = await resp.text();
        return {
          status: resp.status,
          contentType: resp.headers.get("content-type") ?? "",
          bodyTruncated: text.length > 8192,
          body: text.slice(0, 8192),
        };
      } finally {
        clearTimeout(t);
      }
    },
  });

  registerTool({
    name: "list_runs",
    description: "List the most recent brain runs (id, goal, status).",
    paramsSchema: {
      type: "object",
      properties: { limit: { type: "integer", default: 10, minimum: 1, maximum: 50 } },
    },
    async run(params: unknown) {
      const { limit = 10 } = (params as { limit?: number }) ?? {};
      const rows = await db
        .select()
        .from(runsTable)
        .orderBy(desc(runsTable.createdAt))
        .limit(Math.min(Math.max(limit, 1), 50));
      return rows.map((r) => ({
        id: r.id,
        goal: r.goal,
        status: r.status,
        iterations: r.iterations,
        createdAt: r.createdAt.toISOString(),
        finalAnswer: r.finalAnswer ?? undefined,
      }));
    },
  });

  registerTool({
    name: "get_run",
    description: "Fetch a past run by id, including all region messages.",
    paramsSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
    async run(params: unknown) {
      const { id } = params as { id?: string };
      if (!id) throw new Error("id required");
      const [run] = await db.select().from(runsTable).where(eq(runsTable.id, id));
      if (!run) throw new Error("run not found");
      const messages = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.runId, id))
        .orderBy(messagesTable.createdAt);
      return {
        run: {
          id: run.id,
          goal: run.goal,
          status: run.status,
          finalAnswer: run.finalAnswer ?? undefined,
        },
        messages: messages.map((m) => ({
          region: m.region,
          role: m.role,
          content: m.content.slice(0, 4000),
        })),
      };
    },
  });

  registerTool({
    name: "search_memory",
    description:
      "Keyword-search prior runs and region outputs. Acts as the brain's recallable memory.",
    paramsSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Substring to look for" },
        limit: { type: "integer", default: 8, minimum: 1, maximum: 25 },
      },
    },
    async run(params: unknown) {
      const { query, limit = 8 } = (params as { query?: string; limit?: number }) ?? {};
      if (!query) throw new Error("query required");
      const pat = `%${query}%`;
      const msgRows = await db
        .select()
        .from(messagesTable)
        .where(like(messagesTable.content, pat))
        .orderBy(desc(messagesTable.createdAt))
        .limit(Math.min(Math.max(limit, 1), 25));
      const runRows = await db
        .select()
        .from(runsTable)
        .where(or(like(runsTable.goal, pat), like(runsTable.finalAnswer, pat)))
        .orderBy(desc(runsTable.createdAt))
        .limit(5);
      return {
        matchingRuns: runRows.map((r) => ({
          id: r.id,
          goal: r.goal,
          status: r.status,
          finalAnswer: r.finalAnswer?.slice(0, 500) ?? undefined,
        })),
        matchingMessages: msgRows.map((m) => ({
          runId: m.runId,
          region: m.region,
          excerpt: m.content.slice(0, 500),
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },
  });

  registerTool({
    name: "list_files",
    description: "List files in the brain's sandbox directory (/tmp/brain-tools).",
    paramsSchema: { type: "object", properties: {} },
    async run() {
      await ensureSandbox();
      const entries = await fs.readdir(SANDBOX, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
      }));
    },
  });

  registerTool({
    name: "read_text_file",
    description: "Read a UTF-8 text file from the brain sandbox (/tmp/brain-tools).",
    paramsSchema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string", description: "Relative path inside sandbox" } },
    },
    async run(params: unknown) {
      const { path: rel } = params as { path?: string };
      if (!rel) throw new Error("path required");
      await ensureSandbox();
      const content = await fs.readFile(safePath(rel), "utf8");
      return { path: rel, length: content.length, content: content.slice(0, 16_384) };
    },
  });

  registerTool({
    name: "write_text_file",
    description: "Write a UTF-8 text file to the brain sandbox (/tmp/brain-tools).",
    paramsSchema: {
      type: "object",
      required: ["path", "content"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
    },
    async run(params: unknown) {
      const { path: rel, content } = params as { path?: string; content?: string };
      if (!rel) throw new Error("path required");
      if (typeof content !== "string") throw new Error("content required");
      await ensureSandbox();
      const full = safePath(rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf8");
      return { path: rel, bytesWritten: Buffer.byteLength(content, "utf8") };
    },
  });
}
