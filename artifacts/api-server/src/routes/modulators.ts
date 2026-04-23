import { Router, type IRouter } from "express";
import { getModulators, setModulators } from "../lib/modulators";

const router: IRouter = Router();

router.get("/modulators", async (_req, res) => {
  const m = await getModulators();
  res.json(m);
});

router.patch("/modulators", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, number> = {};
  for (const k of ["focus", "energy", "calm", "curiosity"] as const) {
    if (typeof body[k] === "number") patch[k] = body[k] as number;
  }
  const next = await setModulators(patch);
  res.json(next);
});

export default router;
