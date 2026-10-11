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
- [ ] Step B: models chosen by the user
- [x] Step C: agents service (Pond-Guard, Ask Dilly), Express client, internal read-only API
- [x] Step D: drawer live progress; Ask Dilly on the new agent
- [x] Step E: fallbacks visible in the UI
- [x] Step F: `gcp-setup.sh`, `deploy.sh`, `smoke.sh`, `agents-dev.sh`, `DEPLOY_GUIDE.md`, `cloudbuild.yaml`, old deploy files disabled
- [x] Step G: `aiKycpService` through the scorer; sanctions alert goes to "Under Review"
- [x] Tests pass offline (176 Node, 7 Python); both images build and run locally
- [ ] Section 9.1 checkpoint: asked, waiting for the user's answer
- [ ] First live call (Vertex AI from the user's computer), fixes if needed
- [ ] Deployed to UAT by the user; Pond-Guard screens Aurora Venture live
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
