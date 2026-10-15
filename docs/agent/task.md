# Tasks

## Phase 0: read and ask
- [x] Read `GEMINI.md`, `DEPLOY_GUIDE.md`, `GEMINI.md`, `docs/CLOUD_PLAN.md` and the repo
- [x] Run the test suite offline (137 pass)
- [x] Ask the section 9 questions
- [x] Record the answers in `docs/agent/decisions.md`
- [x] Open questions A, B, C answered

## Phase 1: scoring engine, editable rules, "Why <score>?"
- [x] Plan approved by the user (`implementation_plan.md`)
- [x] Aurora Venture decisions made (ownership fact approved; country row to be checked against the CPI data)
- [x] Step 1: `points.config.js`, `rulesStore.js`, `/api/risk/rules` routes
- [x] Step 2: Reviews "Scoring rules" editor; suggestions after a policy or source upload; alert and link
- [x] Step 3: `scorer.js` (points, confidence, route, level, pose)
- [x] Step 4: findings schema and `findings` table
- [x] Step 5: demo findings; `calculateAiRisk` and `screenCounterparty` use the scorer; breakdown routes
- [x] Step 6: drawer pipeline strip and "Why <score>?" panel
- [x] Step 7: `tests/risk.test.js`; `npm test` passes offline (167); no existing test needed changing
- [x] `.env.example` and `DEPLOY_GUIDE.md`: nothing to update, no variable or script was added
- [x] `walkthrough.md` written, with before and after demo scores
- [x] User review of Phase 1 (decisions recorded 12 Oct)
- [x] Reviews page split into five tabs (user request)

## Phase 2: Vertex AI, agents service, Pond-Guard, Ask Dilly, first deploy
- [x] `gcloud`, `bq`, Docker, sign-in, project and billing verified (12 Oct)
- [x] Installed ADK inspected (google-adk 2.11.0, Python 3.14.8)
- [x] Plan approved by the user (`implementation_plan.md`), questions 1 to 3 answered
- [x] Step A: `DEMO_MODE`, rate limit and caps, demo label, `.env.example` placeholder shape
- [x] Step B: Vertex AI in the shared client; models listed
- [x] Step B: models chosen (Gemini's proposal, kept by the user): app `gemini-3.5-flash-lite`, agents `gemini-3.5-flash`
- [x] Step C: agents service (Pond-Guard, Ask Dilly), Express client, internal read-only API
- [x] Step D: drawer live progress; Ask Dilly on the new agent
- [x] Step E: fallbacks visible in the UI
- [x] Step F: `gcp-setup.sh`, `deploy.sh`, `smoke.sh`, `agents-dev.sh`, `DEPLOY_GUIDE.md`, `cloudbuild.yaml`, old deploy files disabled
- [x] Step G: `aiKycpService` through the scorer; sanctions alert goes to "Under Review"
- [x] Tests pass offline (176 Node, 7 Python); both images build and run locally
- [x] Section 9.1 checkpoint: the user said go for Vertex AI (12 Oct)
- [x] First live call (Vertex AI from the user's computer): works; three fixes made (see `walkthrough.md`)
- [x] Deployed to UAT by the user; smoke test passed with `Pond-Guard: live` (a screening on the link still to be confirmed by the user)
- [x] `walkthrough.md` updated (live results to be added)

## Accounts phase: roles, workspaces, sign-in, Settings (requested 12 Oct, before Phase 3)
- [x] Repo read: personas, auth, routes without a sign-in check, database access, empty-workspace mode
- [x] Plan written (`implementation_plan.md`); Phase 2 plan kept as `implementation_plan.phase2.md`
- [x] Questions 1 to 6 answered by the user; answers recorded in `decisions.md`
- [x] Accounts store: workspaces, accounts, audit log, demo seed, last-officer rule
- [x] Workspace databases: `getDb()` by request context, empty mode, per-workspace uploads, DDQ token claim
- [x] Auth: sessions, `/api/auth/demo`, `/api/auth/google`, `/api/auth/signup`; role from the account only
- [x] Role guards on every route (plan section 5)
- [x] Settings routes and tab; invite with "Copy invite link" fallback
- [x] Login page with three options; "Demo" labels; restart warning
- [x] Empty states on every screen of a new workspace
- [x] `tests/accounts.test.js`; `npm test` passes offline (187)
- [x] `.env.example`, `DEPLOY_GUIDE.md` step 11 and README sign-in section updated
- [ ] Section 9.1 checkpoint: asked, waiting for the user's answer (first live Google sign-in)
- [x] `walkthrough.md`: how to try each sign-in path
- [ ] Follow-up: pass the workspace to the agents service so live Ask Dilly works outside the Demo workspace

## Phase 3: events, crawler agents, self-healing, Ripples triage, policy search
- [x] Plan written (`implementation_plan.md`); Accounts plan kept as `implementation_plan.accounts.md`
- [x] Plan approved by the user (12 Oct); approval needed before each later phase; questions 3 to 6 on the recommended defaults
- [x] Step 0: API references read and noted in `decisions.md`
- [x] Step A: event bus, push endpoint, where events are published, subscriptions script, crawl schedule
- [x] Step B: crawler (robots.txt, terms tick, no login pages, rate limit), snapshots, ADK extraction, change detection, Sources tab, demo fixture
- [x] Step C: self-healing proposals, approve or dismiss in the Sources tab
- [x] Step D: Ripples triage, merge, "what changed", High asks for a re-screen
- [x] Step E: policy files, `kyc_policy.pdf` (demo), Agent Search setup script, clause shown on every route
- [x] `.env.example` and `DEPLOY_GUIDE.md` steps 5, 7, 8, 13 and 14 updated
- [x] Tests pass offline (205 Node, 11 Python); gate checked offline and live on Vertex AI locally
- [x] Section 9.1 go-ahead given (12 Oct). Live and working from this computer: Agent Search, Cloud Storage
- [ ] Pub/Sub and Cloud Scheduler: set up; first live event needs the redeploy
- [ ] Deployed to UAT by the user (the link still runs Phase 2)
- [x] `walkthrough.md` updated

## Phase 4, replaced: the review model (machine learning on officers' reviews)
- [x] Research on Vertex AI AutoML, BigQuery ML AutoML and BigQuery ML boosted trees; reported to the user
- [x] User's decision: BigQuery ML boosted trees, suggestions only, synthetic labelled data, Reviews tab
- [x] Features from the score breakdown; synthetic labelled reviews (seeded, marked synthetic)
- [x] Offline model: boosted trees inside the app, tuning trials, held-back test, reasons per prediction
- [x] BigQuery client over REST; BigQuery ML SQL (train with tuning, trials, explain); result parsing
- [x] Learning service and `/api/learning` routes; daily cap; guardrail test (no score or route changes)
- [x] Reviews: red and green per case, prediction and suggestion, rings on the chart, "Dilly learns" tab, hints
- [x] `.env.example`, `scripts/deploy.sh`, `DEPLOY_GUIDE.md` step 6
- [x] Tests pass offline (215 Node, 11 Python)
- [x] Section 9.1 go-ahead for BigQuery ML; first live training run worked on UAT (26 min 47 s, no fix needed)
- [ ] Not built: Pond forecast (4), name matching (11), AIS anomalies (13). Old plan kept, user to decide

## Phase 5, in part: reviewer copilot, Duck-Scanner, answer verification (user chose "A and C", 12 Oct)
- [x] Reviewer copilot (5): Gemini draft with checked citations, computed route only, draft and final stored
- [x] Duck-Scanner (14): Document AI Form Parser then Gemini mapping with confidence; checks; "not sure" marker
- [x] Answer verification (7): fixed pairings, Gemini judges each pair, points once, runs on `ddq-submitted`
- [x] Review dialog and supplier portal hooks; `.env.example`, `scripts/deploy.sh`, `DEPLOY_GUIDE.md` step 9
- [x] Tests pass offline (225 Node, 11 Python); copilot, verification and scanner run live on Vertex AI locally
- [x] Section 9.1 go-ahead for Document AI; first live call worked (1 page, 8 form fields, 12 answers, 8.9 s)
- [ ] Deployed to UAT by the user
- [ ] Not built: Quack-Back (6), automatic DDQ email (16), Request more info (17), "How Dilly works" (15)


## Country risk views on the Globe (requested 13 Oct 2026, built 14 Oct)
- [x] Repo read; plan written (`implementation_plan.md`); review-model plan kept as `implementation_plan.review-model.md`
- [x] Questions answered by the user; answers and my readings of them recorded in `decisions.md`
- [x] Connections checked with the bot's user agent: OFAC and EU reachable, FATF refuses robots (403 challenge)
- [x] View registry, ISO 3166-1 list, validation, two tables, service, API, role checks
- [x] Layers panel view list, colours, legend, tooltip, country panel, refresh control, upload button
- [x] File downloads in the fetcher; dataset record to newest CSV; due-check on the daily tick; fallback when the tick does not come
- [x] ADK `country_risk` agent and `POST /country-risk/extract`
- [x] First live reads: EU (parsed, no model) and OFAC (ADK agent on Vertex AI, 1 call); both saved as the samples
- [x] `.env.example`, `scripts/deploy.sh`, `DEPLOY_GUIDE.md` steps 7 and 13, README
- [x] Tests pass offline (239 Node, 13 Python)
- [x] `walkthrough.md`: switch views, change the refresh setting, trigger a refresh
- [ ] FATF: no data until a compliance officer uploads the saved page (the site refuses robots); upload not yet tried with a real FATF page
- [ ] Not built: Basel, TRACE, FSI, CTHI (user: not used); following links one level deep; PDF statements; upload block in the Sources tab (it is in the Layers panel)
- [ ] "How Dilly works" line: served by the API and shown in the Layers panel; the page itself (feature 15) is not built
- [ ] Deployed to UAT by the user, with `COUNTRY_RISK_FETCH=live`

## HUD, Firestore and BigQuery AI (requested and withdrawn on 14 Oct 2026)
- [x] Phase A discovery written (`implementation_plan.hud-firestore-bigquery.md`)
- [x] Withdrawn by the user before any answer. Nothing built

## Strengthen Pond-Guard: Dilly the orchestrator (requested 14 Oct 2026)
- [x] What is built today read and compared with the user's picture; plan written
- [x] Questions 1 to 6 answered; A to E approved in that order; answers in `decisions.md`
- [x] Cloud Run CPU check done (docs read); choice written into the plan
- [x] Three demo clauses drafted with numbers (1.1, 1.2, 1.3) and shown to the user
- [ ] User's OK on the updated plan and on the clause texts
- [ ] A1: `screening-requested` on KYC submit; entity for a new request; result written back; status on the request
- [ ] A2: reuse within 24 hours; cap message and runs left; "Offline" label
- [ ] A3: `POST /api/kyc/:id/screen-now` for inline events on Cloud Run; subscription check in the script
- [ ] B1: three clauses saved; policy files and PDF rebuilt; policy column of the points rows
- [ ] B2: policy text in each brief; `policy_clause`, `policy_quote`, `suggested_action`; checks in code
- [ ] B3: Country and contract agent; number checks; riskiest country once
- [ ] C: `dilly` agent; next steps, "Dilly's note", "AI suggestion" labels; copilot starts from the summary
- [ ] D: "Dilly suggests" wording; suggestion stored per run
- [ ] E1: outcomes stored; Agreed / stricter / more lenient / Waiting; SQLite logic; Reviews panel and list
- [ ] E2: BigQuery table and view script; app inserts and reads; section 9.1 before the first insert
- [ ] E3 (first to cut): "How likely an officer marks this red" column; suggestion added to the feature list
- [ ] Tests offline (Node and Python)
- [ ] Section 9.1: ask, then live run on Vertex AI (Aurora Venture and one new request)
- [ ] `DEPLOY_GUIDE.md` steps 6, 7, 8; README; `walkthrough.md` with demo scores before and after

## Dilly motion (requested 15 Oct 2026, plan: `implementation_plan.motion.md`)

- [x] M1 `dilly-motion.js`, tests, served; motion tokens; Three.js loads only on the sign-in screen
- [x] M2 Paper plane on Send DDQ and staff invites
- [x] `npm test` after M1 and M2
- [x] M3 Rubber stamp on Approve, Reject, Request more info
- [x] M4 "Why <score>?" count-up; route pose pop
- [x] `npm test` after M3 and M4
- [x] M5 Pond-Guard ducklings in a row
- [x] M6 DDQ portal duckling hop and mommy duck waddle
- [x] `npm test` after M5 and M6; browser check

## Big report popups (requested 15 Oct 2026, plan: `implementation_plan.popups.md`)

- [x] P1 Popup shell (dimmed page, Minimise, Esc, focus kept inside); Pond-Guard laid out left to right
- [x] P2 Pond-Guard animation from the real events (packets, spinner rings, badges, score ring counts to the real score)
- [x] `npm test` after P1 and P2
- [x] P3 BigQuery ML: Train (stages, reading Dilly), Refresh predictions (new button, popup), a case's prediction (popup)
- [x] P4 Browser check; docs
- [x] `npm test` after P3 and P4
