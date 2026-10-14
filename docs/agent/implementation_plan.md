# Implementation plan: strengthen Pond-Guard (Dilly the orchestrator)

Status: **parts A to E approved by the user on 14 Oct 2026, with the answers below. Updated with those answers,
the Cloud Run check and the three clause drafts. No code is changed. Waiting for the user's OK on this version
and on the clause texts (section "Three demo clauses").**
The HUD, Firestore and BigQuery AI track was withdrawn; its notes are in `implementation_plan.hud-firestore-bigquery.md`.

Order: A, B, C, D, E. If time runs short before 16 Oct 12:00: A to D first, then the agreement labels and rate
from E; the model probability column is cut first.

## What is built today, and the gaps

| Point | Today | Gap |
| --- | --- | --- |
| First instance | A new KYC request is screened by non-agent code in `kycService.js` (`screenCounterparty`, `calculateAiRisk`). Pond-Guard runs only on an officer's "Screen" or a High ripple. A new request has no entity record | Pond-Guard never sees a request when it arrives |
| Orchestrator, sub-agents | `pond_guard` is an ADK `ParallelAgent` over Sanctions, PEP, Adverse media, Ownership, Vessel behaviour. Country, contract value and broker are worked out in code | No orchestrating agent. No Country and contract agent |
| Policy | No agent is given policy text. The policy has no clause for sanctions, adverse media or ownership | Nothing to map against |
| What to do | The prompt forbids recommendations | No suggested next step |
| Suggestion | The score is computed from the Reviews points table already; only the latest is kept | Not stored per run; not worded as a suggestion |
| Nearness | A BigQuery ML model predicts the officer's red or green | Nothing compares the suggestion with the final decision |

---

## A. Pond-Guard at the first instance

**Decision (answer 1): automatic, in the background, on every new KYC request.**

1. `POST /api/kyc/submit` saves the request as today, with today's rule-based result as its first value, and
   answers at once.
2. It then publishes the existing event `screening-requested` with a new field `kycId` (nothing renamed).
3. The handler: finds or creates the entity for the request (the same builder monitoring uses, without switching
   monitoring on), runs `pondGuard.screenEntity`, and writes the result back to the request's existing fields
   (AI result, score, confidence, rationale, screening result).
4. The request carries a small status the pages read: `screening`, `done`, `reused`, `limit` or `offline`.

**Reuse within 24 hours.** "The same entity" means: the same registration number, IMO number or ID document number
in the same workspace; or, when the request has none of those, the same normalised name and country. If such an
entity has a live Pond-Guard result less than 24 hours old, no run is made: the request is linked to that entity,
takes its result, and says "Reused from the screening at <time>". An officer's "Screen" button always runs afresh.

**Daily cap reached.** The rule-based result stays, with "Pond-Guard daily limit reached, press Screen tomorrow".
Compliance officers see "Pond-Guard runs left today: n of 30" (from the existing `GET /api/pond-guard/status`).

**Gemini disabled, agents service off, or the run fails.** The rule-based result stays, labelled "Offline".

### The Cloud Run check you asked for

What the Cloud Run documentation says (billing settings page, read 14 Oct 2026): request-based billing is the
default; "With request-based billing, CPU is only allocated during request processing"; instance-based billing
(`--no-cpu-throttling`) "allocates CPU even outside of request processing" and is charged "for the entire lifecycle
of instances, even when there are no incoming requests". `scripts/deploy.sh` sets neither flag, so both services
are on the default: **a run started after the response has no CPU. Your concern is right.**

**What I chose: the run always happens inside a request. No billing setting changes.**

| Where | How the run gets a request |
| --- | --- |
| UAT on Cloud Run (`PUBSUB_MODE=pubsub`, already set) | `screening-requested` is published to the topic `uat-screening-requested`. The existing push subscription delivers it to `POST /events/screening-requested`, which already waits for the handler before it answers. The run is inside that request. This path exists today for ripples |
| Publish to Pub/Sub fails, or `PUBSUB_MODE=inline` on Cloud Run | Nothing is started in the background. The request stays `screening`, and the page that shows it calls a new `POST /api/kyc/:id/screen-now`, which runs Pond-Guard inside that request (signed-in staff only, rate limited, same cap). Opening the request is enough |
| Dev and tests (`PUBSUB_MODE=inline`, not Cloud Run) | Handled inside the app as today: there is no CPU throttling on your own computer |

Why not `--no-cpu-throttling`: it bills the instance for its whole life, against the USD 100 limit, and an idle
instance can still be shut down mid-run. Why not Cloud Tasks: a new service and queue for something Pub/Sub push
already does here.

Checked against the settings already in place: the push subscriptions have `--ack-deadline 300` and the app has
`--timeout 300`; a Pond-Guard run stops itself at 120 seconds (150 on the app's side), so one delivery covers one
run. A redelivered event does nothing (`events_seen`). The app runs one instance; the agents service up to two.

**Nothing new for you to run** if `scripts/pubsub-subscriptions.sh` was run (it was, 12 Oct). I will add to
`scripts/pubsub-subscriptions.sh check` a line that fails loudly if `uat-screening-requested-push` is missing or
its deadline is under 180 seconds, and write this section into `DEPLOY_GUIDE.md` step 7.

---

## B. Sub-agents and the policy

**Decision (answer 3): every entity gets five; a vessel gets a sixth.**

| Agent | Policy section it is given | Points rows it may report | Evidence it is given |
| --- | --- | --- | --- |
| Sanctions | new sanctions clause | `sanctions_confirmed`, `sanctions_possible` | the app's lists and source records (as today) |
| PEP | §3.6 | `pep_owner`, `pep_associate` | as today |
| Adverse media | new adverse media clause | `adverse_media_severe`, `adverse_media_other` | Grounding with Google Search (as today) |
| Ownership | new ownership clause | `ownership_unclear` | ownership graph, registry notes (as today) |
| **Country and contract** (new) | §4.1, §2.1, §5.2 | `country_cpi_low`, `country_cpi_mid`, `contract_value_high`, `broker_intermediary` | the CPI 2025 rows for the countries on file; the contract value and relationship type from the KYC request |
| Vessel behaviour (vessels only) | §5.4 | `vessel_ais_dark`, `vessel_sts_transfer`, `vessel_flag_changes` | AIS signals, flag history (as today) |

- Each brief gains `policy`: the clause text, from `policySearch` (Agent Search when connected, built-in text
  otherwise).
- Each finding gains three optional fields (added, none renamed): `policy_clause`, `policy_quote` (exact words of
  the clause) and `suggested_action` (one sentence).
- Checks in code, on top of today's: the policy quote must be in the clause the agent was given, or it is blanked
  with the reason kept. For Country and contract the numbers are checked too: a CPI finding only stands if the
  cited CPI row really is below the threshold in the rules, the riskiest country counts once, and a contract
  finding only stands if the request's value really is above the rule's threshold. Sources: the CPI data
  (Transparency International, as stored in the app) and the request itself, linked by its KYC id.
- A watchlist entity that has no KYC request has no contract value: the agent then reports country only.
- `country_cpi_mid` keeps its note "Proposed, not in policy yet": §4.1 only speaks of CPI below 40.
- A clause never adds or removes points. The points row is decided by the finding's category and your table.

### Three demo clauses (answer 4): please approve the numbers and texts

The policy today: Section 1 "General Principles" is one sentence with no clauses ("...automated screening against
sanctions, watchlists, adverse media, and jurisdictional risk..."); then 2.1, 2.2, 3.6, 4.1, 5.2, 5.4. The three
new subjects are exactly what Section 1 names, so I propose they become **Clauses 1.1, 1.2 and 1.3** under it.
Each is marked "Demo clause" in its title, and the files and the PDF already say "Demo policy".

"The wording must match the points table exactly": your drafts differ from the table in three places. I changed
only those, shown in bold. Say if you would rather change the points row instead.

**Clause 1.1 (Sanctions screening, demo clause)**
> Every counterparty, its directors, shareholders and beneficial owners, and every vessel by IMO number, must be
> screened against the sanctions lists before onboarding and at each re-screen. A name-only match **with strong
> similarity** is a possible match and must be investigated. A match confirmed by a second identifier (date of
> birth, registration number or IMO number) must be escalated, and the relationship must not proceed.

- Changed: added "with strong similarity" (points row: "name only, strong similarity").
- To know: "the relationship must not proceed" is policy wording. In the app a confirmed match still goes to
  Escalate and a person decides; nothing is rejected automatically.

**Clause 1.2 (Adverse media, demo clause)**
> Adverse media from the last 24 months must be reviewed. Media alleging **fraud, bribery or sanctions evasion**
> is severe and must be investigated before approval. Other negative media must be recorded and considered.

- Changed: your draft listed "fraud, bribery, corruption, money laundering or sanctions evasion". The points row
  says "(fraud, bribery, sanctions evasion)". With the longer list the clause would call corruption and money
  laundering severe while the row does not name them. Alternative: keep your five and I add "corruption, money
  laundering" to the row's label (the row's id and points stay). Your choice.
- To know: "24 months" is a number you can edit in Reviews. If you change it there, the existing "recommended
  change" alert is how the clause and the rule are brought back in line.

**Clause 1.3 (Beneficial ownership, demo clause)**
> The counterparty must disclose its ownership up to its ultimate beneficial owners. Nominee shareholders, bearer
> shares, an offshore holding **company**, or an unknown beneficial owner make ownership unclear and require
> enhanced due diligence.

- Changed: removed "with no clear business purpose". The points row says "offshore holding" with no condition; an
  agent reading your draft would have to judge business purpose, and could skip the row.

Where they go once approved: `src/services/policyRagService.js` (the policy text), then
`node scripts/build-policy-files.js` writes `policy-clause-1-1.txt`, `1-2`, `1-3` and both `kyc_policy.pdf` files.
The points rows `sanctions_*`, `adverse_media_*` and `ownership_unclear` get `§1.1`, `§1.2`, `§1.3` in their
policy column. For Agent Search on UAT the three files have to be imported: you rerun
`bash scripts/agent-search-setup.sh` (I will not); until then the built-in text is used and says so.

---

## C. Dilly, the orchestrator

**Decision (answer 2): next steps only.**

- New ADK `LlmAgent` named `dilly`. A Pond-Guard run becomes: sub-agents in parallel → the app checks the findings
  and adds up the points from your table → Dilly is given the checked findings, the points lines, the total, the
  confidence, the computed route, and which checks ran or failed.
- Dilly returns: a short summary; an ordered list of next steps, each citing finding ids and policy clauses; and at
  most one line, **"Dilly's note"**, only when the agents disagree or a check could not run.
- Dilly cannot change the score or the route. Its output schema has no field for a number or a route, and the app
  ignores anything else. The note never changes the route.
- Checks in code: every cited finding id is from this run; every cited clause was given; a next step that cites
  nothing is dropped.
- Everything Dilly writes is labelled **"AI suggestion"** wherever it is shown.
- If Dilly fails, the findings, score and route stand without it, and the card says so.
- The reviewer copilot starts its draft from Dilly's summary instead of a second Gemini call.

## D. The score as a suggestion

- Shown as "Dilly suggests: 85, High, Escalate", with the points lines, until a person decides.
- Each run stores a suggestion record: risk, confidence, route, the rules in force, the finding ids, when, and
  whether it was live, reused or offline. This is what E compares with the decision.

## E. How near Dilly was to the final decision

**Decisions (answers 5 and 6): no new model, no retraining.**

- **Which decision:** the officer's decision on the request. Approve and Reject are final. "Request more info"
  (stored as "Bounce Back", unchanged) is not: the case shows "Waiting" and is counted when it is later approved or
  rejected.
- **The rule, with 50 points as the line**, on the suggestion that was current when the decision was made:

  | Dilly suggested | Officer | Result |
  | --- | --- | --- |
  | 50 or more | Reject | Agreed |
  | under 50 | Approve | Agreed |
  | 50 or more | Approve | Dilly was stricter |
  | under 50 | Reject | Dilly was more lenient |

  The line is read from the rules (the Medium band's lower edge), not written a second time.
- **BigQuery does the judging.** A table `suggestion_outcomes` (one row per decided request: suggested risk, route,
  decision, times, workspace, is_demo) and a view `dilly_agreement` holding the rule above as SQL. The same SQL
  logic runs on SQLite as the offline fallback, and a test checks both give the same answer on the same rows.
  The view is created by a script you run (`scripts/bq-agreement.sh`, with a dry run that prints the bytes first);
  the app only inserts rows and reads the view, with `BIGQUERY_MAX_BYTES_BILLED` on every query.
- **Reviews**, under "Dilly learns": agreement rate; counts of "stricter" and "more lenient"; "Waiting"; and a list
  of the disagreements, each opening its case.
- **Model probability** (first to cut): next to each case, "How likely an officer marks this red", from the
  existing model's stored predictions. The model keeps learning from the red and green marks only.
- **Dilly's suggestion as a model feature:** added to the feature list so it is used the next time you press
  "Train the model". I do not retrain.
- Section 9.1: BigQuery is live for the review model already, but this is a new table and view, so I ask before
  the first insert.

---

## Files

- Agents service: `agents/app/pond_guard.py`, `models.py`, `main.py`, `tests/test_agents.py`.
- App: `src/services/pondGuardService.js`, `src/risk/findingSchema.js`, `src/risk/points.config.js` (policy column
  of five rows), `src/services/policyRagService.js` (three clauses), `src/services/kycService.js`,
  `src/routes/kyc.js`, `src/routes/pondGuard.js`, `src/events/handlers.js`, `src/db/sqlite.js` (suggestions and
  outcomes), `src/learning/*`, `src/services/copilotService.js`, `src/services/bigquery.js`,
  `safe-globe.html`, `employee-portal.html`.
- New: `tests/pond-guard.test.js`, `scripts/bq-agreement.sh`, `docs/policies/policy-clause-1-{1,2,3}.txt`.
- `scripts/pubsub-subscriptions.sh` (check only), `DEPLOY_GUIDE.md` steps 6, 7 and 8, `README.md`, `docs/agent/*`.
- No new Google Cloud service, no new variable, no new dependency.

## Tests (offline, Gemini disabled)

A new request publishes one event and is screened once; a second request for the same entity within 24 hours
reuses the result and makes no run; over the cap the rule-based result stays with the limit message; with no
agents service it stays, labelled Offline; on Cloud Run with inline events nothing runs in the background and
`screen-now` runs it inside the request; a policy quote that is not in the clause is blanked; a CPI or contract
finding whose number does not meet the rule is rejected; the riskiest country counts once; Dilly citing an unknown
finding or clause is dropped; Dilly cannot move the score or the route; the note appears only on disagreement or
a failed check; the four agreement cases; "Request more info" waits and counts later; SQLite and the BigQuery SQL
agree; nothing here changes a score or route; Python: `dilly` and `country_contract` have no tools and checked
output schemas.

## What will change that you should expect

- **Demo scores will move**, because country, contract and broker points now come through an agent's finding and
  the checks around it. `walkthrough.md` will list before and after for every demo counterparty, and Aurora
  Venture is checked against 85.
- Each new request costs one Pond-Guard run: six or seven model calls (five or six sub-agents, one of them with
  Google Search, plus Dilly), inside the cap of 30 a day.
- The first live run is on Vertex AI from this computer. Pond-Guard on Vertex AI was approved on 12 Oct; I will
  still ask before the first run of the changed agents, as you said.
