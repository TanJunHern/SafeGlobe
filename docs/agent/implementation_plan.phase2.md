# Implementation plan: Phase 2 (Vertex AI, agents service, Pond-Guard, Ask Dilly, first deploy)

Status: **approved by the user on 12 Oct 2026.**
The Phase 1 plan is kept as `implementation_plan.phase1.md`.

## Goal and gate

Pond-Guard screens Aurora Venture live on the UAT link: each agent's progress and sourced findings show in the
drawer, and the score and route follow from the points table. Ask Dilly answers from DueDilly data.
Everything still works offline with every placeholder commented.

## Verified before planning (12 Oct 2026)

- Project `safe-globe-compliance` (number 1002923438500) is active, billing is linked, `gcloud`, `bq` and Docker work,
  Application Default Credentials are present.
- Installed ADK: Python `google-adk` 2.11.0 with `google-genai` 2.29.0, `fastapi` 0.141.1, `pydantic` 2.13.5,
  `uvicorn` 0.54.0, on Python 3.14.8. Read from the installed package:
  - `LlmAgent` (with `output_schema`, `tools`, `sub_agents`), `ParallelAgent`, `SequentialAgent`, `Runner.run_async`.
  - Built-in tools `google_search` and `url_context` exist. The package states that built-in tools cannot be used
    together with other tools, so each lives in its own sub-agent.
- `aiplatform.googleapis.com` is **not enabled yet**, so I cannot list the Gemini models. Not enabled either: Cloud
  Run, Cloud Build, Artifact Registry, Secret Manager.

## Step A. Make the app safe to put on a public link

A public link today lets anyone send `x-user-role: compliance_officer`. This comes first.

1. `DEMO_MODE` (new variable). When `true`: the persona picker and the `x-user-*` headers work, as today.
   When not `true`: only a verified Google sign-in sets the user, and the role comes from
   `COMPLIANCE_OFFICER_EMAILS`. Dev defaults to `true`; tests set it.
2. Per-IP rate limit on every endpoint that calls Gemini or the agents (`src/middleware/rateLimit.js`, in memory,
   default 20 requests per 10 minutes, friendly message), plus daily caps kept in settings
   (`POND_GUARD_DAILY_CAP`, default 30). `app.set('trust proxy', 1)` so the limit sees the real IP on Cloud Run.
3. Banner "Demo: all organisations, people and vessels are fictional", and on Cloud Run
   "Data resets when the app restarts".
4. `.env.example` rewritten in the rule 11 placeholder shape. Existing variable names are kept.

## Step B. Gemini on Vertex AI in the shared client

- `src/services/geminiClient.js`: `GEMINI_BACKEND=vertex` calls the Vertex AI `generateContent` REST endpoint with
  a token from `google-auth-library` (already a dependency), using `GOOGLE_CLOUD_PROJECT` and
  `GOOGLE_CLOUD_LOCATION`. Same fallback chain logic, same `null` on failure, same "disabled" mode.
- Structured output: a `responseSchema` option, used with the findings schema from Phase 1.
- New variables `VERTEX_GEMINI_MODEL` and `VERTEX_GEMINI_FALLBACK_MODELS`. The AI Studio chain is unchanged.
- **Models are chosen by the user** from the list the project can use (section 9, question 8). I list them after
  the Vertex AI API is enabled. I will not pin a model ID before that.

## Step C. The agents service (`agents/`, FastAPI + ADK 2.11.0)

- `agents/requirements.txt` pins the versions listed above. `agents/Dockerfile` (Python 3.14 slim image, checked
  at build), `PORT` 8080, Pydantic request and response models.
- **Pond-Guard** (`POST /pond-guard/screen`, streamed): a coordinator runs these sub-agents in a `ParallelAgent`:
  sanctions, PEP, adverse media, ownership, and vessel behaviour for vessels.
  - Sanctions and PEP agents get the app's list candidates in the request. They do not search the web.
  - The adverse media agent is the only one with `google_search` (Grounding with Google Search).
  - Each returns findings in the section 4.8 format through `output_schema`.
- **Ask Dilly** (`POST /ask`): an agent with read-only function tools (search counterparties, get a case, list
  alerts, get a risk breakdown) that call a small read-only internal API on Express. A separate sub-agent holds
  `url_context` for pasted links. It has no tool that changes data.
- Express side (`src/services/agentsClient.js`): calls the service with an ID token (service-to-service
  authentication), validates every finding with `findingSchema.js`, stores accepted and rejected ones, and scores
  with the Phase 1 scorer. The agents never return a number or a route.
- New variables: `AGENTS_SERVICE_URL`, `AGENTS_INTERNAL_TOKEN` (dev only; Cloud Run uses IAM).
- The agents service is deployed `--no-allow-unauthenticated`, scales to zero, and only `duedilly-run` may call it.

## Step D. UI

- Entity drawer: a "Screen with Pond-Guard" action, one row per agent with live status
  (waiting, reading, done, failed), then its findings with links. The "Why <score>?" panel refreshes when done.
  This replaces the older agent cards on the Screening tab.
- Ask Dilly uses the new agent, answers link to cases, and shows "Offline sample" when on the fallback.

## Step E. Fallbacks (each shown in the UI)

| Missing or failing | What the user sees |
| --- | --- |
| `AGENTS_SERVICE_URL` commented, service down, slow, or daily cap reached | The existing in-process agent framework runs, or labelled offline samples |
| Vertex AI not configured | AI Studio if a key is set, else "Gemini disabled" with offline samples |
| Google Search grounding unavailable | Adverse media check marked "Not run"; coverage and confidence drop accordingly |

## Step F. Scripts and guide (the user runs every script)

- `scripts/gcp-setup.sh`: add the `source-changed` topics, the `bigqueryconnection` and `gmail` APIs, and
  permission for `duedilly-run` to call the agents service. Fix the Scheduler job name and time to match the guide.
- `scripts/deploy.sh <uat|agents-uat>`: Cloud Run deploy with `APP_ENV`, secrets from Secret Manager,
  `--max-instances 1` for the app, `--min-instances 0`.
- `scripts/smoke.sh <url>`: health, one screening, one risk breakdown.
- `DEPLOY_GUIDE.md`: every step corrected to the real names (`DOCUMENT_STORAGE`, `jwt-secret`, OAuth client ID
  for sign-in, `--max-instances 1`), and the new variables added.
- `cloudbuild.yaml`, `firebase.json`, `DEPLOYMENT.md` and the README cloud section still deploy `safe-globe-app`
  with 10 instances and no `APP_ENV`. Decision needed (question 2 below).

## Step G. Older behaviours that break the guardrails

- `aiKycpService.js` lets Gemini return a risk number. It will send findings through the scorer instead.
- A KYC request with a "Sanctions Alert" is rejected automatically. Decision needed (question 3 below).

## Tests

Offline, Gemini disabled: `DEMO_MODE` on and off, the rate limit, the Vertex request builder, the agents client
(output parsing for each agent, a bad finding rejected, service down falls back), the read-only internal API,
and Python tests for the agents service models. Existing 167 tests keep passing.

## Risks

1. **Time.** Submission is 16 Oct, 12:00 SGT. Phase 2 is the largest phase. If it is not on UAT by the end of
   14 Oct, I will propose cutting Ask Dilly's URL context and the read-only tool API to the minimum.
2. **Python 3.14 base image and ADK on Cloud Run** are not verified until the first build. Fallback: Python 3.13
   image, with the user's approval, since rule 6 says to use the installed version.
3. **Two services, cold starts.** The agents service scales to zero, so the first screening after idle is slow.
   The drawer shows progress, and the app falls back after a timeout.
4. **Cost.** Grounding with Google Search is billed per grounded request. I will read the current price before the
   first live call and report it; the daily cap limits it either way.
5. **Model availability in `asia-southeast1`.** If the chosen model is not served there, I will say which location
   is needed and ask.

## Before any live call (section 9.1)

I will build and test all of this on fallbacks first, then ask before the first call to Vertex AI, Secret Manager
and the deployed Cloud Run services.

## Questions for the user

1. Please run this so I can list the Gemini models (it enables an API; it costs nothing by itself):
   `gcloud services enable aiplatform.googleapis.com --project safe-globe-compliance`
2. The old deploy files (`cloudbuild.yaml`, `firebase.json`, `.firebaserc`, `DEPLOYMENT.md`): delete them, or
   rewrite them to deploy `duedilly-uat` correctly? My recommendation: delete `firebase.json`, `.firebaserc` and
   `DEPLOYMENT.md` (replaced by `DEPLOY_GUIDE.md`), and rewrite `cloudbuild.yaml`.
3. Automatic rejection on a sanctions alert: change it so the request goes to the compliance queue as Escalate and
   a person rejects it? My recommendation: yes. It changes what the employee sees ("Under review", not "Rejected").
