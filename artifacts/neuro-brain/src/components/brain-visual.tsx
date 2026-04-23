import React from "react";
import { cn } from "@/lib/utils";

interface BrainVisualProps {
  activeRegion?: string;
  className?: string;
}

export function BrainVisual({ activeRegion, className }: BrainVisualProps) {
  // Abstract brain layout: 6 nodes
  const nodes = [
    { key: "prefrontal_cortex", label: "PFC", x: 20, y: 30 },
    { key: "motor_cortex", label: "MC", x: 50, y: 15 },
    { key: "sensory_cortex", label: "SC", x: 80, y: 30 },
    { key: "association_cortex", label: "AC", x: 25, y: 65 },
    { key: "hippocampus", label: "HC", x: 50, y: 50 },
    { key: "cerebellum", label: "CB", x: 75, y: 65 },
  ];

  const edges = [
    [0, 1], [1, 2], [0, 4], [2, 4], [0, 3], [2, 5], [3, 4], [4, 5], [1, 4]
  ];

  return (
    <div className={cn("relative w-48 h-48", className)}>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100">
        {/* Connections */}
        {edges.map(([i, j], idx) => {
          const n1 = nodes[i];
          const n2 = nodes[j];
          const isActive = activeRegion === n1.key || activeRegion === n2.key;
          return (
            <line
              key={idx}
              x1={n1.x}
              y1={n1.y}
              x2={n2.x}
              y2={n2.y}
              stroke="currentColor"
              strokeWidth="0.5"
              className={cn(
                "transition-all duration-500",
                isActive ? "text-accent opacity-80" : "text-primary/20"
              )}
            />
          );
        })}
      </svg>
      
      {/* Nodes */}
      {nodes.map((node) => {
        const isActive = activeRegion === node.key;
        return (
          <div
            key={node.key}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center transition-all duration-300"
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
          >
            <div
              className={cn(
                "w-3 h-3 rounded-full transition-all duration-300",
                isActive 
                  ? "bg-accent shadow-[0_0_15px_hsl(var(--accent))] scale-150 animate-pulse-fast" 
                  : "bg-primary/50 shadow-[0_0_5px_hsl(var(--primary)/0.5)]"
              )}
            />
            <span className={cn(
              "text-[10px] mt-1.5 font-mono transition-colors duration-300",
              isActive ? "text-accent font-bold" : "text-muted-foreground"
            )}>
              {node.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
