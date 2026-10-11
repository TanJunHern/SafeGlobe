# DEPLOY_GUIDE.md: getting every key, and deploying DueDilly

This guide is for you, not the agent. It shows where to get each key or ID, which line to paste it into, and what
the app does if you skip it. Claude keeps the variable names and commands in this file in sync with the code
(rule 12 in `CLAUDE.md`). **If a name here differs from `.env.example`, `.env.example` wins**: each block there
points back to its step number in this guide.

Project: `safe-globe-compliance` · Region: `asia-southeast1` (Singapore) · Environments: `dev` (offline, port 8080)
and `uat` (online, port 8081, and the Cloud Run link).

**What works today (after Phase 2):** steps 0 to 4, 11 to 14. Steps 5 to 10 belong to later phases and are marked
"Not built yet". Skip those for now; the app uses the fallback.

**To get a live link, do these in order:** 0, 1, 2, 4, 11 (first half), 12, 13, 14.

---

## How to paste a value

Placeholders in `.env.example` look like this:

```
# --- SECRET. Gemini API key from Google AI Studio. Get it: DEPLOY_GUIDE.md step 3.
# Fallback if left commented: Gemini disabled, labelled offline samples are shown.
# GEMINI_API_KEY=paste-here
```

1. Copy `.env.example` to `.env.dev` (offline testing) and to `.env.uat` (online), once.
2. In the file you are filling, delete the `#` at the start of the **last** line of the block only.
3. Replace the value after `=`. No quotes, no spaces around `=`.
4. Save, then restart the app (`npm run dev` or `npm run uat`).
5. Never commit `.env.dev` or `.env.uat`. For Cloud Run, anything marked SECRET goes into Secret Manager (step 12),
   not the file. `scripts/deploy.sh` copies the non-secret lines from `.env.uat` to Cloud Run for you.

Leaving a block commented is always safe: the app uses the fallback written in the block.

---

## Fallbacks at a glance

| Service | If you skip its step, the app… |
| --- | --- |
| Gemini (AI Studio or Vertex AI) | Uses "Gemini disabled" mode with labelled offline samples |
| ADK agents service | Pond-Guard shows the stored findings as an "Offline sample"; Ask Dilly uses its built-in answers |
| BigQuery (not built yet) | Uses local tables; forecast and anomalies show labelled samples |
| Pub/Sub, Cloud Scheduler (not built yet) | Handles events inside the app |
| Cloud Storage (not built yet) | Stores files locally; on Cloud Run they reset when the app restarts |
| Agent Search (not built yet) | Uses the built-in policy text |
| Document AI (not built yet) | Reads PDFs with Gemini directly, as today |
| Gmail API (not built yet) | Shows the "copy link" button, as today |
| Google sign-in | Shows "not set up" on the two Google options; the demo accounts work (with `DEMO_MODE=true`) |

---

## Step 0: Before you start (once)

Done on 12 Oct 2026: project created, billing account `0150AC-66D95B-EDEF5B` linked, `gcloud` and Docker working.

1. **Billing.** [console.cloud.google.com/billing](https://console.cloud.google.com/billing): project
   `safe-globe-compliance` must be linked to a billing account.
2. **Budget alert.** Billing → Budgets & alerts: create a budget of **USD 100** with alerts at 50%, 90% and 100%.
   Alerts warn you; they do not stop spending.
   **Optional spend cap.** Google Cloud has no built-in hard limit. `bash scripts/billing-cap.sh` sets up Google's
   documented workaround: when spending passes the cap (default 80, in your billing account's currency), a function
   removes billing from the project. Everything then stops, including the demo link, resources may be deleted, and
   it is not exact because billing data arrives hours late. Read the warning at the top of the script first.
   Remove the cap before judging: `gcloud functions delete stop-billing-function --region asia-southeast1`.
3. **Install** the gcloud CLI (`brew install --cask gcloud-cli`) and Docker Desktop.
4. **Sign in:**
   ```
   gcloud auth login
   gcloud auth application-default login
   gcloud config set project safe-globe-compliance
   gcloud config set run/region asia-southeast1
   gcloud auth application-default set-quota-project safe-globe-compliance
   ```

**Fallback:** without this step you can still run `dev` on port 8080, fully offline.

---

## Step 1: Turn on the Google Cloud services and create the basics

Run the setup script. It is safe to run twice; it asks before it creates anything.
```
bash scripts/gcp-setup.sh
```
It does all of this:
- turns on the APIs (Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Cloud Storage, Pub/Sub,
  Cloud Scheduler, BigQuery, BigQuery connections, Vertex AI, Document AI, Agent Search, Gmail, Cloud SQL admin);
- creates the service account `duedilly-run` and its roles (step 2);
- creates the secrets `gemini-api-key`, `jwt-secret` and `agents-internal-token` (step 12). It asks you to paste the
  AI Studio key (press Enter to skip) and generates the other two;
- creates the buckets `duedilly-dev-safe-globe-compliance` and `duedilly-uat-safe-globe-compliance`, the BigQuery
  datasets `duedilly_dev` and `duedilly_uat`, and the Pub/Sub topics `<env>-screening-requested`,
  `<env>-screening-completed`, `<env>-ddq-submitted`, `<env>-alert-raised`, `<env>-rescreen-due`,
  `<env>-source-changed` for `dev` and `uat`;
- creates the Cloud Scheduler job `duedilly-uat-rescreen-due` (daily at 06:00 Singapore time).

It does **not** create: the BigQuery connection (step 6), the Document AI processor (step 9), the Agent Search data
store (step 8), or the budget alert (step 0).

Cost: the buckets, datasets, topics and the scheduler job cost cents or nothing while idle.

---

## Step 2: The service account Cloud Run runs as

The setup script creates `duedilly-run@safe-globe-compliance.iam.gserviceaccount.com` with only these roles:
Vertex AI user, Document AI API user, Agent Search (Discovery Engine) user, BigQuery data editor and job user,
Pub/Sub publisher, object admin on DueDilly's two buckets, and read access to DueDilly's three secrets.
`scripts/deploy.sh agents-uat` also lets it call the agents service.

**Nothing to paste.** On Cloud Run, Vertex AI and the rest use this account automatically, with no key.

---

## Step 3: Gemini API key (Google AI Studio)

Used for `dev`, prompt testing, and as the AI Studio path the hackathon requires.

1. Go to [aistudio.google.com](https://aistudio.google.com) and sign in.
2. **Get API key** → **Create API key** → choose project `safe-globe-compliance`.
3. Paste it into `.env.dev`:
   ```
   GEMINI_BACKEND=aistudio
   GEMINI_API_KEY=your-key
   ```
4. For Cloud Run, it goes in Secret Manager instead (step 12, secret `gemini-api-key`). Only needed there if
   `.env.uat` says `GEMINI_BACKEND=aistudio`.
5. Optional but wise: Cloud console → APIs & Services → Credentials → restrict the key to the
   **Generative Language API**.

The free tier may use your prompts to improve Google products. Use fictional demo data only.

**Fallback:** Gemini disabled mode, with labelled offline samples.

---

## Step 4: Gemini on Vertex AI (no key needed)

Vertex AI is now part of Gemini Enterprise Agent Platform. It uses your sign-in (step 0) on your computer and the
service account (step 2) on Cloud Run, so there is no key to copy.

**Pick the models.** Claude lists the Gemini models the project can use and you choose. To list them yourself:
```
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: safe-globe-compliance" \
  "https://aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=300" | grep '"name"' | grep gemini
```
On 12 Oct 2026 the `global` location listed many Gemini models, and `asia-southeast1` listed only
`gemini-2.5-flash`. So the location below is usually `global`. All demo data is fictional, so processing outside
Singapore was approved (`docs/CLOUD_PLAN.md`, decision 2).

Paste into `.env.uat`:
```
GEMINI_BACKEND=vertex
GOOGLE_CLOUD_PROJECT=safe-globe-compliance
GOOGLE_CLOUD_LOCATION=global
VERTEX_GEMINI_MODEL=<the model you chose>
VERTEX_GEMINI_FALLBACK_MODELS=<one or two more, comma separated>
AGENTS_MODEL=<the model the ADK agents use>
GOOGLE_GENAI_USE_VERTEXAI=TRUE
```
- `VERTEX_GEMINI_MODEL` and its fallbacks are used by the app (document auto-fill, DDQ guide, copilot).
- `AGENTS_MODEL` is used by the ADK agents (Pond-Guard, Ask Dilly). It must support Grounding with Google Search.
- `GOOGLE_GENAI_USE_VERTEXAI=TRUE` only matters when you run the agents on your computer (`npm run agents`);
  `scripts/deploy.sh agents-uat` sets it on Cloud Run for you.

Vertex AI is paid per token from your credit. Grounding with Google Search is billed per grounded request on top;
`POND_GUARD_DAILY_CAP` (default 30 a day) limits how many live screenings can run.

**Fallback:** `GEMINI_BACKEND=aistudio` (step 3), or Gemini disabled.

---

## Step 5: Cloud Storage bucket (uploads, page snapshots, policy files)

**Not built yet (Phase 3).** The setup script already creates the bucket. Keep `DOCUMENT_STORAGE=local` (the
default) for now; the Cloud Storage driver and its variables are added in Phase 3 and this step will be updated.

**Fallback (today's behaviour):** files are stored on the instance. On Cloud Run they are lost when the app
restarts, and a banner says so.

---

## Step 6: BigQuery (forecast, anomalies, name matching, calibration)

**Not built yet (Phase 4).** The setup script already creates the datasets. The connection that lets BigQuery call
Vertex AI, and the variables, are added in Phase 4 and this step will be updated.

**Fallback:** local tables, and labelled sample results.

---

## Step 7: Pub/Sub topics and the daily schedule

**Not built yet (Phase 3).** The setup script already creates the topics and the job `duedilly-uat-rescreen-due`.
Nothing listens to them until Phase 3 adds the push subscriptions and the variables.

**Fallback:** events are handled inside the app.

---

## Step 8: Agent Search for policies (formerly Vertex AI Search)

**Not built yet (Phase 3).** You do not need Firebase for this. In Phase 3 Claude prepares the policy files and
walks you through creating the data store `duedilly-policies` in the Cloud console; this step will then list the
exact clicks and variable names.

**Fallback:** the built-in policy text.

---

## Step 9: Document AI (Duck-Scanner)

**Not built yet (Phase 5).** In Phase 5 Claude walks you through creating the Form Parser processor. The variables
already exist and stay commented until then: `DOCUMENT_AI_PROJECT_ID`, `DOCUMENT_AI_LOCATION`,
`DOCUMENT_AI_PROCESSOR_ID`. Do not fill them in yet: with them set, PDF template uploads are refused with
"integration is not implemented yet".

**Fallback:** upload templates as `.md`; Gemini reads returned PDFs directly.

---

## Step 10: Gmail API (automatic DDQ emails)

**Not built yet (Phase 5).** DDQ emails will be sent from `whitehathud@gmail.com`. In Phase 5 this step will list the
OAuth steps and the variables.

**Fallback:** the "copy link" button, as today.

---

## Step 11: Signing in, accounts and workspaces

The login page has three options. Each person has an **account** with one of two roles, **Compliance officer** or
**Employee**, in one **workspace**. The role is checked on the server for every request.

**1. Try a demo account (recommended for the demo link).** Paste into `.env.uat`:
```
DEMO_MODE=true
```
Judges can then choose "Grace Teo · Compliance officer" or "John Doe · Employee" with one click and no Google
account. Both are in the Demo workspace with the fictional demo data. In demo mode anyone with the link can use
either demo account, so use it only with demo data. The demo compliance officer can open Settings, invite people
and change roles; "Delete account" is switched off there. Demo account changes reset every time the app starts.

**2. Sign in with Google** and **3. Create an account** both need a Google OAuth client ID (not Firebase
Authentication).
1. Cloud console → **APIs & Services** → **OAuth consent screen**: choose **External**, name the app DueDilly, add
   your email, and add your testers under **Test users**.
2. **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
3. Under **Authorised JavaScript origins** add `http://localhost:8080`, `http://localhost:8081` and, after the
   first deploy, your Cloud Run link.
4. Paste into `.env.uat`:
   ```
   GOOGLE_CLIENT_ID=<the client ID>.apps.googleusercontent.com
   ```
   Keep `DEMO_MODE=true` as well if you want the demo accounts next to Google sign-in.

How it then works:
- **Create an account**: Google sign-in, then a short form (name, organisation name). This makes a new, empty
  workspace, and that person is its compliance officer. It never gives access to the Demo workspace or to anyone
  else's workspace. One email belongs to one workspace.
- **Invite an employee**: the compliance officer opens **Settings**, enters the person's email, and sends them the
  invite link (the "Copy invite link" button; automatic email arrives with step 10, the Gmail API). The invitation
  is accepted when that person uses **Sign in with Google** with the same email.
- Someone who signs in with Google and has no account or invitation is told to ask their compliance officer or
  create their own workspace. No account is created for them.
- `COMPLIANCE_OFFICER_EMAILS` is **no longer used**. Compliance officers are made in the app: the person who
  creates the workspace, and anyone they promote in Settings. A workspace always keeps at least one.

With `DEMO_MODE=false` the demo accounts are hidden and the `x-user-*` headers are ignored: only a verified Google
sign-in says who the user is. In `uat` the app refuses to start with neither `DEMO_MODE=true` nor `GOOGLE_CLIENT_ID`.

**Where accounts are kept.** Accounts are in `data/safe_globe.accounts.db`, and each created workspace has its own
database in `data/safe_globe.workspaces/` (both follow `DATABASE_PATH`). On Cloud Run these files are on the
container's disk: **accounts, invitations and created workspaces are lost when the app restarts or is redeployed**,
like the demo data. The login page and the banner say so. Keeping them needs a hosted database, which is not built.

Optional: `GOOGLE_MAPS_API_KEY` (a browser key for the Maps JavaScript and Places APIs). Without it the address
field uses a built-in Singapore landmark picker.

---

## Step 12: Secrets in Secret Manager (for Cloud Run)

`scripts/gcp-setup.sh` creates these three and lets the `duedilly-run` service account read them:

| Secret | What it is | Who fills it |
| --- | --- | --- |
| `jwt-secret` | Signs the one-time DDQ links | Generated by the setup script |
| `agents-internal-token` | Shared by the app and the agents service | Generated by the setup script |
| `gemini-api-key` | AI Studio key (step 3). Only needed when `GEMINI_BACKEND=aistudio` | You paste it when the setup script asks |

`scripts/deploy.sh` wires them in as `JWT_SECRET`, `AGENTS_INTERNAL_TOKEN` and `GEMINI_API_KEY`.

To set or change one by hand (macOS / Linux):
```
printf '%s' 'PASTE_THE_VALUE' | gcloud secrets versions add gemini-api-key --data-file=-
```

**For port 8081 on your computer** (`npm run uat`) the same three values go in `.env.uat`, because the container on
your computer cannot read Secret Manager on its own. Any long random text works:
```
JWT_SECRET=<long random text>
AGENTS_INTERNAL_TOKEN=<long random text, the same one the agents use>
```

---

## Step 13: Deploy to Cloud Run

1. Run the tests offline: `npm test` and `npm run test:agents`.
2. Optional, on your computer first:
   - `npm run agents` starts the agents on `http://localhost:8090` (settings from `.env.dev`; use
     `APP_ENV=uat npm run agents` for `.env.uat`).
   - `npm run dev` with `AGENTS_SERVICE_URL=http://localhost:8090` and `AGENTS_INTERNAL_TOKEN` set in `.env.dev`.
   - `npm run uat` builds the production image and runs it on `http://localhost:8081`. From inside that container
     the agents on your computer are at `AGENTS_SERVICE_URL=http://host.docker.internal:8090`.
3. Deploy, in this order (each one prints what to do next):
   ```
   bash scripts/deploy.sh uat           # the app, public link
   bash scripts/deploy.sh agents-uat    # the ADK agents, private
   bash scripts/deploy.sh uat           # again, so the app learns the agents' address
   ```
   The first run asks to create an Artifact Registry repository called `cloud-run-source-deploy`: answer yes.
   The link looks like `https://duedilly-uat-xxxx.asia-southeast1.run.app` and stays the same on every redeploy.
4. To see the links again:
   ```
   gcloud run services describe duedilly-uat --region asia-southeast1 --format='value(status.url)'
   gcloud run services describe duedilly-agents-uat --region asia-southeast1 --format='value(status.url)'
   ```

What the script sets, so you do not have to:
- the app: `APP_ENV=uat`, one instance at most (`--max-instances 1`, because the data is in SQLite on the
  instance), public access, the secrets from step 12, `AGENTS_SERVICE_URL`, and the non-secret lines of `.env.uat`;
- the agents: no public access, only `duedilly-run` may call it, scales to zero, `GOOGLE_GENAI_USE_VERTEXAI=TRUE`,
  `AGENTS_MODEL`, and `DUEDILLY_INTERNAL_URL` (the app's link, for Ask Dilly's read-only tools).

Settings you can add to `.env.uat` (all optional): `POND_GUARD_DAILY_CAP` (default 30), `AI_RATE_LIMIT_MAX`
(default 20) and `AI_RATE_LIMIT_WINDOW_MINUTES` (default 10), `WORKSPACE_NAME`, `CONFIDENCE_THRESHOLD`,
`CORS_ORIGIN`, `VESSELFINDER_LOOKUP`.

After the first deploy, `gcloud builds submit --config=cloudbuild.yaml` rebuilds and rolls out the app image only.

**If a deploy fails,** copy the last 20 lines of the error to Claude. `npm run uat` on port 8081 still runs the same
container on your computer.

---

## Step 14: After the first deploy

1. Run the smoke test: `bash scripts/smoke.sh https://duedilly-uat-xxxx.asia-southeast1.run.app`
   It should end with "All checks passed." and say `Pond-Guard: live`.
2. If you use Google sign-in, add the link to the OAuth client (step 11.3).
3. Open the link in a private window, as a judge would.
4. Open Aurora Venture and press **Screen with Pond-Guard**. Each agent should go from "Reading…" to its findings.
   If it says "Offline sample", the reason is written under it.

---

## Before the demo

- [ ] `MIN_INSTANCES=1 bash scripts/deploy.sh uat`, so the first visitor does not wait and demo data does not reset
      mid-demo
- [ ] One warm-up run of the demo story (Aurora Venture) on the live link (this also wakes the agents service)
- [ ] Budget alert set (step 0)
- [ ] All demo data is fictional, and the "Demo" label is showing

## After the demo

- [ ] `bash scripts/deploy.sh uat` (back to `MIN_INSTANCES=0`) to stop paying for an idle instance
- [ ] When the hackathon is over, delete what you no longer need: both Cloud Run services, the buckets, the
      BigQuery datasets, the Pub/Sub topics, the scheduler job, the secrets, and the Artifact Registry repository
