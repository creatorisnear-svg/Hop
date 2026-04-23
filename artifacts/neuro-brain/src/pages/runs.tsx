import React from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useListRuns } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Activity, Clock, Target, Play } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Runs() {
  const { data: runs, isLoading } = useListRuns({ limit: 50 });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Memory Bank</h1>
            <p className="text-muted-foreground">Historical logs of past cognitive cycles.</p>
          </div>
          <Link href="/run/new">
            <Button className="gap-2">
              <Play className="w-4 h-4" />
              New Run
            </Button>
          </Link>
        </div>

        <Card className="bg-card border-border">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : !runs || runs.length === 0 ? (
              <div className="text-center p-12 text-muted-foreground">
                <Activity className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>No historical runs found.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {runs.map((run) => (
                  <Link key={run.id} href={`/run/${run.id}`} className="block hover:bg-muted/30 transition-colors">
                    <div className="p-4 sm:p-6 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2">
                          <Target className="w-4 h-4 text-primary" />
                          <h3 className="font-medium line-clamp-1">{run.goal}</h3>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(run.createdAt).toLocaleString()}
                          </span>
                          <span>{run.iterations} iterations</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                          run.status === 'succeeded' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                          run.status === 'failed' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                          run.status === 'running' ? 'bg-accent/10 text-accent border-accent/20 animate-pulse' :
                          'bg-muted text-muted-foreground border-border'
                        }`}>
                          {run.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
