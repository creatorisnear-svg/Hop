export interface ToolDefinition<TParams = unknown, TResult = unknown> {
  name: string;
  description: string;
  paramsSchema: Record<string, unknown>; // JSON-Schema-ish, just for docs/UI/Jarvis
  run(params: TParams): Promise<TResult>;
}

const REGISTRY = new Map<string, ToolDefinition>();

export function registerTool(tool: ToolDefinition): void {
  REGISTRY.set(tool.name, tool as ToolDefinition);
}

export function getTool(name: string): ToolDefinition | undefined {
  return REGISTRY.get(name);
}

export function listTools(): ToolDefinition[] {
  return Array.from(REGISTRY.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export interface ToolInvocationResult {
  ok: boolean;
  durationMs: number;
  result?: unknown;
  error?: string;
}

export async function invokeTool(name: string, params: unknown): Promise<ToolInvocationResult> {
  const tool = REGISTRY.get(name);
  if (!tool) return { ok: false, durationMs: 0, error: `Unknown tool: ${name}` };
  const t0 = Date.now();
  try {
    const result = await tool.run(params);
    return { ok: true, durationMs: Date.now() - t0, result };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
