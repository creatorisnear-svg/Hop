import { Router, type IRouter } from "express";
import { db, jarvisActionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { autonomyMode } from "../lib/jarvisAutonomy";

const router: IRouter = Router();

router.get("/api/jarvis/autonomy", (_req, res) => {
  const githubConfigured = !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
  const koyebConfigured = !!process.env.KOYEB_API_TOKEN;
  res.json({
    mode: autonomyMode(),
    githubConfigured,
    koyebConfigured,
    repo: process.env.GITHUB_REPO ?? null,
    branch: process.env.GITHUB_BRANCH ?? "main",
  });
});

router.get("/api/jarvis/actions", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 500);
  const rows = await db
    .select()
    .from(jarvisActionsTable)
    .orderBy(desc(jarvisActionsTable.createdAt))
    .limit(limit);
  res.json({ actions: rows });
});

export default router;
