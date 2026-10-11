# DueDilly — AI-Native Global Screening Platform

[![Tests](https://img.shields.io/badge/tests-137%20passed-brightgreen.svg)]()
[![Google Cloud Run](https://img.shields.io/badge/Google%20Cloud-Cloud%20Run%20Ready-blue.svg)]()
[![Firebase](https://img.shields.io/badge/Firebase-Hosting%20Ready-orange.svg)]()

DueDilly is an AI-native global screening platform built according to the **Product Requirements Document (PRD)**. It runs ongoing KYC and compliance screening on organisations, people, and vessels, surfaces risks on an interactive map and ownership graph, and gives screened organisations a voice through verified clarification statements.

---

## 🌟 Key Product Capabilities (from PRD)

### Phase 1 — Screen and Alert (KYC)
- **Multi-Entity Screening (1.1, Page 3):** Screens organisations (registration, directors), people (PEPs, UBOs), and vessels (IMO, MMSI, flags, live AIS position).
- **Vessel check by IMO:** every IMO number is verified on VesselFinder before a request is accepted. The registry name, flag and type are compared with the form, and the vessel is drawn on the globe from its last position to its destination.
- **Interactive Map Interface (1.4, Page 11):** Visual world map with Transparency International CPI 2025 country risk overlays, vessel tracks, dark period flags, and registered counterparty pins.
- **AI Agent Team (Page 6–8):**
  - **Sentry:** Screens counterparties against 41 sanctions lists, PEP and fraud records; auto-clears false positives with written justification.
  - **Ripples:** Monitors regulatory gazettes and country legal changes; maps updates to affected counterparties with plain-language impact alerts.
  - **Web:** Multi-hop corporate ownership and control graph (detects shell companies and hidden links); drawn as animated arcs on the map.
  - **Tide:** Watches vessel AIS signals for dark periods, AIS spoofing, and ship-to-ship (STS) transfers.
  - **Forecast:** Pond forecast: predictive risk outlook (Beta) scoring 90-day risk probability based on sanctions momentum.
  - **Policy Compiler:** Compiles uploaded guidelines into automated rules; flags gaps and conflicts.
- **Confidence Engine (Page 9–10):** Separates **Risk Level** (stakes) from **Confidence Level** (who acts). Routes cases into 4 quadrants:
  - `Escalate` (High risk, High confidence) → Senior reviewer decides
  - `Investigate` (High risk, Low confidence) → Smart DDQ sent, analyst owns until confidence rises
  - `Fill the gaps` (Low risk, Low confidence) → Request missing records
  - `Auto-clear and monitor` (Low risk, High confidence) → Auto-cleared with written reason, sample-checked
- **Custom Data Sources (1.8, Page 4):** Connectors for API, Data feeds (CSV/SFTP), and Web monitors with trust levels, test connection probes, and health monitoring.
- **Screening API (`POST /v1/screen`):** Direct counterparty screening integration for ERP and onboarding workflows.

### Phase 2 — Clarify and Engage
- **Organisation Claim (2.1, Page 12):** Screened organisations can claim their profile after corporate identity verification.
- **Clarification Statements (2.2, 2.3):** Claimed organisations can post official explanations and remediation steps.
- **Truth Check AI Agent (Page 8):** Decomposes statements into individual claims and validates each against official registry filings and sanctions dates (`Consistent`, `Unverified`, or `Contradicted`).
- **Smart DDQ (1.7, 2.4):** Tailored questionnaires automatically dispatched to counterparties; submitted answers raise confidence score (+18%).

---

## 🦆 Architecture names

| Code name | What it is in this codebase |
| --- | --- |
| **Duck-Scanner** | Document auto-fill using Gemini multimodal. Google Document AI is planned, not connected (`src/services/documentParserService.js` is a placeholder). |
| **Pond-Guard** | AI KYCP check plus the Policy RAG evaluator. |
| **Feather-Weight** | Shared Gemini client (`src/services/geminiClient.js`): `gemini-flash-lite-latest` first, then `gemini-flash-latest`, then `gemini-3.1-flash-lite` on 404 / 429 / 503. |
| **Duckling Trail** | Ownership tracing across registry, filings and news. |
| **Ripples** | Ongoing monitoring alerts. |
| **Quack-Back** | Smart DDQ: the questionnaire sent to the counterparty and the answers returned. |

---

## 📁 Repository Structure

```text
DueDilly/
├── Final PRD.pdf             # Original Product Requirements Document
├── safe-globe.html           # Full interactive frontend interface
├── saf-globe.html            # Exact frontend alias
├── package.json              # Scripts & dependencies
├── Dockerfile                # Production Dockerfile for Google Cloud Run
├── cloudbuild.yaml           # Google Cloud Build automated CI/CD pipeline
├── firebase.json             # Firebase Hosting configuration
├── .firebaserc               # Firebase project configuration
├── .env.example              # Environment variables template
├── DEPLOYMENT.md             # Google Cloud Run & Firebase deployment instructions
├── scripts/
│   └── demo-reset.js         # npm run demo:reset (demo story) and npm run demo:clean (empty workspace)
├── docs/
│   └── test-docs/            # Mock test documents in Markdown (see Demo guide)
├── data/
│   └── safe_globe.db         # Local SQLite database (auto-seeded)
├── src/
│   ├── config.js             # Configuration & environment variables
│   ├── server.js             # Express application & static frontend serving
│   ├── db/
│   │   ├── index.js          # Database abstraction provider
│   │   ├── sqlite.js         # SQLite database engine (node:sqlite)
│   │   └── seed-data.js      # PRD seed data (organisations, vessels, people, CPI)
│   ├── services/
│   │   ├── screening.js      # Sentry screening agent & quadrant calculation
│   │   ├── vesselFinderService.js # IMO check, registry compare, position and destination
│   │   ├── truthCheck.js     # Truth Check AI statement verifier
│   │   ├── ddqService.js     # Smart DDQ generator & answer verifier
│   │   └── askService.js     # Ask Dilly graph query engine
│   └── routes/
│       ├── v1.js             # Public screening API (POST /v1/screen)
│       ├── entities.js       # Counterparties & intake (POST /api/intake)
│       ├── claims.js         # Phase 2 profile claims (POST /api/claim)
│       ├── statements.js     # Phase 2 clarification statements (POST /api/statements)
│       ├── ddq.js            # Smart DDQ endpoints (POST /api/ddq/answer)
│       ├── alerts.js         # Ripples & screening alerts (GET /api/alerts)
│       ├── sources.js        # Custom data sources & test probe (POST /api/sources/test)
│       ├── policies.js       # Policy compiler & rule evaluation
│       ├── cases.js          # Review workflow & decision memo recording
│       ├── ask.js            # Ask Dilly queries (POST /api/ask)
│       └── stats.js          # KPIs, calibration, and CPI country risk
└── tests/
    ├── screening.test.js     # Screening and Truth Check unit tests
    └── api.test.js           # Integration test suite for all HTTP endpoints
```

---

## 🚀 Getting Started Locally

### 1. Installation
```bash
npm install
```

### 2. Run Tests
The automated test suite runs 137 unit and integration tests. It runs offline, with Gemini and the VesselFinder lookup switched off:
```bash
npm test
```

### 3. Two ports: DEV (offline) and UAT (online)

| | DEV | UAT |
| --- | --- | --- |
| Command | `npm run dev` | `npm run uat` |
| URL | http://localhost:8080 | http://localhost:8081 |
| Runs | `node --watch` (restarts on every save) | the production Docker image, the same one Cloud Run runs |
| Settings | `.env.dev` | `.env.uat` |
| Needs internet | No | Yes |
| Needs Docker | Only for the Pub/Sub emulator; the app starts without it | Yes |

First time:
```bash
cp .env.example .env.dev      # or: cp .env .env.dev to keep your current settings
cp .env.example .env.uat      # set APP_ENV=uat, your own JWT_SECRET, and GEMINI_BACKEND
```
- The server refuses to start, and lists what is wrong, if a required setting is missing. In UAT that is `JWT_SECRET`, `GEMINI_BACKEND`, and either `GEMINI_API_KEY` (aistudio) or `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` (vertex).
- `GET /healthz` (and `GET /api/health`) reports `{ env, version, gemini }`, where `gemini` is `aistudio`, `vertex` or `disabled`.
- `npm run uat` mounts your Application Default Credentials read-only when they exist (`gcloud auth application-default login`).
- `npm test` is unchanged and runs offline with Gemini disabled.
- Region: `asia-southeast1` for Cloud Run and Cloud Storage. The locations used for Document AI and Agent Search will be recorded here when those are set up.
- The full cloud plan and the decisions taken are in [docs/CLOUD_PLAN.md](docs/CLOUD_PLAN.md).

### 4. Launch the Server (no environment file)
```bash
npm start
```
Open your browser at:
- **Interactive Frontend:** [http://localhost:8080/](http://localhost:8080/) or [http://localhost:8080/saf-globe.html](http://localhost:8080/saf-globe.html)
- **Health Check Probe:** [http://localhost:8080/api/health](http://localhost:8080/api/health)

To try the product end to end with ready-made test documents, follow the [Demo guide](#-demo-guide) below.

---

## 🎬 Demo guide

A full run takes about 20 minutes: start from an empty workspace, load the mock policy and data feed, submit nine onboarding requests (green, orange and red for a person, a vessel and an organisation), answer the questionnaires, and decide them as the compliance officer.

### What you need

- `npm install` done, and a `.env` (or `.env.dev`) with a working `GEMINI_API_KEY`. Document auto-fill and DDQ prefill need it. Without a key, auto-fill returns fixed sample values instead of what is in your document, and prefill is unavailable.
- Internet access. Every vessel IMO number is checked on [VesselFinder](https://www.vesselfinder.com); an IMO that does not exist is refused.

### Step 1: start from an empty workspace

Stop the server first (it holds the database open), then:

```bash
npm run demo:clean
npm start
```

`demo:clean` removes all local and placeholder data so that everything you see afterwards came from your own test:

| Removed | Kept |
| --- | --- |
| Every onboarding request, DDQ answer and compliance decision | Country risk scores (CPI 2025), which the policy rules need |
| The built-in demo counterparties on the globe and watchlist (Halcyon, Kestrel, Severny, Aurora Venture, Arkady Zemtsov) | The default Supplier CDDQ questionnaire template |
| Sample alerts, review cases, data sources, and the sample policy with its six rules | The VesselFinder source (built in, locked) |
| Uploaded files in `data/uploads/` | Your `.env` settings |

- Nothing is lost: the previous database and uploads are copied to `demo-data/backups/<timestamp>/` first (the five most recent are kept).
- The workspace stays empty across restarts. The demo counterparties do not come back until you run `npm run demo:reset`.
- To restore a backup: stop the server and copy `demo-data/backups/<timestamp>/safe_globe.db` over `data/safe_globe.db`.

| Command | Result |
| --- | --- |
| `npm run demo:clean` | Empty workspace, for testing with your own documents (this guide) |
| `npm run demo:reset` | The scripted demo story: sample requests at every stage, links in `demo-data/DEMO-LINKS.md` |
| `npm run demo:reset -- --ai` | The same story, with Gemini writing the agent's explanations |

### Step 2: build the test kit

The test documents are kept as Markdown in [`docs/test-docs/`](docs/test-docs/). Each file starts with a comment that says what to convert it to and what result to expect. Convert them once into this folder layout (any folder outside the repo is fine):

| Folder | Source in `docs/test-docs/` | Convert to |
| --- | --- | --- |
| `1-intake/` | `01-intake-person.md`, `02-intake-vessel.md`, `03-intake-organisation.md` | One PDF per case, nine in total: `person-green.pdf`, `person-orange.pdf`, `person-red.pdf`, and the same for `vessel-` and `organisation-`. Split each file at its `CASE` markers. |
| `2-ddq-answers/` | `ddq-person-orange.md`, `ddq-person-red.md`, `ddq-vessel-orange.md`, `ddq-vessel-red.md`, `ddq-organisation-orange.md`, `ddq-organisation-red.md` | One PDF each (the DDQ portal also accepts the `.md` as it is). Optional extra: `ddq-vessel-orange-7.7-no.pdf`, a copy of the vessel orange file with answer 7.7 changed to No. |
| `3-policy/` | `policy-guideline-mock.md` | `Meridian-Third-Party-Due-Diligence-Policy.pdf` |
| `4-sources/` | `dataset-mock.md` | `meridian-restricted-parties.csv`: copy only the rows inside the code block |
| `5-templates/` | `ddq-template-mock.md` | Nothing. The importer reads Markdown. |

All companies, people and events in the kit are fictional. Two vessels use real IMO numbers (MADRID MAERSK 9778791, ANDHIKA VIDYANATA 9823417) so that the VesselFinder check passes; every commercial detail about them is invented.

### Step 3: sign in

Open http://localhost:8080/login and pick a persona. No password is needed locally.

| Persona | Use it for | Page |
| --- | --- | --- |
| The Company Employee (John Doe) | Submitting onboarding requests | `/portal/employee` |
| The Compliance Officer (Grace Teo) | Policies, sources, DDQ Manager, review and decisions, the globe | `/portal/compliance` |

### Step 4: run the demo in this order

1. **Template (optional), as Compliance Officer.** DDQ Manager > Import template > `5-templates/ddq-template-mock.md`. Do this before submitting any request: a request keeps the template that was active when its DDQ was issued. Skip this step to use the default template, which is what the DDQ answer files are numbered for.
2. **Policy, as Compliance Officer.** Policies > Upload policy > `3-policy/Meridian-Third-Party-Due-Diligence-Policy.pdf`.
3. **Data feed, as Compliance Officer.** Sources > Add source > Data feed > `4-sources/meridian-restricted-parties.csv`. The VesselFinder card is already there, marked built in and locked.
4. **Nine onboarding requests, as Employee.** For each PDF in `1-intake/`: New request > Auto-fill from document > check the fields against the table below > switch **Ongoing Monitoring** on > Submit.
5. **Questionnaires, as the counterparty.** For each orange and red request, open its DDQ link (shown after submitting, and in the request's audit drawer) > Prefill from a document > the matching file in `2-ddq-answers/` > type the declaration name and signature > Submit.
6. **Review, as Compliance Officer.** Compliance > open each request > read the Compliance Agent's recommendation > Approve, Bounce back or Reject.
7. **Globe.** Every monitored request appears as soon as it is submitted, marked "Pending approval" until it is approved, and is removed if it is rejected. A vessel sits at its last reported position with a dashed arrow to its destination when it broadcasts one. The globe refreshes every 20 seconds.

### What each intake file should produce

| File | Entity / Country | Request status | Screening | AI result | DDQ |
| --- | --- | --- | --- | --- | --- |
| person-green.pdf | Person · SGP | Approved | Clear | Low Risk | Not required |
| person-orange.pdf | Person · IDN | Pending DDQ | Watchlist Match | Medium (62) | Required |
| person-red.pdf | Person · NGA · PEP Yes | Pending DDQ | PEP Alert | High (78) | Required |
| vessel-green.pdf | Vessel · DNK · IMO verified | Approved | Clear | Low Risk | Not required |
| vessel-orange.pdf | Vessel · IDN · IMO verified | Pending DDQ | Watchlist Match | Medium (62) | Required |
| vessel-red.pdf | Vessel · PAN · IMO 9876543 = TEST609 (Vietnam), name and flag mismatch | Pending DDQ | High Risk | 68 (chip shows Medium) | Required |
| organisation-green.pdf | Organisation · SGP | Approved | Clear | Low Risk | Not required |
| organisation-orange.pdf | Organisation · IND | Pending DDQ | Watchlist Match | Medium (62) | Required |
| organisation-red.pdf | Organisation · MMR | Pending DDQ | PEP Alert | High (78) | Required |

**Check the Remarks field before you submit.** The rules match words inside Remarks, and the extractor writes its own summary there.

- Person and organisation, green and orange: Remarks must not contain "PEP".
- Person and organisation, red: the word "PEP" must be in Remarks, or tick "PEP declared". Type it in if the extractor left it out.
- Vessel, green and orange: Remarks must not contain "dark", "transshipment", "anomaly" or the letters "sts" (as in "lists" or "costs").
- Vessel, red: Remarks must contain "dark" to get the High Risk screening result.
- To test the hard block on vessel-red, change the IMO to 9823411 (wrong check digit) or 1000007 (not on VesselFinder). The submission is refused.

### What each DDQ answer file should produce

| File | Matches intake | Expected agent recommendation |
| --- | --- | --- |
| ddq-person-orange.pdf | person-orange | Bounce back (1.8 N/A, 1.13 TBC, 1.15 vague, 6.2 and 6.7 No) |
| ddq-person-red.pdf | person-red | Escalate (PEP, donations, gift, corruption inquiry) |
| ddq-vessel-orange.pdf | vessel-orange | Lists bounce-back issues, but **Escalate** because 7.7 is Yes. This is current rule behaviour: every Yes in the "Sanctions exposure" section counts as a sanctions disclosure. |
| ddq-vessel-orange-7.7-no.pdf | vessel-orange | Bounce back (1.13 TBC, 2.5 vague, owners add up to 120%, 1.1 name differs from the vessel). Same as the file above except 7.7 = No. |
| ddq-vessel-red.pdf | vessel-red | Escalate (sanctions penalty, Iran cargo, AIS off, ship-to-ship transfers, nominees) |
| ddq-organisation-orange.pdf | organisation-orange | Bounce back (1.12 TBC, 1.16 N/A, 2.3 vague, 6.5 and 6.7 No) |
| ddq-organisation-red.pdf | organisation-red | Escalate (state shareholder, PEP owner, money laundering inquiry, debarment, sanctioned buyer) |

- Green cases have no DDQ: they are approved at intake.
- Every DDQ also reports "supporting documents were not uploaded" unless you attach files.
- Red cases stay at Pending DDQ rather than Rejected. A confirmed sanctions match is rejected at intake and its questionnaire is locked, so it could not be used to test the DDQ.

### Policy, data feed and template: expected results

- **Policy:** the upload is stored and one compiled rule is added. Clauses 2.1, 3.6, 4.1, 5.2 and 5.4 of the document match the rules the engine already applies. The compiler does not yet turn each clause into a live rule.
- **Data feed:** 14 records, read as **4 High, 6 Medium, 4 Low** (Sources > the new source > Readable data). Rows 1 to 9 match the nine intake cases; rows 10 to 14 are extra entries for search and "Ask Dilly". The feed does not change the intake colour, which comes from the policy rules.
- **Known name mismatch:** the CSV has `Mandalay Hills Resources Co. Ltd.` with no comma, because values cannot contain commas. The intake and DDQ have `Co., Ltd.` If the agent does not cite this record for organisation-red, that is the likely cause.
- **Template:** after import, the title is "Maritime Counterparty DDQ (Short Form)", with 4 instructions, 4 supporting documents, 7 sections, 30 questions (2 of them tables), 5 declaration statements and 6 glossary terms.

### Good to know while demoing

- **Green does not mean "verified to exist".** Only vessels are checked against a registry. For a person or an organisation, green means no policy rule fired and screening found nothing.
- **Vessel positions come from the public VesselFinder page** and are rounded to whole degrees, so a marker can sit slightly inland. Set `VESSELFINDER_API_KEY` for exact positions. Routes change from day to day as the ships move.
- **If VesselFinder cannot be reached**, a valid IMO is accepted as "IMO not verified" and the vessel is drawn at the intake address.
- **A registry mismatch** (name, flag or type differs from what was declared) raises the request to at least Medium Risk and sends it to compliance, with both versions shown.

---

## ☁️ Cloud Deployment (Google Cloud Run / Firebase)

This codebase is production-ready for deployment to **Google Cloud Run** and **Firebase Hosting**.

### Deploy to Google Cloud Run (One Command)
```bash
gcloud run deploy safe-globe-app \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --port 8080
```

### Deploy to Firebase Hosting
```bash
firebase deploy --only hosting
```

For complete deployment details and configuring Google Cloud SQL (PostgreSQL) or Cloud Firestore, refer to [DEPLOYMENT.md](DEPLOYMENT.md).
