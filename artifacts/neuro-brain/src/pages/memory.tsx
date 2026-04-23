import React, { useCallback, useEffect, useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Brain, Trash2, Plus, Search } from "lucide-react";

interface Memory {
  id: string;
  text: string;
  tags: string[];
  source: string;
  createdAt: string;
}

export default function MemoryPage() {
  const [items, setItems] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const url = query ? `/api/jarvis/memory?q=${encodeURIComponent(query)}` : "/api/jarvis/memory";
    const r = await fetch(url);
    const data = await r.json();
    setItems(data.items ?? []);
    setLoading(false);
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  const add = useCallback(async () => {
    const t = text.trim();
    if (!t) return;
    await fetch("/api/jarvis/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: t,
        tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
        source: "user",
      }),
    });
    setText(""); setTags("");
    await load();
  }, [text, tags, load]);

  const remove = useCallback(async (id: string) => {
    await fetch(`/api/jarvis/memory/${id}`, { method: "DELETE" });
    await load();
  }, [load]);

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <Brain className="w-7 h-7 text-primary" /> Jarvis Memory
          </h1>
          <p className="text-muted-foreground">Long-term notes Jarvis carries into every chat. Add facts, preferences, project context.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5" /> Add memory</CardTitle>
            <CardDescription>This will appear in Jarvis's system context on every turn.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I prefer concise answers. Default to dark mode." rows={2} />
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="optional tags, comma-separated" />
            <div className="flex justify-end">
              <Button onClick={() => void add()} disabled={!text.trim()}>Save</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Search className="w-5 h-5" /> Stored ({items.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." />
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-muted-foreground">{query ? "No matches" : "No memories yet"}</div>
            ) : (
              <div className="space-y-2">
                {items.map((m) => (
                  <div key={m.id} className="rounded-md border border-border/60 px-3 py-2 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm whitespace-pre-wrap">{m.text}</div>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">{m.source}</Badge>
                        {m.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                        <span>{new Date(m.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void remove(m.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
