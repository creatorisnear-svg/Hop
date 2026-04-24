import React from "react";
import { Layout } from "@/components/layout";
import { JarvisChat } from "@/components/jarvis-chat";
import { Bot } from "lucide-react";

export default function JarvisPage() {
  return (
    <Layout>
      <div className="max-w-5xl mx-auto w-full">
        <div className="mb-4 flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10 border border-primary/20">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Jarvis</h1>
            <p className="text-sm text-muted-foreground">
              Your always-on coordinator. Chat preserves context across messages and can launch full brain runs.
            </p>
          </div>
        </div>
        <JarvisChat embedded />
      </div>
    </Layout>
  );
}
