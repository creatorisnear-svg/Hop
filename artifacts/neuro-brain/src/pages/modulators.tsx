import React, { useEffect, useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useGetModulators,
  updateModulators,
  type Modulators,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, Target, Zap, Wind, Compass } from "lucide-react";
import { toast } from "sonner";

const KNOBS: {
  key: keyof Modulators;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "focus", label: "Focus", description: "High focus → fewer steps, lower temperature, more deterministic answers.", icon: Target },
  { key: "energy", label: "Energy", description: "High energy → tolerates more steps and amplifies whatever direction the others push.", icon: Zap },
  { key: "calm", label: "Calm", description: "High calm → damps temperature; the brain avoids risky choices.", icon: Wind },
  { key: "curiosity", label: "Curiosity", description: "High curiosity → favors exploratory tools (search_memory, fetch_url) and longer plans.", icon: Compass },
];

function debounce<F extends (...args: any[]) => void>(fn: F, ms: number): F {
  let h: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<F>) => {
    if (h) clearTimeout(h);
    h = setTimeout(() => fn(...args), ms);
  }) as F;
}

export default function ModulatorsPage() {
  const { data, isLoading } = useGetModulators();
  const qc = useQueryClient();
  const [local, setLocal] = useState<Modulators | null>(null);

  useEffect(() => {
    if (data && !local) setLocal(data);
  }, [data, local]);

  const persist = React.useMemo(
    () =>
      debounce(async (next: Modulators) => {
        try {
          await updateModulators(next);
          await qc.invalidateQueries({ queryKey: ["/api/modulators"] });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
      }, 250),
    [qc],
  );

  const onChange = (key: keyof Modulators, v: number) => {
    if (!local) return;
    const next = { ...local, [key]: v };
    setLocal(next);
    persist(next);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-primary" />
            Neuromodulators
          </h1>
          <p className="text-muted-foreground">
            Global mood knobs. They reshape every region's effective temperature, the planning step cap, and Jarvis's preferences.
            Changes apply to the next run.
          </p>
        </div>

        {isLoading || !local ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {KNOBS.map(({ key, label, description, icon: Icon }) => {
              const val = local[key];
              return (
                <Card key={key}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-base">
                      <span className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-primary" />
                        {label}
                      </span>
                      <span className="font-mono text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        {Math.round(val * 100)}%
                      </span>
                    </CardTitle>
                    <CardDescription className="text-xs">{description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Slider
                      min={0}
                      max={1}
                      step={0.01}
                      value={[val]}
                      onValueChange={(vs) => onChange(key, vs[0])}
                    />
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
