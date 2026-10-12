# Decisions

Answers to the Phase 0 questions (`GEMINI.md` section 9), given by the user on 12 Oct 2026.
Earlier cloud decisions (project, region, public link, Form Parser) are in `docs/CLOUD_PLAN.md` and still stand
unless a line here changes them.

## Phase 0 answers

| # | Topic | Decision |
| --- | --- | --- |
| 0 | Phase order | Strict Phase 1 to 6 order. No separate "deploy first" phase. The deploy scripts are written in Phase 2, whose gate needs UAT. |
| 1 | Deadline | Submission is 16 Oct 2026, 12:00 Singapore time. |
| 2 | Cloud access | The user will install `gcloud` and start Docker. Google Cloud account has USD 200 of credit. On 12 Oct neither `gcloud` nor a running Docker daemon was present on this machine. |
| 3 | ADK | Python `google-adk` 2.11.0, installed as a uv tool (`~/.local/share/uv/tools/google-adk`, Python 3.14.8). Section 2.1 applies. |
| 4 | Points and confidence | Approved as defaults, **and they must be editable by the user**. After a policy or a source is uploaded (at any time), an alert appears with a recommended change; it links to the points table and formula in the Reviews tab, where the user can change both. **Build this first.** |
| 5 | "Strong name match" | No number given. Build name matching for real use, not only the demo. I measure on the lists in the app and propose a threshold; it is a setting, not a constant. Demo data stays fictional. |
| 6 | Crawler sources | The crawler reads every website the user adds in the Sources tab; assume the user has checked the terms. Each website source gets a checkbox "Run on every screening". `robots.txt` is still respected and pages behind a login are never read (section 10). |
| 7 | Synthetic data | Allowed. It is saved as a demo data set, labelled "synthetic demo data", and removed by the existing clear action (`npm run demo:clean` and its UI equivalent). |
| 8 | Authoritative lists | My choice, for the demo: the built-in sanctions lists and the built-in PEP list count as authoritative. Custom lists and websites can only produce a "possible" match unless a compliance officer marks the source authoritative. To confirm in the Phase 1 walkthrough. |
| 9 | Document AI | Not created. Guide the user through creating the Form Parser processor (`DEPLOY_GUIDE.md` step 9) in Phase 5. |
| 10 | Agent Search | Not created. Guide the user through creating the `duedilly-policies` data store on the USD 200 account (`DEPLOY_GUIDE.md` step 8) in Phase 3. The user wrote "create a firebase"; Agent Search does not need Firebase, so I read this as "teach me to create the data store". Confirmed by the user on 12 Oct. |
| 11 | `source-changed` topic | Approved. |
| 12 | Spend | Total Google Cloud spend must stay under **USD 100 by 16 Oct**. See "Spend design" below. |
| 13 | Agents service | Approved if it is not more expensive, and the public link must work for anyone without breaks. So: `duedilly-agents-uat` scales to zero, and Express falls back to in-process agents or offline samples if it is slow or down. |
| 14 | `kyc_policy.pdf` | Not available. Build a dummy version from the policy sections and the CDDQ template, labelled as a demo policy, saved as a PDF in `docs/test-docs/`. |
| 15 | Email and roles | Compliance officer: `whitehathud@gmail.com`. Employee: `hud.marcotrex@gmail.com`. DDQ counterparty test address: `thiswhitecap@gmail.com`. Before "Send DDQ to counterparty", the user sees a generated draft email and can edit it. DDQ emails are sent from `whitehathud@gmail.com` (the compliance account). |
| 16 | "Request more info" | Approved. Label changes; stored action value and route stay the same. |

## What answer 4 changes in `GEMINI.md`

- Section 4.3 still holds: one config file (`src/risk/points.config.js`) is the single definition of rows, bands and
  default numbers. The user's edits are stored as overrides in the database and merged over the defaults. The scorer,
  the "Why <score>?" panel, the Reviews editor and "How Dilly works" all read the merged result.
- Section 4.5 "implement exactly" now means "these are the defaults".
- Guardrails that are **not** editable: a confirmed sanctions match is 100 and always Escalate; the total is capped
  at 100; no source, no points; the AI never sets a number. A recommended change is only ever applied by a person.

## Spend design (answer 12)

- Cloud Run: `--min-instances 0` except during a demo; `--max-instances 1` for the app (SQLite).
- Per-IP rate limit on every AI endpoint, plus daily caps (Pond-Guard runs, Document AI pages, Agent Search queries)
  kept in settings. When a cap is reached the feature shows its offline fallback.
- Document AI Form Parser (about USD 30 per 1,000 pages) only on an explicit upload, never on a schedule.
- Budget alert at USD 100 with 50%, 90% and 100% emails. Alerts do not stop spending.

## Findings from the Phase 0 read that affect later phases

- `GEMINI_BACKEND=vertex` currently reports `disabled` (`src/services/geminiClient.js:14`). Phase 2.
- `scripts/deploy.sh`, `scripts/smoke.sh`, `scripts/pubsub-subscriptions.sh` do not exist. Phase 2 and 3.
- Auth trusts `x-user-*` headers (`src/middleware/auth.js`), `DEMO_MODE` does not exist, and there is no per-IP
  rate limit. Must be fixed before the first public deploy (Phase 2).
- `cloudbuild.yaml`, `firebase.json`, `DEPLOYMENT.md` and the README cloud section still deploy `safe-globe-app`.
- `DEPLOY_GUIDE.md` uses `STORAGE` / `GCS_BUCKET`; the code uses `DOCUMENT_STORAGE`. Rule 8: keep `DOCUMENT_STORAGE`.
- Risk numbers are produced in four places today (`kycService.calculateAiRisk`, `screening.screenCounterparty`,
  `sourceHandlers`, and literals in `safe-globe.html` / `seed-data.js`). Phase 1 replaces the first, second and
  fourth for case scores.
- Aurora Venture data does not support 85 today. See the Phase 1 plan.

## Phase 1 approvals (12 Oct 2026)

- The Phase 1 plan in `implementation_plan.md` is approved.
- Aurora Venture: a fictional, labelled demo fact may be added so that "ownership unclear" is true, and the
  "owners all match" line is removed.
- The second Aurora Venture record (`sqlite.js`, IMO 9412345, flag LBR) is changed to match the first
  (IMO 9304124, flag Cameroon).

## Phase 1 review (12 Oct 2026)

- Halcyon Marine auto-clearing and the Severny Agro classification: the user said this is a demo and left both to
  me. Both stay as built in Phase 1 (Halcyon 40, Auto-clear; Severny 60, Investigate, with the majority-owner fact
  classed as a possible sanctions match).
- Reviews page: one section at a time, switched by tabs (user request).

## Phase 2 approvals (12 Oct 2026)

- The Phase 2 plan in `implementation_plan.md` is approved.
- Google Cloud: the project `safe-globe-compliance` did not exist. The user created it under
  `hud.marcotrex@gmail.com` and linked billing account `0150AC-66D95B-EDEF5B`. Project number 1002923438500.
- Old deploy files: do not delete. Comment out `firebase.json`, `.firebaserc` and `DEPLOYMENT.md` (JSON has no
  comments, so the two JSON files keep their old content under a `_disabled` key). Rewrite `cloudbuild.yaml`.
- A sanctions alert no longer rejects a KYC request automatically. It goes to the compliance queue and a person
  decides.

## Google Cloud setup state (12 Oct 2026, verified read-only)

- `scripts/gcp-setup.sh` ran: service account `duedilly-run` with its six roles, secrets `jwt-secret` and
  `agents-internal-token` (one version each), both buckets, both datasets, 12 topics, scheduler job
  `duedilly-uat-rescreen-due` (06:00 SGT), APIs enabled.
- `gemini-api-key` has no value: the user's AI Studio quota is used up, so UAT runs on Vertex AI only for now.
- Document AI: the user created processor `bc77f3acd99699a5` in `us`, named "Form Parser", but its type is
  **Custom Extractor**, not Form Parser. Decision 7 in `docs/CLOUD_PLAN.md` and feature 14 need Form Parser.
  Replaced the same day: the Form Parser processor is **`3beb45e235622652`** in **`us`** (type Form Parser,
  enabled). The `DOCUMENT_AI_*` lines stay commented until Phase 5 builds the integration.
- Agent Search data store: not created yet (Phase 3).
- A spend cap script exists (`scripts/billing-cap.sh`, Google's disable-billing pattern). Whether the user ran it
  is not confirmed.

## Paused (12 Oct 2026, end of day)

- `.env.uat` is filled in by Gemini at the user's request: `GEMINI_BACKEND=vertex`, location `global`,
  `VERTEX_GEMINI_MODEL=gemini-3.5-flash-lite` with fallbacks `gemini-3.5-flash,gemini-2.5-flash`,
  `AGENTS_MODEL=gemini-3.5-flash`, `DEMO_MODE=true`, `COMPLIANCE_OFFICER_EMAILS=whitehathud@gmail.com`,
  `AGENTS_SERVICE_URL=http://localhost:8090`, and locally generated `JWT_SECRET` and `AGENTS_INTERNAL_TOKEN`.
  The models are Gemini's proposal; the user did not object. Prices and Google Search grounding support for them
  are not verified.
- **No live call yet.** The user said to pause and run Vertex AI on 13 Oct. The section 9.1 go-ahead for Vertex AI,
  Secret Manager and Cloud Run is still to be given.

## Vertex AI go-ahead (12 Oct 2026)

- The user said go for Vertex AI (section 9.1). First live calls were made the same day from the user's computer,
  with the user's own sign-in (Application Default Credentials), against `safe-globe-compliance`, location `global`.
- Still **not** live, and still needing the user: Cloud Run (the user runs `scripts/deploy.sh`), Secret Manager
  from the deployed services, and Google sign-in.
- Models in use: app `gemini-3.5-flash-lite` (fallbacks `gemini-3.5-flash`, `gemini-2.5-flash`), agents
  `gemini-3.5-flash`. All three answered on Vertex AI. Grounding with Google Search works with `gemini-3.5-flash`.
- New optional setting `AGENTS_THINKING_LEVEL`, set to `LOW` in `.env.uat` by Gemini: a Pond-Guard run went from
  about 60 seconds to about 20. To confirm.
- Adverse media, Gemini's choice, to confirm: a web article counts only when the page Google Search returned names
  the counterparty, and for a vessel only when any IMO number in it is the same. Reason: the demo names are
  fictional, and the first live search returned news about real ships with other IMO numbers.
- The user asked to go on to Phases 3 to 6 once the deploy and the smoke test are good.

## Phase 2 gate and Phase 3 approvals (12 Oct 2026)

- The user ran the three deploy commands and the smoke test: all checks passed, `Pond-Guard: live`.
  Public link `https://duedilly-uat-gqthvx5oha-as.a.run.app`; agents (private)
  `https://duedilly-agents-uat-gqthvx5oha-as.a.run.app`. A Pond-Guard screening on the link itself was not yet
  confirmed by anyone when Phase 3 started.
- **Approval before each phase:** the user said no to running Phases 3 to 6 without stopping. Each phase needs
  its plan approved first.
- **Phase 3 is approved** ("Proceed with phase 3"). **Build and test locally first; update the container only
  when it is ready.**
- Plan questions 3 to 6 were not answered. Phase 3 is built on the recommended defaults, to confirm in the
  walkthrough: crawl once a day at 06:30 Singapore time plus "Run now"; a High alert asks for a re-screen inside
  the daily cap; the 12-hour policy text and the 24-hour scoring rule are both left as they are; the fictional
  fixture page `/demo/port-notices` is the "changed page".

## Phase 3: what the API references say (read 12 Oct 2026)

- **Pub/Sub publish:** `POST https://pubsub.googleapis.com/v1/projects/{p}/topics/{t}:publish`, body
  `{messages:[{data: base64, attributes}]}`, scope `pubsub` or `cloud-platform`.
- **Pub/Sub push:** body `{message:{data, messageId, publishTime, attributes}, subscription}`; 102, 200, 201, 202
  and 204 acknowledge, anything else is retried. With authentication on, the request carries
  `Authorization: Bearer <JWT>` signed by Google with `iss https://accounts.google.com`, `aud` as set on the
  subscription, and `email` of the push service account. The Pub/Sub service agent needs
  `roles/iam.serviceAccountTokenCreator` on that account. `gcloud pubsub subscriptions create --push-endpoint
  --push-auth-service-account --push-auth-token-audience`.
- **Cloud Scheduler HTTP job:** `--uri --http-method --oidc-service-account-email --oidc-token-audience`.
- **Cloud Storage JSON API:** upload `POST /upload/storage/v1/b/{bucket}/o?uploadType=media&name=`, download
  `GET /storage/v1/b/{bucket}/o/{object}?alt=media`.
- **Agent Search (Discovery Engine v1, API definition revision 20261004):** search is
  `POST v1/{servingConfig}:search` on `.../collections/default_collection/dataStores/{id}/servingConfigs/default_serving_config`;
  results carry `document.derivedStructData` with `link` and `snippets[].snippet`. Snippets need no Enterprise
  feature for unstructured data; extractive answers and segments do, so the app does not ask for them. Data store
  create: `POST .../dataStores?dataStoreId=` with `contentConfig: CONTENT_REQUIRED`; import from Cloud Storage with
  `gcsSource.dataSchema: "content"`.
- Not confirmed from the docs: whether `.txt` files are accepted by an unstructured data store (the PDF certainly
  is), and which edition a data store searched without an app is billed at.

## Phase 3 go-live (12 Oct 2026)

- The user ran `scripts/agent-search-setup.sh` and `scripts/pubsub-subscriptions.sh`; both worked first time.
  That is the section 9.1 go-ahead for Agent Search, Cloud Storage, Pub/Sub and Cloud Scheduler.
- Agent Search: data store `duedilly-policies` in `global`, 8 of 8 files indexed (`.txt` files are accepted).
  First live calls from this computer: all six clauses found by Agent Search; a policy search returned
  `policy-clause-5-4.txt` first. The serving config `default_serving_config` works on the data store directly.
- Cloud Storage: first live save and read-back worked. A small test object was left at
  `gs://duedilly-uat-safe-globe-compliance/snapshots/_selftest/check.txt`.
- Pub/Sub: six push subscriptions and the job `duedilly-uat-crawl-due` exist. `PUBSUB_MODE=pubsub` is set in
  `.env.uat`. **No live publish or push has been made yet:** that happens on the deployed app after the redeploy.
- `.env.uat` now has `DOCUMENT_STORAGE=gcs`, `GCS_BUCKET`, `PUBSUB_MODE=pubsub`, `AGENT_SEARCH_DATA_STORE`,
  `AGENT_SEARCH_LOCATION` (added by Gemini at the user's request).
- Git: checked that no `.env` file with real values was ever committed on any branch.

## Phase 3 review (12 Oct 2026)

- **Halcyon Marine:** the demo notice no longer names Halcyon ("remove it for the demo if it is confusing").
  So the changed page raises one ripple, for Aurora Venture only, and Halcyon keeps its 40 points.
- **Crawl schedule: once a week** (Mondays, 06:30 Singapore time), to save cost for the demo. The screen says
  "once a week" too. The user's words were "you can put it as that but backend make it once a week"; I read
  "put it as that" as keeping the scheduled crawl, and made the screen say what the schedule really is.
  To confirm. `CRAWL_SCHEDULE` on the script sets another schedule.
- The other Phase 3 defaults are confirmed: automatic re-screen on a High ripple inside the daily cap; the
  12-hour policy text and the 24-hour scoring rule both left as they are; the demo page as the changed page.
- Phase 3 work committed and pushed to `DueBilly` (`31d6f1d`) at the user's request.
- Phase 4: the user said "proceed to phase 4" after the clean-up. Its plan was written and shown for approval
  (approval before each phase). Coding starts when the plan is approved.

## Change of direction (12 Oct 2026): machine learning on review labels

- The user asked Gemini to **leave workflows and UI to the user and focus on the AI integration** (40% of the
  scoring), centred on the **Reviews tab**.
- The user asked for research on Vertex AI machine learning, and for a supervised model trained on the decisions
  compliance officers record, aimed at false negatives, that gets better with more reviews. Vertex AutoML named.
- This conflicts with `GEMINI.md` rule 5 (no model training; `CREATE MODEL` on hold) and section 10 (the AI never
  sets the risk number or the route). Gemini reported the research and asked the user to confirm before training
  anything. **Nothing has been trained and no Phase 4 code is written.**
- The Phase 4 plan in `implementation_plan.md` is on hold until the user answers.

## The review model: decisions (12 Oct 2026)

The user's answers ("Do this now"):
- **Rule 5 is lifted for this model.** Use BigQuery ML boosted trees.
- **The model suggests; it does not score.** "Prediction as you mention": it flags a likely miss for review and
  never changes the score or the route.
- **Synthetic labelled data: yes**, "because of AI governance and demo purposes".
- **Gemini updates the Reviews UI for this** (the user asked for it here, although the user owns UI in general):
  the officer can classify a case red or green; keep it simple; add hints that explain prediction, inference,
  suggestion and hyperparameter tuning, tied into the risk-by-confidence chart.
- The earlier Phase 4 plan (forecast, anomalies, name matching) is **not built** and is kept as
  `implementation_plan.phase4-bigquery-ai.md`. Features 4, 11 and 13 of `GEMINI.md` are therefore open.

Choices Gemini made while building, to confirm:
- An officer's own review counts 10 times a synthetic one in training.
- "Likely miss" at a prediction of 50% or more (a setting); "likely false alarm" at 20% or less.
- The synthetic officer's miss patterns include "a company whose points come from a vessel it manages", which is
  the Halcyon Marine situation. So after Halcyon is marked red and the model is retrained, Halcyon shows as a
  likely miss. This is by design of the synthetic data, and the screens say the data is synthetic.
- Offline there is a real model too (boosted trees trained inside the app), labelled "Offline model".
- BigQuery ML has **not** been called yet. Not confirmed: boosted-tree training and tuning in `asia-southeast1`,
  the columns of `ML.TRIAL_INFO`, and the price of a training run.

## BigQuery ML: first live run (12 Oct 2026)

- The user set `BIGQUERY=bigquery`, deployed (revision `duedilly-uat-00006-xlt`) and pressed Train. That is the
  section 9.1 go-ahead for BigQuery ML.
- **It worked first time.** `CREATE MODEL` (boosted trees, 6 tuning trials) ran in `asia-southeast1` and took
  26 min 47 s. Model `duedilly_uat.review_risk_model`, table `duedilly_uat.review_labels` (800 synthetic rows).
- Tuning: trial 6 kept (tree depth 5, learning rate 0.4, AUC 0.775 on BigQuery's own evaluation split).
- On the 101 held-back reviews: AUC 0.837, recall 77%, precision 76%, 18 of 28 low-scored risks flagged.
- Predictions with reasons came back from `ML.EXPLAIN_PREDICT`. Halcyon Marine: 59%, likely miss.
- A 403 the user saw in the browser console was `GET /api/sources/records` asked at page start before sign-in.
  Harmless; fixed in the page (asked only when signed in as an officer, and when the Sources tab is opened).
- The cost of the training run is not known yet (check Billing > Reports tomorrow).

## Open questions

- Build the rest of the old Phase 4 (forecast, anomalies, name matching), or go to Phase 5?
