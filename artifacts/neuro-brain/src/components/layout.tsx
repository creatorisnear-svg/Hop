import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity, Brain, Play, LayoutDashboard, Settings, Zap, Wrench, Moon, Sparkles,
  Webhook, Puzzle, Image as ImageIcon, Key, ShieldAlert, Menu, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface LayoutProps {
  children: React.ReactNode;
}

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/run/new", label: "New Run", icon: Play },
  { href: "/runs", label: "Runs History", icon: Activity },
  { href: "/synapses", label: "Synapses", icon: Zap },
  { href: "/tools", label: "Tools", icon: Wrench },
  { href: "/sleep", label: "Sleep", icon: Moon },
  { href: "/modulators", label: "Modulators", icon: Sparkles },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/plugins", label: "Plugins", icon: Puzzle },
  { href: "/images", label: "Imagery", icon: ImageIcon },
  { href: "/memory", label: "Jarvis Memory", icon: Brain },
  { href: "/keys", label: "API Keys", icon: Key },
  { href: "/jarvis-actions", label: "Jarvis Actions", icon: ShieldAlert },
  { href: "/regions", label: "Regions Config", icon: Settings },
];

function NavList({ location, onNavigate }: { location: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 px-3 pb-6 space-y-0.5 overflow-y-auto">
      {NAV.map((item) => {
        const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href} className="block" onClick={onNavigate}>
            <div
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                active
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent",
              )}
            >
              <item.icon className={cn("w-4 h-4", active ? "text-primary" : "opacity-70")} />
              <span className="truncate">{item.label}</span>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}

function BrandHeader() {
  return (
    <div className="px-5 py-4 flex items-center gap-3">
      <div className="relative">
        <Brain className="w-7 h-7 text-primary" />
        <span className="absolute top-0 right-0 w-2 h-2 bg-accent rounded-full animate-pulse-fast shadow-[0_0_8px_hsl(var(--accent))]" />
      </div>
      <span className="font-bold text-base tracking-tight bg-gradient-to-br from-primary to-accent bg-clip-text text-transparent">
        NeuroLinked
      </span>
    </div>
  );
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [location]);

  const currentLabel = NAV.find(
    (n) => location === n.href || (n.href !== "/" && location.startsWith(n.href)),
  )?.label ?? "NeuroLinked";

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-40 flex items-center justify-between px-3 py-2.5 border-b border-border bg-background/95 backdrop-blur">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Open menu">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 bg-card flex flex-col">
            <BrandHeader />
            <NavList location={location} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm truncate max-w-[55vw]">{currentLabel}</span>
        </div>
        <div className="w-9" />{/* spacer for symmetry */}
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-60 lg:w-64 md:border-r border-border bg-card flex-col shrink-0">
        <BrandHeader />
        <NavList location={location} />
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8">
          <div className="max-w-6xl mx-auto w-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
