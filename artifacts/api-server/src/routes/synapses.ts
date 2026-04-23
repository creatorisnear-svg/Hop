import { Router, type IRouter } from "express";
import { listSynapses } from "../lib/synapses";

const router: IRouter = Router();

router.get("/synapses", async (_req, res) => {
  const rows = await listSynapses();
  res.json(
    rows.map((s) => ({
      fromRegion: s.fromRegion,
      toRegion: s.toRegion,
      successCount: s.successCount,
      totalCount: s.totalCount,
      strength: Number(s.strength.toFixed(4)),
      lastFiredAt: s.lastFiredAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  );
});

export default router;
