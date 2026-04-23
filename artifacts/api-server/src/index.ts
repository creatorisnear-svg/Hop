import app from "./app";
import { logger } from "./lib/logger";
import { ensureRegionsSeeded } from "./lib/brain";
import { REGION_DEFAULTS } from "./lib/regionDefaults";
import { registerBuiltinTools } from "./lib/tools/builtins";
import { startSleepScheduler } from "./lib/sleep";
import { loadPlugins } from "./lib/plugins";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  try {
    await ensureRegionsSeeded(REGION_DEFAULTS);
    logger.info("Brain regions seeded");
  } catch (err) {
    logger.error({ err }, "Failed to seed regions");
  }

  registerBuiltinTools();
  logger.info("Built-in agent tools registered");

  try {
    const plugins = await loadPlugins();
    logger.info({ count: plugins.length, ok: plugins.filter((p) => p.ok).length }, "Plugins loaded");
  } catch (err) {
    logger.warn({ err }, "Plugin loader failed");
  }

  startSleepScheduler();
  logger.info("Sleep/consolidation scheduler started");

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

void main();
