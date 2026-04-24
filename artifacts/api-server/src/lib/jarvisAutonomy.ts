import { db, jarvisActionsTable } from "@workspace/db";
import { logger } from "./logger";

export type AutonomyMode = "off" | "on";
export type Account = 1 | 2;

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

function normalizeAccount(account?: number): Account {
  if (account === 2) return 2;
  return 1;
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
// GitHub client — supports up to 2 accounts.
//   Account 1: GITHUB_TOKEN  / GITHUB_REPO  / GITHUB_BRANCH
//   Account 2: GITHUB_TOKEN_2 / GITHUB_REPO_2 / GITHUB_BRANCH_2
// ---------------------------------------------------------------------------

function ghEnv(account: Account = 1): { token: string; owner: string; repo: string; branch: string } {
  const suffix = account === 2 ? "_2" : "";
  const token = process.env[`GITHUB_TOKEN${suffix}`];
  const repoFull = process.env[`GITHUB_REPO${suffix}`];
  if (!token) throw new Error(`GITHUB_TOKEN${suffix} not set (account ${account})`);
  if (!repoFull || !repoFull.includes("/"))
    throw new Error(`GITHUB_REPO${suffix} must be 'owner/name' (account ${account})`);
  const [owner, repo] = repoFull.split("/", 2);
  const branch = process.env[`GITHUB_BRANCH${suffix}`] ?? "main";
  return { token, owner, repo, branch };
}

async function gh<T = unknown>(
  account: Account,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const { token } = ghEnv(account);
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
  if (!resp.ok) throw new Error(`GitHub[${account}] ${method} ${path} -> ${resp.status}: ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

export const github = {
  whichAccounts(): Account[] {
    const out: Account[] = [];
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) out.push(1);
    if (process.env.GITHUB_TOKEN_2 && process.env.GITHUB_REPO_2) out.push(2);
    return out;
  },

  async listCommits(limit = 10, account?: number) {
    const acc = normalizeAccount(account);
    const { owner, repo, branch } = ghEnv(acc);
    const rows = await gh<Array<{ sha: string; commit: { message: string; author: { name: string; date: string } } }>>(
      acc,
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

  async readFile(filePath: string, ref?: string, account?: number) {
    const acc = normalizeAccount(account);
    const { owner, repo, branch } = ghEnv(acc);
    const r = ref ?? branch;
    const data = await gh<{ content?: string; encoding?: string; sha?: string }>(
      acc,
      "GET",
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(r)}`,
    );
    if (!data.content) throw new Error("Not a file");
    const text = Buffer.from(data.content, (data.encoding ?? "base64") as BufferEncoding).toString("utf8");
    return { sha: data.sha, content: text };
  },

  async writeFile(filePath: string, content: string, message: string, branch?: string, account?: number) {
    const acc = normalizeAccount(account);
    const env = ghEnv(acc);
    const targetBranch = branch ?? env.branch;
    let existingSha: string | undefined;
    try {
      const cur = await gh<{ sha: string }>(
        acc,
        "GET",
        `/repos/${env.owner}/${env.repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(targetBranch)}`,
      );
      existingSha = cur.sha;
    } catch {
      // file doesn't exist yet, that's fine
    }
    const result = await gh<{ commit: { sha: string; html_url: string } }>(
      acc,
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

  async createBranch(newBranch: string, fromBranch?: string, account?: number) {
    const acc = normalizeAccount(account);
    const env = ghEnv(acc);
    const base = fromBranch ?? env.branch;
    const ref = await gh<{ object: { sha: string } }>(
      acc,
      "GET",
      `/repos/${env.owner}/${env.repo}/git/ref/heads/${encodeURIComponent(base)}`,
    );
    await gh(acc, "POST", `/repos/${env.owner}/${env.repo}/git/refs`, {
      ref: `refs/heads/${newBranch}`,
      sha: ref.object.sha,
    });
    return { branch: newBranch, fromSha: ref.object.sha };
  },

  async openPR(title: string, body: string, head: string, base?: string, account?: number) {
    const acc = normalizeAccount(account);
    const env = ghEnv(acc);
    const pr = await gh<{ number: number; html_url: string }>(
      acc,
      "POST",
      `/repos/${env.owner}/${env.repo}/pulls`,
      { title, body, head, base: base ?? env.branch },
    );
    return { number: pr.number, url: pr.html_url };
  },

  async mergePR(number: number, method: "merge" | "squash" | "rebase" = "squash", account?: number) {
    const acc = normalizeAccount(account);
    const env = ghEnv(acc);
    const r = await gh<{ sha: string; merged: boolean }>(
      acc,
      "PUT",
      `/repos/${env.owner}/${env.repo}/pulls/${number}/merge`,
      { merge_method: method },
    );
    return r;
  },
};

// ---------------------------------------------------------------------------
// Koyeb client — supports up to 2 accounts.
//   Account 1: KOYEB_API_TOKEN
//   Account 2: KOYEB_API_TOKEN_2
// ---------------------------------------------------------------------------

function koyebToken(account: Account = 1): string {
  const suffix = account === 2 ? "_2" : "";
  const t = process.env[`KOYEB_API_TOKEN${suffix}`];
  if (!t) throw new Error(`KOYEB_API_TOKEN${suffix} not set (account ${account})`);
  return t;
}

async function ky<T = unknown>(account: Account, method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`https://app.koyeb.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${koyebToken(account)}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Koyeb[${account}] ${method} ${path} -> ${resp.status}: ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

export const koyeb = {
  whichAccounts(): Account[] {
    const out: Account[] = [];
    if (process.env.KOYEB_API_TOKEN) out.push(1);
    if (process.env.KOYEB_API_TOKEN_2) out.push(2);
    return out;
  },

  async listServices(account?: number) {
    const acc = normalizeAccount(account);
    const data = await ky<{ services?: Array<{ id: string; name: string; status?: string; app_id?: string }> }>(
      acc,
      "GET",
      "/v1/services",
    );
    return (data.services ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      appId: s.app_id,
      account: acc,
    }));
  },

  async getService(serviceId: string, account?: number) {
    const acc = normalizeAccount(account);
    return ky(acc, "GET", `/v1/services/${encodeURIComponent(serviceId)}`);
  },

  async getRecentLogs(serviceId: string, limit = 100, account?: number) {
    const acc = normalizeAccount(account);
    const data = await ky<{ data?: Array<{ created_at: string; msg: string; stream: string }> }>(
      acc,
      "GET",
      `/v1/streams/logs?service_id=${encodeURIComponent(serviceId)}&limit=${Math.min(Math.max(limit, 1), 500)}`,
    );
    return (data.data ?? []).map((l) => ({
      ts: l.created_at,
      stream: l.stream,
      msg: l.msg,
    }));
  },

  async redeploy(serviceId: string, account?: number) {
    const acc = normalizeAccount(account);
    return ky(acc, "POST", `/v1/services/${encodeURIComponent(serviceId)}/redeploy`, {
      deployment_group: "prod",
      skip_build: false,
    });
  },

  async pause(serviceId: string, account?: number) {
    const acc = normalizeAccount(account);
    return ky(acc, "POST", `/v1/services/${encodeURIComponent(serviceId)}/pause`, {});
  },

  async resume(serviceId: string, account?: number) {
    const acc = normalizeAccount(account);
    return ky(acc, "POST", `/v1/services/${encodeURIComponent(serviceId)}/resume`, {});
  },

  async deleteService(serviceId: string, account?: number) {
    const acc = normalizeAccount(account);
    return ky(acc, "DELETE", `/v1/services/${encodeURIComponent(serviceId)}`);
  },
};
