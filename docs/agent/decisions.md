# Decisions

Answers to the Phase 0 questions (`CLAUDE.md` section 9), given by the user on 12 Oct 2026.
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

## What answer 4 changes in `CLAUDE.md`

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

- `.env.uat` is filled in by Claude at the user's request: `GEMINI_BACKEND=vertex`, location `global`,
  `VERTEX_GEMINI_MODEL=gemini-3.5-flash-lite` with fallbacks `gemini-3.5-flash,gemini-2.5-flash`,
  `AGENTS_MODEL=gemini-3.5-flash`, `DEMO_MODE=true`, `COMPLIANCE_OFFICER_EMAILS=whitehathud@gmail.com`,
  `AGENTS_SERVICE_URL=http://localhost:8090`, and locally generated `JWT_SECRET` and `AGENTS_INTERNAL_TOKEN`.
  The models are Claude's proposal; the user did not object. Prices and Google Search grounding support for them
  are not verified.
- **No live call yet.** The user said to pause and run Vertex AI on 13 Oct. The section 9.1 go-ahead for Vertex AI,
  Secret Manager and Cloud Run is still to be given.

## Open questions

None.

## Accounts phase approvals (12 Oct 2026)

The plan in `implementation_plan.md` (Accounts phase) is approved with these answers:

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Employees | Keep it simple: employees only get the table-only employee portal. |
| 2 | Role table | Approved as written. `/v1/screen` stays open for demo purposes. |
| 3 | `COMPLIANCE_OFFICER_EMAILS` | No longer grants access. It stays in `.env.example`, marked "no longer used". An officer is whoever created the workspace or was promoted in Settings. |
| 4 | One email, one workspace | Approved. "Create an account" is refused for an email that already has an account or a pending invitation. |
| 5 | Cloud Run restarts | Accepted for the hackathon. Accounts and workspaces live in SQLite on the container disk and are lost on restart. A warning at the start says this is a demo version and data is not saved after a restart. A hosted database is not in scope. |
| 6 | Reference data | Approved: default scoring rules, the default CDDQ questionnaire and default monitoring settings are part of the app and present in every new workspace, with sanctions, PEP, CPI and policies. |

Built the same day. Choices made while building, to confirm:
- Live Ask Dilly (the ADK agent) answers only in the Demo workspace for now; created workspaces get the built-in
  answers. Reason: the agent's lookup tools do not yet carry a workspace.
- `/api/places` (address lookup) stays open: it holds no workspace data and the counterparty page uses it.
- The built-in VesselFinder source is present in every workspace, as part of the app.
- Section 9.1: the first live Google sign-in has **not** been made. Asked on 12 Oct; waiting.
