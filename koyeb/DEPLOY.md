# Deploying NeuroLinked Brain on Koyeb

There are two completely separate things you can deploy on Koyeb:

1. **The web app itself** (frontend + API server) — see [Web App](#1-web-app-the-bot-itself) below.
2. **The 6 Ollama Qwen brain regions** (optional, only if you want the regions to run on your own LLM servers instead of Groq) — see [Ollama Brain Regions](#2-ollama-brain-regions-optional).

---

## 1. Web app (the bot itself)

This deploys the whole thing — Express API + React UI bundled into one container that listens on port 8080.

### Prereqs (5 minutes, all free)

| What | Where | Notes |
|---|---|---|
| Postgres database | https://neon.tech (recommended) or Koyeb Postgres | Copy the connection string. Must include `?sslmode=require` for Neon. |
| Gemini API key | https://aistudio.google.com/app/apikey | Free tier is plenty for Jarvis. |
| (optional) Groq API keys | https://console.groq.com/keys | Up to 10. The app rotates them to dodge rate limits. |
| GitHub repo | Push this project to GitHub | Koyeb pulls from Git. |

### Deploy via the Koyeb web UI

1. Sign in at https://app.koyeb.com → **Create Service** → **GitHub** → pick this repo.
2. **Builder:** Dockerfile.
3. **Dockerfile location:** `koyeb/web.Dockerfile`
4. **Instance type:** `Eco-small` (1GB) — the build needs more than 512MB, so the free tier may OOM.
5. **Region:** pick the one closest to you and your DB.
6. **Port:** `8080`, HTTP, route `/`.
7. **Health check:** HTTP `GET /api/healthz` on port 8080, grace period 60s.
8. **Environment variables / secrets:**
   - `DATABASE_URL` → your Postgres connection string (mark as Secret)
   - `GEMINI_API_KEY` → your Google AI key (mark as Secret)
   - `NODE_ENV` → `production`
   - `PORT` → `8080`
   - (optional) `GROQ_API_KEY_1` … `GROQ_API_KEY_10` → your Groq keys (each as Secret)
9. **Service name:** `neuro-brain-web`
10. Click **Deploy**.

First build takes ~5–7 minutes. When it's healthy, open the `https://neuro-brain-web-<org>.koyeb.app` URL — that's your live bot.

### Or deploy via the Koyeb CLI

```bash
# Create the secrets first
koyeb secret create DATABASE_URL --value "postgres://..."
koyeb secret create GEMINI_API_KEY --value "AIza..."

# Then create the service
koyeb service create --file koyeb/web.yaml
```

`koyeb/web.yaml` has all the config baked in.

### What the container does on first boot

1. `pnpm --filter @workspace/db run push` — creates/updates the Postgres tables.
2. Starts the bundled API server on `$PORT`.
3. Server seeds the 6 brain regions with default prompts.
4. Static SPA is served from the same port — `/api/*` goes to Express, everything else returns the React app.

### Updating

Push to GitHub. In Koyeb, click **Redeploy** on the service (or set **Auto-deploy** to on for the branch).

### Common gotchas

- **Build OOMs on free tier.** Use Eco-small.
- **`DATABASE_URL` for Neon needs `?sslmode=require`.**
- **Health check fails for the first ~30s** — that's normal, the API is bundling. The 60s grace period covers it.
- **Gemini errors at boot:** check the `GEMINI_API_KEY` secret is set and not pasted with extra whitespace.

---

## 2. Ollama brain regions (optional)

NeuroLinked Brain talks to **one Ollama HTTP endpoint per brain region**. You can:

| Setup | Koyeb cost | Parallelism |
|---|---|---|
| **1 service**, all 6 regions point at it | Free tier (sleeps idle) | Sequential, but free |
| **3 services**, 2 regions each | ~$10–15/mo | Mostly parallel |
| **6 services**, one per region | Free × 6 if you have 6 free slots, or ~$30/mo | Fully parallel |

You said you have 6 free Koyeb accounts. **Go for 6 — one per region.**

### Web UI deploy (no CLI)

1. Sign in at https://app.koyeb.com
2. **Create Service** → **Docker** → "Build from a Git repository"
3. Select this repo, set **Dockerfile** to `koyeb/Dockerfile`
4. Build args: `MODEL=qwen2.5:0.5b-instruct` (free tier) or `qwen2.5:1.5b-instruct` (Eco-small)
5. Instance type: **Free** (or Eco-small for no cold starts)
6. Port: `8080` HTTP, route `/`
7. Health check: HTTP `GET /` on port 8080, grace period 120s
8. Env var: `OLLAMA_KEEP_ALIVE=24h`
9. Deploy. Repeat 6 times — name each service after the region: `neuro-sensory-cortex`, `neuro-association-cortex`, `neuro-hippocampus`, `neuro-prefrontal-cortex`, `neuro-cerebellum`, `neuro-motor-cortex`.

### CLI deploy

```bash
koyeb service create --file koyeb/koyeb.yaml
```

(Edit `name:` and `MODEL=` for each of the 6 services.)

### Recommended model per instance class

| Instance | RAM | Best Qwen model |
|---|---|---|
| Free | 512MB | `qwen2.5:0.5b-instruct` |
| Eco-small ($5/mo) | 1GB | `qwen2.5:1.5b-instruct` |
| Eco-medium ($10/mo) | 2GB | `qwen2.5:3b-instruct` |
| Standard ($25+/mo) | 4GB+ | `qwen2.5:7b-instruct` |

First request after a cold start blocks ~30–60s while the model loads. `OLLAMA_KEEP_ALIVE=24h` keeps it warm.

### Wire the URLs into the app

After each Ollama service is healthy:

1. Test it: `curl https://YOUR-SERVICE.koyeb.app/api/tags` → should return JSON.
2. Open the deployed web app → **Regions** page.
3. For each region row, set the Ollama URL to the matching Koyeb service URL and the model to whatever you preloaded.
4. Save.

### Notes

- Koyeb free instances **sleep after ~10 min idle**. First request wakes them; expect 30–90s. Upgrade to Eco for always-on.
- If a region times out, the brain logs the error and fails the run gracefully.
- Each region can use a **different Ollama URL and model** — you don't have to share servers.
