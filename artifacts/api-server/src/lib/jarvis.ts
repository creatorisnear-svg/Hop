import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";

const MODEL = "gemini-2.5-flash";

const REGION_KEYS = [
  "sensory_cortex",
  "association_cortex",
  "hippocampus",
  "prefrontal_cortex",
  "cerebellum",
  "motor_cortex",
] as const;

export type RegionKey = (typeof REGION_KEYS)[number];

export interface JarvisStep {
  region: RegionKey;
  instruction: string;
}

export interface JarvisPlan {
  reasoning: string;
  steps: JarvisStep[];
}

const PLAN_SYSTEM = `You are Jarvis, the central conductor of a six-region neuromorphic brain.

Your six worker regions:
- sensory_cortex: extracts the key signals from the prompt (perception)
- association_cortex: turns signals into a step-by-step plan (planning)
- hippocampus: recalls relevant prior knowledge (memory)
- prefrontal_cortex: drafts the actual answer (executor)
- cerebellum: critiques the draft and decides if it is good enough (critic)
- motor_cortex: polishes the final wording (output)

Given a user goal, decide the best ordered sequence of region calls. You may use the same region multiple times if useful (e.g. prefrontal twice for refinement). Each step must include a custom instruction telling that region exactly what to focus on for THIS goal. 4 to 8 steps is typical.

Reply ONLY with JSON of the shape:
{
  "reasoning": "one short sentence on why this plan",
  "steps": [
    { "region": "sensory_cortex", "instruction": "..." },
    ...
  ]
}`;

const SYNTH_SYSTEM = `You are Jarvis, the central conductor of a six-region neuromorphic brain.

You will receive the original user goal and the raw outputs from each brain region you orchestrated. Synthesize them into the single best final answer for the user. Be direct, useful, and well-formatted. Do not narrate the process or mention the regions — just deliver the answer.`;

function fallbackPlan(): JarvisPlan {
  return {
    reasoning: "Default sequence (Jarvis fallback).",
    steps: [
      { region: "sensory_cortex", instruction: "Extract the key signals and intent from the goal." },
      { region: "association_cortex", instruction: "Produce a clear step-by-step plan." },
      { region: "hippocampus", instruction: "Recall any relevant context that anchors the plan." },
      { region: "prefrontal_cortex", instruction: "Execute the plan and draft the answer." },
      { region: "cerebellum", instruction: "Critique the draft. Reply with VERDICT: APPROVED if good." },
      { region: "motor_cortex", instruction: "Polish the approved draft into the final answer." },
    ],
  };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object found");
  return JSON.parse(raw.slice(start, end + 1));
}

function isValidPlan(value: unknown): value is JarvisPlan {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  if (typeof p.reasoning !== "string") return false;
  if (!Array.isArray(p.steps) || p.steps.length === 0) return false;
  for (const s of p.steps) {
    if (!s || typeof s !== "object") return false;
    const step = s as Record<string, unknown>;
    if (typeof step.region !== "string") return false;
    if (!REGION_KEYS.includes(step.region as RegionKey)) return false;
    if (typeof step.instruction !== "string" || step.instruction.length === 0) return false;
  }
  return true;
}

export async function jarvisPlan(goal: string, hint?: string): Promise<JarvisPlan> {
  try {
    const userText = hint
      ? `Goal:\n${goal}\n\n${hint}`
      : `Goal:\n${goal}`;
    const resp = await ai.models.generateContent({
      model: MODEL,
      contents: [
        { role: "user", parts: [{ text: userText }] },
      ],
      config: {
        systemInstruction: PLAN_SYSTEM,
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        temperature: 0.4,
      },
    });
    const text = resp.text ?? "";
    const parsed = extractJson(text);
    if (!isValidPlan(parsed)) throw new Error("plan failed validation");
    return parsed;
  } catch (err) {
    logger.warn({ err }, "jarvisPlan failed; using fallback sequence");
    return fallbackPlan();
  }
}

export interface SynthInput {
  region: RegionKey;
  instruction: string;
  output: string;
}

export async function jarvisSynthesize(goal: string, steps: SynthInput[]): Promise<string> {
  try {
    const transcript = steps
      .map(
        (s, i) =>
          `### Step ${i + 1} — ${s.region}\nInstruction: ${s.instruction}\nOutput:\n${s.output}`,
      )
      .join("\n\n");
    const resp = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Original goal:\n${goal}\n\nRegion outputs in order:\n${transcript}\n\nProduce the final answer to the user.`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: SYNTH_SYSTEM,
        maxOutputTokens: 8192,
        temperature: 0.5,
      },
    });
    const text = (resp.text ?? "").trim();
    if (!text) throw new Error("empty synthesis");
    return text;
  } catch (err) {
    logger.warn({ err }, "jarvisSynthesize failed; falling back to last region output");
    return steps[steps.length - 1]?.output ?? "(no output)";
  }
}
