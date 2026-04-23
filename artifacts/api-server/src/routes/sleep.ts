import { Router, type IRouter } from "express";
import { consolidate, getSleepStatus, listInsights } from "../lib/sleep";

const router: IRouter = Router();

router.get("/insights", async (_req, res) => {
  const rows = await listInsights(50);
  res.json(
    rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      content: r.content,
      sourceRunIds: r.sourceRunIds,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

router.get("/sleep/status", async (_req, res) => {
  const s = getSleepStatus();
  res.json({
    isSleeping: s.isSleeping,
    lastRunAt: s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null,
    lastSleepAt: s.lastSleepAt ? new Date(s.lastSleepAt).toISOString() : null,
    insightsLastCycle: s.insightsLastCycle,
  });
});

router.post("/sleep/run", async (_req, res) => {
  const result = await consolidate({ force: true });
  res.json(result);
});

export default router;
