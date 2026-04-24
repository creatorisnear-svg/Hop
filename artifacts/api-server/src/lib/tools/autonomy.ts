import { registerTool, type ToolDefinition } from "./index";
import {
  autonomyEnabled,
  github,
  koyeb,
  recordAction,
  requireAutonomy,
} from "../jarvisAutonomy";
import { logger } from "../logger";

/**
 * Wrap a tool's run() so every invocation:
 *   1. Checks the JARVIS_AUTONOMY kill switch
 *   2. Logs the action (success or failure) to the jarvis_actions audit table
 */
function autonomous<TParams, TResult>(
  def: ToolDefinition<TParams, TResult>,
): ToolDefinition<TParams, TResult> {
  const wrapped: ToolDefinition<TParams, TResult> = {
    ...def,
    async run(params: TParams) {
      const t0 = Date.now();
      try {
        requireAutonomy();
        const result = await def.run(params);
        await recordAction({
          tool: def.name,
          params,
          ok: true,
          result,
          durationMs: Date.now() - t0,
        });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await recordAction({
          tool: def.name,
          params,
          ok: false,
          error,
          durationMs: Date.now() - t0,
        });
        throw err;
      }
    },
  };
  return wrapped;
}

export function registerAutonomyTools(): void {
  // GitHub --------------------------------------------------------------
  registerTool(
    autonomous({
      name: "github_list_commits",
      description: "List the most recent commits on the configured repo branch.",
      paramsSchema: {
        type: "object",
        properties: { limit: { type: "integer", default: 10, minimum: 1, maximum: 50 } },
      },
      async run(params: unknown) {
        const { limit = 10 } = (params as { limit?: number }) ?? {};
        return github.listCommits(limit);
      },
    }),
  );

  registerTool(
    autonomous({
      name: "github_read_file",
      description: "Read a file's contents from the configured repo.",
      paramsSchema: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", description: "Repo-relative file path" },
          ref: { type: "string", description: "Branch, tag, or commit SHA (optional)" },
        },
      },
      async run(params: unknown) {
        const { path, ref } = params as { path: string; ref?: string };
        return github.readFile(path, ref);
      },
    }),
  );

  registerTool(
    autonomous({
      name: "github_write_file",
      description:
        "Create or update a file in the configured repo. Commits directly to the given branch (defaults to main).",
      paramsSchema: {
        type: "object",
        required: ["path", "content", "message"],
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          message: { type: "string", description: "Commit message" },
          branch: { type: "string", description: "Target branch (default: main)" },
        },
      },
      async run(params: unknown) {
        const { path, content, message, branch } = params as {
          path: string; content: string; message: string; branch?: string;
        };
        return github.writeFile(path, content, message, branch);
      },
    }),
  );

  registerTool(
    autonomous({
      name: "github_create_branch",
      description: "Create a new branch off another branch (default: main).",
      paramsSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "New branch name" },
          from: { type: "string", description: "Source branch (default: main)" },
        },
      },
      async run(params: unknown) {
        const { name, from } = params as { name: string; from?: string };
        return github.createBranch(name, from);
      },
    }),
  );

  registerTool(
    autonomous({
      name: "github_open_pr",
      description: "Open a pull request from `head` into `base` (default base: main).",
      paramsSchema: {
        type: "object",
        required: ["title", "head"],
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          head: { type: "string", description: "Source branch" },
          base: { type: "string", description: "Target branch (default: main)" },
        },
      },
      async run(params: unknown) {
        const { title, body = "", head, base } = params as {
          title: string; body?: string; head: string; base?: string;
        };
        return github.openPR(title, body, head, base);
      },
    }),
  );

  registerTool(
    autonomous({
      name: "github_merge_pr",
      description: "Merge an open pull request by number.",
      paramsSchema: {
        type: "object",
        required: ["number"],
        properties: {
          number: { type: "integer" },
          method: { type: "string", enum: ["merge", "squash", "rebase"], default: "squash" },
        },
      },
      async run(params: unknown) {
        const { number, method = "squash" } = params as {
          number: number; method?: "merge" | "squash" | "rebase";
        };
        return github.mergePR(number, method);
      },
    }),
  );

  // Koyeb ---------------------------------------------------------------
  registerTool(
    autonomous({
      name: "koyeb_list_services",
      description: "List all Koyeb services for the configured token.",
      paramsSchema: { type: "object", properties: {} },
      async run() {
        return koyeb.listServices();
      },
    }),
  );

  registerTool(
    autonomous({
      name: "koyeb_get_logs",
      description: "Fetch the most recent log lines from a Koyeb service.",
      paramsSchema: {
        type: "object",
        required: ["serviceId"],
        properties: {
          serviceId: { type: "string" },
          limit: { type: "integer", default: 100, minimum: 1, maximum: 500 },
        },
      },
      async run(params: unknown) {
        const { serviceId, limit = 100 } = params as { serviceId: string; limit?: number };
        return koyeb.getRecentLogs(serviceId, limit);
      },
    }),
  );

  registerTool(
    autonomous({
      name: "koyeb_redeploy",
      description: "Trigger a redeploy of a Koyeb service.",
      paramsSchema: {
        type: "object",
        required: ["serviceId"],
        properties: { serviceId: { type: "string" } },
      },
      async run(params: unknown) {
        const { serviceId } = params as { serviceId: string };
        return koyeb.redeploy(serviceId);
      },
    }),
  );

  registerTool(
    autonomous({
      name: "koyeb_pause_service",
      description: "Pause a Koyeb service (stops it without deleting).",
      paramsSchema: {
        type: "object",
        required: ["serviceId"],
        properties: { serviceId: { type: "string" } },
      },
      async run(params: unknown) {
        const { serviceId } = params as { serviceId: string };
        return koyeb.pause(serviceId);
      },
    }),
  );

  registerTool(
    autonomous({
      name: "koyeb_resume_service",
      description: "Resume a paused Koyeb service.",
      paramsSchema: {
        type: "object",
        required: ["serviceId"],
        properties: { serviceId: { type: "string" } },
      },
      async run(params: unknown) {
        const { serviceId } = params as { serviceId: string };
        return koyeb.resume(serviceId);
      },
    }),
  );

  registerTool(
    autonomous({
      name: "koyeb_delete_service",
      description: "PERMANENTLY delete a Koyeb service. Cannot be undone.",
      paramsSchema: {
        type: "object",
        required: ["serviceId"],
        properties: { serviceId: { type: "string" } },
      },
      async run(params: unknown) {
        const { serviceId } = params as { serviceId: string };
        return koyeb.deleteService(serviceId);
      },
    }),
  );

  logger.info(
    { autonomy: autonomyEnabled() ? "on" : "off" },
    "Jarvis autonomy tools registered (GitHub + Koyeb)",
  );
}
