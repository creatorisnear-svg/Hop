import React from "react";
import { Layout } from "@/components/layout";
import { BrainVisual } from "@/components/brain-visual";
import { useGetDashboardInsights, useGetRegionActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "wouter";
import { Activity, BrainCircuit, Target, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: insights, isLoading: loadingInsights } = useGetDashboardInsights();
  const { data: regionActivity, isLoading: loadingActivity } = useGetRegionActivity();

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Observatory</h1>
          <p className="text-muted-foreground">Monitor the brain's global activity and recent cognitive operations.</p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-card/50 border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Runs</CardTitle>
              <Target className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              {loadingInsights ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-2xl font-bold">{insights?.totalRuns || 0}</div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Active Now</CardTitle>
              <Activity className="w-4 h-4 text-accent" />
            </CardHeader>
            <CardContent>
              {loadingInsights ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-2xl font-bold text-accent">{insights?.runningRuns || 0}</div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Succeeded</CardTitle>
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            </CardHeader>
            <CardContent>
              {loadingInsights ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-2xl font-bold text-green-500">{insights?.succeededRuns || 0}</div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Avg Iterations</CardTitle>
              <BrainCircuit className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              {loadingInsights ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-2xl font-bold">{insights?.avgIterations ? Math.round(insights.avgIterations * 10) / 10 : 0}</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Chart / Visual */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle>Recent Cognition</CardTitle>
                <CardDescription>Latest problem-solving sessions</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingInsights ? (
                  <div className="space-y-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {insights?.recentRuns?.length ? insights.recentRuns.map((run) => (
                      <Link key={run.id} href={`/run/${run.id}`} className="block">
                        <div className="p-4 rounded-lg bg-muted/30 border border-border hover:border-primary/50 transition-colors cursor-pointer group">
                          <div className="flex items-start justify-between">
                            <div className="space-y-1 pr-4">
                              <p className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors">
                                {run.goal}
                              </p>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {new Date(run.createdAt).toLocaleDateString()}
                                </span>
                                <span>{run.iterations} iterations</span>
                              </div>
                            </div>
                            <div className="shrink-0">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium border ${
                                run.status === 'succeeded' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                run.status === 'failed' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                                run.status === 'running' ? 'bg-accent/10 text-accent border-accent/20 animate-pulse' :
                                'bg-muted text-muted-foreground border-border'
                              }`}>
                                {run.status}
                              </span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    )) : (
                      <div className="text-center p-8 text-muted-foreground">No recent runs</div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Side Panel */}
          <div className="space-y-6">
            <Card className="bg-card border-border flex flex-col items-center justify-center p-6 min-h-[300px]">
              <h3 className="text-sm font-medium text-muted-foreground mb-6 uppercase tracking-wider">Live Brain Topology</h3>
              <BrainVisual activeRegion={insights?.runningRuns && insights.runningRuns > 0 ? "prefrontal_cortex" : undefined} />
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle>Region Activity</CardTitle>
                <CardDescription>Messages processed per region</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingActivity ? (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {regionActivity?.map((act) => {
                      const maxMessages = Math.max(...regionActivity.map(a => a.messageCount));
                      const percent = maxMessages > 0 ? (act.messageCount / maxMessages) * 100 : 0;
                      return (
                        <div key={act.region} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono text-muted-foreground">{act.region}</span>
                            <span className="font-medium">{act.messageCount}</span>
                          </div>
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-primary transition-all duration-1000" 
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
