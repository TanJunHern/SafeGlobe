# Communication Protocol: Caveman Mode
- Respond in caveman speak: ultra-terse, direct, no filler.
- Drop articles ("the", "a"), greetings, conversational transitions, and restating the prompt.
- Zero pleasantries ("Sure!", "I have updated...", "Here is the code:").
- Code must remain complete, production-ready, and functionally exact.
- Only explain if explicitly asked. Otherwise: code, tool execution, or fragments only.

---

# DueDilly KYC: Tri-Party Architecture & Lifecycle Specification

## 1. Identity & Security Architecture (Approach A)

### Authentication Mechanism
- Frontend: Google Identity Services / Firebase Auth (`Google One-Tap` & `Sign in with Google`).
- Backend Verification: FastAPI verifies Google ID Token / Firebase JWT (`verify_oauth2_token` / `auth.verify_id_token`).
- Role Assignment:
  - `employee`: Standard corporate domain account. Access strictly limited to records where `created_by_email == session.email`.
  - `compliance_officer`: Designated compliance admin accounts. Global view over all requests, approvals, policy overrides, and risk analytics.
  - `counterparty`: External guest. No full login required; authenticates via One-Time Cryptographic Guest Token embedded in unique DDQ link.

---

## 2. End-to-End Request Lifecycle Workflow

### Phase 1: Employee Submission & AI Ingestion
1. Employee logs in via Google One-Tap (`/portal/employee`).
2. Employee uploads counterparty document (ACRA Bizfile, passport, or vessel registry PDF).
3. Backend calls Gemini 2.5 Flash (`POST /api/kyc/extract-document`) to parse document and auto-populate form fields.
4. Employee verifies extracted fields, selects Relationship Type, enters Contract Value (SGD), and inputs remarks.
5. If Ongoing Monitoring is enabled, employee uses Google Maps Places Autocomplete to verify and pin the physical location.
6. Employee submits request (`POST /api/kyc/submit`). Record is saved with session metadata (`created_by_email`, department, timestamp).

### Phase 2: Policy Evaluation & Automated Screening
1. Backend cross-references submitted details against corporate rules in `kyc_policy.pdf` using Gemini RAG.
2. System runs automated watchlist/sanctions/PEP check.
3. System produces structured output: `Screening Result`, `AI Risk Score`, and `DDQ Required` decision with cited policy clauses.
4. Branching decision:
   - Branch A (Low Risk, DDQ Not Required): Request status set to `Approved` or `Clear`. Employee table updates immediately.
   - Branch B (DDQ Required): Request status set to `Pending DDQ`. Backend generates signed one-time link: `/ddq/portal?token=<JWT>`. An automated dispatch email is triggered to the counterparty.

### Phase 3: External Counterparty (DDQ Company) Response
1. Counterparty opens email and clicks one-time secure link (`/ddq/portal?token=<JWT>`).
2. Token is validated; counterparty enters isolated form containing only their assigned questionnaire.
3. Counterparty provides Ultimate Beneficial Owner (UBO > 25%) disclosures, litigation/PEP declarations, and uploads audited financials.
4. Counterparty submits form (`POST /api/ddq/submit`). Access token expires, form locks to read-only, and status updates to `DDQ Under Review`.

### Phase 4: Compliance Officer Triage & Final Resolution
1. Gemini re-screens counterparty's submitted DDQ answers and updates risk summary.
2. Compliance Officer opens `/portal/compliance` and views flagged request in the triage queue.
3. Officer inspects side-by-side comparison (Employee submission vs. Counterparty DDQ answers vs. Gemini policy notes).
4. Officer selects action: `Approve`, `Reject`, or `Request More Info`.
5. Status updates globally. Employee table updates in real time to reflect final approval or rejection.

---

## 3. UI Views & Requirements by Profile

### Profile 1: The Company's Employee (`/portal/employee`)
- Header: Active user avatar & email badge, `+ New KYC Request`, and `Export to Excel (.xlsx)`.
- Scoped Data Table:
  - Filter: `WHERE created_by_email == current_user.email`.
  - Columns:
    1. `KYC ID`
    2. `Submission Date` (`YYYY-MM-DD HH:mm`)
    3. `Counterparty Name`
    4. `Entity Type` (`Organisation` | `Vessel` | `Person`)
    5. `Country of Incorporation / Flag / Nationality`
    6. `Relationship Type` (`Community Investment & Sponsorship`, `Vendor/Supplier`, `3rd Party Reps & Brokers`, `Customer/Trading Partner`, `M&A and Investment`)
    7. `Anticipated Contract Value (SGD)` (Formatted with thousand separators, e.g., `SGD 250,000`)
    8. `Ongoing Monitoring` (Boolean badge: `Enabled` / `Disabled`)
    9. `Request Status` (`Draft`, `Under Review`, `Pending DDQ`, `Approved`, `Rejected`)
    10. `KYC Screening Result` (`Clear`, `Watchlist Match`, `PEP Alert`, `Sanctions Alert`, `High Risk`)
    11. `AI Result` (Pill chip + popover: *e.g., "Confidence 96% - Low Risk"*)
    12. `DDQ Required` (`Yes` | `No`)
    13. `DDQ Status` (`N/A`, `Triggered`, `Sent to Counterparty`, `Under Review`, `Completed`)
- Audit & Traceability (Hidden from table, preserved in storage & Excel metadata):
  - `created_by_user_id` & `created_by_email`
  - `created_by_department`
  - `ip_address` & `client_timestamp`
  - `last_modified_by`
- New Request Modal / Drawer:
  - Dropzone: "Drop Bizfile, Passport, or Vessel Registry PDF". Calls Gemini to auto-populate form.
  - Base Inputs: Entity Name, Entity Type, Relationship, Contract Value, Remarks.
  - Dynamic Fields by Entity Type:
    - `Organisation`: Registration / Tax ID (UEN/EIN), UBO names, Parent/Holding Company.
    - `Vessel`: IMO Number, Flag State/Port, Vessel Type, Registered Owner, Commercial Operator.
    - `Person`: Full Legal Name, Aliases, Date of Birth, ID/Passport Number, PEP Self-Declaration.
  - Google Maps Integration: When "Ongoing Monitoring" is enabled (or for physical asset registration), provide address input with Places Autocomplete, display pin on map, and persist Place ID, coordinates, and formatted address.

### Profile 2: The Counterparty DDQ Portal (`/ddq/portal?token=...`)
- Access Control: Validated strictly via temporary HMAC/JWT token containing `{kyc_id, counterparty_email, exp}`.
- Form Layout: Scoped external vendor questionnaire:
  - Corporate details & Ultimate Beneficial Owners (UBO > 25%).
  - Declarations: Sanctions exposure, litigation history, PEP ties.
  - Document attachments: Audited financial statements, tax clearance certificates.
- Post-Submission: Locks form into read-only mode and notifies compliance.

### Profile 3: The Compliance Officer Workspace (`/portal/compliance`)
- Global Overview: Unrestricted view across all employee submissions and department metrics.
- Triage Queue: Prioritizes requests flagged by Gemini as `Medium/High Risk` or `DDQ Completed`.
- Review Drawer:
  - Side-by-side comparison of original employee submission vs. counterparty DDQ responses.
  - Gemini Policy Audit: Cites exact rule violations or triggers (*e.g., "Rule 4.2 triggered: Contract value > SGD 100,000 with 3rd Party Broker"*).
  - One-click triage: Approve, Reject, or Request More Info.

---

## 4. Technical Implementation Details for `agy`

### Backend (FastAPI + Pydantic + Google GenAI SDK)
- `POST /api/kyc/extract-document`: Multimodal file ingestion using `gemini-2.5-flash` returning structured JSON matching entity schemas.
- `POST /api/kyc/submit`:
  - Saves record with `created_by_email` from auth context.
  - Triggers Gemini Policy Check against ingested `kyc_policy.pdf`.
  - If DDQ triggered, generates unique link: `/ddq/portal?token=JWT`.
- `GET /api/kyc/my-requests`: Returns filtered rows for authenticated employee (`WHERE created_by_email == session.email`).
- `GET /api/kyc/export-excel`: Streams an `.xlsx` file containing visible columns plus hidden audit columns (`created_by`, `timestamp`, `ip`, `triggered_policy_clause`).
- `POST /api/ddq/submit`: Receives guest vendor submission, parses files, and updates status to `Under Review`.

### Google Maps API Setup
- Load Maps JavaScript API + Places Library in frontend index.
- Wire autocomplete input to save `formatted_address`, `latitude`, `longitude`.

### Cloud Run Deployment Target
- Multi-stage `Dockerfile` listening on environment variable `PORT` (default `8080`).
- No hardcoded secrets; reads `GEMINI_API_KEY` from environment.