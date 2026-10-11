# Implementation plan: Phase 1 (scoring engine, editable rules, "Why <score>?")

Status: **approved by the user on 12 Oct 2026.**
No cloud service is called in this phase. Everything runs offline with Gemini disabled.

## Goal

1. One scoring engine: findings in, risk points, confidence and route out. The AI never picks a number.
2. The points table and confidence formula are **editable in the Reviews tab** and a recommended change is raised
   whenever a policy or a source is added (decision 4, built first).
3. The entity drawer shows the 6-step pipeline strip and the "Why <score>?" panel.
4. Gate: Aurora Venture scores from findings, offline, with a test for every points row.

## Build order

### Step 1. Rules config and store (first)
- `src/risk/points.config.js` (new): the 16 rows of section 4.5 (id, label, default points, policy clause, category,
  flags such as `setsScoreTo100`, `alwaysEscalate`, `sendsDdq`), the level bands (4.4), the confidence weights (4.6),
  the route thresholds (4.7), and which fields are locked.
- `src/risk/rulesStore.js` (new): merges the defaults with the user's overrides saved in the existing `app_settings`
  table (key `risk_rules`), validates every edit, and keeps a change log (who, when, before, after, reason).
- `src/routes/risk.js` (new), mounted at `/api/risk`:
  - `GET /rules` merged rules plus defaults, so the UI can show what was changed
  - `PUT /rules` compliance officer only; validated; logged
  - `POST /rules/reset` back to defaults
  - `GET /rules/suggestions`, `POST /rules/suggestions/:id/accept`, `POST /rules/suggestions/:id/dismiss`
- Editable: points per row, the three confidence weight tables, the corroboration bonus, the confidence threshold.
- Locked (shown greyed with the reason): confirmed sanctions match = 100 and Escalate, the cap of 100,
  "no source, no points", and the 50-point risk line (it is the line already drawn on the Reviews chart).
- The formula is edited through its weights, not as free text, so it can always be validated and explained.
- `CONFIDENCE_THRESHOLD` and the existing Reviews slider keep working; the slider now saves through `PUT /rules`.

### Step 2. Reviews editor and the recommendation alert
- `safe-globe.html`, Reviews tab: a new "Scoring rules" card with the points table and the confidence formula,
  inline edit, "Changed from default" markers, reset, and a preview of how many open cases would change route.
- `src/risk/suggestions.js` (new): after `POST /api/policies/compile` or `POST /api/sources`, compare the new policy
  text or source with the current rules and store suggestions, for example a policy that states a different contract
  value or CPI threshold, a clause number that a row should cite, or a new source that makes a row checkable.
  In Phase 1 this comparison is deterministic (offline). Gemini-written suggestions are added in Phase 2.
- UI: an alert "Dilly recommends N changes to your scoring rules" with a button that opens the Reviews card with the
  suggested rows highlighted. Nothing is applied until a person accepts it.
- Saving a change re-scores open cases and lists before and after.

### Step 3. Scorer, confidence, route
- `src/risk/scorer.js` (new, pure functions):
  `scoreFindings(findings, rules)` (each row at most once, cap 100, confirmed sanctions sets 100),
  `confidenceFor(findings, checks, rules)` (4.6, including the coverage rule when there are no findings),
  `routeFor(risk, confidence, rules)` (4.7), `levelFor(risk, rules)`, `poseFor(route, causedBySanctions)`.
- Country row: riskiest of incorporation, operating address, flag state and residence, counted once, from the CPI
  table already in the app.
- `screening.calculateQuadrant` stays (rule 8) and delegates to `routeFor`.

### Step 4. Findings schema and store
- `src/risk/findingSchema.js` (new): the fields of section 4.8, validation, rejection reasons
  ("no source", "quote too long", "unknown category"). A DDQ fact may cite a DDQ answer ID instead of a URL.
- `src/db/sqlite.js`: new table `findings` (accepted and rejected, with the reason) and its read/write functions.
  New table only; no existing column is renamed.

### Step 5. Demo findings and re-scoring
- Seeded demo findings for the demo counterparties, built from the facts already in `src/db/seed-data.js`, each
  labelled demo and citing a source record inside the app.
- `kycService.calculateAiRisk` and `screening.screenCounterparty` build findings and call the scorer. Their return
  shapes stay the same.
- `GET /api/risk/breakdown/:entityId` and `GET /api/risk/scores`. `safe-globe.html` replaces its literal risk and
  confidence numbers with these on load, and shows "Offline sample" if the call fails.

### Step 6. Drawer UI
- The 6-step strip (Read, Understand, Check, Score, Weigh, Route) and the "Why <score>?" panel under the risk card:
  one row per counted finding (points, rule, policy clause, summary, quote, source link), then total, level,
  confidence parts and route. The existing "What drives the confidence" list shows the confidence parts.
- A line in the UI says CPI is the one score where low is bad, and that risk points always mean higher is riskier.

### Step 7. Tests
- `tests/risk.test.js` (new, added to `npm test`): every points row, once-per-case, the cap, confirmed sanctions,
  the country rule, the confidence formula and coverage rule, all four routes, the findings schema, rule edits
  (valid, invalid, locked), suggestions, and the Aurora Venture case.
- Existing tests that assert old literal scores are updated; each change is listed in `walkthrough.md`.

## Files

New: `src/risk/points.config.js`, `src/risk/rulesStore.js`, `src/risk/scorer.js`, `src/risk/findingSchema.js`,
`src/risk/suggestions.js`, `src/routes/risk.js`, `tests/risk.test.js`, `docs/agent/walkthrough.md`.
Changed: `src/server.js`, `src/db/sqlite.js`, `src/db/seed-data.js`, `src/services/kycService.js`,
`src/services/screening.js`, `src/routes/policies.js`, `src/routes/sources.js`, `safe-globe.html`, `package.json`
(test list only), `.env.example`, `DEPLOY_GUIDE.md`.

## Risks

1. **Aurora Venture will not score 85 on today's data.** The seed data supports AIS dark 31 h (+20), ship-to-ship
   transfer (+20) and two flag changes since 2024 (+10) = 50. The local CPI table has no row for Cameroon, and
   nothing in the record says ownership is unclear (it says "owners all match"). Two decisions for the user:
   - Country (+20): I will check whether the app's CPI 2025 data set includes Cameroon and why the row is missing.
     I will not type in a CPI value from memory.
   - Ownership unclear (+15): may I add a fictional, labelled demo fact (for example a nominee owner) to Aurora
     Venture, and remove the "owners all match" line?
   Without both, the honest result is 50 or 70, and the demo story's "Why 85?" changes.
2. Two records disagree about the vessel: IMO 9304124, flag Cameroon (`seed-data.js`) and IMO 9412345, flag LBR
   (`sqlite.js:982`). I will make the second match the first unless told otherwise.
3. `safe-globe.html` is one 495 KB file with literal demo data. Edits there are the slowest and riskiest part.
4. Existing tests assert old scores (88, 86, 78, 92, 84). They will change; before and after go in `walkthrough.md`.
5. Scores inside imported source records (`sourceHandlers.js`) are the source's own ratings, not case scores.
   They stay as they are in Phase 1 and are labelled as such.

## How I will verify

- `npm test` passes offline with Gemini disabled, including the new suite.
- By hand on `http://localhost:8080`: edit a points row in Reviews and see the Aurora total and route change;
  upload a policy and see the alert, follow it, accept one suggestion; open the drawer and trace every point to a
  finding, a rule and a source; reset to defaults.
- The app starts with every `.env.example` placeholder commented.

## Dates (submission 16 Oct 2026)

| Phase | Target |
| --- | --- |
| 1 | 12 to 13 Oct |
| 2 | 13 to 14 Oct |
| 3 | 14 Oct |
| 4 | 14 to 15 Oct |
| 5 | 15 Oct |
| 6 | 15 to 16 Oct |

Four days for six phases is tight. If a phase slips, the order in which I would propose to cut, for the user to
decide: AIS anomaly checks (13), smarter name matching (11), self-healing extraction (9). Each would keep its
labelled offline sample.
