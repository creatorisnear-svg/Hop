import { Router, type IRouter } from "express";
import { getLoadedPlugins, loadPlugins, pluginsDir } from "../lib/plugins";

const router: IRouter = Router();

router.get("/plugins", async (_req, res) => {
  res.json({ dir: pluginsDir(), plugins: getLoadedPlugins() });
});

router.post("/plugins/reload", async (_req, res) => {
  const result = await loadPlugins();
  res.json({ dir: pluginsDir(), plugins: result });
});

export default router;
