import { Router, type IRouter } from "express";
import { listTools, invokeTool } from "../lib/tools";

const router: IRouter = Router();

router.get("/tools", async (_req, res) => {
  res.json(
    listTools().map((t) => ({
      name: t.name,
      description: t.description,
      paramsSchema: t.paramsSchema,
    })),
  );
});

router.post("/tools/:name/invoke", async (req, res) => {
  const name = req.params.name;
  const params = req.body ?? {};
  const result = await invokeTool(name, params);
  res.status(result.ok ? 200 : 400).json(result);
});

export default router;
