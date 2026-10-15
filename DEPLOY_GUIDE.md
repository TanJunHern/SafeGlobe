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
| ADK agents service | Pond-Guard shows the stored findings as an "Offline sample"; Ask Dilly uses its built-in answers; crawler agents use the built-in pattern extractor |
| BigQuery ML | Trains the review model inside the app ("Offline model") |
| Pub/Sub, Cloud Scheduler | Handles events inside the app; "Run now" in the Sources tab replaces the schedule |
| Cloud Storage | Stores page snapshots locally; on Cloud Run they reset when the app restarts |
| Agent Search | Uses the built-in policy text, labelled "Offline fallback" |
| Country risk views (`COUNTRY_RISK_FETCH`) | Colours the map from saved samples, labelled "Sample data, may be out of date"; contacts no website |
| Document AI | Gemini reads the uploaded file directly, and the result says so |
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

It does **not** create: the Document AI processor (step 9), the Agent Search data
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
AGENTS_THINKING_LEVEL=LOW
GOOGLE_GENAI_USE_VERTEXAI=TRUE
```
- `VERTEX_GEMINI_MODEL` and its fallbacks are used by the app (document auto-fill, DDQ guide, copilot).
- `AGENTS_MODEL` is used by the ADK agents (Pond-Guard, Ask Dilly). It must support Grounding with Google Search.
- `AGENTS_THINKING_LEVEL` is optional: `MINIMAL`, `LOW`, `MEDIUM` or `HIGH`. Left out, the model uses its own
  default. Measured on 12 Oct 2026 with `gemini-3.5-flash`: a Pond-Guard run took about 60 seconds on the default
  and about 20 seconds on `LOW`, with the same findings and score for Aurora Venture.
- `GOOGLE_GENAI_USE_VERTEXAI=TRUE` only matters when you run the agents on your computer (`npm run agents`);
  `scripts/deploy.sh agents-uat` sets it on Cloud Run for you.

Vertex AI is paid per token from your credit. Grounding with Google Search is billed per grounded request on top;
`POND_GUARD_DAILY_CAP` (default 30 a day) limits how many live screenings can run.

**Fallback:** `GEMINI_BACKEND=aistudio` (step 3), or Gemini disabled.

---

## Step 5: Cloud Storage bucket (page snapshots, policy files, uploads)

**What it is for today:** the snapshot a crawler agent keeps of every page it reads, and the policy files that
Agent Search indexes (step 8). DDQ uploads still stay on the instance until Phase 5.

`scripts/gcp-setup.sh` (step 1) already created the bucket `duedilly-uat-safe-globe-compliance` and gave
`duedilly-run` access to it. To use it, in `.env.uat`:
```
DOCUMENT_STORAGE=gcs
GCS_BUCKET=duedilly-uat-safe-globe-compliance
```
Check the bucket exists (read-only): `gcloud storage buckets describe gs://duedilly-uat-safe-globe-compliance --format='value(name,location)'`

Snapshots are saved under `snapshots/<workspace>/<source>/<time>.html`. A page is at most 2 MB, so a daily read of
a few sites costs well under a cent a month.

**Fallback:** with `DOCUMENT_STORAGE=local` (the default), or if a Cloud Storage call fails, snapshots are kept in
a folder next to the database. On Cloud Run they are lost when the app restarts. The Sources tab shows which is in
use ("Snapshots: Cloud Storage" or "local folder (offline fallback)").

---

## Step 6: BigQuery ML (the review model)

**What it does:** trains the review model on the cases compliance officers marked red or green. With BigQuery ML
connected, pressing **Train the model** in Reviews > Dilly learns uploads the labelled reviews to the table
`review_labels`, trains the model `review_risk_model` (`BOOSTED_TREE_CLASSIFIER`, with hyperparameter tuning) and
reads its predictions with `ML.EXPLAIN_PREDICT`. Training takes a few minutes; the page checks by itself.

`scripts/gcp-setup.sh` (step 1) already created the dataset `duedilly_uat` in `asia-southeast1` and gave
`duedilly-run` the roles it needs (`bigquery.dataEditor`, `bigquery.jobUser`). Nothing else has to be created by
hand: the table and the model are created inside that dataset when an officer presses Train.

1. In `.env.uat`:
   ```
   BIGQUERY=bigquery
   ```
   (`BIGQUERY_DATASET` defaults to `duedilly_uat` and `BIGQUERY_LOCATION` to `asia-southeast1`.)
2. Redeploy: `bash scripts/deploy.sh uat`
3. On the link: Reviews > **Dilly learns** > **Add synthetic demo data** > **Train the model**. The card says
   "Training on BigQuery ML…", then shows the tuning trials and the results.
4. Check what was created (read-only): `bq ls --models duedilly_uat` and `bq show duedilly_uat.review_labels`

Cost: the labelled reviews are well under 1 MB. BigQuery's first 1 TiB of query data a month is free. Model
training is billed by BigQuery ML; **the price of a boosted-tree training run with tuning was not confirmed from
the pricing page** (https://cloud.google.com/bigquery/pricing#bqml), so check it before you train often. The app
limits itself to `ML_TRAIN_DAILY_CAP` runs a day (default 6) with `ML_TUNING_TRIALS` settings each (default 6),
and every ordinary query carries a limit of `BIGQUERY_MAX_BYTES_BILLED` (default 100 MB).

Not confirmed until the first live run: that boosted-tree training and tuning are available in `asia-southeast1`.
If they are not, the app says so and trains the offline model instead.

**Fallback:** with `BIGQUERY=local` (the default), or if BigQuery cannot be reached, the model is trained inside
the app ("Offline model": the same kind of model, boosted trees, on the same labelled reviews) and the screen
says so.

---

## Step 7: Pub/Sub topics and the schedules

**What it does:** the app raises six events (`screening-requested`, `screening-completed`, `ddq-submitted`,
`alert-raised`, `rescreen-due`, `source-changed`). With Pub/Sub on, each goes to the topic `uat-<event>` and comes
back to the app at `POST /events/<event>`. Cloud Scheduler publishes `rescreen-due` every day at 06:00 and calls
`POST /events/crawl-due` once a week, on Mondays at 06:30 (Singapore time), which makes every crawler agent read
its website. Once a week keeps the demo cheap: each run is one Gemini call per website source. For another
schedule, run the script with one, for example daily: `CRAWL_SCHEDULE="30 6 * * *" bash scripts/pubsub-subscriptions.sh`

`scripts/gcp-setup.sh` (step 1) already created the topics and the 06:00 job. After the first deploy (step 13):

1. Run, once:
   ```
   bash scripts/pubsub-subscriptions.sh
   ```
   It creates one push subscription per topic (`uat-<event>-push`) and the job `duedilly-uat-crawl-due`. Every
   delivery is signed as `duedilly-run` and addressed to your app's link; the app refuses anything else.
2. In `.env.uat`:
   ```
   PUBSUB_MODE=pubsub
   ```
   `PUBSUB_PUSH_AUDIENCE` (your app's link) and `PUBSUB_PUSH_SERVICE_ACCOUNT` (`duedilly-run@...`) are set on
   Cloud Run by `scripts/deploy.sh`; you only need them in a settings file to test pushes on your own computer.
3. Redeploy: `bash scripts/deploy.sh uat`
4. Check (read-only): `bash scripts/pubsub-subscriptions.sh check`
5. Try the crawl schedule without waiting for the morning:
   `gcloud scheduler jobs run duedilly-uat-crawl-due --location asia-southeast1`

Cost: Pub/Sub's first 10 GiB a month are free and these events are a few bytes each. Cloud Scheduler gives 3
free jobs per billing account; this uses 2.

**Fallback:** with `PUBSUB_MODE=inline` (the default) events are handled inside the app, and a failed publish is
handled inside the app too, so no event is lost. Without the schedule, use **Run now** in the Sources tab.
The Sources tab shows which is in use ("Events: Pub/Sub" or "handled inside the app (offline fallback)").

**Crawler agents, the rules they keep** (in code, not adjustable): they obey `robots.txt` as `DueDillyBot`; a
website is only read after someone ticks "I have checked that this site's terms allow automated reading"; a page
that needs a sign-in is never read and no cookie is ever sent; one request at a time per site, 5 seconds apart;
only public web addresses. `CRAWLER_DAILY_CAP` (default 50) and `TRIAGE_DAILY_CAP` (default 200) limit the AI
calls per day.

**Country risk views on the Globe (FATF lists, OFAC sanctions, EU sanctions).** No new job, topic or bucket: the
daily 06:00 `rescreen-due` event also checks which views are due under the refresh setting a compliance officer
chose in the Globe's Layers panel (Manual only, Daily, Weekly by default, Monthly). The app never creates or edits
a scheduler job. If the daily event does not come, opening the Globe starts the check once a view is more than
6 hours overdue.

1. In `.env.uat`:
   ```
   COUNTRY_RISK_FETCH=live
   ```
2. Redeploy: `bash scripts/deploy.sh uat`
3. In the app: Globe, Layers, **Refresh now** (compliance officer). OFAC and EU are read; FATF answers robots with
   a challenge page, which DueDilly does not get around: open the FATF page in your browser, save it as HTML, and
   use **Upload the page** under FATF lists in the same panel.

What is read: the OFAC "Sanctions Programs and Country Information" page (one Gemini call through the ADK country
risk agent, only when the page text has changed) and the EU consolidated list CSV named by the data.europa.eu
dataset record (about 25 MB, parsed in code, no Gemini). Snapshots go to the bucket of step 5 under
`snapshots/<workspace>/country-risk/`, and each view's JSON to `country-risk/<workspace>/<view_id>.json`.
`COUNTRY_RISK_DAILY_CAP` (default 20) limits the Gemini calls per day. Needs the agents service (step 13) for OFAC
and FATF; the EU view works without it.

**Fallback:** with `COUNTRY_RISK_FETCH` left commented no website is contacted and the map uses the saved samples
in `src/countryRisk/samples/`, labelled "Sample data, may be out of date". A failed check keeps the last good data
and the view says "Stale since <date>" with the reason.

---

## Step 8: Agent Search for policies (formerly Vertex AI Search)

**What it does:** answers policy searches and finds the clause each route relied on, from a data store that
indexes one file per policy clause, the CDDQ template and the demo policy PDF. You do not need Firebase.

1. Run:
   ```
   bash scripts/agent-search-setup.sh
   ```
   It builds the files in `docs/policies/` (`node scripts/build-policy-files.js`), uploads them to
   `gs://duedilly-uat-safe-globe-compliance/policies/`, creates the data store **`duedilly-policies`** in
   **`global`** (an unstructured-document search data store) and imports the files.
2. Wait a few minutes for indexing, then check (read-only):
   ```
   bash scripts/agent-search-setup.sh check
   ```
   A result should name `policy-clause-5-4.txt`. You can also see the data store in the Cloud console under
   AI Applications > Data stores.
3. In `.env.uat`:
   ```
   AGENT_SEARCH_DATA_STORE=duedilly-policies
   AGENT_SEARCH_LOCATION=global
   ```
4. Tell Claude it is ready (the section 9.1 go-ahead), then redeploy: `bash scripts/deploy.sh uat`

Cost, read on 12 Oct 2026 from the pricing page (check it again before you rely on it:
https://cloud.google.com/generative-ai-app-builder/pricing): Search Standard Edition USD 1.50 per 1,000 searches,
Enterprise Edition USD 4.00 per 1,000. The app asks for snippets only, which need no Enterprise feature. Whether a
data store searched without an app is billed at the Standard rate was not confirmed in the docs. Index storage
has a free allowance far above these eight small files. The app sends at most `AGENT_SEARCH_DAILY_CAP` searches a
day (default 200, about USD 0.30 to 0.80 a day at most) and caches clause lookups for six hours.

To change the policy text later: edit it in `src/services/policyRagService.js`, run the script again, redeploy.

**Fallback:** with `AGENT_SEARCH_DATA_STORE` commented, over the daily cap, or if the call fails, the built-in
policy text answers and the screen says "Offline fallback".

---

## Step 9: Document AI (Duck-Scanner)

**What it does:** when a supplier uploads a returned questionnaire or a company document in the DDQ portal,
Document AI (Form Parser) reads the text and the form fields with a reading confidence for each, and Gemini maps
them to the DDQ question numbers with a confidence per answer. Answers below 75% are marked "Not sure. Please
check" for the supplier. Nothing is submitted for them.

You already created the Form Parser processor `3beb45e235622652` in `us` (12 Oct), and `duedilly-run` has the
Document AI API user role. So only the settings are left. In `.env.uat`:
```
DOCUMENT_AI_PROJECT_ID=safe-globe-compliance
DOCUMENT_AI_LOCATION=us
DOCUMENT_AI_PROCESSOR_ID=3beb45e235622652
```
Then redeploy: `bash scripts/deploy.sh uat`

Check the processor (read-only):
`curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" https://us-documentai.googleapis.com/v1/projects/safe-globe-compliance/locations/us/processors/3beb45e235622652`
It should say `"type": "FORM_PARSER_PROCESSOR"` and `"state": "ENABLED"`.

Cost: Form Parser bills per page (about USD 30 per 1,000 pages when this guide was written; check
https://cloud.google.com/document-ai/pricing). A document is sent only when a supplier uploads one, never on a
schedule, and at most `DOCUMENT_AI_DAILY_CAP` documents a day (default 20). Files over 15 MB are refused.

**Fallback:** with the three lines commented, over the daily cap, or if Document AI fails, Gemini reads the file
directly and the result says so. With Gemini off as well, there is no suggestion and the supplier fills the form in.

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
   - `npm start` (no `APP_ENV`) reads **only `.env`**, so it needs its own `AGENTS_SERVICE_URL` and
     `AGENTS_INTERNAL_TOKEN` lines there. The token must equal the one the running agents service was started
     with: `npm run agents` reads `.env.dev`, `APP_ENV=uat npm run agents` reads `.env.uat`. Without both lines the
     app never calls the agents and shows the offline sample. `/health` on port 8090 shows which backend the
     agents use (`aistudio` = your API key, `vertex` = your gcloud sign-in).
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
- the app: `PUBSUB_PUSH_AUDIENCE` (the app's link) and `PUBSUB_PUSH_SERVICE_ACCOUNT` (`duedilly-run`), so pushes
  from Pub/Sub and Cloud Scheduler can be checked (step 7);
- the app: `APP_ENV=uat`, one instance at most (`--max-instances 1`, because the data is in SQLite on the
  instance), public access, the secrets from step 12, `AGENTS_SERVICE_URL`, and the non-secret lines of `.env.uat`;
- the agents: no public access, only `duedilly-run` may call it, scales to zero, `GOOGLE_GENAI_USE_VERTEXAI=TRUE`,
  `AGENTS_MODEL`, `AGENTS_THINKING_LEVEL` when it is set, and `DUEDILLY_INTERNAL_URL` (the app's link, for Ask Dilly's read-only tools).

Settings you can add to `.env.uat` (all optional): `COPILOT_DAILY_CAP` (default 100), `CRAWLER_DAILY_CAP` (default 50), `COUNTRY_RISK_DAILY_CAP` (default 20), `TRIAGE_DAILY_CAP`
(default 200), `AGENT_SEARCH_DAILY_CAP` (default 200), `POND_GUARD_DAILY_CAP` (default 30), `AI_RATE_LIMIT_MAX`
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
5. Sources > **Crawler agents** > **Add the demo page**, then **Publish a change**. Within a few seconds the bell
   shows a High ripple for Aurora Venture with "Screened again".
6. Optional, for events through Pub/Sub and the daily schedules: step 7. For policy search on Agent Search: step 8.

---

## Before the demo

- [ ] `MIN_INSTANCES=1 bash scripts/deploy.sh uat`, so the first visitor does not wait and demo data does not reset
      mid-demo
- [ ] `npm run live`: finds the live link (gcloud, else `.env.uat`), checks `/api/health` and opens it
- [ ] One warm-up run of the demo story (Aurora Venture) on the live link (this also wakes the agents service)
- [ ] Budget alert set (step 0)
- [ ] All demo data is fictional, and the "Demo" label is showing

## After the demo

- [ ] `bash scripts/deploy.sh uat` (back to `MIN_INSTANCES=0`) to stop paying for an idle instance
- [ ] When the hackathon is over, delete what you no longer need: both Cloud Run services, the buckets, the
      BigQuery datasets, the Pub/Sub topics, the scheduler job, the secrets, and the Artifact Registry repository
