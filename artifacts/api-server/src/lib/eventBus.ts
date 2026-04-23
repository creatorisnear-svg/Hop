import { EventEmitter } from "node:events";

export interface BrainEvent {
  type: "message" | "status" | "done" | "error";
  runId: string;
  payload: unknown;
}

class BrainBus extends EventEmitter {
  emitRun(runId: string, evt: BrainEvent) {
    this.emit(`run:${runId}`, evt);
  }
  onRun(runId: string, fn: (evt: BrainEvent) => void) {
    this.on(`run:${runId}`, fn);
  }
  offRun(runId: string, fn: (evt: BrainEvent) => void) {
    this.off(`run:${runId}`, fn);
  }
}

export const brainBus: BrainBus = new BrainBus();
brainBus.setMaxListeners(0);
