import { db, jarvisActionsTable } from "@workspace/db";
import { logger } from "./logger";

export type AutonomyMode = "off" | "on";

export function autonomyMode(): AutonomyMode {
  const v = (process.env.JARVIS_AUTONOMY ?? "off").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1" ? "on" : "off";
}

export function autonomyEnabled(): boolean {
  return autonomyMode() === "on";
}

export function requireAutonomy(): void {
  if (!autonomyEnabled()) {
    throw new Error(
      "Jarvis autonomy is disabled. Set JARVIS_AUTONOMY=on in the environment to enable.",
    );
  }
}

export async function recordAction(args: {
  tool: string;
  params: unknown;
  ok: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}): Promise<void> {
  try {
    await db.insert(jarvisActionsTable).values({
      tool: args.tool,
      params: args.params as object,
      result: args.ok ? (args.result as object) : null,
      ok: args.ok,
      error: args.error,
      durationMs: String(args.durationMs),
      autonomyMode: autonomyMode(),
    });
  } catch (err) {
    logger.error({ err }, "Failed to record Jarvis action");
  }
}

// ---------------------------------------------------------------------------
// GitHub client (fine-grained PAT in GITHUB_TOKEN, repo in GITHUB_REPO=owner/name)
// ---------------------------------------------------------------------------

function ghEnv(): { token: string; owner: string; repo: string; branch: string } {
  const token = process.env.GITHUB_TOKEN;
  const repoFull = process.env.GITHUB_REPO;
  if (!token) throw new Error("GITHUB_TOKEN not set");
  if (!repoFull || !repoFull.includes("/"))
    throw new Error("GITHUB_REPO must be 'owner/name'");
  const [owner, repo] = repoFull.split("/", 2);
  const branch = process.env.GITHUB_BRANCH ?? "main";
  return { token, owner, repo, branch };
}

async function gh<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const { token } = ghEnv();
  const resp = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`GitHub ${method} ${path} -> ${resp.status}: ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

export const github = {
  async listCommits(limit = 10) {
    const { owner, repo, branch } = ghEnv();
    const rows = await gh<Array<{ sha: string; commit: { message: string; author: { name: string; date: string } } }>>(
      "GET",
      `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${Math.min(Math.max(limit, 1), 50)}`,
    );
    return rows.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0],
      author: c.commit.author.name,
      date: c.commit.author.date,
    }));
  },

  async readFile(filePath: string, ref?: string) {
    const { owner, repo, branch } = ghEnv();
    const r = ref ?? branch;
    const data = await gh<{ content?: string; encoding?: string; sha?: string }>(
      "GET",
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(r)}`,
    );
    if (!data.content) throw new Error("Not a file");
    const text = Buffer.from(data.content, (data.encoding ?? "base64") as BufferEncoding).toString("utf8");
    return { sha: data.sha, content: text };
  },

  async writeFile(filePath: string, content: string, message: string, branch?: string) {
    const env = ghEnv();
    const targetBranch = branch ?? env.branch;
    let existingSha: string | undefined;
    try {
      const cur = await gh<{ sha: string }>(
        "GET",
        `/repos/${env.owner}/${env.repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(targetBranch)}`,
      );
      existingSha = cur.sha;
    } catch {
      // file doesn't exist yet, that's fine
    }
    const result = await gh<{ commit: { sha: string; html_url: string } }>(
      "PUT",
      `/repos/${env.owner}/${env.repo}/contents/${encodeURIComponent(filePath)}`,
      {
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: targetBranch,
        sha: existingSha,
      },
    );
    return { commitSha: result.commit.sha, url: result.commit.html_url };
  },

  async createBranch(newBranch: string, fromBranch?: string) {
    const env = ghEnv();
    const base = fromBranch ?? env.branch;
    const ref = await gh<{ object: { sha: string } }>(
      "GET",
      `/repos/${env.owner}/${env.repo}/git/ref/heads/${encodeURIComponent(base)}`,
    );
    await gh("POST", `/repos/${env.owner}/${env.repo}/git/refs`, {
      ref: `refs/heads/${newBranch}`,
      sha: ref.object.sha,
    });
    return { branch: newBranch, fromSha: ref.object.sha };
  },

  async openPR(title: string, body: string, head: string, base?: string) {
    const env = ghEnv();
    const pr = await gh<{ number: number; html_url: string }>(
      "POST",
      `/repos/${env.owner}/${env.repo}/pulls`,
      { title, body, head, base: base ?? env.branch },
    );
    return { number: pr.number, url: pr.html_url };
  },

  async mergePR(number: number, method: "merge" | "squash" | "rebase" = "squash") {
    const env = ghEnv();
    const r = await gh<{ sha: string; merged: boolean }>(
      "PUT",
      `/repos/${env.owner}/${env.repo}/pulls/${number}/merge`,
      { merge_method: method },
    );
    return r;
  },
};

// ---------------------------------------------------------------------------
// Koyeb client (token in KOYEB_API_TOKEN; v1 REST API)
// ---------------------------------------------------------------------------

function koyebToken(): string {
  const t = process.env.KOYEB_API_TOKEN;
  if (!t) throw new Error("KOYEB_API_TOKEN not set");
  return t;
}

async function ky<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`https://app.koyeb.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${koyebToken()}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Koyeb ${method} ${path} -> ${resp.status}: ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

export const koyeb = {
  async listServices() {
    const data = await ky<{ services?: Array<{ id: string; name: string; status?: string; app_id?: string }> }>(
      "GET",
      "/v1/services",
    );
    return (data.services ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      appId: s.app_id,
    }));
  },

  async getService(serviceId: string) {
    return ky("GET", `/v1/services/${encodeURIComponent(serviceId)}`);
  },

  async getRecentLogs(serviceId: string, limit = 100) {
    // Koyeb log endpoint expects query params; this fetches a tail
    const data = await ky<{ data?: Array<{ created_at: string; msg: string; stream: string }> }>(
      "GET",
      `/v1/streams/logs?service_id=${encodeURIComponent(serviceId)}&limit=${Math.min(Math.max(limit, 1), 500)}`,
    );
    return (data.data ?? []).map((l) => ({
      ts: l.created_at,
      stream: l.stream,
      msg: l.msg,
    }));
  },

  async redeploy(serviceId: string) {
    return ky("POST", `/v1/services/${encodeURIComponent(serviceId)}/redeploy`, {
      deployment_group: "prod",
      skip_build: false,
    });
  },

  async pause(serviceId: string) {
    return ky("POST", `/v1/services/${encodeURIComponent(serviceId)}/pause`, {});
  },

  async resume(serviceId: string) {
    return ky("POST", `/v1/services/${encodeURIComponent(serviceId)}/resume`, {});
  },

  async deleteService(serviceId: string) {
    return ky("DELETE", `/v1/services/${encodeURIComponent(serviceId)}`);
  },
};
