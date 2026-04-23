import React, { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useListPlugins, reloadPlugins } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Puzzle, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function PluginsPage() {
  const { data, isLoading } = useListPlugins();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const onReload = async () => {
    setBusy(true);
    try {
      await reloadPlugins();
      await qc.invalidateQueries({ queryKey: ["/api/plugins"] });
      toast.success("Plugins reloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const plugins = data?.plugins ?? [];

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <Puzzle className="w-8 h-8 text-primary" />
            Plugins
          </h1>
          <p className="text-muted-foreground">
            Drop a <code className="px-1 mx-1 rounded bg-muted">.mjs</code> file into the plugins folder and it can
            register brand-new tools that Jarvis can call.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plugins folder</CardTitle>
            <CardDescription className="font-mono break-all">{data?.dir ?? "—"}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={onReload} disabled={busy} size="sm">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Reload plugins
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Loaded ({plugins.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : plugins.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No plugins loaded. Drop a <code>.mjs</code> file in the plugins folder and click Reload.
              </p>
            ) : (
              plugins.map((p) => (
                <div key={p.file} className="rounded-md border border-border bg-card/40 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    {p.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-destructive" />
                    )}
                    <span className="font-mono">{p.file}</span>
                  </div>
                  {p.ok ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Registered tools: {p.toolsAdded.length === 0 ? "(none)" : p.toolsAdded.map((t) => (
                        <code key={t} className="px-1 mx-0.5 rounded bg-muted">{t}</code>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-destructive">{p.error}</div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plugin format</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded bg-muted/40 p-3 text-xs">{`// plugins/my_plugin.mjs
export default function setup({ registerTool, logger }) {
  registerTool({
    name: "my_tool",
    description: "What it does in one sentence.",
    paramsSchema: { type: "object", properties: { ... } },
    async run(params) {
      // do stuff and return JSON
      return { ok: true };
    },
  });
}`}</pre>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
