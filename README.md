# proply-cma-worker

Off-Vercel browser worker for **PROPLY CMA (PH2), Source 1**. Runs **headed**
Chromium under **xvfb** and exposes one authed REST endpoint the Vercel CMA job
calls to pull real comparable deals from nadlan.gov.il.

## Why headed + xvfb
nadlan's reCAPTCHA v3 backend rejects headless browsers (spike: headless 0/3
`token-verify`, headed 5/5). The container runs a real headed Chromium against an
xvfb virtual display.

## Red lines
Headed Chromium runs **the site's own scripts** — **no token forging, no captcha
solver, no reCAPTCHA score-gaming**. Pacing between fetches, cooldown on a
failure streak, hard-stop + backoff on 403. No GovMap. No persistence of scraped
data. ToS responsibility is the owner's.

## Endpoints
- `GET /health` → `{ ok, browser: "up"|"down", queue_depth }` (public; 503 if browser down)
- `POST /comparables` — Bearer `CMA_WORKER_SECRET`

## POST /comparables
Auth: `Authorization: Bearer <CMA_WORKER_SECRET>` (401 otherwise). Serialized
(one nadlan session at a time). nadlan-native only — no GovMap, no forging.

Request:
```json
{
  "address": "דיזנגוף 100 תל אביב",
  "city": "תל אביב",
  "filters": { "rooms": 3, "sqm": 78, "street": "דיזנגוף",
               "neighborhood": "הצפון הישן", "monthsBack": 12 }
}
```

200 (resolved):
```json
{
  "comparables": [ /* near-subject, room+street+sqm, last 12mo */ ],
  "settlement_sample": [ /* room-matched buffer (band basis) */ ],
  "aggregate_band": { "price_per_sqm_estimate": 71000, "low": 62000, "high": 81000, "n": 253, "confidence": "high" },
  "meta": { "resolved": true, "settlement_id": "5000", "settlement_name": "תל אביב-יפו",
            "total_rows": 5336, "year_filter_applied": true, "window_truncated": true,
            "oldest_covered": "2026-04-20", "rooms_matched": 253, "pages_fetched": 1,
            "got_403": false, "source_url": "https://www.nadlan.gov.il/?view=settlement&id=5000&page=deals" }
}
```

200 (no city match — Vercel runs Source-2 only):
```json
{ "comparables": [], "settlement_sample": [], "aggregate_band": null, "meta": { "resolved": false, "reason": "no_city_match" } }
```

`400 { error, code: "bad_request" }`  ·  `401 { error: "unauthorized", code: "unauthorized" }`  ·  `500 { error: "internal error", code: "internal" }`

## Local dev
```bash
npm install
npx playwright install chromium   # local only; the Docker image bundles browsers
cp .env.example .env               # set CMA_WORKER_SECRET
# headed locally needs a display (xvfb on Linux, or run inside Docker):
npm run dev
curl localhost:8080/health
```

## Docker
```bash
docker build -t proply-cma-worker .
docker run -p 8080:8080 --env-file .env proply-cma-worker
curl localhost:8080/health
```

## Deploy (warm single instance — required)
Must run **one persistent instance** holding a warm browser (not a cold
serverless function), `MAX_CONCURRENCY=1`.
- **Fly.io** — `fly launch` (Dockerfile auto-detected); set `min_machines_running=1`, `auto_stop_machines=false`; `fly secrets set CMA_WORKER_SECRET=…`.
- **Railway / Render** — Docker deploy; one instance, no autoscale; set env vars in dashboard; health check path `/health`.
- **Plain droplet (Hetzner/DO)** — `docker run -d --restart=unless-stopped -p 8080:8080 --env-file .env proply-cma-worker` behind Caddy/nginx TLS.

### Worker env
| Env | Default | Purpose |
|---|---|---|
| `PORT` | 8080 | listen port |
| `CMA_WORKER_SECRET` | — | Bearer secret (required for /comparables) |
| `MAX_CONCURRENCY` | 1 | serialized queue — keep at 1 |
| `FETCH_DELAY_MS` | 2750 | gentle pacing between deal-data fetches |
| `COOLDOWN_MS` | 30000 | cooldown after a failure streak |
| `MAX_RETRIES` | 3 | retry-on-miss (SPA flakiness) |
| `MONTHS_BACK` | 12 | comparable window |
| `NADLAN_BASE_URL` | https://www.nadlan.gov.il | base URL |
| `LOG_LEVEL` | info | pino level |

### Vercel-side env (set on the Vercel project — NOT on the worker)
The CMA job in the Vercel app (`proply-platform`) calls this worker. Set these on Vercel:

| Env | Value | Purpose |
|---|---|---|
| `CMA_WORKER_URL` | https://<your-worker-host> | base URL of this service |
| `CMA_WORKER_SECRET` | (match the worker's) | Bearer auth |
| `CMA_WORKER_TIMEOUT_MS` | **100000** | client timeout. MUST be ≤ ~100s so the worker returns inside the CMA deals-phase budget (110s) in `jobs.ts`. |

## CP map
- CP1 scaffold + `/health`
- CP2 browser pool + deal-data intercept/decode
- CP3 settlement-id resolution via the static CBS table (no GovMap)
- CP4 pagination (server-side year filter) + 12-mo window + near-subject filter + pacing/retry/backoff + floor 1–40
- CP5 `POST /comparables` + Bearer auth + aggregate band
