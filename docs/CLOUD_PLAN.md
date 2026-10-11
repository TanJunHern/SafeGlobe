# GEMINI.md: DueDilly cloud stack, environments and deployment

This file tells the coding agent how to move DueDilly onto the Google Cloud stack below, run it on a
**dev port (offline)** and a **UAT port (online)**, and deploy both to Cloud Run with shareable links.

Free-tier figures were checked on 11 Oct 2026. Google changes them often, so re-check before you rely on one.

> The user's answers to section 0, and the changes they made to the phases, are recorded in
> [Decisions (11 Oct 2026)](#decisions-11-oct-2026) at the end of this file. Where they differ from the
> text below, the decisions win.

---

## Rules for the agent

1. **Start with section 0.** Ask the user every question there, in one message, and wait for the answers.
   Do not write code before you have them.
2. Work **one phase at a time** (section 4). After each phase, stop, summarise (files changed, commands the user
   must run, anything skipped and why) and wait for approval.
3. **Never create, change or delete a billable Google Cloud resource yourself.** Write the `gcloud` commands into
   a script or the summary and let the user run them. Read-only commands (`gcloud ... list`, `describe`) are fine.
4. Do not rename existing identifiers, env vars, API routes, storage paths or data fields. Add new ones only.
   Existing env vars to keep: `GEMINI_MODEL`, `STORAGE`, the `DOCUMENT_AI_*` variables, and anything else in
   `.env.example`.
5. Never commit secrets. `.env.dev` and `.env.uat` are gitignored; `.env.example` lists every variable with a
   placeholder.
6. Keep the hackathon requirements working at every step: **Google AI Studio, Google ADK, Cloud Run, Antigravity.**
7. Keep the existing Gemini fallback client and the existing "Gemini disabled" test mode. Tests must keep
   running offline.
8. Do not invent data, model IDs, processor IDs or quotas. If something is unknown, ask or look it up with a
   read-only command.

---

## 0. Questions to ask the user first

1. **Project:** Use an existing Google Cloud project (which ID?) or create a new one? Is it on the Free Trial
   ($300 credit, 90 days)?
2. **Region:** Run Cloud Run, Cloud SQL, BigQuery and Pub/Sub in `asia-southeast1` (Singapore)? Agent Search and
   Document AI are offered in fewer locations (often `global`, `us` or `eu`). Is it acceptable for demo data to
   be processed outside Singapore? (All demo data is fictional.)
3. **Database:** Cloud SQL for PostgreSQL (recommended) or AlloyDB?
4. **Gemini online:** Keep the Google AI Studio API key everywhere, or use Gemini on Vertex AI for UAT and Cloud
   Run? (Recommended: AI Studio for dev, Vertex AI for UAT. Both go through the same shared client.)
5. **Events:** Which events should go through Pub/Sub? Proposed: `screening-requested`, `screening-completed`,
   `ddq-submitted`, `alert-raised` (Ripples). Add or remove any?
6. **Predictive model:** Is there labelled data (past cases with reviewer decisions)? If not, skip the predictive
   model or build a BigQuery ML baseline on demo data clearly labelled as demo?
7. **Document AI:** Which documents first: DDQ PDFs, ACRA / registry extracts, financial statements? This decides
   the processor type (Form Parser, Layout Parser or Custom Extractor).
8. **Policy documents:** Where are the policy files that Agent Search should index? How many, and what format?
9. **Link access:** Should the Cloud Run links be public (`--allow-unauthenticated`, needed for judges without a
   Google login) or restricted? Is there a demo login?
10. **Budget:** What budget alert should be set (e.g. SGD 30, 50%/90%/100% emails)?

---

## 1. Recommended stack and free options

| Service | Role in DueDilly | Free option | Watch out |
| --- | --- | --- | --- |
| **Gemini on Vertex AI** (Vertex AI is now part of *Gemini Enterprise Agent Platform*, renamed 22 Apr 2026) | Ask Dilly, AI KYCP check (Pond-Guard), DDQ guide, document auto-fill | No free tier. Paid per token from the $300 credit. | The $300 credit **cannot** pay for the Gemini API in Google AI Studio. Model IDs on Vertex differ from AI Studio aliases: list them, don't guess. |
| **Gemini API (Google AI Studio)** | Dev and offline-friendly testing; hackathon requirement | Free tier (rate-limited) | Free-tier prompts may be used to improve Google products. Use demo data only. |
| **Google ADK** | Agent orchestration for Pond-Guard and the DDQ guide | Open source, free | Hackathon requirement. Works with AI Studio or Vertex AI as the model backend. |
| **BigQuery** | Screening, decision, alert and DDQ analytics; calibration figures on the Reviews page | 1 TiB of queries + 10 GiB storage per month | Put the dataset in the same region as Cloud Run. |
| **Vertex AI predictive / classification** | Risk classifier | No free tier (credit) | Stretch goal. A BigQuery ML model is simpler and cheaper for a hackathon. Needs real labels (question 6). |
| **Document AI** | DDQ PDFs, registry extracts, financial and non-standard documents | No free tier. Per 1,000 pages: Enterprise OCR $1.50, Layout Parser $10, Form Parser $30, Custom Extractor $30 (from credit) | Failed requests (4xx/5xx) are not billed. Check processor locations. |
| **Agent Search** (formerly Vertex AI Search) | Policy and knowledge retrieval (Policy RAG) | 10,000 queries per account per month + 10 GiB storage per month | Free queries exclude Advanced Generative Answers. Standard search is $1.50 per 1,000 queries after that. |
| **Cloud Run** | App and API; `duedilly-dev` and `duedilly-uat` services | 2M requests, 180,000 vCPU-seconds, 360,000 GiB-seconds per month | The container filesystem is temporary. Anything written to `data/` is lost, so app data must move to Cloud SQL and uploads to Cloud Storage first. |
| **Cloud SQL for PostgreSQL** | Application data (counterparties, cases, DDQs, decisions) | 30-day free trial instance | After the trial it bills from the credit and runs 24/7. Delete it after the hackathon. |
| **AlloyDB** (alternative) | Same as Cloud SQL | 30-day free trial cluster: 8 vCPU basic instance, storage up to 1 TB; new AlloyDB projects only | Stops serving when the trial ends unless upgraded. Far more than DueDilly needs. |
| **Pub/Sub** | Event-driven processing (section 0, question 5) | 10 GiB of messages per month | Local dev uses the Pub/Sub emulator. |
| **Cloud Storage** | DDQ uploads, policy documents for Agent Search | 5 GB-months, only in `us-east1`, `us-west1`, `us-central1` | A bucket in `asia-southeast1` is cheap but outside the free tier. |
| **Cloud Build + Artifact Registry** | Building images for `gcloud run deploy --source` | 2,500 build-minutes/month; 0.5 GB storage/month | |
| **Secret Manager** | AI Studio key, DB password | 6 active secret versions, 10,000 access operations per month | |

**Free Trial terms:** $300 credit valid for 90 days. During the trial you **cannot request quota increases**,
so Gemini on Vertex AI may hit default rate limits. The existing fallback client must keep handling 429s.

---

## 2. Environments and ports

There are two environments. Each one runs locally on its own port and deploys to its own Cloud Run service.

| | **DEV: offline** | **UAT: online** |
| --- | --- | --- |
| Local URL | `http://localhost:8080` (hot reload). If the frontend has its own dev server, it keeps its usual port and proxies API calls to 8080. | `http://localhost:8081`, running the **same production Docker image** that Cloud Run runs |
| Needs internet | No (after Docker images are pulled once) | Yes |
| `APP_ENV` | `dev` | `uat` |
| Database | PostgreSQL 16 in Docker | Cloud SQL, database `duedilly_uat` |
| Files | Local folder (`STORAGE=local`, existing behaviour) | Cloud Storage bucket (`STORAGE=gcs`, new driver) |
| Gemini | Existing "Gemini disabled" mode, or AI Studio key when online | Gemini on Vertex AI (or AI Studio, per question 4) |
| Document AI | Existing placeholder (`documentParserService.js`) | Real processor |
| Policy retrieval | Existing local Policy RAG | Agent Search, falling back to local Policy RAG on error |
| Pub/Sub | Emulator (`PUBSUB_EMULATOR_HOST=localhost:8085`) | Real topics `uat-*` |
| Analytics | Writes to a local Postgres table | BigQuery dataset `duedilly_uat` |
| Cloud Run service | `duedilly-dev` (uses `dev-*` cloud resources) | `duedilly-uat`: **the link to share** |

Resource names per environment (`<env>` = `dev` or `uat`):
- Cloud SQL: one instance `duedilly-db` with databases `duedilly_dev` and `duedilly_uat`
- BigQuery datasets: `duedilly_dev`, `duedilly_uat`
- Pub/Sub topics: `<env>-screening-requested`, `<env>-screening-completed`, `<env>-ddq-submitted`, `<env>-alert-raised`
- Buckets: `duedilly-<env>-<project-id>`
- Shared by both: Document AI processor, Agent Search data store `duedilly-policies`, service account `duedilly-run`

---

## 3. How the shareable link works

`gcloud run deploy` builds the container with Cloud Build, stores it in Artifact Registry, and gives the service a
permanent HTTPS URL like `https://duedilly-uat-<hash>.asia-southeast1.run.app`. Each new deploy keeps the same
URL. With `--allow-unauthenticated`, anyone with the link can open it. Without it, only signed-in Google accounts
with the Cloud Run Invoker role can.

---

## 4. Phases

### Phase 0: Discovery (no edits)
Report briefly:
1. How the server starts, which framework serves the frontend, and whether it listens on `process.env.PORT`.
2. Everything written to the local filesystem (`data/`, `data/uploads/ddq/...`, JSON stores, caches).
3. The storage interface in `src/services/documentStorage.js` and its drivers.
4. The shared Gemini client: file, how it picks models and falls back, and how "Gemini disabled" works.
5. Where Google ADK is used. If it is not used yet, say so. Do not add it in this phase.
6. How Policy RAG works today and where its documents live.
7. `src/services/documentParserService.js` and the `DOCUMENT_AI_*` variables.
8. Test and build commands, and every variable in `.env.example`.

### Phase 1: Config, ports and containers
1. Add `APP_ENV` (`dev` | `uat`) and a config module that loads `.env.dev` or `.env.uat`, validates required
   variables at startup and fails with a clear message.
2. Make the server listen on `process.env.PORT`, defaulting to 8080.
3. Add a multi-stage `Dockerfile` (build, then a small runtime image) and `.dockerignore`.
4. Add `docker-compose.dev.yml` with `postgres:16` and the Pub/Sub emulator.
5. Add scripts (use the project's package manager):
   - `dev`: start compose services, then the app with hot reload on port 8080 using `.env.dev`
   - `uat`: build the production image and run it on port 8081 with `.env.uat`, mounting the user's Application
     Default Credentials read-only
   - `test`: unchanged, still offline
6. Add `GET /healthz` returning `{ env, version, gemini: "aistudio" | "vertex" | "disabled" }`. No secrets.
7. Update `.env.example` and the README with how to run both ports.

### Phase 2: Google Cloud setup script (user runs it)
Write `scripts/gcp-setup.sh`. It must be safe to run twice, print each step, and **not run by the agent**:
1. `gcloud config set project <id>` and the region from question 2.
2. Enable APIs: `run`, `cloudbuild`, `artifactregistry`, `secretmanager`, `sqladmin`, `storage`, `pubsub`,
   `bigquery`, `aiplatform`, `documentai`, `discoveryengine` (Agent Search).
3. Create service account `duedilly-run` with these roles (least privilege): `roles/aiplatform.user`,
   `roles/documentai.apiUser`, `roles/discoveryengine.user`, `roles/bigquery.dataEditor`, `roles/bigquery.jobUser`,
   `roles/pubsub.publisher`, `roles/cloudsql.client`, `roles/secretmanager.secretAccessor`, and
   `roles/storage.objectAdmin` on the two buckets only.
4. Create secrets: `gemini-api-key`, `db-password`.
5. Create the buckets, BigQuery datasets and Pub/Sub topics for `dev` and `uat` (names in section 2).
6. Print the console steps the script cannot do: budget alert (question 10), Document AI processor, Agent Search
   data store.

### Phase 3: Data out of the container
1. Add a PostgreSQL data layer behind the existing data-access functions, with migrations. Dev uses Docker
   Postgres; UAT uses Cloud SQL via the Cloud SQL connector or the `/cloudsql/<instance>` socket.
2. Add a `gcs` driver to `documentStorage.js` (`STORAGE=gcs`). Keep the 7 MB limit, the allowed file types and
   the 403 rule for other employees. Keep the local driver for dev and the Firebase stub as it is.
3. Write a one-off script that copies existing demo data from `data/` into Postgres.

### Phase 4: AI services
1. Add `GEMINI_BACKEND=aistudio | vertex` to the shared client. Vertex uses the service account (no API key),
   `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. List the Gemini model IDs available to the project, then
   propose the Vertex fallback chain to the user. Keep the existing AI Studio chain unchanged.
2. Implement Document AI in `documentParserService.js` using the existing `DOCUMENT_AI_*` variables. Keep the
   placeholder behaviour when they are not set (dev). Remove the "not connected yet" rejection only when the
   processor is configured.
3. Connect Policy RAG to Agent Search (`duedilly-policies` data store), with the local Policy RAG as the fallback.
   Use standard search only, so it stays in the free 10,000 queries.
4. Keep the ADK agents working with both backends.

### Phase 5: Events and analytics
1. Publish the events from question 5. Dev publishes to the emulator; UAT to `uat-*` topics.
2. Add push endpoints `POST /events/<event>` on the app. Verify the Pub/Sub OIDC token, make handlers idempotent
   (dedupe on message ID), and return 2xx only after the work is saved.
3. Write screenings, decisions, alerts and DDQ submissions to BigQuery in UAT (tables named after the events)
   and to a local Postgres table in dev.
4. Read the Reviews page calibration figures from BigQuery in UAT. Leave dev unchanged.

### Phase 6: Predictive model (only if the user says yes to question 6)
Train a BigQuery ML classification model on reviewer decisions, show its score as a separate "model score" with
the training date and data label, and never let it change the route by itself. If there is no real labelled
data, label everything as demo.

### Phase 7: Deploy to Cloud Run
Write `scripts/deploy.sh <dev|uat>` (the user runs it). It runs:
```
gcloud run deploy duedilly-<env> \
  --source . \
  --region <region> \
  --service-account duedilly-run@<project>.iam.gserviceaccount.com \
  --set-env-vars APP_ENV=<env>,GEMINI_BACKEND=<backend>,GOOGLE_CLOUD_PROJECT=<project>,GOOGLE_CLOUD_LOCATION=<region> \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest,DB_PASSWORD=db-password:latest \
  --add-cloudsql-instances <project>:<region>:duedilly-db \
  --min-instances 0 --max-instances 2 \
  <--allow-unauthenticated or --no-allow-unauthenticated, per question 9>
```
Then it prints the link:
```
gcloud run services describe duedilly-<env> --region <region> --format='value(status.url)'
```
Add the Pub/Sub push subscriptions for that environment after the first deploy, since they need the URL.

### Phase 8: Verify
1. `scripts/smoke.sh <url>` calls `/healthz`, runs one sample screening (Meridian Port Logistics test case) and
   checks the response. Run it against `http://localhost:8080`, `http://localhost:8081` and both Cloud Run URLs.
2. Tests and build pass offline.
3. Report: both URLs, which services each environment uses, and estimated monthly cost per service.

---

## 5. User checklist (things only the user can do)

- [ ] Activate the Google Cloud Free Trial and create or pick the project
- [ ] Set a budget alert in Billing (question 10)
- [ ] Install the gcloud CLI and Docker Desktop
- [ ] Run `gcloud auth login` and `gcloud auth application-default login`
- [ ] Get a Gemini API key from Google AI Studio
- [ ] Create the Document AI processor in the console and send the processor ID to the agent
- [ ] Upload the policy documents and create the Agent Search data store `duedilly-policies`
- [ ] Run `scripts/gcp-setup.sh`, then `scripts/deploy.sh uat`
- [ ] Open the UAT link in a private window to check what judges will see

## 6. After the hackathon

Delete these to stop charges: the Cloud SQL instance (or AlloyDB cluster), both Cloud Run services, the Agent
Search data store, the buckets, the Pub/Sub topics and subscriptions, and the BigQuery datasets if unused.

---

## Decisions (11 Oct 2026)

The user's answers to section 0. Where they change a phase above, this section wins.

1. **Project:** `safe-globe-compliance`. Billing: it will run on the **Free Trial** ($300 credit, 90 days, no quota increases).
2. **Region:** `asia-southeast1` for Cloud Run, Cloud SQL, BigQuery, Pub/Sub and Cloud Storage. Agent Search and
   Document AI may run in `global` / `us` / `eu`, because all demo data is fictional. The README must note the
   location used.
3. **Database:** Cloud SQL for PostgreSQL, but not yet. Phase 3 becomes:
   - **3a (now):** keep SQLite. Seed the demo data on every startup. Deploy with `--min-instances 1
     --max-instances 1` during demos so all users share one instance. Move only uploads to Cloud Storage
     (`STORAGE=gcs`). Show a banner: "Demo environment. Data resets when the app restarts."
   - **3b (later, only when the user approves):** Postgres behind the same data-access functions. All tests must
     pass against both SQLite and Postgres before UAT is switched.
4. **Gemini:** AI Studio for dev, Vertex AI for UAT and Cloud Run, through the shared client. AI Studio keeps
   working (hackathon requirement).
5. **Events:** the four proposed, plus `rescreen-due` for monitoring re-screens, published daily by Cloud
   Scheduler. The Scheduler job goes in the setup script.
6. **Predictive model:** skipped. No real labelled data. Phase 6 is not built.
7. **Document AI:** DDQ PDFs first (Form Parser). Registry extracts later.
8. **Policies:** the template is the whole set. Move the hard-coded policy text in
   `src/services/policyRagService.js` into one file per policy section (§2.1, §3.6, §4.1, §5.2, §5.4) under
   `policies/`, add the CDDQ template, and export them in a format Agent Search can index (PDF or HTML). Keep the
   hard-coded text as the offline fallback until Agent Search works.
9. **Link:** public (`--allow-unauthenticated`). Add a visible banner "Demo: all organisations, people and vessels
   are fictional", a per-IP rate limit on every endpoint that calls Gemini, Document AI or Agent Search (for
   example 20 requests per 10 minutes) with a friendly message, and `--max-instances 1`. Keep the persona picker.
10. **Budget:** USD 50, alerts at 50%, 90% and 100%. The setup script must remind the user that alerts do not
    stop spending.

The user installs the gcloud CLI and runs every script. The agent only writes them.

### Phase 2 as written (`scripts/gcp-setup.sh`)

- Not created yet, because the app stays on SQLite (3a): the Cloud SQL instance, the `db-password` secret and
  `roles/cloudsql.client`. The `sqladmin` API is enabled so 3b needs no second setup run.
- Added beyond the original list: a `jwt-secret` secret (the app refuses to start in uat without its own
  `JWT_SECRET`), the `cloudscheduler` API, the `<env>-rescreen-due` topics and the daily Scheduler job
  `duedilly-uat-rescreen-due`.
- `roles/secretmanager.secretAccessor` is granted per secret, not project-wide.

