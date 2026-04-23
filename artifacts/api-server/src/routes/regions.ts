import { Router, type IRouter } from "express";
import { db, regionsTable, type RegionRow } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateRegionBody, UpdateRegionParams, PingRegionParams, GetRegionParams } from "@workspace/api-zod";
import { ollamaListModels } from "../lib/ollama";

const router: IRouter = Router();

function rowToRegion(r: RegionRow) {
  return {
    key: r.key,
    role: r.role,
    name: r.name,
    description: r.description,
    ollamaUrl: r.ollamaUrl,
    model: r.model,
    systemPrompt: r.systemPrompt,
    temperature: r.temperature,
    enabled: r.enabled,
  };
}

router.get("/regions", async (_req, res) => {
  const rows = await db.select().from(regionsTable);
  // Stable ordering matching brain flow
  const order = [
    "sensory_cortex",
    "association_cortex",
    "hippocampus",
    "prefrontal_cortex",
    "cerebellum",
    "motor_cortex",
  ];
  rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  res.json(rows.map(rowToRegion));
});

router.get("/regions/:regionKey", async (req, res) => {
  const { regionKey } = GetRegionParams.parse(req.params);
  const [row] = await db.select().from(regionsTable).where(eq(regionsTable.key, regionKey));
  if (!row) return res.status(404).json({ error: "Region not found" });
  res.json(rowToRegion(row));
});

router.patch("/regions/:regionKey", async (req, res) => {
  const { regionKey } = UpdateRegionParams.parse(req.params);
  const body = UpdateRegionBody.parse(req.body);
  const [row] = await db
    .update(regionsTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(regionsTable.key, regionKey))
    .returning();
  if (!row) return res.status(404).json({ error: "Region not found" });
  res.json(rowToRegion(row));
});

router.post("/regions/:regionKey/ping", async (req, res) => {
  const { regionKey } = PingRegionParams.parse(req.params);
  const [row] = await db.select().from(regionsTable).where(eq(regionsTable.key, regionKey));
  if (!row) return res.status(404).json({ error: "Region not found" });
  if (!row.ollamaUrl) {
    return res.status(200).json({ ok: false, latencyMs: 0, error: "No Ollama URL configured" });
  }
  const start = Date.now();
  try {
    const models = await ollamaListModels(row.ollamaUrl);
    res.json({ ok: true, latencyMs: Date.now() - start, modelsAvailable: models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, latencyMs: Date.now() - start, error: message });
  }
});

export default router;
