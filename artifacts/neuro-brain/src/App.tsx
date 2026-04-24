import React, { useEffect, useRef, useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import NewRun from "@/pages/new-run";
import LiveRun from "@/pages/live-run";
import Regions from "@/pages/regions";
import Runs from "@/pages/runs";
import SynapsesPage from "@/pages/synapses";
import ToolsPage from "@/pages/tools";
import SleepPage from "@/pages/sleep";
import ModulatorsPage from "@/pages/modulators";
import WebhooksPage from "@/pages/webhooks";
import PluginsPage from "@/pages/plugins";
import ImagesPage from "@/pages/images";
import MemoryPage from "@/pages/memory";
import KeysPage from "@/pages/keys";
import JarvisActionsPage from "@/pages/jarvis-actions";
import JarvisPage from "@/pages/jarvis";
import BrainTopologyPage from "@/pages/brain";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    }
  }
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/run/new" component={NewRun} />
      <Route path="/run/:id" component={LiveRun} />
      <Route path="/regions" component={Regions} />
      <Route path="/runs" component={Runs} />
      <Route path="/synapses" component={SynapsesPage} />
      <Route path="/tools" component={ToolsPage} />
      <Route path="/sleep" component={SleepPage} />
      <Route path="/modulators" component={ModulatorsPage} />
      <Route path="/webhooks" component={WebhooksPage} />
      <Route path="/plugins" component={PluginsPage} />
      <Route path="/images" component={ImagesPage} />
      <Route path="/memory" component={MemoryPage} />
      <Route path="/keys" component={KeysPage} />
      <Route path="/jarvis-actions" component={JarvisActionsPage} />
      <Route path="/jarvis" component={JarvisPage} />
      <Route path="/brain" component={BrainTopologyPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster theme="dark" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
