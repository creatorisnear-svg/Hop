import React, { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useListRegions, useUpdateRegion, usePingRegion } from "@workspace/api-client-react";
import { Region } from "@workspace/api-client-react/src/generated/api.schemas";
import { Network, Server, Settings2, Activity, Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

export default function Regions() {
  const { data: regions, isLoading } = useListRegions();

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <Network className="w-8 h-8 text-primary" />
            Neural Configuration
          </h1>
          <p className="text-muted-foreground">Manage the specialized agents, models, and system prompts that make up the brain.</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-[400px] w-full" />
            <Skeleton className="h-[400px] w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {regions?.map((region) => (
              <RegionConfigCard key={region.key} region={region} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function RegionConfigCard({ region }: { region: Region }) {
  const queryClient = useQueryClient();
  const updateRegion = useUpdateRegion();
  const pingRegion = usePingRegion();

  const [formData, setFormData] = useState({
    ollamaUrl: region.ollamaUrl,
    model: region.model,
    systemPrompt: region.systemPrompt,
    temperature: region.temperature,
    enabled: region.enabled,
  });

  // Re-sync when region prop changes (e.g. from refetch)
  useEffect(() => {
    setFormData({
      ollamaUrl: region.ollamaUrl,
      model: region.model,
      systemPrompt: region.systemPrompt,
      temperature: region.temperature,
      enabled: region.enabled,
    });
  }, [region]);

  const handleSave = () => {
    updateRegion.mutate(
      { regionKey: region.key, data: formData },
      {
        onSuccess: () => {
          toast.success(`${region.name} updated`);
          queryClient.invalidateQueries({ queryKey: ['/api/regions'] });
        },
        onError: (err: any) => toast.error(err.message || "Failed to update")
      }
    );
  };

  const handlePing = () => {
    pingRegion.mutate(
      { regionKey: region.key },
      {
        onSuccess: (res) => {
          if (res.ok) {
            toast.success(`Ping successful: ${res.latencyMs}ms`);
          } else {
            toast.error(`Ping failed: ${res.error}`);
          }
        },
        onError: (err: any) => toast.error(err.message || "Ping failed")
      }
    );
  };

  const isDirty = 
    formData.ollamaUrl !== region.ollamaUrl ||
    formData.model !== region.model ||
    formData.systemPrompt !== region.systemPrompt ||
    formData.temperature !== region.temperature ||
    formData.enabled !== region.enabled;

  return (
    <Card className={`bg-card transition-colors duration-300 ${formData.enabled ? 'border-primary/30 shadow-[0_0_15px_hsl(var(--primary)/0.05)]' : 'border-border/50 opacity-70'}`}>
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              {region.name}
              <span className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full font-mono font-normal">
                {region.role}
              </span>
            </CardTitle>
            <CardDescription className="mt-1.5">{region.description}</CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor={`enabled-${region.key}`} className="text-xs sr-only">Enabled</Label>
            <Switch 
              id={`enabled-${region.key}`}
              checked={formData.enabled}
              onCheckedChange={(val) => setFormData(prev => ({ ...prev, enabled: val }))}
              className="data-[state=checked]:bg-primary"
            />
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5 text-muted-foreground">
              <Server className="w-3 h-3" />
              Ollama Server URL
            </Label>
            <Input 
              value={formData.ollamaUrl}
              onChange={(e) => setFormData(prev => ({ ...prev, ollamaUrl: e.target.value }))}
              className="font-mono text-sm bg-background/50"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5 text-muted-foreground">
              <Settings2 className="w-3 h-3" />
              Model Tag
            </Label>
            <Input 
              value={formData.model}
              onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
              className="font-mono text-sm bg-background/50"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">System Prompt</Label>
          <Textarea 
            value={formData.systemPrompt}
            onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
            className="font-mono text-xs min-h-[120px] bg-background/50 resize-none"
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Temperature</Label>
            <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{formData.temperature}</span>
          </div>
          <Slider 
            min={0} max={2} step={0.1}
            value={[formData.temperature]}
            onValueChange={(vals) => setFormData(prev => ({ ...prev, temperature: vals[0] }))}
            className="py-2"
          />
        </div>
      </CardContent>

      <CardFooter className="bg-muted/10 border-t border-border/50 flex justify-between py-4">
        <Button 
          variant="outline" 
          size="sm"
          onClick={handlePing}
          disabled={pingRegion.isPending || !formData.enabled}
          className="bg-background/50"
        >
          {pingRegion.isPending ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Activity className="w-4 h-4 mr-2" />}
          Test Connection
        </Button>
        
        <Button 
          size="sm"
          onClick={handleSave}
          disabled={updateRegion.isPending || !isDirty}
          className={isDirty ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}
        >
          {updateRegion.isPending ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save Changes
        </Button>
      </CardFooter>
    </Card>
  );
}
