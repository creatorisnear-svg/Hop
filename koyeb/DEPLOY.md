# Deploy 6 Ollama Qwen Servers on Koyeb (free / cheap)

NeuroLinked Brain talks to **one Ollama HTTP endpoint per brain region**. You can:

| Setup | Koyeb cost | Parallelism |
|---|---|---|
| **1 service**, all 6 regions point at it | Free tier (sleeps idle) | Sequential, but free |
| **3 services**, 2 regions each | ~$10–15/mo | Mostly parallel |
| **6 services**, one per region | Free × 6 if you have 6 free slots, or ~$30/mo | Fully parallel |

You said you have 3 free Koyeb services and can grab 3 more. **Go for 6 — one per region.**

---

## Quick deploy with the Koyeb CLI

1. Install: https://www.koyeb.com/docs/build-and-deploy/cli/installation
2. `koyeb login`
3. From the repo root, edit `koyeb/koyeb.yaml` once per region (change `name:` and optionally `MODEL=`).
4. `koyeb service create --file koyeb/koyeb.yaml`
5. Repeat for the other 5 regions.

After each service is healthy, copy its public URL (looks like `https://neuro-sensory-cortex-myorg.koyeb.app`) into the **Regions** page of NeuroLinked Brain.

---

## Web UI deploy (no CLI)

1. Sign in at https://app.koyeb.com
2. Click **Create Service** → **Docker** → "Build from a Git repository"
3. Select this repo, set **Dockerfile** to `koyeb/Dockerfile`
4. Build args: `MODEL=qwen2.5:1.5b-instruct` (or `qwen2.5:0.5b-instruct` on free tier)
5. Instance type: **Free** (or Eco-small if you want no cold starts)
6. Port: `8080` HTTP, route `/`
7. Health check: HTTP `GET /` on port 8080, grace period 120s
8. Env var: `OLLAMA_KEEP_ALIVE=24h`
9. Deploy. Repeat 6 times — name each service after the region it serves.

---

## Recommended model per instance class

| Instance | RAM | Best Qwen model |
|---|---|---|
| Free | 512MB | `qwen2.5:0.5b-instruct` |
| Eco-small ($5/mo) | 1GB | `qwen2.5:1.5b-instruct` |
| Eco-medium ($10/mo) | 2GB | `qwen2.5:3b-instruct` |
| Standard ($25+/mo) | 4GB+ | `qwen2.5:7b-instruct` |

The first request after a cold start will block ~30–60s while the model loads into RAM. `OLLAMA_KEEP_ALIVE=24h` keeps it warm.

---

## Suggested mapping (6 services)

| Region | Suggested model | Why |
|---|---|---|
| Sensory Cortex (researcher) | qwen2.5:1.5b | Short observations, fast turnaround |
| Association Cortex (planner) | qwen2.5:1.5b | Structured plans, tight format |
| Hippocampus (memory) | qwen2.5:0.5b | Tiny — short recall summaries |
| Prefrontal Cortex (executor) | qwen2.5:3b if budget allows | Carries the actual answer |
| Cerebellum (critic) | qwen2.5:1.5b | Yes/no plus short reasoning |
| Motor Cortex (summarizer) | qwen2.5:1.5b | Final polish |

---

## Test a region from your laptop

```bash
curl https://YOUR-SERVICE.koyeb.app/api/tags
curl -X POST https://YOUR-SERVICE.koyeb.app/api/chat \
  -H 'content-type: application/json' \
  -d '{"model":"qwen2.5:1.5b-instruct","messages":[{"role":"user","content":"hi"}],"stream":false}'
```

If both return JSON, you're good. Paste the URL into the **Regions** page in the app.

---

## Notes

- Koyeb free instances **sleep after ~10 min idle**. The first request wakes them; expect 30–90s. Upgrade to Eco for always-on.
- If a region times out, the brain logs the error and fails the run gracefully.
- Each region can use a **different Ollama URL and model** — you don't have to share servers across regions.
