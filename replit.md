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
- **Q1 Earnings panel** (`GET /api/market/earnings/:symbol`, 30-min cache): pulls Yahoo `quoteSummary` (earningsHistory + calendarEvents), surfaces the latest fiscal Q1 (EPS actual vs estimate, revenue, surprise %), the next scheduled report, and the last 4 quarters. Shown only for stocks/ETFs; falls back gracefully to "unavailable" if Yahoo blocks/fails.
- **Chat with AI about the watch** (`POST /api/market/watches/:id/chat`, body `{message, history}`): Gemini 2.5 Flash, ephemeral client-side history (no DB table), refetches live quote + headlines + earnings on every reply so answers are always current. Client trims history to last 12 turns.
- **Enhanced predictions**: each forecast now also returns and stores `bullCase`, `bearCase`, `keyDrivers[]`, `nextCatalysts[]`, plus an earnings snapshot. Persisted in `market_predictions` (`bull_case`, `bear_case`, `key_drivers` jsonb, `next_catalysts` jsonb, `earnings` jsonb). Surfaced in the prediction card as colored bull/bear panels, a drivers list, and an amber "next catalysts" list.
- **Search by name** (`GET /api/market/search?q=apple`): wraps Yahoo's `/v1/finance/search` (with retry/backoff and query1↔query2 host fallback) and falls back to SEC EDGAR's `company_tickers.json` (cached 24h) plus a built-in popular crypto/forex/index list when Yahoo blocks/rate-limits. The frontend `AddWatchForm` uses a 250ms-debounced combobox with click-to-fill and a collapsible "Advanced: enter ticker manually" section.
- **Yahoo crumb auth**: `getYahooCrumb()` in `lib/market.ts` fetches a session cookie from `fc.yahoo.com` and a crumb from `query2.finance.yahoo.com/v1/test/getcrumb` (now with 3-attempt retry + query1 fallback + browser-like headers), cached 30min. Required because Yahoo's `quoteSummary` v10 endpoint started returning 401 "Invalid Crumb" without it. From dev IPs Yahoo may still 429-block all calls; the earnings panel and prompt both handle "unavailable" gracefully.
- **Calibrated prediction prompt**: the model is instructed to (A) score trend / momentum / mean-reversion / earnings / news on -2..+2 and tally, (B) pick direction from the sum, (C) compute confidence as `clamp(0.4 + 0.1·|sum| + 0.05·news_strength)`, and (D) compute `targetPrice = sign · confidence · min(20%, k·vol20d·√(days/20))` rounded to a clean tick. Reasoning must cite at least two of: trend, momentum, RSI/52w pos, earnings, news, and reference headlines by [n].
- **Mobile chart polish**: chart card price scales `text-lg sm:text-2xl`, timestamp hidden on narrow screens, range buttons (`1D 5D 1M 6M 1Y`) become `flex-1` and `h-7` on mobile so they're tap-friendly without overflowing.
