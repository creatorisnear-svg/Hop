import React, { useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useListWebhooks,
  createWebhook,
  deleteWebhook,
  updateWebhook,
  testWebhook,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Webhook, Plus, Trash2, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function WebhooksPage() {
  const { data, isLoading } = useListWebhooks();
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const allEvents = data?.events ?? [];
  const hooks = data?.webhooks ?? [];

  const toggleEvent = (e: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(e)) n.delete(e);
      else n.add(e);
      return n;
    });
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || selected.size === 0) {
      toast.error("URL and at least one event are required");
      return;
    }
    setBusy(true);
    try {
      await createWebhook({ url: url.trim(), events: Array.from(selected), secret: secret.trim() || undefined });
      toast.success("Webhook registered");
      setUrl("");
      setSecret("");
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ["/api/webhooks"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    await deleteWebhook(id);
    await qc.invalidateQueries({ queryKey: ["/api/webhooks"] });
  };
  const onToggle = async (id: string, enabled: boolean) => {
    await updateWebhook(id, { enabled });
    await qc.invalidateQueries({ queryKey: ["/api/webhooks"] });
  };
  const onTest = async (id: string) => {
    const r = await testWebhook(id);
    if (r.ok) toast.success("Test event sent");
    else toast.error(`Test failed: ${r.error ?? "unknown"}`);
    await qc.invalidateQueries({ queryKey: ["/api/webhooks"] });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <Webhook className="w-8 h-8 text-primary" />
            Webhooks
          </h1>
          <p className="text-muted-foreground">
            Receive a JSON POST whenever something happens in the brain. Each delivery includes an
            <code className="px-1 mx-1 rounded bg-muted">x-brain-event</code> header and, if you set a secret, an
            <code className="px-1 mx-1 rounded bg-muted">x-brain-signature</code> HMAC-SHA256 of the body.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" />
              New webhook
            </CardTitle>
            <CardDescription>Subscribe a URL to one or more brain events.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="url">Target URL</Label>
                <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="secret">Signing secret (optional)</Label>
                <Input id="secret" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="any string used to HMAC sign the body" />
              </div>
              <div className="space-y-2">
                <Label>Events</Label>
                <div className="flex flex-wrap gap-2">
                  {allEvents.map((e) => (
                    <button
                      type="button"
                      key={e}
                      onClick={() => toggleEvent(e)}
                      className={
                        "px-3 py-1 rounded-full text-xs border transition-colors " +
                        (selected.has(e)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-muted-foreground border-border hover:bg-muted/70")
                      }
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Register webhook
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Registered ({hooks.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : hooks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No webhooks yet.</p>
            ) : (
              hooks.map((h) => (
                <div key={h.id} className="rounded-md border border-border bg-card/40 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm break-all">{h.url}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {h.events.map((e) => (
                          <span key={e} className="px-2 py-0.5 rounded bg-muted text-[10px]">
                            {e}
                          </span>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {h.hasSecret ? "🔐 signed · " : ""}
                        {h.lastFiredAt
                          ? `last fired ${new Date(h.lastFiredAt).toLocaleString()} · status ${h.lastStatus ?? "?"}`
                          : "never fired"}
                        {h.lastError ? ` · error: ${h.lastError}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => onTest(h.id)} title="Send test event">
                        <Send className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant={h.enabled ? "default" : "outline"}
                        onClick={() => onToggle(h.id, !h.enabled)}
                      >
                        {h.enabled ? "Enabled" : "Disabled"}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => onDelete(h.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
