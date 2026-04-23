import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { logger } from "./logger";
import { registerTool, type ToolDefinition } from "./tools";

interface PluginApi {
  registerTool: (tool: ToolDefinition) => void;
  logger: typeof logger;
}

export interface LoadedPlugin {
  file: string;
  toolsAdded: string[];
  ok: boolean;
  error?: string;
}

const loaded: LoadedPlugin[] = [];

export function pluginsDir(): string {
  // dist/index.mjs → ../plugins
  return path.resolve(__dirname, "..", "plugins");
}

export function getLoadedPlugins(): LoadedPlugin[] {
  return [...loaded];
}

export async function loadPlugins(): Promise<LoadedPlugin[]> {
  const dir = pluginsDir();
  loaded.length = 0;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
    return [];
  }

  for (const file of entries) {
    if (!file.endsWith(".mjs") && !file.endsWith(".js")) continue;
    const full = path.join(dir, file);
    const before = new Set<string>();
    try {
      // record which tools existed before so we can attribute new ones
      const { listTools } = await import("./tools");
      for (const t of listTools()) before.add(t.name);

      const mod = (await import(pathToFileURL(full).href)) as {
        default?: (api: PluginApi) => void | Promise<void>;
      };
      if (typeof mod.default !== "function") {
        loaded.push({ file, toolsAdded: [], ok: false, error: "no default export function" });
        continue;
      }
      await mod.default({ registerTool, logger });
      const { listTools: listAfter } = await import("./tools");
      const added = listAfter()
        .map((t) => t.name)
        .filter((n) => !before.has(n));
      loaded.push({ file, toolsAdded: added, ok: true });
      logger.info({ file, added }, "plugin loaded");
    } catch (err) {
      loaded.push({
        file,
        toolsAdded: [],
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      logger.warn({ file, err }, "plugin failed to load");
    }
  }
  return getLoadedPlugins();
}
