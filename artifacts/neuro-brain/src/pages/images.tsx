import React, { useCallback, useEffect, useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Trash2, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface ImageItem {
  id: string;
  prompt: string;
  mimeType: string;
  source: string;
  createdAt: string;
  url: string;
}

export default function ImagesPage() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/images");
      const data = await r.json();
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const generate = useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setPrompt("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [prompt, busy, load]);

  const remove = useCallback(async (id: string) => {
    if (!confirm("Delete this image?")) return;
    await fetch(`/api/images/${id}`, { method: "DELETE" });
    await load();
  }, [load]);

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Imagery</h1>
          <p className="text-muted-foreground">Generate images with Gemini's nano-banana model. Jarvis can also call this for you from chat.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> Generate</CardTitle>
            <CardDescription>Describe the image you want.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A neon-lit cyberpunk brain in a glass jar, photorealistic, 4k..."
              rows={3}
              disabled={busy}
            />
            {error && <div className="text-sm text-red-400">{error}</div>}
            <div className="flex justify-end">
              <Button onClick={() => void generate()} disabled={busy || !prompt.trim()}>
                {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</> : <>Generate</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-xl font-semibold mb-4">History</h2>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)}
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm">No images yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((img) => (
                <Card key={img.id} className="overflow-hidden">
                  <div className="aspect-square bg-muted relative">
                    <img src={img.url} alt={img.prompt} className="absolute inset-0 w-full h-full object-cover" />
                  </div>
                  <CardContent className="p-3 space-y-2">
                    <div className="text-xs line-clamp-3 text-muted-foreground">{img.prompt}</div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>{new Date(img.createdAt).toLocaleString()}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void remove(img.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
