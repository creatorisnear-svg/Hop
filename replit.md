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
- **Ensemble forecasting**: `predictMarket()` accepts `ensemble?: number` (default 3 from the route). It runs N parallel Gemini calls at varied temperatures (0.1, 0.25, 0.4, 0.55, 0.7), majority-votes the direction (confidence-weighted), takes the median target price across agreeing runs, then applies a consensus bonus (>66% agreement → +0.05) or penalty (<50% → -0.05). Reasoning is suffixed with `[Ensemble: X/N runs agreed on DIR; consensus Y%]`.
- **Expanded indicators**: `IndicatorsResult` now includes EMA12/26, MACD line/signal/histogram (12,26,9), Bollinger middle/upper/lower/width (20, 2σ), Stochastic %K(14), ATR-proxy(14), and a composite `trendScore` (-3..+3). All surfaced in the prompt block with tagged interpretations (BULLISH MOMENTUM / BEARISH MOMENTUM / OVERBOUGHT / OVERSOLD / SQUEEZE etc.) so the model can cite them.
- **User trade tracking** — DB table `market_user_trades` (id, watchId, predictionId, symbol, action, entryPrice, targetPrice, horizon, strikeHint, expiryHint, quantity, notes, status, closePrice, closedAt, openedAt). Endpoints: `GET /api/market/trades?watchId=…`, `POST /api/market/trades` (auto-fills entryPrice from live quote), `POST /api/market/trades/:id/close` (auto-fills closePrice), `DELETE /api/market/trades/:id`. Each returned trade is enriched with `livePrice`, `pnlPct` (direction-aware), `pnlAbs`, `targetProgressPct`, `reachedTarget`.
- **"I took this trade" button + entry markers**: `PredictionCard` shows the button on BUY_CALL / BUY_PUT signals (hidden once the prediction has been marked, so users can't double-mark). The chart draws a dotted horizontal line + ▲/▼ at the entry price for each open trade, with a live `+X.YZ% / TARGET HIT` chip on the right. New `OpenTradesPanel` lives between the chart and TrackRecord, listing every open trade with entry/live/PnL/target, a colored progress bar to target, and Close / Delete buttons; closed trades collapse into a recent-history strip below.
- **Autonomy loop**: the existing `autoPredict` toggle re-runs the ensemble forecast every 60s; the live chart fetches a fresh quote every 1s; the trades list refreshes every 5s so the open-position P/L stays in sync without any user action.
- **Self-calibration via track record**: every prediction request now fetches the watch's last 20 predictions, evaluates each against the live quote (`evaluatePrediction`), and feeds them into the prompt as a `YOUR TRACK RECORD ON THIS WATCH` block — overall hit rate, per-direction breakdown, and a per-row outcome list (`3d ago: BULLISH/BUY_CALL (1w) @ conf 0.72 → CORRECT (+2.4%)`). The model adjusts its own confidence accordingly. Wired in `POST /market/watches/:id/predict`; new `pastResults?: PastPredictionRow[]` field on `PredictArgs` and `pastResultsBlock()` formatter in `lib/market.ts`.
- **Volume signals**: `CandlePoint` now carries optional `v` (Yahoo's chart volume), surfaced via two new indicators in `IndicatorsResult`: `relVolume` (today's daily volume / 20d avg — flags `MASSIVE`/`elevated`/`normal`/`low`) and `vwap` + `priceVsVwapPct` (intraday volume-weighted average price across today's 5m bars; tagged `above`/`at`/`below VWAP`). The chart's frontend ignores `v` so candle rendering is unchanged.
- **Chart "no-edge" projection suppression** (frontend, `LivePriceChart` in `pages/market.tsx`): when the new server-side gates force HOLD, the model returns `direction: NEUTRAL` and the server fallback sets `targetPrice ≈ currentPrice`. The chart's wave-shape projection then drew a flat wandering line that goes nowhere — users reported it as "the prediction line isn't there anymore / looks weird". Fix: a `noDirectionalEdge` check now hides the projection (and its cone, end marker, and target chip) whenever direction is NEUTRAL OR targetPrice is within 0.1% of the live price. In place of the misleading wave, an amber HOLD caption appears below the chart explaining "no forecast line drawn — the system has no directional edge on this setup right now" with a Re-run button. Directional predictions (BULLISH/BEARISH) still draw the projection even when the action was gate-forced to HOLD, because the underlying directional view is real.
- **Honest "no-edge" gates** — three structural changes to fix the "AI is never right" problem by issuing FEWER but BETTER directional calls:
  1. **SIGNAL-ALIGNMENT GATE** (in `predictMarket` post-processing): scores 5 INDEPENDENT channels (SuperTrend regime · SMA trend score · RSI14 momentum · volume/money flow combining up/down vol ratio + OBV slope · net news headline tone) as +1/0/-1 toward bullish. A directional call requires AT LEAST 3 of 5 channels to align with the predicted direction, otherwise the action is forced to HOLD. The breakdown is appended to the reasoning so users see exactly which channels supported or opposed the call (e.g. `[SIGNAL-ALIGNMENT-GATE: only 2/5 channels support BULLISH (1 oppose, 2 neutral) — forcing HOLD ...]`). When the gate passes, the breakdown still surfaces as `[SIGNAL-ALIGNMENT: 4/5 channels support BULLISH ...]` so users see the conviction.
  2. **SKILL-VETO GATE**: if there are ≥10 settled past predictions on this watch AND historical accuracy is <50%, force HOLD with `[SKILL-VETO: historical accuracy on this ticker is X/Y = Z%]`. The system honestly admits when it doesn't have edge on a ticker rather than spamming wrong calls.
  3. **Action threshold raised 0.55 → 0.62** in both the prompt rules and the server-side safety enforcement. A near-coin-flip is not a trade. The prompt's step E and the rules section now explicitly tell the model to set `direction:NEUTRAL`/`action:HOLD` when fewer than 3 channels align, instead of trying to fight the gate by inflating confidence.
- **SuperTrend regime filter** (ATR period 10, multiplier 3): textbook SuperTrend computed over daily bars in `computeIndicators` (uses true high/low/close when available, falls back to close-only synthetic ATR otherwise). New fields on `IndicatorsResult`: `superTrend` (line value), `superTrendDir` (`up`/`down`), `superTrendDistancePct`, `superTrendFlipBarsAgo`. Surfaced in the prompt's indicators block with regime-age tags (FLIPPED TODAY / fresh / confirmed / mature / stretched). Added to TASK A as the PRIMARY trend filter (UP regime → +1, fresh UP flip → +2, mirror for DOWN). Server-side **SUPERTREND-GATE** in post-processing: penalizes confidence by 0.05–0.20 when a directional call fights the regime, scaled by regime freshness (fresh flip = bigger penalty), with an extra +0.04 if the price is already ≥5% from the SuperTrend line. A fresh ≤6h catalyst halves the penalty. All gate hits append `[SUPERTREND-GATE: ...]` to reasoning. `predictMarket` now passes `dailyHighs`/`dailyLows` through `IndicatorOptions` so the textbook True Range can be computed.
- **Deep volume / money-flow analytics**: `IndicatorsResult` extended with `avgVolume20d`, `volumeTrend5v20` (5d avg ÷ 20d avg — building/drying), `upDayVolumeRatio` (Σ vol on green days ÷ Σ vol on red days, last 20d — accumulation/distribution), `obvSlope10dPct` (On-Balance-Volume % slope over last 10 sessions — money in/out), `intradayVolumePacePct` (today's cumulative intraday vol vs pro-rated 20d avg by elapsed session time — handles 24/7 crypto via 24h session detection), and a `volumeConfirmsMove` tag (`confirms`/`diverges`/`neutral` — does today's vol agree with today's price direction?). All surfaced in the prompt's indicators block with interpretive tags. The TASK section now requires the model to score VOLUME / MONEY FLOW alongside trend/momentum, and the rules section forces it to cite at least one volume metric by number. Server-side **VOLUME-CONFIRMATION GATE** (in `predictMarket` post-processing) trims confidence by up to ~0.29 when a directional call contradicts the volume picture (bullish call into distribution / OBV outflow / diverging same-day vol / drying 5v20 trend; bearish call into accumulation / OBV inflow / diverging vol). All gate hits append `[VOLUME-GATE: ...]` to reasoning so the user sees why confidence was cut.
- **Multi-source news + market context + options positioning**: `fetchHeadlines()` now merges Google News general + Google News 24h-only + Yahoo per-ticker RSS, deduped by URL/title and freshness-tagged. `fetchMarketContext()` pulls SPY+QQQ daily moves and computes the watch's relative-strength vs SPY (in pp). `fetchOptionsPositioning()` hits Yahoo's `v7/finance/options` endpoint (now properly authed with the same crumb as `quoteSummary` — without it Yahoo returned "Invalid Crumb" and silently failed) and exposes `putCallOIRatio`, `putCallVolRatio`, ATM call/put IV, and `ivSkew` (put_iv − call_iv). All three blocks are injected into the prompt and the model is required to cite them in `reasoning`.
- **Horizon validation bug fix**: `routes/market.ts` previously whitelisted only `["1d","1w","1m","3m"]`, so `1h`/`4h`/`2w` requests were silently coerced to `1w`, causing 1h scalp predictions to use the 10% weekly cap instead of 1.5%. Added a shared `ALLOWED_HORIZONS = ["1h","4h","1d","1w","2w","1m","3m"]` constant used by `/predict`, `/backtest`, and trade creation. Verified: SPY 1h now returns ~0.4% targets, well inside the 1.5% cap.
- **Yahoo crumb negative cache**: when the crumb fetch fails (commonly 429 on Replit dev IPs), `getYahooCrumb()` now sets a 5-minute cool-down so subsequent prediction calls skip the retry storm. Production (Koyeb) almost never hits this.
- **Hot-path indexes** (`lib/db/src/schema/market.ts`):
  - `market_predictions_watch_created_idx (watch_id, created_at DESC)` — serves the track-record block (last 20 predictions) and history list (last 50) from a single index walk.
  - `market_user_trades_watch_opened_idx (watch_id, opened_at DESC)` — serves the trades panel that polls every 5s.
  - `market_user_trades_status_idx (status)` — supports open-trade scans across all watches.
  - `market_watches_symbol_idx (symbol)` — supports symbol-based watch lookups.
  Applied via `pnpm --filter @workspace/db run push`.
- **Broad accuracy test** (`.local/test_broad.mjs`): runs predict against AAPL/SPY/TSLA at 1h/1d/1w each, asserting cap obeyance, direction↔action consistency, target-sign↔direction, confidence band, citation of market context + intraday tech + headlines by `[n]`, and presence of all enhanced fields. Latest run: 97/100 — all safety/accuracy invariants 100%; only one model response had an incomplete secondary-field payload (display, not safety).
- **Weekly timeframe confirmation**: a third Yahoo fetch (`1wk` × `2y`) runs in parallel; `computeIndicators` now optionally takes `weeklyCloses` and produces `weeklySma20`, `priceVsWeeklySma20Pct`, `weeklyRsi14`, plus a `weeklyTrendTag` (`weekly bull` / `weekly bear` / `weekly choppy`). Surfaced in the indicators block so the model can confirm the daily call against a higher timeframe.
- **Default ensemble bumped 3 → 5**: `predictMarket` now uses the full temperature spread (0.1, 0.25, 0.4, 0.55, 0.7) by default. Latency on a stock with no earnings is ~33s; consensus is statistically tighter, and a single-run hallucination can no longer dominate the outcome. The route still accepts `ensemble` 1..5 for callers that need to trade latency for cost.
