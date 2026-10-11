# Implementation plan: Phase 3 (events, crawler agents, self-healing, Ripples triage, policy search)

Status: **approved by the user on 12 Oct 2026. Build and test locally first; update the container when ready.**
Questions 3 to 6 were not answered, so the recommended defaults are used (see `decisions.md`).
Earlier plans are kept as `implementation_plan.phase1.md`, `implementation_plan.phase2.md` and
`implementation_plan.accounts.md`.

## Goal and gate

A changed web page creates a ripple and a re-screen: a crawler agent reads a website source, sees that the page
changed, writes the new records into Readable Source Intelligence, a `source-changed` event fires, Ripples triage
rates it, and a High rating asks for a re-screen of the counterparty it names. Every route shows the policy clause
it relied on, found by policy search. All of it works offline with every placeholder commented.

Features: 3 (source crawler agents), 9 (self-healing extraction), 10 (Ripples alert triage), 12 (policy search),
plus the Pub/Sub and Cloud Scheduler wiring.

## Where things stand before this phase

- Phase 2 runs live on Vertex AI from this computer (see `walkthrough.md`). The deploy to Cloud Run is the user's
  to run; the Phase 2 gate ("live on UAT") closes when the smoke test passes on the link.
- Already created by `scripts/gcp-setup.sh` (checked read-only on 12 Oct): the six topics per environment
  (including `uat-source-changed`), the scheduler job `duedilly-uat-rescreen-due`, both buckets, and these APIs
  enabled: Pub/Sub, Cloud Scheduler, Cloud Storage, Discovery Engine (Agent Search).
- `duedilly-run` has `roles/pubsub.publisher` and `roles/discoveryengine.user`, and object access on the buckets.
- Not there yet: push subscriptions, a crawler schedule, the `duedilly-policies` data store, the policy files.
- In the app today: `handleWebsite` in `src/services/sourceHandlers.js` fetches a page once (no `robots.txt`
  check, no snapshot, pattern-based extraction); alerts are rows in `alerts` with no severity; policy text is one
  string in `policyRagService.js`; the storage driver is local only (`DOCUMENT_STORAGE=firebase` is a stub).

## Step 0. Read the docs before using any API (rule 6)

Nothing below is coded until I have read the current reference for each call and noted the exact shape in
`decisions.md`. If a reference differs from this plan, the reference wins and I tell you.

| API | What I need to confirm |
| --- | --- |
| Pub/Sub REST `topics.publish` and push subscriptions | Message format of a push request; how to verify the OIDC token (issuer, audience, service account email) |
| Cloud Scheduler | An HTTP-target job with an OIDC token calling Cloud Run; free tier (3 jobs per billing account; we would use 2) |
| Cloud Storage JSON API | Upload and download of an object with a token from `google-auth-library` |
| Agent Search (Discovery Engine) | `servingConfigs.search` request and response; which file types an unstructured data store takes; import from Cloud Storage; price per 1,000 queries and which edition that is |
| ADK 2.11.0 | Read from the installed package, as in Phase 2: nothing new expected (`LlmAgent`, `output_schema`) |

No new npm package: Pub/Sub, Cloud Storage and Agent Search are called over REST with `google-auth-library`,
which the app already has, in the same way `geminiClient.js` calls Vertex AI.

## Step A. Events (`src/events/`)

1. `bus.js`: `publish(event, payload)` and `on(event, handler)`. Events: `screening-requested`,
   `screening-completed`, `ddq-submitted`, `alert-raised`, `rescreen-due`, `source-changed`.
   - `PUBSUB_MODE=inline` (default, and always in dev and tests): the handler runs in-process right after the
     current request, so nothing waits on it.
   - `PUBSUB_MODE=pubsub`: publishes to `<env>-<event>`; if the publish fails, the event is handled inline and the
     failure is logged, so an event is never lost to a network error.
   - Every payload carries the workspace id and an event id. Handlers are idempotent: a new table `events_seen`
     stores the ids handled, so a redelivery does nothing.
2. `POST /events/:event`: the push endpoint. Verifies the Pub/Sub OIDC token (audience and service account),
   answers 2xx only after the work is saved, 401 without a valid token. Not behind the user sign-in.
3. Where events are published: `db.addAlert` call sites publish `alert-raised`; Pond-Guard and the screening
   routes publish `screening-completed`; DDQ submit publishes `ddq-submitted`; the monitoring run and the daily
   job publish `rescreen-due`; the crawler publishes `source-changed`. Existing behaviour is unchanged when the
   mode is inline.
4. `scripts/pubsub-subscriptions.sh` (you run it, after the deploy): one push subscription per `uat-*` topic to
   `https://<uat link>/events/<event>`, signed as `duedilly-run`, with a dead-letter-free simple retry policy.
5. Cloud Scheduler: the existing daily `rescreen-due` job stays. One new job, `duedilly-uat-crawl-due`, calls
   `POST /events/crawl-due` on the app once a day with an OIDC token. That is job 2 of the 3 free ones.
   In dev, and whenever the schedule is not connected, the Sources tab has a **Run now** button instead.

New variables (placeholder blocks in `.env.example`, steps in `DEPLOY_GUIDE.md` step 7):
`PUBSUB_MODE`, `PUBSUB_PUSH_AUDIENCE`, `PUBSUB_PUSH_SERVICE_ACCOUNT`.

## Step B. Source crawler agents (feature 3)

One crawler agent per website source. The rules a crawler must never break are code, not prompt:

1. **Fetch pipeline in the app** (`src/services/crawlerService.js`), in this order:
   - `robots.txt` is fetched and obeyed for the user agent `DueDillyBot/1.0 (+<app link>/about-bot)`. Disallowed
     means the page is not read and the source shows "Blocked by robots.txt".
   - Terms: the source needs the tick "I have checked that this site's terms allow automated reading" (decision 6).
     Without it the crawler does not run. Built-in and fixture sources are ticked.
   - Never behind a login: a 401 or 403, a redirect to a sign-in page, or a page that is mostly a password form
     stops the run with "Needs a sign-in: not read". No cookies or credentials are ever sent.
   - Polite: one request at a time per host, at least 5 seconds apart, a 10 second timeout, 2 MB at most,
     HTML and plain text only.
2. **Snapshot** of each page read, with the read time and a hash of its text: Cloud Storage in UAT
   (`gs://duedilly-uat-<project>/snapshots/<workspace>/<source>/<time>.html`), a local folder in dev.
   `src/services/objectStorage.js` is a new small save/read driver; the DDQ upload driver keeps its interface,
   and `DOCUMENT_STORAGE` keeps its name with a new value `gcs` (the `firebase` stub stays as it is).
3. **Extraction by an ADK agent** (`agents/app/crawler.py`, `POST /crawler/extract`): an `LlmAgent` built per
   source (its name, its extraction instructions, the page text) with an `output_schema` of records: name, kind
   (organisation, person or vessel), country, identifier, what the page says, and the exact quote. The app checks
   each record (the quote must be in the snapshot) and stores it in `source_records` with the source link and
   read time. Extracted records are source intelligence, not findings: they add no points until a screening
   cites one, exactly as today.
   - Fallback (no agents service, or the cap reached): the existing pattern extractor, labelled "Offline sample".
4. **Change detection:** the new snapshot's hash against the previous one. When it differs, the records are
   compared by name and identifier, and `source-changed` is published with what was added, removed or changed.
5. **Sources tab:** per website source, the last read time, the result (read, unchanged, changed, blocked,
   needs sign-in, failed), a link to the snapshot, the "Run on every screening" tick (decision 6), the terms
   tick, and **Run now**.
6. **Demo fixture:** a fictional page served by the app itself at `/demo/port-notices` ("Demo: fictional"), with
   a button in the Sources tab, shown only when `DEMO_MODE=true`, that publishes a second version naming Aurora
   Venture. That is the "changed page" for the gate and for the demo story, on dev and on UAT.

## Step C. Self-healing extraction (feature 9)

When a crawl reads a page but the result is broken (zero records where the last run had some, or records that
fail the schema or the quote check), the crawler agent is asked for new extraction instructions for that source.
The proposal is tested at once against the stored snapshot and saved with its test result (records before,
records after, three examples) in a new table `source_proposals`. The Sources tab shows "Dilly suggests a fix"
with the old and new instructions and the test result; a compliance officer presses **Approve** or **Dismiss**.
Nothing is applied automatically, and every decision is logged with who made it.
Fallback: offline, the source shows "Extraction failed" with the reason, and no proposal.

## Step D. Ripples alert triage (feature 10)

On `alert-raised` and `source-changed`, `src/services/triageService.js` asks Gemini (the shared client, with a
response schema) for three things only: a severity (High, Medium or Low), whether this is the same thing as a
recent alert for the same counterparty (then they are merged and the ticker shows one line with a count), and a
one-line "what changed". New columns on `alerts`: `severity`, `what_changed`, `merged_into`, `triaged_by`.
The existing columns keep their names.

- Severity is a sorting aid for people. It is not a risk score and adds no points.
- **High** publishes `screening-requested`; its handler runs Pond-Guard on that counterparty, inside the daily
  cap (`POND_GUARD_DAILY_CAP`), and falls back to re-scoring the stored findings.
- Fallback with Gemini off: severity from fixed rules (sanctions or vessel-behaviour words are High, and so on),
  duplicates by exact match, labelled "Offline rules".
- The Ripples ticker and the drawer show the severity, the one line, and "re-screen requested" when it applies.

## Step E. Policy search (feature 12)

1. **Policy files**, built by `scripts/build-policy-files.js` into `docs/policies/` from the text already in
   `policyRagService.js` (not reworded): one file per section (§2.1, §3.6, §4.1, §5.2, §5.4), the CDDQ template,
   and `docs/test-docs/kyc_policy.pdf`, marked "Demo policy" on every page (decision 14).
2. **Agent Search:** `scripts/agent-search-setup.sh` (you run it) uploads the files to the UAT bucket and
   creates and fills the data store `duedilly-policies`. `DEPLOY_GUIDE.md` step 8 gets the exact commands, the
   console clicks if any are needed, and how to check it worked.
3. `src/services/policySearch.js`: `clauseFor(clauseId)` and `search(question)`. With Agent Search connected it
   returns the clause text, the file and a link; otherwise the local text. Answers are cached, and a daily cap
   (`AGENT_SEARCH_DAILY_CAP`) switches to the local text when reached.
4. **Every route shows its clause:** each row of the "Why <score>?" panel and the route line get the clause text
   from `clauseFor`, with "Agent Search" or "Offline fallback" beside it. The Policies tab gets a search box.
   `policyRagService.evaluatePolicyRAG` keeps its name and its local text.
5. One thing to decide (question 5 below): the policy says an AIS gap of more than **12** hours (§5.4) and the
   scoring rule says **24**. I will not change either without your say.

New variables: `AGENT_SEARCH_DATA_STORE`, `AGENT_SEARCH_LOCATION`, `AGENT_SEARCH_DAILY_CAP`.

## Files

| New | Changed |
| --- | --- |
| `src/events/bus.js`, `src/routes/events.js` | `src/server.js`, `src/config.js`, `src/db/sqlite.js` (new tables and columns only) |
| `src/services/crawlerService.js`, `objectStorage.js`, `triageService.js`, `policySearch.js` | `src/services/sourceHandlers.js` (website sources go through the crawler), `src/routes/sources.js`, `alerts.js`, `policies.js` |
| `agents/app/crawler.py` | `agents/app/main.py`, `agents/app/models.py`, `src/services/agentsClient.js` |
| `scripts/pubsub-subscriptions.sh`, `agent-search-setup.sh`, `build-policy-files.js` | `scripts/gcp-setup.sh` (crawl job), `scripts/deploy.sh` (new settings), `safe-globe.html` |
| `docs/policies/*`, `docs/test-docs/kyc_policy.pdf` | `.env.example`, `DEPLOY_GUIDE.md` steps 5, 7, 8 and 13 |
| `tests/phase3.test.js`, more cases in `agents/tests/test_agents.py` | `package.json` test list |

No identifier, variable, route, storage path or field is renamed.

## Risks

- **Reading other people's websites.** The guardrails in step B are in code and tested. The demo uses the app's
  own fixture page, so the demo never depends on a third party's site.
- **Workspaces.** Events and scheduled runs must act in the right workspace. Every payload carries the workspace
  id, and the tests check that a crawl in one workspace changes nothing in another.
- **Cloud Run scales to zero**, so a scheduled crawl wakes the app, and created workspaces are gone after a
  restart (already accepted). The schedule then only reaches the Demo workspace.
- **Agent Search setup time.** A new data store can take a while to index. If it is not ready, the local text
  is used and the page says "Offline fallback". It does not block the gate.
- **Spend.** Triage is one small call per alert on the lite model; a re-screen is a Pond-Guard run inside the
  daily cap; Agent Search is capped and cached. I will report the Agent Search price from the docs before you
  create the data store.
- **Time.** Four days to the deadline (16 Oct, 12:00 Singapore time) for Phases 3 to 6. Proposed: Phase 3 on
  12 Oct, Phase 4 on 13 Oct, Phase 5 on 14 Oct, Phase 6 and rehearsal on 15 Oct.

## How I will verify

- Offline: `npm test` and `npm run test:agents` stay green. New tests: the event bus (inline, idempotent,
  fallback when publish fails), the push endpoint (401 without a token), `robots.txt` obeyed, login pages not
  read, the rate limit, snapshot and change detection, record checks, the proposal flow (never applied without
  approval), triage output parsing and the offline rules, High leads to a re-screen request, policy search
  fallback and cap, and workspace separation.
- The gate offline: the fixture page changes, new records appear, a ripple fires, and Aurora Venture is
  re-screened (offline sample).
- In Chrome: the Sources tab (Run now, snapshot link, suggested fix), the Ripples ticker, the clause text in
  "Why <score>?", the Policies search box.
- Live, only after the section 9.1 go-ahead for each: Pub/Sub and Cloud Scheduler, Cloud Storage, Agent Search,
  and the crawler agent on Gemini.

## Questions before I start

1. **Approve this plan?**
2. **You said "proceed to phases 3 to 6".** May I go from one phase to the next without stopping for a plan
   approval each time, stopping only for the section 9.1 go-aheads and for anything only you can do? I will
   still write each plan and walkthrough. Recommended, given the deadline.
3. **Crawl schedule:** once a day at 06:30 Singapore time, plus **Run now**?
4. **Automatic re-screen on a High alert:** approved, inside the daily cap of 30 Pond-Guard runs?
5. **§5.4 says 12 hours, the scoring rule says 24.** Leave both as they are and let the recommendation alert
   keep pointing it out, or change one?
6. **Demo fixture page** at `/demo/port-notices`, fictional and labelled: approved as the "changed page"?
