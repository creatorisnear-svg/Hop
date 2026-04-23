import { Router, type IRouter } from "express";
import { db, runsTable, messagesTable } from "@workspace/db";
import { sql, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/insights/dashboard", async (_req, res) => {
  const [stats] = await db
    .select({
      totalRuns: sql<number>`COUNT(*)::int`,
      succeededRuns: sql<number>`COUNT(*) FILTER (WHERE status = 'succeeded')::int`,
      failedRuns: sql<number>`COUNT(*) FILTER (WHERE status = 'failed')::int`,
      runningRuns: sql<number>`COUNT(*) FILTER (WHERE status IN ('running','pending'))::int`,
      avgIterations: sql<number>`COALESCE(AVG(iterations), 0)::float`,
    })
    .from(runsTable);

  const [msgCount] = await db
    .select({ totalMessages: sql<number>`COUNT(*)::int` })
    .from(messagesTable);

  const recent = await db
    .select()
    .from(runsTable)
    .orderBy(desc(runsTable.createdAt))
    .limit(8);

  res.json({
    totalRuns: stats?.totalRuns ?? 0,
    succeededRuns: stats?.succeededRuns ?? 0,
    failedRuns: stats?.failedRuns ?? 0,
    runningRuns: stats?.runningRuns ?? 0,
    totalMessages: msgCount?.totalMessages ?? 0,
    avgIterations: Number((stats?.avgIterations ?? 0).toFixed(2)),
    recentRuns: recent.map((r) => ({
      id: r.id,
      goal: r.goal,
      status: r.status,
      iterations: r.iterations,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : undefined,
      finalAnswer: r.finalAnswer ?? undefined,
      error: r.error ?? undefined,
    })),
  });
});

router.get("/insights/region-activity", async (_req, res) => {
  const rows = await db
    .select({
      region: messagesTable.region,
      role: messagesTable.role,
      messageCount: sql<number>`COUNT(*)::int`,
      avgLatencyMs: sql<number>`COALESCE(AVG(latency_ms), 0)::float`,
    })
    .from(messagesTable)
    .groupBy(messagesTable.region, messagesTable.role);

  res.json(
    rows.map((r) => ({
      region: r.region,
      role: r.role,
      messageCount: r.messageCount,
      avgLatencyMs: Number(r.avgLatencyMs.toFixed(0)),
    })),
  );
});

export default router;
