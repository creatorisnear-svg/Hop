# NeuroLinked Brain

An autonomous multi-agent AI orchestrator. Six "brain regions" — each a separate Ollama Qwen agent — collaborate in a perception → planning → memory → execution → critique → output loop until they converge on an answer.

## Architecture

| Layer | Tech | Path |
|---|---|---|
| Frontend | React + Vite + Tailwind + wouter + TanStack Query | `artifacts/neuro-brain` |
| API | Express + Pino + SSE | `artifacts/api-server` |
| DB | Postgres + Drizzle ORM | `lib/db` |
| API contract | OpenAPI 3 → Orval → typed React Query hooks + Zod schemas | `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` |
| Agents | 6 Ollama HTTP endpoints (Koyeb) running Qwen 2.5 | external |

### Brain regions
1. **Sensory Cortex** — researcher (extracts signals from the prompt)
2. **Association Cortex** — planner (turns signals into a step plan)
3. **Hippocampus** — memory (recalls prior runs / anchors context)
4. **Prefrontal Cortex** — executor (carries out the plan, drafts the answer)
5. **Cerebellum** — critic (judges the draft, emits `VERDICT: APPROVED` or revisions)
6. **Motor Cortex** — summarizer (final user-facing answer)

The orchestrator (`artifacts/api-server/src/lib/brain.ts`) loops Prefrontal ↔ Cerebellum until approval (max iterations) then hands off to Motor. All messages stream live to the UI via SSE (`/api/runs/:id/stream`).

## Local dev

Three workflows run automatically:
- **API Server** → `pnpm --filter @workspace/api-server run dev` (port 8080, mounted at `/api`)
- **Component Preview Server** → mockup sandbox
- **NeuroLinked Brain web** → React app at `/`

Database is provisioned (`DATABASE_URL`). Schema lives in `lib/db/src/schema/{regions,runs,messages}.ts`. Sync with `cd lib/db && pnpm exec drizzle-kit push --config ./drizzle.config.ts --force`.

Regions are seeded on API startup with default Qwen prompts (`artifacts/api-server/src/lib/regionDefaults.ts`). Edit URL / model / system prompt per region in the **Regions Config** page.

## Deploying the Ollama backends

See `koyeb/DEPLOY.md`. Includes a Dockerfile that preloads a Qwen model into the image, an example `koyeb.yaml`, and a step-by-step guide for deploying 6 services (one per region) on the Koyeb free tier.

Recommended models by instance size:
- Free 512MB → `qwen2.5:0.5b-instruct`
- Eco 1GB → `qwen2.5:1.5b-instruct` (default)
- Eco 2GB → `qwen2.5:3b-instruct`

## User preferences

- Free to run on Replit; user has 6 free Koyeb accounts and wants one server per region for full parallelism.
- Plain non-technical communication.
