# CLAUDE.md: DueDilly AI build

You are building the AI layer of **DueDilly** for a Google hackathon. Read this whole file before doing anything.
Then do **Phase 0** only: read the repo, ask the questions in section 9, and wait for the answers.

---

## 1. How to work

1. **Take your time.** There is no prize for speed. Read before you write, plan before you code, and check every
   step. A small correct change beats a large fast one. If you are unsure, stop and ask.
2. **Work the way Antigravity (`agy`) works in this repo**, so either tool can pick up where the other stopped:
   - Read `GEMINI.md` first and follow its protocol, except where this file says otherwise.
   - Keep three working files in `docs/agent/`, in Antigravity's style:
     - `implementation_plan.md`: the plan for the current phase (goal, files to change, risks, how you will verify).
       Show it to the user and wait for approval before coding.
     - `task.md`: a checklist of the phase's tasks, ticked off as you go.
     - `walkthrough.md`: after each phase, what changed, how to see it in the app, how it was tested.
   - Be accurate about who did what. Do not change commit authorship or tool attribution.
3. **One phase at a time** (section 8). After each phase, stop, update `walkthrough.md`, summarise in chat, and wait.
4. **Never create, change or delete a billable Google Cloud resource yourself.** Write the `gcloud` / `bq` commands
   into `scripts/` and let the user run them. Read-only commands are fine once the user has set up `gcloud`.
5. **No model training.** Fine-tuning, Vertex AI custom training and BigQuery ML `CREATE MODEL` are on hold (KIV).
   Use only pre-trained or zero-shot capabilities: Gemini, embeddings, `AI.FORECAST`, `AI.DETECT_ANOMALIES`.
6. **Do not guess APIs.** Before using any Google API, SQL function, ADK class or model ID, read the installed
   package's types or the current official docs. If something differs from this file, the docs win. Tell the user.
7. **Do not invent data.** Demo data must be fictional and labelled as demo. If a feature needs data that does not
   exist (history for forecasting, AIS tracks), ask before generating synthetic data, and label it "synthetic demo
   data" wherever it appears.
8. Do not rename existing identifiers, env vars, API routes, storage paths or data fields. Add new ones only.
9. Every cloud feature needs an **offline fallback** for `APP_ENV=dev`, and the test suite must keep running offline
   with Gemini disabled. The UI shows when a fallback is in use (e.g. "Offline sample").
10. Keep the hackathon requirements on the main demo path: **Google AI Studio, Google ADK, Cloud Run, Antigravity.**
11. **Placeholders, not secrets.** Every key, ID, URL or account the app needs goes in `.env.example` as a
    **commented placeholder block** in this exact shape, so the user only has to uncomment and paste:
    ```
    # --- <What it is>. Get it: DEPLOY_GUIDE.md step <n>.
    # Fallback if left commented: <what the app does instead>.
    # <VARIABLE_NAME>=paste-here
    ```
    The app must start and run with **every** placeholder still commented (all offline fallbacks). Never hard-code a
    value, never commit a filled-in `.env.dev` or `.env.uat`, and keep secrets for Cloud Run in Secret Manager.
    If the repo already has a variable for the same thing, keep its name (rule 8) and use it in the block.
12. **Keep `DEPLOY_GUIDE.md` true.** It is the user's step-by-step guide to getting every key and deploying. Each
    time you add or change a variable, script, secret, topic or service, update the matching step in
    `DEPLOY_GUIDE.md` in the same change, with the exact variable names and commands the code really uses.
13. **Ask before going live** (section 9.1). Build and test everything against placeholders and fallbacks first.
    Do not call a real Google Cloud service, or the deployed Cloud Run services, until the user says yes.

---

## 2. Background

**DueDilly** (formerly Safe Globe) is a third-party risk and KYC screening app. It screens organisations, people and
vessels against sanctions, PEP, adverse media, ownership and country risk, keeps monitoring them, and sends
due diligence questionnaires (DDQs) to counterparties. Its mascot is **Dilly**, a professional duck who is the face
of the AI compliance agent. Tagline: "Get your ducks in a row."

**Tabs:** Globe (map with watchlist, Ripples alert ticker, Pond forecast layer, Duckling trail ownership arcs),
Reviews (case queue, risk-by-confidence chart, calibration), Compliance, DDQ (portal and DDQ compliance),
Sources (custom lists, APIs, websites, Readable Source Intelligence), Policies.

**What is in the repo today** (from the last discovery; confirm in Phase 0):
- Node.js app. Google Cloud project `safe-globe-compliance`, region `asia-southeast1`.
- Data in SQLite (`src/db/sqlite.js`, about 1,600 lines). 125 tests run against it.
- A shared Gemini client with model fallback (`gemini-flash-lite-latest`, then `gemini-flash-latest`, then
  `gemini-3.1-flash-lite`) and a "Gemini disabled" mode used by tests.
- `src/agents/framework.js` is a custom agent runtime that reserves an `adk` option but does not use ADK yet.
- Policy text is hard-coded in `src/services/policyRagService.js`. The only policy file is
  `Supplier CDDQ Policy Template.md`.
- `src/services/documentParserService.js` is a placeholder for Document AI (`DOCUMENT_AI_*` env vars).
- `src/services/documentStorage.js` stores DDQ uploads behind a save/read interface.
- **Google ADK is already installed.** Find which package and version (check `package.json` and any Python
  environment), use that installed version, and do not install a different ADK.

**Specs that already exist** (read whichever are present; this file wins on AI features):
`GEMINI.md`, `DUEDILLY_REBRAND.md`, `DDQ_DUCKS.md`, `docs/CLOUD_PLAN.md`.

### 2.1 The original specification, and how it fits

The project started from an earlier specification. Do not rebuild what already works. Close the gaps as follows:

| Area | Original specification | Today | Plan |
| --- | --- | --- | --- |
| Backend | FastAPI, Pydantic, Google GenAI SDK | Node.js with Express 5 | Keep Express for the app. **Only if the installed ADK is the Python one**, put the ADK agents (features 1, 3, 6, 8, 9) in a small FastAPI service with Pydantic models and the Google GenAI SDK, deployed as its own Cloud Run service (`duedilly-agents-<env>`). Express calls it over HTTP with service-to-service authentication. If the installed ADK is not Python, skip this row. |
| Staff sign-in | Google One-Tap or Firebase Auth | Google sign-in, demo persona picker | Keep Google sign-in as the main path. Show the persona picker only when `DEMO_MODE=true`. |
| Counterparty access | One-time signed link, locks after submit | Built | No change. |
| Document reading | gemini-2.5-flash, structured JSON | Built, on the flash-lite fallback chain | Feature 14 uses structured JSON output with a response schema. Choose the model from the list available on Vertex AI (question 8); do not pin a model ID without checking it is available. |
| Policy check | Gemini RAG over `kyc_policy.pdf` | Built, on local policy text | Feature 12: Agent Search indexes `kyc_policy.pdf` (question 15) plus one file per policy section. Local text stays as the offline fallback. |
| DDQ dispatch | Automatic email to the counterparty | Link generated, sent by the employee | Feature 16. |
| Officer actions | Approve, Reject, Request More Info | Approve, Reject, Bounce back | Feature 17. |
| Deployment | Dockerfile on Cloud Run, PORT 8080 | Built | No change. |

---

## 3. The goal

When you are done:
1. **All 14 high-appeal features (section 6, items 1 to 14) are present**, visible in the app, and demo-able on
   the UAT link.
2. **A user can see exactly how the AI reaches a risk score**: what it read, what it understood, which rule gave
   which points, how sure it is, and why the case went to its route.
3. **Every Google service in section 5 is used and named** where the user can see it, on the "How Dilly works"
   page (feature 15 in section 6).
4. The demo story in section 7 runs end to end in about 3 minutes.

---

## 4. How the risk score works (implement exactly; the user must be able to read it)

### 4.1 The principle
**The AI understands; the rules score; a person decides.**
- Gemini reads sources and turns them into **findings**: structured facts, each with a quote and a source.
- A deterministic function turns findings into **risk points** using the table below. The AI never picks the number.
- **Confidence** is calculated separately from the evidence quality.
- The **route** comes from risk and confidence. A person signs every decision.

### 4.2 The pipeline the user sees
Show this as a 6-step strip in the entity drawer and on the "How Dilly works" page:
1. **Read**: which sources were read, and when.
2. **Understand**: Gemini extracts findings, each with a quote and a link.
3. **Check**: each finding is matched to a rule in the points table.
4. **Score**: points are added up (capped at 100).
5. **Weigh**: confidence is calculated from the evidence.
6. **Route**: the route is set, and a person decides.

### 4.3 Single source of truth
Put the points table, bands and thresholds in one config file (e.g. `src/risk/points.config.js`). The scorer, the
"Why <score>?" panel and the "How Dilly works" page all read from it. Nothing is hard-coded twice.

### 4.4 Risk levels
| Level | Points | Colour |
| --- | --- | --- |
| Low | 0 to 49 | Green |
| Medium | 50 to 74 | Amber |
| High | 75 to 100 | Red |

The 50-point line matches the line already drawn on the Reviews risk-by-confidence chart. Keep it.

### 4.5 Points table
Each row counts **at most once per case**. The total is capped at 100.

| Finding | Points | Policy |
| --- | --- | --- |
| Confirmed sanctions match: name plus a second identifier (date of birth, registration number or IMO) | Set to 100, always Escalate | Sanctions lists |
| Possible sanctions match: name only, strong similarity | +40 | |
| Director, shareholder or beneficial owner is a PEP | +25 | §3.6 |
| Family member or close associate of a PEP | +15 | §3.6 |
| Country CPI below 40 | +20 | §4.1 |
| Country CPI 40 to 59 | +10 | Proposed, not in policy yet |
| Severe adverse media in the last 24 months (fraud, bribery, sanctions evasion) | +25 | |
| Other adverse media in the last 24 months | +10 | |
| Ownership unclear (nominees, bearer shares, offshore holding, beneficial owner unknown) | +15 | |
| Broker or intermediary | +10 | §5.2 |
| Vessel: AIS dark for more than 24 hours in the last 90 days | +20 | §5.4 |
| Vessel: ship-to-ship transfer in a high-risk area | +20 | §5.4 |
| Vessel: 2 or more flag changes in 3 years | +10 | §5.4 |
| Contract value above SGD 100,000 | +5 (and sends a DDQ) | §2.1 |
| DDQ answer contradicts the evidence | +15 | |
| DDQ not returned after 14 days | +10 | |

- **Country:** use the riskiest of the country of incorporation or registration, the operating address country, the
  flag state (vessels) and the country of residence (people). It counts once. Use the CPI 2025 data already in the
  app. CPI is the one score where low means bad; converting it to risk points means every number the user sees
  points the same way: higher is riskier. Say this in the UI.
- **Worked example to test:** Aurora Venture. AIS dark 31 hours (+20), ship-to-ship transfer (+20), flag changed
  twice since 2024 (+10), Cameroon flag with CPI below 40 (+20), ownership unclear (+15) = **85, High**. Expect 85
  only if the app's data matches these facts. If it does not, report the difference. Do not force the number.
- Existing demo scores (88, 86, 78, 92, 84) will change under this table. Recompute them from findings and list
  before and after in `walkthrough.md`.

### 4.6 Confidence (proposal: show it to the user and get approval in Phase 0)
- Per finding: `source trust × match strength × freshness`
  - Source trust from the Sources tab: High 1.0, Medium 0.75, Low 0.5
  - Match strength: second identifier 1.0, strong name match 0.75, weak name match 0.5, not a name match 1.0
  - Freshness: read within 30 days 1.0, within 12 months 0.85, older 0.7
  - A second independent source for the same finding adds 0.15 (capped at 1.0)
- Case confidence with findings = the average of the counted findings' confidence, weighted by their points.
- Case confidence with no findings = coverage: the share of required checks that ran and returned a sourced
  result (sanctions, PEP, adverse media, ownership, country, and the vessel checks for vessels). A clean result is
  only "high confidence" when the checks actually ran.
- Show the parts of the calculation in the existing "What drives the confidence" list.

### 4.7 Routes
| | Confidence under 80% | Confidence 80% or more |
| --- | --- | --- |
| **Risk 50 to 100** | Investigate | Escalate |
| **Risk 0 to 49** | Fill the gaps | Auto-clear |

- A confirmed sanctions match always goes to Escalate, whatever the confidence.
- The route is computed, never chosen by the AI.
- Dilly poses (from the loader spec): Auto-clear → `dilly_done.svg`; Investigate → `dilly_medium.svg`;
  Escalate caused by a sanctions match → `dilly_sanctions.svg`; Escalate for any other reason → `dilly_medium.svg`;
  errors → `dilly_error.svg`.

### 4.8 Findings format
Gemini returns findings through structured output (a response schema), validated before saving:
`id, category (one of the points-table rows), subject, summary, evidence_quote (exact, max 300 characters),
source_name, source_url, source_trust, read_at, match_basis (second_identifier | strong_name | weak_name | not_name),
corroborating_sources[], agent, model_id, prompt_version`.
- **No source, no points.** A finding without `source_url` is rejected. The one exception is a DDQ fact, which cites
  the DDQ answer ID.
- Store every finding, including rejected ones with the reason, so the user can audit.

### 4.9 The "Why <score>?" panel
In the entity drawer under the risk card: one row per counted finding with its points, its rule, its policy clause,
a short summary, the quote, and a link to the source. Below it, the total, the level, the confidence parts and the
route. Plain words, no jargon.

---

## 5. Google technology map (all of these must be used and named)

| Google technology | Used for (feature numbers from section 6) |
| --- | --- |
| **Gemini on Vertex AI** (Vertex AI is now part of Gemini Enterprise Agent Platform) | 1 to 10 and 14, in UAT and Cloud Run |
| **Google AI Studio** (Gemini API key) | Dev, offline-friendly testing and prompt prototyping; same shared client |
| **Google ADK** (the installed version) | 1 Pond-Guard, 8 Ask Dilly, 3 and 9 crawler agents, 6 Quack-Back |
| **Grounding with Google Search** | 1, adverse media sub-agent only |
| **Gemini URL context tool** | 8, when a user pastes a link into Ask Dilly |
| **BigQuery** | Event tables, 4 Pond forecast (`AI.FORECAST`), 13 AIS anomalies (`AI.DETECT_ANOMALIES`), 11 name matching (`AI.GENERATE_EMBEDDING` and `VECTOR_SEARCH`), calibration |
| **Agent Search** (formerly Vertex AI Search) | 12 policy search |
| **Document AI** (Form Parser) | 14 Duck-Scanner |
| **Pub/Sub** | Events: `screening-requested`, `screening-completed`, `ddq-submitted`, `alert-raised`, `rescreen-due`, plus a new `source-changed` |
| **Cloud Scheduler** | Crawler runs and daily `rescreen-due` |
| **Cloud Run** | `duedilly-dev` and `duedilly-uat` |
| **Cloud Storage** | Source page snapshots, DDQ uploads, policy files for Agent Search |
| **Secret Manager** | AI Studio key, Gmail OAuth token and other secrets |
| **Gmail API** | 16 automatic DDQ email |
| **Google sign-in** | Staff sign-in (already built) |
| **Google GenAI SDK and FastAPI** (only if the installed ADK is Python, see 2.1) | The agents service for features 1, 3, 6, 8 and 9 |

- List the Gemini model IDs available to the project on Vertex AI before choosing any. Keep the existing AI Studio
  fallback chain unchanged.
- For BigQuery AI functions, read the current function reference for exact arguments and any required connection
  (some functions need a Cloud resource connection with the Vertex AI User role). Write the setup into a script.
- Follow the installed ADK's documented limits on built-in tools. Some versions allow only one built-in tool per
  agent or need it wrapped as an agent tool. Keep Google Search in its own sub-agent if needed.

---

## 6. The features

Each feature needs: the UI the judge sees, an offline fallback, tests, and a line on "How Dilly works".

**Very high appeal**

1. **Pond-Guard agents** (Entity drawer). An ADK coordinator runs sub-agents for sanctions, PEP, adverse media,
   ownership and (for vessels) vessel behaviour, in parallel where the installed ADK supports it. Sanctions and PEP
   agents use the app's lists, not the open web. The adverse media agent uses Grounding with Google Search. Each
   agent returns findings (section 4.8). The drawer shows each agent's progress live, then its findings.
   *Done when:* screening Aurora Venture shows each agent's findings with links, and the score and route follow
   from the points table.
2. **"Why <score>?" panel** (Entity drawer). As specified in section 4.9. *Done when:* every point on screen traces
   to one finding, rule and source.
3. **Source crawler agents** (Sources). One ADK agent per website source. It checks `robots.txt` and the site's
   terms, fetches the page with an identifying user agent and a polite rate limit, stores a snapshot in Cloud
   Storage (dev: local folder), and has Gemini extract organisations, people and vessels into Readable Source
   Intelligence with the source link and read time. It compares with the previous snapshot and publishes
   `source-changed` when something changed. Runs on Cloud Scheduler. Never reads pages behind a login.
   *Done when:* a changed demo page (use a fixture in dev) produces new records and a ripple.
4. **Pond forecast** (Globe layer). Daily alert counts per country (and per sea lane for vessels) in BigQuery.
   `AI.FORECAST` gives a 90-day outlook with a confidence band. Gemini writes a two-sentence reason **only from the
   top alert categories computed in SQL**. Label it "Forecast, not a finding". It never adds risk points.
   *Done when:* the layer shows the outlook and band for at least the demo countries. If history is synthetic,
   the legend says so.
5. **Reviewer copilot** (Reviews). Gemini drafts a case summary and a decision reason that cites finding IDs and
   policy clauses. The suggested route is the computed route. The reviewer must edit or confirm before saving.
   Store both the draft and the final text. Label the draft "AI draft".
6. **Quack-Back chat** (DDQ portal). An ADK agent (Dilly) asks the supplier the DDQ questions section by section,
   follows up when an answer is vague or fails a DDQ check, and writes answers into the same DDQ fields. The
   supplier reviews everything before submitting. Save the transcript.
7. **Answer verification** (DDQ compliance). Compare DDQ answers with findings: e.g. 3.2 "No PEP" against a PEP
   finding, 2.8 beneficial owners against ownership findings, 7.7 vessels against vessel records, section 5
   violations against adverse media. Each contradiction is shown with both sides quoted. Any contradiction adds the
   "DDQ answer contradicts the evidence" points once.

**High appeal**

8. **Ask Dilly** (Globe). An ADK agent with read-only tools over DueDilly data (search counterparties, get a case,
   list alerts, get a risk breakdown). Answers link to cases. It never changes data. Uses the URL context tool when
   the user pastes a link.
9. **Self-healing extraction** (Sources). When a source fails (layout changed, zero records, schema check fails),
   the agent proposes new extraction instructions and a test result. A person approves in the Sources tab. Never
   applied automatically.
10. **Ripples alert triage** (Globe). On `alert-raised` or `source-changed`, Gemini sets a severity, merges
    duplicates and writes a one-line "what changed". High severity publishes `screening-requested` for a re-screen.
11. **Smarter name matching** (screening). Embeddings of list names in BigQuery and `VECTOR_SEARCH` find candidate
    matches across spellings and scripts. Embedding similarity alone never confirms a sanctions match; only a
    second identifier does (section 4.5).
12. **Policy search** (Policies, and every route). Agent Search indexes one file per policy section (§2.1, §3.6,
    §4.1, §5.2, §5.4) plus the CDDQ template. Each route shows the clause it relied on. The hard-coded text stays as
    the offline fallback.
13. **AIS anomaly checks** (Vessels). `AI.DETECT_ANOMALIES` on per-vessel series (dark hours, speed, loitering)
    flags unusual behaviour, which becomes a vessel finding with the data as its source.
14. **Duck-Scanner** (DDQ). Document AI Form Parser reads a returned DDQ PDF. Gemini maps the fields to DDQ question
    numbers with a confidence per field. Low-confidence fields are highlighted for the supplier to confirm. Never
    submits on its own.

**Transparency**

15. **"How Dilly works" page**. The 6-step pipeline, the points table and routes (read from the config in 4.3),
    the confidence formula, and a list of every Google technology in section 5 with what it does in DueDilly and
    its live status: Connected, or Offline fallback.

**Specification alignment** (from section 2.1)

16. **Automatic DDQ email** (DDQ). When a DDQ is sent, DueDilly emails the counterparty the one-time link through
    the Gmail API, using OAuth for the sending account the user names (service accounts cannot send from a
    personal Gmail address). Store the token in Secret Manager. While `DEMO_MODE=true`, only send to addresses on an
    allowlist (e.g. `example.com` and the user's own addresses); show anything else as "not sent: not on the demo
    allowlist". The "copy link" button stays as the fallback, and dev never sends email. Record sent time and status
    on the DDQ.
17. **Request more info** (Reviews). Change the button label "Bounce back" to "Request more info". Keep the stored
    action value and route unchanged (rule 8). The officer picks the questions or sections that need more; Dilly
    drafts targeted follow-up questions, the officer edits and confirms them, and they go to the counterparty
    through Quack-Back (feature 6) and the same email path (feature 16). The case shows "Waiting for counterparty".

---

## 7. The demo story (it must run end to end)

1. The vessel **Aurora Venture** goes dark for 31 hours, then does a ship-to-ship transfer. A **Ripple** fires.
2. **Pond-Guard** agents screen it live and return sourced findings.
3. The **"Why 85?"** panel adds up the points. The route turns to **Escalate** and Dilly shows the matching pose.
4. The **reviewer copilot** drafts the reasoning. A person edits and decides.
5. **Quack-Back** sends a DDQ to the ship manager, Halcyon Marine Services, asking for voyage records.
6. **Duck-Scanner** reads the returned PDF. **Answer verification** flags any contradiction.
7. **Pond forecast** shows the risk outlook for that sea lane over the next 90 days.

---

## 8. Phases

Follow this order. Each phase starts with `implementation_plan.md` and ends with `walkthrough.md`.

| Phase | Contents | Gate (must work before moving on) |
| --- | --- | --- |
| 0 | Read the repo and specs; ask section 9 questions; no edits | Answers recorded in `docs/agent/decisions.md` |
| 1 | Scoring engine, points config, confidence, routes, findings schema, "Why <score>?" panel, pipeline strip (no cloud needed) | Aurora Venture scores from findings, offline, with tests for every points row |
| 2 | Gemini on Vertex AI in the shared client; the FastAPI agents service if 2.1 applies; ADK: Pond-Guard (1), Ask Dilly (8) | Pond-Guard screens Aurora Venture live on UAT |
| 3 | Pub/Sub and Cloud Scheduler wiring; crawler agents (3), self-healing (9), Ripples triage (10); Agent Search policy search (12) | A changed page creates a ripple and a re-screen |
| 4 | BigQuery tables and connection; name matching (11), Pond forecast (4), AIS anomalies (13), calibration from decisions | Forecast and anomalies visible on UAT |
| 5 | Reviewer copilot (5); Duck-Scanner (14); Quack-Back (6); answer verification (7); automatic DDQ email (16); Request more info (17) | A DDQ is emailed, comes back, is read and checked, and a follow-up can be requested |
| 6 | "How Dilly works" page (15); persona picker behind `DEMO_MODE`; full demo story; README and pitch notes | The 3-minute story runs on the UAT link |

---

## 9. Questions to ask the user in Phase 0 (all in one message, then wait)

Check `docs/CLOUD_PLAN.md`, `GEMINI.md` and `docs/agent/decisions.md` first, and only ask what is not answered there.

1. **Deadline:** What is the exact submission date and time? It sets the phase dates.
2. **Cloud access:** Is `gcloud` installed and signed in (`gcloud auth login` and
   `gcloud auth application-default login`)? Is billing linked to `safe-globe-compliance`?
3. **ADK:** Which ADK package and version did you install, and where (Node package or Python environment)?
4. **Points and confidence:** Approve the points table (4.5) and the confidence formula (4.6) as written, or
   change any numbers?
5. **"Strong name match":** What similarity counts as strong? Proposal: I measure on the demo lists and suggest a
   threshold for you to approve.
6. **Crawler sources:** Which website URLs should the crawler agents read, and how often? Have you checked their
   terms allow automated reading?
7. **Synthetic data:** May I generate labelled synthetic history for the forecast (about 12 months of daily alert
   counts) and demo AIS tracks for the vessels? Without history, `AI.FORECAST` has nothing to forecast.
8. **Models:** After I list the Gemini models available on Vertex AI, which should Pond-Guard and the copilot use?
9. **Sanctions and PEP lists:** Which lists in the app count as authoritative for a confirmed match?
10. **Document AI:** Has the Form Parser processor been created? What is its ID and location?
11. **Agent Search:** Has the `duedilly-policies` data store been created, and in which location?
12. **Pub/Sub:** Approve the new `source-changed` topic?
13. **Spend:** Any limit on AI calls per demo beyond the per-IP rate limit (e.g. a daily cap on Pond-Guard runs)?
14. **Agents service:** If the installed ADK is the Python one, approve a separate FastAPI agents service (section
    2.1)? It means two Cloud Run services to deploy instead of one.
15. **`kyc_policy.pdf`:** Do you have this file? If not, may I build it from the policy sections and the CDDQ
    template, labelled as a demo policy?
16. **Email:** Which Google account should send DDQ emails, and which addresses go on the demo allowlist?
17. **Request more info:** Approve renaming the "Bounce back" button label to "Request more info", with the stored
    value unchanged?

### 9.1 Checkpoint before calling live services (ask every time a service goes live for the first time)

When a phase's code works against placeholders and fallbacks, and before the **first** real call to any of these:
Gemini on Vertex AI, BigQuery, Pub/Sub, Cloud Scheduler, Cloud Storage, Agent Search, Document AI, Gmail API,
Secret Manager, or the deployed Cloud Run services (including Express calling the agents service), stop and ask,
in one message:

> "The placeholders for **<services>** are done and everything works on fallbacks. To go live I need
> `DEPLOY_GUIDE.md` steps **<n, n>** done and these lines filled in `.env.<env>`: **<VARIABLE_NAMES>**.
> Have you done that, and may I start calling **<services>** now? If not, I will keep using the fallbacks:
> **<what the user will see>**."

Then wait. If the user says no, carry on with the fallback and note it in `decisions.md`. After the first live
call, report what worked, what it cost if you can tell, and any error with its fix.

Fallbacks to build (each must be visible in the UI as "Offline fallback" on the "How Dilly works" page):

| Service | Fallback when its placeholder is commented or the call fails |
| --- | --- |
| Gemini (AI Studio and Vertex AI) | The existing "Gemini disabled" mode with clearly labelled offline samples |
| ADK agents service (if 2.1 applies) | The agents run in-process in Express through the existing framework, or show offline samples |
| BigQuery | Local tables in the app's database; forecast and anomalies from labelled sample results |
| Pub/Sub and Cloud Scheduler | Events handled in-process (`PUBSUB_MODE=inline`); the dev emulator when available; a "Run now" button instead of the schedule |
| Cloud Storage | `STORAGE=local`, with the "Data resets when the app restarts" banner on Cloud Run |
| Agent Search | The local policy text in `policyRagService.js` |
| Document AI | The existing Gemini document auto-fill reads the PDF directly |
| Gmail API | The "copy link" button, as today |
| Google sign-in | The persona picker when `DEMO_MODE=true` |

---

## 10. Guardrails (say these in the pitch too)

- The AI finds and classifies facts. It never sets the risk number or the route.
- No source, no points. Every finding has a link and the time it was read.
- A person signs every decision. Auto-clear only for risk below 50 with confidence of 80% or more, and samples are
  re-checked.
- A confirmed sanctions match always goes to Escalate.
- Forecasts are labelled as forecasts with their band, and never count as findings.
- Crawler agents respect `robots.txt` and site terms, and never read behind a login.
- The free AI Studio tier is for fictional demo data only. Real counterparty data goes through Gemini on Vertex AI.
- Every endpoint that calls Gemini, Document AI or Agent Search has a per-IP rate limit and a friendly message.
- No model training (rule 5). If a feature seems to need it, stop and ask.

---

## 11. Definition of done

- [ ] All 17 items in section 6 work on the UAT link, and each has an offline fallback in dev
- [ ] Every "Plan" in section 2.1 is done or explicitly skipped with the reason recorded in `decisions.md`
- [ ] The app starts with every `.env.example` placeholder still commented, and each fallback in 9.1 works
- [ ] `DEPLOY_GUIDE.md` matches the real variable names, scripts, secrets and services, step by step
- [ ] Every risk point on screen traces to a finding, a rule and a source
- [ ] The "How Dilly works" page names every Google technology in section 5 with its live status
- [ ] The demo story in section 7 runs end to end
- [ ] All tests pass offline with Gemini disabled; new tests cover every points row, the confidence formula,
      routes, the findings schema and each agent's output parsing
- [ ] `docs/agent/walkthrough.md` explains how to see each feature, with before and after demo scores
- [ ] `README.md` has a short "How the AI works" section and the list of Google technologies used
