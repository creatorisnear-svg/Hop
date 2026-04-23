import React, { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useListTools, invokeTool } from "@workspace/api-client-react";
import { Wrench, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface InvokeState {
  paramsJson: string;
  loading: boolean;
  result?: { ok: boolean; durationMs: number; result?: unknown; error?: string };
}

export default function ToolsPage() {
  const { data: tools, isLoading } = useListTools();
  const [state, setState] = useState<Record<string, InvokeState>>({});

  const updateState = (name: string, patch: Partial<InvokeState>) =>
    setState((s) => ({ ...s, [name]: { ...(s[name] ?? { paramsJson: "{}", loading: false }), ...patch } }));

  const onInvoke = async (name: string) => {
    const cur = state[name] ?? { paramsJson: "{}", loading: false };
    let parsed: unknown = {};
    try {
      parsed = cur.paramsJson.trim() ? JSON.parse(cur.paramsJson) : {};
    } catch {
      toast.error("Params must be valid JSON");
      return;
    }
    updateState(name, { loading: true, result: undefined });
    try {
      const result = await invokeTool(name, parsed as Record<string, unknown>);
      updateState(name, { loading: false, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateState(name, { loading: false, result: { ok: false, durationMs: 0, error: message } });
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <Wrench className="w-8 h-8 text-primary" />
            Agent Tools
          </h1>
          <p className="text-muted-foreground">
            Capabilities Jarvis can call mid-run, or that you can invoke manually here. Jarvis sees this list every time he plans.
          </p>
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {(tools ?? []).map((t) => {
              const cur = state[t.name] ?? { paramsJson: "{}", loading: false };
              return (
                <Card key={t.name}>
                  <CardHeader>
                    <CardTitle className="font-mono text-base">{t.name}</CardTitle>
                    <CardDescription>{t.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Params schema</summary>
                      <pre className="mt-2 overflow-x-auto rounded bg-muted/40 p-2 text-[11px]">
                        {JSON.stringify(t.paramsSchema, null, 2)}
                      </pre>
                    </details>
                    <Textarea
                      value={cur.paramsJson}
                      onChange={(e) => updateState(t.name, { paramsJson: e.target.value })}
                      placeholder='{"key": "value"}'
                      className="font-mono text-xs h-24"
                    />
                    <Button onClick={() => onInvoke(t.name)} disabled={cur.loading} size="sm" className="w-full">
                      {cur.loading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 mr-2" />
                      )}
                      Invoke
                    </Button>
                    {cur.result && (
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">
                          {cur.result.ok ? "✓ ok" : "✗ error"} · {cur.result.durationMs}ms
                        </div>
                        <pre className="overflow-x-auto rounded bg-muted/40 p-2 text-[11px] max-h-64">
                          {cur.result.ok
                            ? JSON.stringify(cur.result.result, null, 2)
                            : cur.result.error}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
