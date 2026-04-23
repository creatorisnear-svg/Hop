import React from "react";
import { Link, useLocation } from "wouter";
import { Activity, Brain, Network, Play, LayoutDashboard, Settings, Zap, Wrench, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/run/new", label: "New Run", icon: Play },
    { href: "/runs", label: "Runs History", icon: Activity },
    { href: "/synapses", label: "Synapses", icon: Zap },
    { href: "/tools", label: "Tools", icon: Wrench },
    { href: "/sleep", label: "Sleep", icon: Moon },
    { href: "/regions", label: "Regions Config", icon: Settings },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Sidebar */}
      <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border bg-card flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="relative">
            <Brain className="w-8 h-8 text-primary" />
            <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-accent rounded-full animate-pulse-fast shadow-[0_0_8px_hsl(var(--accent))]"></span>
          </div>
          <span className="font-bold text-lg tracking-tight bg-gradient-to-br from-primary to-accent bg-clip-text text-transparent">
            NeuroLinked
          </span>
        </div>

        <nav className="flex-1 px-4 pb-6 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className="block">
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
                    active
                      ? "bg-primary/10 text-primary border border-primary/20 shadow-[inset_0_0_12px_hsl(var(--primary)/0.1)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className={cn("w-4 h-4", active ? "text-primary" : "opacity-70")} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
