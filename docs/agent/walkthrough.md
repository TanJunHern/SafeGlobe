# Walkthrough

## Phase 1: scoring engine, editable rules, "Why <score>?" (12 Oct 2026)

Built by Gemini Code. No cloud service was called. Everything below runs offline with Gemini disabled.

### What changed

| Area | Files |
| --- | --- |
| Rules: the points table, levels, thresholds, confidence weights, routes (single definition) | `src/risk/points.config.js` (new) |
| Rules in force = defaults + the user's edits, validation, change log | `src/risk/rulesStore.js` (new) |
| Findings format and validation ("no source, no points") | `src/risk/findingSchema.js` (new) |
| Scorer: points, confidence, route, level, Dilly pose, the 6-step pipeline | `src/risk/scorer.js` (new) |
| Storing findings, re-scoring, demo findings, rule-edit preview | `src/risk/riskService.js` (new) |
| Recommended rule changes after a policy or source upload | `src/risk/suggestions.js` (new) |
| API `/api/risk/*` and the in-app source page `/risk/source` | `src/routes/risk.js` (new), `src/server.js` |
| Tables `findings`, `risk_checks`; new read/write functions; Cameroon CPI row; Aurora record fix | `src/db/sqlite.js`, `src/db/seed-data.js` |
| The two older scoring functions now add up points through the scorer | `src/services/screening.js`, `src/services/kycService.js`, `src/routes/entities.js` |
| Upload hooks that raise recommendations | `src/routes/policies.js`, `src/routes/sources.js` |
| Drawer strip and "Why <score>?" panel, Reviews "Scoring rules" card, alert | `safe-globe.html` |
| Tests | `tests/risk.test.js` (new, 30 tests and sub-tests), `package.json` test list |

No environment variable was added, so `.env.example` and `DEPLOY_GUIDE.md` are unchanged. `CONFIDENCE_THRESHOLD`
keeps its meaning: it is the default for the confidence threshold until an officer changes it in Reviews.

### How to see it

Start the app (`npm run dev`, or `npm start`), open `http://localhost:8080`, and choose the compliance officer.

1. **"Why 85?"** Globe > watchlist > **Aurora Venture**. Under the risk card: the 6-step strip
   (Read, Understand, Check, Score, Weigh, Route), then one row per counted finding with its points, rule, policy
   clause, summary, quote and source link, then the total, the route and the reason. "What drives the confidence"
   now starts with the calculation for each finding.
2. **Edit the rules.** Reviews > scroll to **Scoring rules**. Change a number, read the preview
   ("n of m scored cases change"), give a reason, **Save and re-score**. Open Aurora Venture again: the total moved.
   **Reset to defaults** undoes it. The change log at the bottom of the card records who changed what.
3. **Locked values.** The confirmed-sanctions row shows "Set to 100, always Escalate". The list "Cannot be changed"
   names the guardrails.
4. **Recommendation alert.** Policies > upload a `.txt` policy that says, for example,
   "§2.1 A DDQ is required when the contract value is above SGD 250,000." An alert appears at the top:
   "Dilly recommends n changes to your scoring rules". **Review** opens Reviews with the affected rows highlighted.
   **Accept** applies one change and re-scores; **Dismiss** drops it. Adding a source does the same.
   With the demo policies loaded, the first upload also surfaces two existing differences: policy §5.4 says an AIS
   gap over 12 hours while the rules use 24, and no row cites §3.2.
5. **Your own row.** In the Scoring rules card, "Add your own finding" adds a row with your points and clause.
6. **An employee** can read the rules but every input is disabled, and the API answers 403.

### How it was tested

- `npm test`: **167 pass, 0 fail**, offline, Gemini disabled (137 before; none of the old tests needed changing).
- New tests cover: every points row, once-per-case, the cap, confirmed sanctions, the country rule, the levels,
  each confidence weight and the second-source bonus, weighted confidence and coverage, the four routes and the
  poses, every schema rejection, valid / invalid / locked rule edits, custom rows, recommendations, the Aurora
  Venture example, re-scoring and reset, and stored rejected findings.
- By hand, against a scratch database on port 8097: the API calls (403 for an employee, 400 with plain reasons for a
  locked row and bad values, accept, edit, add row, reset), and in Chrome the Reviews card, the alert and the
  Aurora Venture drawer.
- Not tested: the drawer for people and organisations was not looked at in the browser, only the vessel drawer.
  There is no automated test of the HTTP routes in `src/routes/risk.js`.

### Demo scores, before and after

Scores are now added up from findings. Confidence is calculated from the evidence.

| Counterparty | Before (risk / confidence) | After | Level | Route | Why |
| --- | --- | --- | --- | --- | --- |
| Aurora Venture | 86 / 82% | **85 / 96%** | High | Escalate | AIS dark +20, ship-to-ship +20, flag changes +10, Cameroon CPI 26 +20, ownership unclear +15 |
| Arkady Zemtsov | 92 / 62% | **100 / 100%** | High | Escalate (sanctions pose) | Confirmed match: name plus date of birth |
| Severny Agro Export | 88 / 90% | **60 / 76%** | Medium | Investigate (was Escalate) | Possible sanctions link through the majority owner +40, Russia CPI 22 +20 |
| Kestrel Trading | 84 / 58% | **55 / 48%** | Medium | Investigate | Possible sanctions link from a news report +40, ownership unclear +15 |
| Halcyon Marine | 78 / 86% | **40 / 100%** | Low | Auto-clear (was Investigate) | Only the two findings about the vessel it manages: +20 and +20 |

### Things you should know, and decide

1. **Aurora Venture reaches 85 only with two additions.**
   - Cameroon was not in the app's CPI data. I added CPI 2025 score 26, rank 142, after looking it up
     ([Trading Economics](https://tradingeconomics.com/cameroon/corruption-index),
     [Le360](https://afrique.le360.ma/societe/cameroun-20-ans-de-lutte-contre-la-corruption-pourquoi-lepervier-sest-contente-de-miettes_VQERAQ6GVRG5FI47QBQ7ARQTVQ/)).
     I did not check it on transparency.org itself.
   - "Ownership unclear" is the fictional demo fact you approved (registered owner held through nominees), and
     "owners all match" is removed.
2. **Halcyon Marine now auto-clears.** The points table has no row for "manages a vessel that went dark". I gave its
   case the two vessel findings (40 points). If you would rather it stayed in Investigate for the demo story (step 5
   sends it a DDQ), add your own row in Reviews, or tell me which rule should cover it.
3. **Severny Agro drops from Escalate to Investigate.** State ownership and "sectoral restrictions" are not a row
   either. I classed the majority-owner fact as a possible sanctions match (name level). That is a judgement: please
   confirm it or tell me to drop it (it would then score 20, Low).
4. **Three older behaviours I left alone, because they are not Phase 1 and changing them changes statuses:**
   - A vessel whose registry record contradicts the form is still raised to at least 65 (`withVesselMismatch` in
     `kycService.js`). That number does not come from the points table, so the breakdown will not explain it.
   - A KYC request with a "Sanctions Alert" is still set to Rejected automatically (`createKycRequest`). That is a
     machine deciding, which section 10 says must not happen.
   - `aiKycpService.js` (the AI KYCP check) still lets Gemini return a risk number. Pond-Guard replaces it in Phase 2.
5. **The offline screening engine recognises names by pattern** (`screening.js`). Its findings are labelled demo
   and its agent is named "Sentry (offline rules)". It honestly reports that adverse media was not checked, so a
   clean counterparty now shows 80% confidence (4 of 5 checks), not 92% to 96%.
6. **Recommendations read text only.** A PDF policy cannot be read offline, so it raises no recommendation from its
   own content until Document AI or Gemini reads it (Phases 2 and 5). `.txt` and `.md` uploads work now.
7. **The drawer's Screening tab still shows the older agent cards** next to the new scored findings. Pond-Guard
   replaces those cards in Phase 2.
8. **Authoritative lists (decision 8)** are not enforced in code yet: nothing in Phase 1 produces a confirmed match
   except the demo finding. It becomes a rule in Phase 2 with the sanctions agent.

### Added after review (12 Oct 2026): Reviews sections

The Reviews page now shows one section at a time. A switcher under the four figures has five tabs, in this order:
Ongoing monitoring, Case queue, Risk and confidence, Calibration, Scoring rules. It opens on Case queue.
The "Needs a person / All cases" filter shows only on Case queue. The Scoring rules tab carries a count when there
are recommended changes, and the alert's Review button opens that tab. Changed: `safe-globe.html` only.
Checked in Chrome: each tab shows its own section and hides the other four. `npm test`: 167 pass.

In "How to see it" above, "Reviews > scroll to Scoring rules" is now "Reviews > Scoring rules tab".

---

## Phase 2: Vertex AI, agents service, Pond-Guard, Ask Dilly, deploy scripts (12 Oct 2026)

Built by Gemini Code. **Status: built and tested on fallbacks only. No live call has been made** to Vertex AI, the
agents' Gemini backend, Secret Manager or Cloud Run. The gate ("Pond-Guard screens Aurora Venture live on UAT") is
**not met yet**: it needs the user's go-ahead (section 9.1), the model choice, and the user to run the scripts.

### What changed

| Area | Files |
| --- | --- |
| Demo mode: persona picker and `x-user-*` headers only with `DEMO_MODE=true`; otherwise verified Google sign-in only | `src/config.js`, `src/middleware/auth.js`, `safe-globe.html` |
| Per-IP AI rate limit and daily Pond-Guard budget | `src/middleware/rateLimit.js` (new), `src/routes/ai.js`, `kyc.js`, `ask.js` |
| "Demo: fictional" label; "Data resets" on Cloud Run | `src/server.js` (`/api/config/public`), `safe-globe.html` |
| Gemini on Vertex AI in the shared client, structured output (`responseSchema`) | `src/services/geminiClient.js` |
| ADK agents service: Pond-Guard (parallel sub-agents), Ask Dilly (read-only tools, URL context) | `agents/` (new: `app/main.py`, `pond_guard.py`, `ask_dilly.py`, `models.py`, `settings.py`, `Dockerfile`, `requirements.txt`, `tests/`) |
| App side: client, evidence gathering, vetting, scoring, offline fallback, routes, read-only tool API | `src/services/agentsClient.js`, `src/services/pondGuardService.js`, `src/routes/pondGuard.js` (all new), `src/server.js` |
| Drawer: "Screen with Pond-Guard" with one live row per agent; Ask Dilly through the agent | `safe-globe.html` |
| Guardrails: KYCP report takes its number from the scorer; a sanctions alert goes to "Under Review", not "Rejected" | `src/services/aiKycpService.js`, `src/services/kycService.js` |
| Scripts | `scripts/deploy.sh`, `scripts/smoke.sh`, `scripts/agents-dev.sh` (new), `scripts/gcp-setup.sh` |
| Config and docs | `.env.example` (placeholder blocks), `DEPLOY_GUIDE.md` (rewritten to match the code), `README.md` cloud section, `cloudbuild.yaml` (rewritten), `firebase.json`, `.firebaserc`, `DEPLOYMENT.md` (disabled, old content kept) |
| App `Dockerfile` | One line fixed: `COPY "Final PRD.pdf" ...` did not parse, so the image had never built. |
| Tests | `tests/phase2.test.js` (new, 9), `agents/tests/test_agents.py` (new, 7), `tests/config.test.js`, `tests/ai-kycp.test.js`, `tests/portal.test.js` updated |

### How Pond-Guard keeps the AI honest

1. The app gathers the evidence (its lists, source records, ownership graph, AIS signals) and gives each agent only
   its own part. Sanctions and PEP agents never see the web. Only the adverse media agent has Google Search.
2. An agent returns findings that cite an evidence item by reference and quote it.
3. The app checks each one: the reference must be one that agent was given, the quote must be in it, the category
   must be one that agent may report. For adverse media, the link must be one Google Search returned in that run.
4. The source name, link, trust and read time are filled in from the evidence, never from the model.
5. A "confirmed" sanctions match is downgraded to "possible" unless the evidence carries a second identifier.
6. Ruled-out findings are stored as rejected with the reason. The scorer then gives the points and the route.

### How to see it (offline, today)

- `npm run dev`, open Aurora Venture, press **Screen with Pond-Guard**: five agent rows, then "Offline sample"
  with the reason. Nothing is changed.
- Ask Dilly a free question: with no agents service it answers as before.
- Reviews and "Why 85?" are unchanged from Phase 1.
- `npm run agents` starts the agents on port 8090; with no model set it answers 503 and the app falls back.

### How it was tested

- `npm test`: **176 pass, 0 fail**, offline. `npm run test:agents`: **7 pass**, offline, on Python 3.14.8 with
  google-adk 2.11.0.
- Three existing tests changed, by design: the uat settings test (new `DEMO_MODE`, `VERTEX_GEMINI_MODEL` and
  `GOOGLE_CLIENT_ID` rules), the public config keys, and the KYCP Severny test (score is now 60, Medium, from the
  points table; it was ">= 70, High").
- The app started with every `.env.example` placeholder commented, and `scripts/smoke.sh` passed against it.
- Both container images were built locally and run: the agents image answers `/health` (ADK 2.11.0, Python
  3.14.8); the app image passed the smoke test with `APP_ENV=uat`.
- In Chrome: the Pond-Guard rows and the offline note in the vessel drawer.
- **Not tested, because they need a live call:** the agents actually running on Gemini (the ADK event handling,
  `output_schema` with the chosen model, Grounding with Google Search results), the Vertex AI call from the shared
  client, service-to-service identity tokens, `scripts/deploy.sh` and the updated `scripts/gcp-setup.sh`.
  These are the likeliest places for a first-run fix.

### Things you should know

1. ADK 2.11.0 marks `ParallelAgent` and `SequentialAgent` as deprecated in favour of `Workflow`. They work and are
   what the plan named, so I used them; the package prints a warning.
2. A live Pond-Guard run replaces a case's findings with what the agents find. Aurora Venture may then score
   something other than 85 (for example if an agent does not report the flag changes). The offline sample is unchanged.
3. `DEMO_MODE=true` on the public link means anyone with the link can act as either persona. That is the persona
   picker working as designed; use it with fictional data only.
4. Models: `asia-southeast1` lists only `gemini-2.5-flash`; `global` lists many. No model is pinned in the code.
5. The employee portal page (`employee-portal.html`) still shows its persona picker when `DEMO_MODE=false`; the
   server ignores it, but the buttons are not hidden there yet.
6. The Screening tab in the drawer still shows the older agent cards. The new agent rows are on the first tab.

---

## Accounts phase: roles, workspaces, sign-in, Settings (12 Oct 2026)

Status: **built and tested offline. Google sign-in has not been tried against real Google** (section 9.1: waiting
for the go-ahead). The Gmail invitation email is not live either; the "Copy invite link" fallback is in use.

### What changed

- **Two roles, kept on the server.** `compliance_officer` (label "Compliance officer") and `employee` ("Employee").
  The role is read from the person's account on every request. The `x-user-role` header is no longer read, and the
  "email contains compliance" shortcut is gone. Grace Teo is the demo compliance officer, John Doe the demo employee.
- **Accounts** (`src/accounts/`): workspaces, accounts, invitations and a log of every account change, in their own
  file (`data/safe_globe.accounts.db`).
- **Workspaces** (`src/db/index.js`): one database file per workspace. `getDb()` keeps its name and returns the
  database of the signed-in person's workspace. The Demo workspace is the original database. A created workspace
  opens empty.
- **Sign-in** (`src/routes/auth.js`): `POST /api/auth/demo`, `/api/auth/google`, `/api/auth/signup`,
  `/api/auth/signout`. A session lasts 12 hours and is signed with `JWT_SECRET`.
- **Every `/api` route now checks who is calling.** The routes that had no check (case decisions, sources,
  policies, intake, statements, claims, alerts, uploads, stats, AI screening, the Globe-side DDQ routes, the risk
  routes) are compliance officer only. Left open on purpose: `/v1/screen` (your decision), address lookup
  (`/api/places`, also used by the counterparty page), health, public config, and the counterparty DDQ routes, which
  are guarded by their signed link.
- **Login page**: three options. **Settings tab**: new, compliance officers only.
- **Empty states** on the watchlist, Ripples, alerts, Reviews, the compliance queue, Sources, Readable Source
  Intelligence, Policies, the Settings log and the employee table.
- `COMPLIANCE_OFFICER_EMAILS` no longer grants access. `.env.example` and `DEPLOY_GUIDE.md` step 11 say so.
  No new variable was added.

### How to try each sign-in path

Start the app (`npm run dev`) and open `http://localhost:8080/login`.

1. **Demo account, compliance officer.** Under "Try a demo account" press **Grace Teo · Compliance officer**.
   You land in the Demo workspace with the demo data. The left nav has **Settings**.
2. **Demo account, employee.** Press the name at the top right → **Log Out** → **John Doe · Employee**. You land on
   the table-only employee page. There is no Settings, and the server refuses it too (try
   `curl -H 'x-user-email: john.doe@duedilly.com' localhost:8080/api/settings/accounts` → 403).
3. **Settings in the Demo workspace.** As Grace: Settings → enter any email → **Invite**. The row shows "Invited"
   with **Copy invite link**, **Resend** and **Cancel invite**. **Make compliance officer** on John works.
   **Delete account** is greyed out with "Not available in the demo". The log lists each change. Restart the app
   and the demo accounts are back to the two originals.
4. **Create an account** (needs `GOOGLE_CLIENT_ID`; not yet tried live). Press the Google button under "Create an
   account", choose your Google account, fill in your name and organisation name, press **Create workspace**. You
   land in a new workspace with your organisation's name at the top and every screen empty.
5. **Invite and accept** (needs Google). In your workspace: Settings → invite a second Google address → copy the
   link and open it in another browser → **Sign in with Google** with that address. That person lands on the
   employee page of your workspace, and Settings shows them as Active with "Invitation accepted" in the log.
6. **No account, no invitation** (needs Google). Use **Sign in with Google** with an address that was never
   invited. The page shows "You don't have access yet. Ask your compliance officer to invite you, or create your
   own workspace." with a **Create your own workspace** button. No account is created.
7. **Last compliance officer.** In your workspace, try **Make employee** or **Delete account** on yourself while
   you are the only officer: it is refused with the reason. Promote the employee first and it is allowed.

### How it was tested

- `npm test`: **187 pass, 0 fail**, offline, Gemini disabled. `tests/accounts.test.js` (new, 10 tests) covers: demo
  sign-in; invite and accept; a Google user with no invitation refused and no account created; employees refused
  on Settings and on 28 officer-only routes (and every one of them needs a sign-in when demo mode is off); the
  last compliance officer cannot be demoted or deleted; delete refused in the Demo workspace; a new workspace has
  no data but has the reference data; workspaces cannot see each other; a DDQ link opens the right workspace; a
  deleted person loses access at once and stays in the log by name. Google is replaced by a stand-in in tests.
- **Existing tests changed, by design:** five files (`api`, `monitoring`, `vessel`, `portal`, `phase2`) called
  routes with no sign-in; those calls now act as the demo compliance officer. One `phase2` test asserted that the
  header sets the role; it now asserts the opposite. The public-config key list gained `demoAccounts` and
  `googleSignIn`.
- In Chrome, on a local server with the Google stand-in: the login page, demo sign-in, Settings (invite, log,
  disabled delete), a created workspace's Globe, Reviews, Compliance, Sources and Policies screens, and the
  employee page of an invited person. No console errors.
- The app starts with the placeholders commented (demo accounts on, the two Google options showing "not set up").
- **Not tested, because it needs a live call:** the real Google buttons (Google Identity Services `renderButton`
  with `click_listener`), and real ID-token verification for sign-in and sign-up.

### Things you should know

1. **Restarts on Cloud Run wipe accounts and created workspaces**, like the demo data. The login page says "Demo
   version: accounts and data are not saved after the app restarts" there, and so does the banner. Locally the
   files stay; only the Demo workspace's account changes reset at each start.
2. **Reference data in a new workspace:** CPI scores, the built-in policy rules (without demo counterparties), the
   default scoring rules, the default CDDQ questionnaire, default monitoring settings, the sanctions and PEP
   screening, and the built-in **VesselFinder** source (locked, part of the app). The three demo sources are not
   carried over.
3. **Live Ask Dilly is Demo-workspace only for now.** The agents service's lookup tools read the Demo workspace, so
   in a created workspace Ask Dilly uses its built-in answers. Passing the workspace through the agent is a small
   follow-up in the Python service.
4. **Sessions saved in a browser before this phase are dropped**: the person sees the login page once.
5. A demo header (`x-user-email`) with an email that is not a demo account is treated as a Demo-workspace employee,
   as before. It can never be a compliance officer and can never reach a created workspace.
6. `/v1/screen` with no sign-in writes into the Demo workspace. A signed-in caller screens into their own.
7. Deleting an account does not rewrite history: past records store names and emails as text.
8. The Globe's country colours and the "Sample: 9 of 182 countries" legend still come from the page's built-in
   list in every workspace. That is reference data, but the wording is from the demo.
