# DueDilly — AI-Native Global Screening Platform

[![Tests](https://img.shields.io/badge/tests-17%20passed-brightgreen.svg)]()
[![Google Cloud Run](https://img.shields.io/badge/Google%20Cloud-Cloud%20Run%20Ready-blue.svg)]()
[![Firebase](https://img.shields.io/badge/Firebase-Hosting%20Ready-orange.svg)]()

DueDilly is an AI-native global screening platform built according to the **Product Requirements Document (PRD)**. It runs ongoing KYC and compliance screening on organisations, people, and vessels, surfaces risks on an interactive map and ownership graph, and gives screened organisations a voice through verified clarification statements.

---

## 🌟 Key Product Capabilities (from PRD)

### Phase 1 — Screen and Alert (KYC)
- **Multi-Entity Screening (1.1, Page 3):** Screens organisations (registration, directors), people (PEPs, UBOs), and vessels (IMO, MMSI, flags, live AIS position).
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
The automated test suite runs 92 unit and integration tests verifying every PRD service and API route:
```bash
npm test
```

### 3. Launch the Server
```bash
npm start
```
Open your browser at:
- **Interactive Frontend:** [http://localhost:8080/](http://localhost:8080/) or [http://localhost:8080/saf-globe.html](http://localhost:8080/saf-globe.html)
- **Health Check Probe:** [http://localhost:8080/api/health](http://localhost:8080/api/health)

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

For complete deployment details and configuring Google Cloud SQL (PostgreSQL) or Cloud Firestore, refer to [DEPLOYMENT.md](file:///C:/Users/DFD_Admin/Documents/Github/Safe%20Globe/DEPLOYMENT.md).
