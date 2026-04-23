import React, { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useCreateRun } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Brain, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function NewRun() {
  const [goal, setGoal] = useState("");
  const [maxIterations, setMaxIterations] = useState(6);
  const [, setLocation] = useLocation();
  const createRun = useCreateRun();
  const queryClient = useQueryClient();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) {
      toast.error("Please enter a goal");
      return;
    }

    createRun.mutate(
      { data: { goal, maxIterations } },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: ['/api/runs'] });
          queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
          toast.success("Brain engaged successfully");
          setLocation(`/run/${data.id}`);
        },
        onError: (err: any) => {
          toast.error(err.message || "Failed to start run");
        }
      }
    );
  };

  return (
    <Layout>
      <div className="max-w-3xl mx-auto py-12">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-full mb-4 shadow-[0_0_20px_hsl(var(--primary)/0.2)]">
            <Brain className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-3">Initialize Cognition</h1>
          <p className="text-muted-foreground text-lg">Define a goal and let the autonomous regions collaborate to solve it.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <Card className="bg-card border-primary/20 shadow-xl shadow-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5 text-accent" />
                Objective Protocol
              </CardTitle>
              <CardDescription>What should the brain think about?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="space-y-3">
                <Label htmlFor="goal" className="text-base">Primary Goal</Label>
                <Textarea
                  id="goal"
                  placeholder="e.g., Research the implications of quantum computing on cryptography and create a summarized report..."
                  className="min-h-[150px] resize-none bg-background/50 border-border focus-visible:ring-primary text-base"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Maximum Iterations</Label>
                  <span className="font-mono text-sm text-muted-foreground bg-muted px-2 py-1 rounded-md">
                    {maxIterations} cycles
                  </span>
                </div>
                <Slider
                  min={1}
                  max={20}
                  step={1}
                  value={[maxIterations]}
                  onValueChange={(vals) => setMaxIterations(vals[0])}
                  className="py-4"
                />
                <p className="text-xs text-muted-foreground">
                  Limits the number of messages exchanged between regions to prevent infinite loops.
                </p>
              </div>
            </CardContent>
            <CardFooter className="bg-muted/20 pt-6">
              <Button 
                type="submit" 
                size="lg" 
                className="w-full relative overflow-hidden group"
                disabled={createRun.isPending || !goal.trim()}
              >
                <span className="relative z-10 flex items-center gap-2 text-primary-foreground font-semibold tracking-wide">
                  {createRun.isPending ? "Initializing..." : "Engage Brain"}
                  {createRun.isPending ? <Sparkles className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                </span>
                {!createRun.isPending && (
                  <div className="absolute inset-0 bg-white/20 translate-y-[100%] group-hover:translate-y-0 transition-transform duration-300 ease-in-out" />
                )}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </Layout>
  );
}

// Just adding Target here for icon since I forgot to import it above.
function Target(props: any) {
  return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;
}
