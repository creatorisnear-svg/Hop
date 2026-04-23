import { Router, type IRouter } from "express";
import { checkAllKeys, getCachedKeyHealth } from "../lib/keysHealth";

const router: IRouter = Router();

router.get("/keys/health", async (_req, res) => {
  const cached = getCachedKeyHealth();
  res.json(cached);
});

router.post("/keys/health/check", async (_req, res) => {
  const results = await checkAllKeys();
  res.json({ results, checkedAt: Date.now() });
});

export default router;
