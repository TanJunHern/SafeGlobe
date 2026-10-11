# Implementation plan: Accounts phase (roles, workspaces, sign-in, Settings)

Status: **approved by the user on 12 Oct 2026 (answers in `decisions.md`) and built. See `walkthrough.md`.**
Requested by the user on 12 Oct 2026, to run before the remaining AI phases.
The Phase 2 plan is kept as `implementation_plan.phase2.md` (its section 9.1 checkpoint is still open).

## Goal and gate

Judges get in with one click on a demo account. A real person can sign in with Google, create their own empty
workspace, and control who else gets in from a Settings tab. Roles are checked on the server for every request.

Gate: the seven test groups in the request pass offline, the existing suite still passes, and the app starts with
every `.env.example` placeholder commented.

## What the repo does today (read on 12 Oct 2026)

- **Two personas only**: John Doe (`john.doe@duedilly.com`, `employee`) and Grace Teo (`compliance@duedilly.com`,
  `compliance_officer`). They are defined in `safe-globe.html` and `employee-portal.html`.
- **The browser says who it is.** In demo mode the page sends `x-user-email`, `x-user-role` and friends, and the
  server believes the role (`src/middleware/auth.js:68`). An email containing the word "compliance" is also an
  officer in demo mode.
- **Google sign-in** verifies the ID token and takes the role from `COMPLIANCE_OFFICER_EMAILS`. Anyone with a Google
  account gets in as an employee. There are no accounts, invitations or sessions; the Google ID token is re-sent on
  every request and expires after about an hour.
- **One database, one workspace.** `getDb()` returns a single SQLite file. About 120 call sites, all at request
  time, none at module load.
- **Many routes have no sign-in check at all**, including the final case decision. See the table below.
- An "empty workspace" mode already exists (`npm run demo:clean`, `placeholder_data=false`): schema plus CPI
  scores, nothing else, and the page drops its built-in demo counterparties (`window.DUEDILLY_NO_PLACEHOLDERS`).

## Design

### 1. Roles

The stored values stay `compliance_officer` and `employee` (rule 8). Labels: "Compliance officer", "Employee".

- Grace Teo becomes Compliance officer. John Doe becomes Employee. There are no other personas.
- The role always comes from the account record on the server. `x-user-role` is no longer read.
- The "email contains compliance" shortcut is removed.

### 2. Accounts store (`src/accounts/`, new)

A separate SQLite file next to the main one (`data/accounts.db`, path derived from `DATABASE_PATH`), because sign-in
has to find the account before it knows the workspace.

| Table | Fields |
| --- | --- |
| `workspaces` | id, name, is_demo, created_by, created_at |
| `accounts` | id, workspace_id, email, name, role, status (`invited` or `active`), is_demo, invited_by, invited_at, last_sign_in_at, created_at |
| `account_audit` | id, workspace_id, actor_name, actor_email, action, target_name, target_email, detail, at |

- One email belongs to one workspace (question 4).
- An invitation is an `accounts` row with status `invited`. It becomes `active` on the first Google sign-in with the
  same email.
- Deleting removes the `accounts` row. The audit log and every past record keep the person's name as text, so
  history still shows who did what.
- The last-officer rule is one function used by role change and delete: it refuses, with the reason
  "A workspace must always have at least one compliance officer."
- Demo workspace accounts (Grace, John, and anything invited there) are rebuilt at every start, so changes reset.
  Delete in the Demo workspace is refused on the server with "Not available in the demo".

### 3. Workspace isolation: one database file per workspace

`getDb()` keeps its name and signature. It returns the database of the current request's workspace, held in
Node's `AsyncLocalStorage` and set by the auth middleware.

- Demo workspace: the existing file (`DATABASE_PATH`), seeded as today. Code that runs outside a request (startup
  seeding, scripts, tests) gets this one, as today.
- A new workspace: `data/workspaces/<workspace id>.db`, opened in the existing empty mode. No counterparties, cases,
  alerts, watchlist, DDQs, reviews, custom sources, documents or settings.
- Uploaded documents of a new workspace go under `data/workspaces/<workspace id>/uploads`.
- Why this way: none of the 120 call sites change, no table gets a new column, and data cannot leak between
  workspaces through a forgotten `WHERE` clause. The cost: no cross-workspace queries, which nothing needs.
- DDQ links: the counterparty has no account, so new DDQ tokens carry the workspace id as an extra claim. A token
  without it resolves to the Demo workspace, so existing links keep working.
- `/internal/ask-tools` (called by the agents service) gets the workspace id passed with the request.

Reference data that every workspace gets, because it is part of the app:

| Reference data | Where it lives |
| --- | --- |
| Sanctions lists, PEP data | Code (`src/services/screening.js`); shared already |
| CPI 2025 scores | Seeded into every database, as the empty mode does today |
| Policy text | Code (`policyRagService.js`) plus the four policy rules, seeded without the demo counterparty "hits" |
| Default scoring rules (points table, bands, routes) | Code (`src/risk/points.config.js`); edits are per workspace |
| Default DDQ questionnaire (CDDQ template) | Created on first use, as today (**my addition**, question 6) |
| Default monitoring settings | Code defaults (**my addition**, question 6) |

Not carried over: the three demo sources (Group blocklist, Vendor X sanctions API, MAS enforcement actions). They
are demo custom sources, so a new workspace starts with none.

### 4. Sign-in and sessions

New routes (existing ones keep their paths):

| Route | What it does |
| --- | --- |
| `POST /api/auth/demo` | Only when `DEMO_MODE=true`. Body: which demo account. Returns a session for that account. |
| `POST /api/auth/google` | Verifies the Google ID token. Active account: session. Invited account: accept, then session. Neither: 403 with "You don't have access yet. Ask your compliance officer to invite you, or create your own workspace." Nothing is created. |
| `POST /api/auth/signup` | Verified Google ID token plus name and organisation name. Creates a new workspace and its first compliance officer. Refused if the email already has an account. |
| `GET /api/auth/session` | Existing. Now also returns the workspace (name, is_demo). |
| `POST /api/auth/switch-persona` | Existing. Kept; it now answers from the demo account records and ignores a `role` in the body. |

- The session is a token signed with the existing `JWT_SECRET`, holding only the account id, sent as `Bearer`. Role,
  status and workspace are read from the accounts store on every request, so a role change or a delete takes
  effect at once.
- `x-user-email` in demo mode: still accepted (the pages and 9 test files use it), but it can only ever resolve to
  the Demo workspace. A known demo account gets its stored role. Any other email is a Demo-workspace Employee, as
  today. An email that belongs to a real account is refused. The header never works when `DEMO_MODE` is off.
- `COMPLIANCE_OFFICER_EMAILS`: see question 3.
- No new environment variable is needed: `GOOGLE_CLIENT_ID`, `DEMO_MODE` and `JWT_SECRET` already have placeholder
  blocks. `DEPLOY_GUIDE.md` step 11 is rewritten to describe accounts, invitations and the three login options.

### 5. Who can do what on the server

Every `/api` route gets the sign-in check, except: health, `/api/config/public`, `/api/auth/*`, the counterparty DDQ
routes that carry a guest token, `/internal/ask-tools` (internal token), and `/v1/screen` if the user wants it left
open (question 2).

**Officer-only today, stays Compliance officer only:**

| Action | Route |
| --- | --- |
| Approve, reject or request more info on a KYC request | `POST /api/kyc/:id/triage` |
| Run the Compliance Agent on a request | `POST /api/kyc/:id/agent/run` |
| Monitoring defaults, apply to all, run due re-screens, change a schedule | `/api/monitoring` (4 routes) |
| DDQ questionnaire templates (list, import, edit, activate, delete) | `/api/ddq-templates` (all) |
| Scoring rules: edit, reset, accept or dismiss a recommended change | `/api/risk/rules...` (4 routes) |
| Cost per screen of a source | `PUT /api/sources/:id/cost` |
| The whole main app shell (Globe, Reviews, Compliance, DDQ, Sources, Policies) | Page only; employees are sent to `/portal/employee` |

**Employee today, stays Employee (officers can do these too):** create a KYC request, read documents into it, see
and export **their own** requests only, send a DDQ for their own request, change the status of their own request,
Ask Dilly about their own history.

**No check on the server today. Proposed role:**

| Action | Route | Proposed |
| --- | --- | --- |
| Record a case decision | `POST /api/cases/:id/decision` | Compliance officer |
| Add, delete, convert, retry, test a source | `/api/sources` (writes) | Compliance officer |
| Compile a policy into rules | `POST /api/policies/compile` | Compliance officer |
| Add a counterparty from the Globe | `POST /api/entities/intake`, `/api/intake` | Compliance officer |
| Send a DDQ, record answers from the Globe drawer | `POST /api/ddq/send`, `/answer` (staff side) | Compliance officer |
| Save a statement, claim a profile, raise an alert | `/api/statements`, `/api/claim`, `POST /api/alerts` | Compliance officer |
| Run Pond-Guard, AI screen, AI KYC | `/api/pond-guard/:id/screen`, `/api/ai/*` | Compliance officer |
| Upload or download workspace files | `/api/uploads` | Compliance officer |
| Read entities, cases, alerts, sources, policies, stats, scores, findings | the `GET` routes | Compliance officer (only the main app uses them) |
| Ask Dilly | `/api/ask`, `/api/pond-guard/ask` | Both |
| Address lookup | `/api/places/*` | Both |
| Settings (accounts, invitations, audit log) | `/api/settings/*` (new) | Compliance officer |

This matches what each persona can reach in the pages today, so nothing a persona does now stops working.

### 6. Login page

Three clearly separated options on the existing login screen:

1. **Try a demo account**: the two persona cards, each labelled "Demo". Hidden unless `DEMO_MODE=true`.
2. **Sign in with Google**: for an existing account or an invitation.
3. **Create an account**: Google sign-in, then a short form (name, organisation name).

Without `GOOGLE_CLIENT_ID`, options 2 and 3 are shown as "Not set up" with a pointer to the demo account
(the offline fallback, rule 9).

### 7. Settings tab

- New "Settings" item in the left nav of `safe-globe.html`, shown only to compliance officers, backed by
  `/api/settings/*` which is officer-only on the server.
- Accounts list: name, email, role, status, last sign-in.
- Invite an employee by email (role fixed to Employee). Sending goes through one function, `sendInvite`. Feature 16
  (Gmail API) is not built yet, so today it returns "not sent" and the page shows a **Copy invite link** button.
  Phase 5 plugs the Gmail path into that function.
- Make an employee a compliance officer or the reverse; resend or cancel an invite; delete an account.
- In the Demo workspace the Delete button is shown disabled with "Not available in the demo".
- The account change log (who, what, when) is shown on the same tab.

### 8. Empty states

Each screen of a new workspace says what will appear there and how to add the first item: Globe watchlist, Ripples,
Reviews queue, Compliance queue, DDQ, Sources, Readable Source Intelligence, Policies, Settings invitations, and the
employee portal table. The page decides "empty workspace" from the session instead of from the server-injected
flag, so the built-in demo counterparties never show outside the Demo workspace.

## Files

| File | Change |
| --- | --- |
| `src/accounts/accountsStore.js`, `src/accounts/accountsService.js` | New: tables, demo seed, sign-up, invite, accept, role change, delete, audit, last-officer rule |
| `src/db/index.js` | `getDb()` picks the workspace database from the request context |
| `src/db/sqlite.js` | Constructor option for the empty mode (today it is an env var only); policy rules seeded in empty mode |
| `src/middleware/auth.js` | Sessions, account lookup, workspace context, role from the account |
| `src/routes/auth.js`, `src/routes/settings.js` | New |
| `src/server.js` | Mount the new routes; sign-in check on the open routes |
| `src/routes/*.js` | Role guards from the table in section 5 |
| `src/services/ddqService.js`, `documentStorage.js`, `kycService.js` | Workspace claim in DDQ tokens; per-workspace upload folder |
| `safe-globe.html`, `employee-portal.html`, `portal-shared.js`, `ddq-manager.html` | Login options, session token, Settings tab, empty states, "Demo" labels |
| `tests/accounts.test.js` | New; added to the `npm test` list in `package.json` |
| `tests/phase2.test.js` | One existing assertion expects the header to set the role; it changes to expect the opposite |
| `.env.example`, `DEPLOY_GUIDE.md` | Step 11 rewritten; `COMPLIANCE_OFFICER_EMAILS` block updated per question 3 |
| `docs/agent/task.md`, `walkthrough.md`, `decisions.md` | As usual |

## Risks

- **Cloud Run restarts wipe everything, not only the demo.** Accounts and new workspaces live in SQLite files on the
  container's disk, like the demo data today. On the UAT link a created workspace and its invitations are gone
  after a restart or a new deploy. The banner will say so in every workspace on Cloud Run. Keeping them would need
  a persistent store, which is a separate piece of work (question 5).
- **The sign-in check on previously open routes** can break a page that calls one without a session. I will walk
  each page after the change.
- **Time.** The submission is 16 Oct, 12:00 SGT, and Phases 3 to 6 are not started. This phase is roughly a day.
- Google sign-in cannot be tested for real until the section 9.1 go-ahead. Until then the tests use a stand-in
  verifier, and the walkthrough will mark that path "not yet tried live".

## How I will verify

- `tests/accounts.test.js`: demo sign-in; invite and accept; a Google user with no invitation is refused and no
  account is created; an employee gets 403 on Settings and on each officer-only route; the last compliance officer
  cannot be demoted or deleted; delete is refused in the Demo workspace; a new workspace has zero entities, cases,
  alerts, KYC requests, sources, uploads and settings, and still has CPI scores and policies; two workspaces
  cannot read each other's data; a DDQ link opens the right workspace.
- `npm test` passes offline with Gemini disabled.
- By hand in dev: each sign-in path, the Settings tab, and every empty state.

## Questions for the user

1. **Employees and the main app.** Today employees only get the table-only employee portal; the Globe, Reviews,
   Sources and Policies pages are officer-only. Keep that (my recommendation, least change), or let employees into
   the main app without Settings and without decision buttons?
2. **The role table in section 5.** Approve it as written, or change any row? Should `/v1/screen` (the open
   screening API) stay open, or need a sign-in?
3. **`COMPLIANCE_OFFICER_EMAILS`.** With accounts, an officer is whoever created the workspace or was promoted in
   Settings. I recommend the variable stops granting access (it stays in `.env.example`, marked "no longer used"),
   so `whitehathud@gmail.com` can demonstrate "Create an account". The alternative is to pre-register those emails
   as compliance officers of the Demo workspace, but then they cannot create their own workspace.
4. **One email, one workspace.** May I refuse "Create an account" for an email that already has an account or a
   pending invitation, with a message saying so?
5. **Cloud Run restarts.** Is it acceptable for the hackathon that created workspaces and accounts on the UAT link
   are lost on restart, with the banner saying so? Persisting them is extra work I would schedule separately.
6. **Reference data.** Besides sanctions lists, PEP data, CPI scores and policies, I plan to treat the default
   scoring rules, the default CDDQ questionnaire and the default monitoring settings as part of the app. Agreed?
