# NeuroLinked Brain

An autonomous multi-agent AI orchestrator. Six "brain regions" — each a separate Ollama Qwen agent — collaborate in a perception → planning → memory → execution → critique → output loop until they converge on an answer.

## Architecture

| Layer | Tech | Path |
|---|---|---|
| Frontend | React + Vite + Tailwind + wouter + TanStack Query | `artifacts/neuro-brain` |
| API | Express + Pino + SSE | `artifacts/api-server` |
| DB | Postgres + Drizzle ORM | `lib/db` |
| API contract | OpenAPI 3 → Orval → typed React Query hooks + Zod schemas | `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` |
| Agents | 6 brain regions running on Groq (Llama 3.3 70B by default) with round-robin across 10 API keys | `artifacts/api-server/src/lib/groq.ts` |
| Coordinator | Jarvis runs on Gemini 2.5 Flash via Replit AI Integrations (rotates across 8 Gemini keys) | `artifacts/api-server/src/lib/jarvis.ts` |
| Market predictor | Gemini-powered directional forecaster grounded by Google News RSS + Yahoo Finance quotes | `artifacts/api-server/src/lib/market.ts`, `routes/market.ts`, frontend `pages/market.tsx` |

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

- Hosting: 1 Koyeb server (consolidated, was 6).
- AI keys: 8 Gemini keys + 10 Groq keys, rotated automatically on rate-limit.
- The **API Keys** page must clearly show whether each Gemini key is *READY — no rate limit reached* vs *RATE LIMIT REACHED* (distinct, color-coded states).
- Plain non-technical communication.

## Market Predictor

- Frontend page at `/market` lets the user add a watch (Yahoo-Finance ticker, e.g. `AAPL`, `BTC-USD`, `^GSPC`), pick a horizon (1d / 1w / 1m / 3m), and hit "Predict now".
- Backend pulls fresh headlines from Google News RSS + a live quote from Yahoo Finance's chart endpoint, then asks Gemini 2.5 Flash for a JSON forecast (`direction`, `confidence`, `summary`, `reasoning`).
- Predictions are stored in `market_predictions` (history per watch) and shown with the cited headlines as evidence.
- The price chart renders OHLC **candlesticks** (wicks for high/low, colored body for open→close: green up / red down). On the 1D range, live 1-second ticks fold into a "forming" 1-min bucket candle that pulses. Hovering any candle shows an OHLC + timestamp tooltip with a crosshair.
