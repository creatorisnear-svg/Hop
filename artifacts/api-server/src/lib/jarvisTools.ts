import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db, regionsTable, runsTable, messagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "./logger";
import { runBrain, requestCancel, injectStep, replaceUpcomingSteps } from "./brain";
import { getModulators, setModulators } from "./modulators";
import { addMemory, listMemory, searchMemory, deleteMemory } from "./jarvisMemory";
import { generateImage, listImages } from "./images";
import { getCachedKeyHealth, checkAllKeys } from "./keysHealth";
import { listTools as listBrainTools, invokeTool } from "./tools";
import { loadPlugins, pluginsDir } from "./plugins";
import { fireWebhookEvent } from "./webhooks";

export interface JarvisTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<unknown>;
}

const tools: JarvisTool[] = [];

function reg(t: JarvisTool) {
  tools.push(t);
}

// ----- Runs -----
reg({
  name: "start_run",
  description: "Start a new brain run with a goal. Returns the run id which can be used to stream or cancel.",
  parameters: {
    type: "object",
    required: ["goal"],
    properties: {
      goal: { type: "string", description: "The goal/prompt for the brain to work on" },
      maxIterations: { type: "integer", description: "Optional cap on planned steps (default 6)" },
    },
  },
  async run(args) {
    const goal = String(args.goal ?? "").trim();
    if (!goal) throw new Error("goal required");
    const maxIterations = typeof args.maxIterations === "number" ? args.maxIterations : 6;
    const id = randomUUID();
    const [row] = await db
      .insert(runsTable)
      .values({ id, goal, maxIterations, status: "pending" })
      .returning();
    runBrain(id, goal, maxIterations).catch((err) => logger.error({ err, id }, "background runBrain failed"));
    return { id: row.id, goal: row.goal, status: row.status };
  },
});

reg({
  name: "list_runs",
  description: "List the most recent brain runs (id, goal, status, createdAt).",
  parameters: {
    type: "object",
    properties: { limit: { type: "integer", description: "1-50, default 10" } },
  },
  async run(args) {
    const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 50);
    const rows = await db.select().from(runsTable).orderBy(desc(runsTable.createdAt)).limit(limit);
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

reg({
  name: "get_run",
  description: "Get a specific run with all of its region messages.",
  parameters: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
  },
  async run(args) {
    const id = String(args.id ?? "");
    const [run] = await db.select().from(runsTable).where(eq(runsTable.id, id));
    if (!run) throw new Error("run not found");
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.runId, id))
      .orderBy(messagesTable.createdAt);
    return {
      run: {
        id: run.id,
        goal: run.goal,
        status: run.status,
        iterations: run.iterations,
        finalAnswer: run.finalAnswer ?? undefined,
        error: run.error ?? undefined,
      },
      messages: msgs.map((m) => ({
        region: m.region,
        role: m.role,
        iteration: m.iteration,
        content: m.content.slice(0, 4000),
      })),
    };
  },
});

reg({
  name: "cancel_run",
  description: "Cancel a running brain run by id.",
  parameters: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
  },
  async run(args) {
    const id = String(args.id ?? "");
    const [run] = await db.select().from(runsTable).where(eq(runsTable.id, id));
    if (!run) throw new Error("run not found");
    requestCancel(id);
    return { id, requested: true };
  },
});

reg({
  name: "inject_run_step",
  description:
    "Inject a new step into a running brain run. The step runs after the current step completes. Use this to redirect a run mid-flight.",
  parameters: {
    type: "object",
    required: ["runId", "region", "instruction"],
    properties: {
      runId: { type: "string" },
      region: {
        type: "string",
        description: "One of: sensory_cortex, association_cortex, hippocampus, prefrontal_cortex, cerebellum, motor_cortex",
      },
      instruction: { type: "string", description: "What this region should do" },
    },
  },
  async run(args) {
    const runId = String(args.runId ?? "");
    const region = String(args.region ?? "");
    const instruction = String(args.instruction ?? "");
    if (!runId || !region || !instruction) throw new Error("runId, region, instruction required");
    injectStep(runId, { region: region as never, instruction });
    return { ok: true };
  },
});

reg({
  name: "replace_upcoming_steps",
  description: "Replace all not-yet-executed steps of a running brain run with a new sequence.",
  parameters: {
    type: "object",
    required: ["runId", "steps"],
    properties: {
      runId: { type: "string" },
      steps: {
        type: "array",
        items: {
          type: "object",
          required: ["region", "instruction"],
          properties: {
            region: { type: "string" },
            instruction: { type: "string" },
          },
        },
      },
    },
  },
  async run(args) {
    const runId = String(args.runId ?? "");
    const steps = Array.isArray(args.steps) ? args.steps : [];
    if (!runId || steps.length === 0) throw new Error("runId and non-empty steps required");
    replaceUpcomingSteps(
      runId,
      steps.map((s) => {
        const obj = s as { region: string; instruction: string };
        return { region: obj.region as never, instruction: obj.instruction };
      }),
    );
    return { ok: true, count: steps.length };
  },
});

// ----- Regions -----
reg({
  name: "list_regions",
  description: "List all 6 brain regions with their current config (model, temperature, enabled, prompt).",
  parameters: { type: "object", properties: {} },
  async run() {
    const rows = await db.select().from(regionsTable);
    return rows.map((r) => ({
      key: r.key,
      name: r.name,
      role: r.role,
      model: r.model,
      temperature: r.temperature,
      enabled: r.enabled,
      systemPrompt: r.systemPrompt.slice(0, 600),
    }));
  },
});

reg({
  name: "update_region",
  description:
    "Update one region's configuration. Only the fields you provide are changed. Use to swap models, change temperature, edit the system prompt, or enable/disable.",
  parameters: {
    type: "object",
    required: ["key"],
    properties: {
      key: { type: "string", description: "Region key (e.g. prefrontal_cortex)" },
      model: { type: "string", description: "Groq model id, e.g. llama-3.3-70b-versatile" },
      temperature: { type: "number" },
      systemPrompt: { type: "string" },
      enabled: { type: "boolean" },
      name: { type: "string" },
      description: { type: "string" },
    },
  },
  async run(args) {
    const key = String(args.key ?? "");
    if (!key) throw new Error("key required");
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const f of ["model", "temperature", "systemPrompt", "enabled", "name", "description"] as const) {
      if (args[f] !== undefined) patch[f] = args[f];
    }
    const [updated] = await db.update(regionsTable).set(patch).where(eq(regionsTable.key, key)).returning();
    if (!updated) throw new Error(`region ${key} not found`);
    return { key: updated.key, model: updated.model, temperature: updated.temperature, enabled: updated.enabled };
  },
});

// ----- Modulators -----
reg({
  name: "get_modulators",
  description: "Get current global neuromodulator levels (focus, energy, calm, curiosity), each 0..1.",
  parameters: { type: "object", properties: {} },
  async run() {
    return await getModulators();
  },
});

reg({
  name: "set_modulators",
  description: "Update one or more global neuromodulator levels (each 0..1).",
  parameters: {
    type: "object",
    properties: {
      focus: { type: "number" },
      energy: { type: "number" },
      calm: { type: "number" },
      curiosity: { type: "number" },
    },
  },
  async run(args) {
    return await setModulators(args as Record<string, number>);
  },
});

// ----- Memory -----
reg({
  name: "remember",
  description:
    "Save a long-term memory note that future Jarvis turns will see in their system context. Use for facts, preferences, project context, decisions you (Jarvis) want to retain.",
  parameters: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  async run(args) {
    const text = String(args.text ?? "").trim();
    if (!text) throw new Error("text required");
    const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
    return await addMemory(text, tags, "jarvis");
  },
});

reg({
  name: "list_memory",
  description: "List recent stored memories.",
  parameters: { type: "object", properties: { limit: { type: "integer" } } },
  async run(args) {
    return await listMemory(Number(args.limit ?? 30));
  },
});

reg({
  name: "search_long_term_memory",
  description: "Search stored Jarvis memories by substring.",
  parameters: {
    type: "object",
    required: ["query"],
    properties: { query: { type: "string" }, limit: { type: "integer" } },
  },
  async run(args) {
    return await searchMemory(String(args.query ?? ""), Number(args.limit ?? 10));
  },
});

reg({
  name: "forget",
  description: "Delete a stored memory by id.",
  parameters: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  async run(args) {
    const ok = await deleteMemory(String(args.id ?? ""));
    return { deleted: ok };
  },
});

// ----- Images -----
reg({
  name: "generate_image",
  description: "Generate an image with Gemini (nano banana) from a text prompt. Returns the image id and a data URL.",
  parameters: {
    type: "object",
    required: ["prompt"],
    properties: { prompt: { type: "string" } },
  },
  async run(args) {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) throw new Error("prompt required");
    const img = await generateImage(prompt, "jarvis");
    return {
      id: img.id,
      prompt: img.prompt,
      mimeType: img.mimeType,
      url: `/api/images/${img.id}/raw`,
    };
  },
});

reg({
  name: "list_images",
  description: "List previously generated images (no base64 payload, just metadata + url).",
  parameters: { type: "object", properties: { limit: { type: "integer" } } },
  async run(args) {
    const imgs = await listImages(Number(args.limit ?? 20));
    return imgs.map((i) => ({
      id: i.id,
      prompt: i.prompt,
      mimeType: i.mimeType,
      createdAt: i.createdAt,
      url: `/api/images/${i.id}/raw`,
    }));
  },
});

// ----- System diagnostics -----
reg({
  name: "check_api_keys",
  description: "Run a live health check across all configured Groq + Gemini API keys.",
  parameters: { type: "object", properties: {} },
  async run() {
    return await checkAllKeys();
  },
});

reg({
  name: "key_health_cached",
  description: "Return the most recent API key health snapshot without re-pinging providers.",
  parameters: { type: "object", properties: {} },
  async run() {
    return getCachedKeyHealth();
  },
});

// ----- Brain tool catalog (low-level, used inside runs) -----
reg({
  name: "list_brain_tools",
  description: "List the low-level tools available to brain regions during a run.",
  parameters: { type: "object", properties: {} },
  async run() {
    return listBrainTools().map((t) => ({ name: t.name, description: t.description }));
  },
});

reg({
  name: "invoke_brain_tool",
  description: "Manually invoke a brain tool by name with arguments. Use to test tools or fetch data.",
  parameters: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      params: { type: "object" },
    },
  },
  async run(args) {
    const name = String(args.name ?? "");
    return await invokeTool(name, args.params ?? {});
  },
});

// ----- Plugin / tool creation -----
reg({
  name: "create_tool_plugin",
  description:
    "Create a new runtime plugin file that registers one or more brain tools. The file is written to the plugins dir and loaded immediately. " +
    "The provided code must be a valid ES module with `export default async function ({ registerTool, logger }) { registerTool({ ... }); }`.",
  parameters: {
    type: "object",
    required: ["filename", "code"],
    properties: {
      filename: { type: "string", description: "Filename (must end in .mjs)" },
      code: { type: "string", description: "Full ES module source code" },
    },
  },
  async run(args) {
    const filename = String(args.filename ?? "").trim();
    const code = String(args.code ?? "");
    if (!filename.endsWith(".mjs")) throw new Error("filename must end in .mjs");
    if (filename.includes("/") || filename.includes("..")) throw new Error("invalid filename");
    if (!code) throw new Error("code required");
    const dir = pluginsDir();
    await fs.mkdir(dir, { recursive: true });
    const full = path.join(dir, filename);
    await fs.writeFile(full, code, "utf8");
    const reloaded = await loadPlugins();
    const me = reloaded.find((p) => p.file === filename);
    return { written: full, plugins: reloaded.length, thisPlugin: me };
  },
});

reg({
  name: "list_plugins",
  description: "List loaded runtime plugins and the tools each one added.",
  parameters: { type: "object", properties: {} },
  async run() {
    return await loadPlugins();
  },
});

// ----- Webhooks-as-actions -----
reg({
  name: "fire_webhook_event",
  description: "Fire a custom webhook event so external systems get notified.",
  parameters: {
    type: "object",
    required: ["event"],
    properties: {
      event: { type: "string" },
      data: { type: "object" },
    },
  },
  async run(args) {
    const event = String(args.event ?? "");
    if (!event) throw new Error("event required");
    fireWebhookEvent({ event, data: (args.data as Record<string, unknown>) ?? {} });
    return { ok: true };
  },
});

// ----- Autonomous (GitHub + Koyeb) -----
// These delegate to the agent tool registry, which audits every call to the
// jarvis_actions table and enforces the JARVIS_AUTONOMY kill switch.
const AUTONOMY_TOOLS: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [
  {
    name: "github_list_commits",
    description: "List the most recent commits on the configured repo branch. Use to check what's deployed or to verify a commit landed.",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer", description: "1-50, default 10" } },
    },
  },
  {
    name: "github_read_file",
    description: "Read a file from the configured repo. ALWAYS use this after github_write_file to verify the change actually landed.",
    parameters: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" },
        ref: { type: "string", description: "Optional branch/tag/sha" },
      },
    },
  },
  {
    name: "github_write_file",
    description: "Create or update a file in the configured repo (commits to the given branch, default main). Only use when the user explicitly asks Jarvis to edit code or a file.",
    parameters: {
      type: "object",
      required: ["path", "content", "message"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        message: { type: "string", description: "Commit message" },
        branch: { type: "string" },
      },
    },
  },
  {
    name: "github_create_branch",
    description: "Create a new branch off another branch (default main).",
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        from: { type: "string" },
      },
    },
  },
  {
    name: "github_open_pr",
    description: "Open a pull request from `head` into `base` (default base: main).",
    parameters: {
      type: "object",
      required: ["title", "head"],
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string" },
        base: { type: "string" },
      },
    },
  },
  {
    name: "github_merge_pr",
    description: "Merge an open pull request by number. Only on explicit user request.",
    parameters: {
      type: "object",
      required: ["number"],
      properties: {
        number: { type: "integer" },
        method: { type: "string", description: "merge | squash | rebase (default squash)" },
      },
    },
  },
  {
    name: "koyeb_list_services",
    description: "List all Koyeb services. Use to find a service id before any other Koyeb action.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "koyeb_get_logs",
    description: "Fetch recent log lines from a Koyeb service. Use to verify the service is healthy after a deploy or to debug errors the user reports.",
    parameters: {
      type: "object",
      required: ["serviceId"],
      properties: {
        serviceId: { type: "string" },
        limit: { type: "integer", description: "1-500, default 100" },
      },
    },
  },
  {
    name: "koyeb_redeploy",
    description: "Trigger a redeploy of a Koyeb service. After calling, ALWAYS verify by calling koyeb_list_services or koyeb_get_logs to confirm the new deployment came up healthy.",
    parameters: {
      type: "object",
      required: ["serviceId"],
      properties: { serviceId: { type: "string" } },
    },
  },
  {
    name: "koyeb_pause_service",
    description: "Pause (stop) a Koyeb service without deleting it.",
    parameters: {
      type: "object",
      required: ["serviceId"],
      properties: { serviceId: { type: "string" } },
    },
  },
  {
    name: "koyeb_resume_service",
    description: "Resume a paused Koyeb service.",
    parameters: {
      type: "object",
      required: ["serviceId"],
      properties: { serviceId: { type: "string" } },
    },
  },
  {
    name: "koyeb_delete_service",
    description: "PERMANENTLY delete a Koyeb service. CANNOT be undone. Only use when the user explicitly says to delete it. Always confirm by name in your reply before calling this.",
    parameters: {
      type: "object",
      required: ["serviceId"],
      properties: { serviceId: { type: "string" } },
    },
  },
];

for (const t of AUTONOMY_TOOLS) {
  reg({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    async run(args) {
      const result = await invokeTool(t.name, args);
      if (!result.ok) throw new Error(result.error ?? "tool failed");
      return result.result;
    },
  });
}

export function listJarvisTools(): JarvisTool[] {
  return [...tools];
}

export function getJarvisTool(name: string): JarvisTool | undefined {
  return tools.find((t) => t.name === name);
}
