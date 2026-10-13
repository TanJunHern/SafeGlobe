# Implementation plan: country risk views on the Globe, refreshed by an ADK agent

Status: **answered and approved by the user on 13 Oct 2026 ("Ok do the 4 first"), built on 14 Oct. See `decisions.md`
for the answers and for what differs from this plan, and `walkthrough.md` for how to use it.**
Earlier plans: `.phase1.md`, `.phase2.md`, `.accounts.md`, `.phase3.md`, `.phase4-bigquery-ai.md` (not built),
`.review-model.md` (built).

## Goal

In the Globe's Layers panel, under "Country fill", the user picks one country risk view to colour the map. At the
bottom of the panel a compliance officer sets how often DueDilly refreshes the data. A country risk agent reads each
source, the countries end up in one JSON file per view, and the map is coloured only from validated JSON.
Display only: no risk score, points row, confidence or route changes.

## What I found in the repo that changes the request

These are differences between the request and the code as it is. Each one has a recommendation; four of them need
your answer (questions 6 to 9).

1. **The feature 3 crawler does not fetch in Python.** The DueDilly app (Express, `src/services/crawlerService.js`)
   does the fetch: `robots.txt`, the terms tick, the no-sign-in checks, the public-address check, the 5-second gap,
   the identifying user agent `DueDillyBot/1.0`, and the snapshot. The ADK agent (`agents/app/crawler.py`) has no
   tools and only reads page text it is handed. The agents service also has no database and no storage. So "an ADK
   agent in the agents service fetches each source" and "reuse the crawler from feature 3" point at two different
   places. See question 6.
2. **There is no hourly tick.** Two schedules exist: `duedilly-uat-rescreen-due` (daily, 06:00 Singapore time, through
   Pub/Sub) and `duedilly-uat-crawl-due` (Mondays 06:30). Both call the app, not the agents service. Daily is enough
   for Daily, Weekly and Monthly, so the plan hooks the due-check onto the existing daily `rescreen-due` event. No
   scheduler job is created or changed, by the app or by a script.
3. **The page fetcher only accepts web pages up to 2 MB.** CSV, XML, XLSX and PDF are refused today. File downloads
   need their own, larger limit and a hash computed on the bytes.
4. **The "How Dilly works" page (feature 15) is not built.** There is nowhere to add the line yet. See question 8.
5. **CPI in the app is 21 of 182 countries** (`src/db/seed-data.js`, 9 of them repeated in the page). "Reuse its
   data" therefore gives a 21-country view. See question 9.
6. **`safe-globe.html` is the page that is served**; `saf-globe.html` is an older copy served by the same handler.
   Only `safe-globe.html` is changed.
7. **Samples cannot be written from memory.** Rule 7 (do not invent data) and your "do not hard-code which countries
   are on any list" mean each sample JSON must be the saved output of a real, permitted fetch. Until the first
   go-ahead for a source, its view shows "No data yet", not a made-up sample. CPI is the exception: its sample is
   built from the app's own table.

## Design

### Who does what (recommended; depends on question 6)

| Step | Where | LLM |
| --- | --- | --- |
| Decide which views are due (setting, last checked, per-view on/off) | App: `src/countryRisk/countryRiskService.js` | No |
| Fetch with `robots.txt`, terms, no sign-in, rate limit, user agent; save the snapshot; hash it | App: the existing `fetchPage` guards, extended for files and for one level of same-site links | No |
| Hash unchanged: stop. Record "checked, no change" | App | No |
| Structured file (CSV, XML, XLSX): parse in code | App: `src/countryRisk/parsers/` (`exceljs` is already installed) | No |
| HTML statement (FATF): extract countries, category and quote with structured output | Agents service: new ADK agent `country_risk` in `agents/app/country_risk.py`, endpoint `POST /country-risk/extract` | Yes, only when the hash changed |
| Uploaded file (Basel, TRACE): parse the officer's file | App | No |
| Validate: schema, quote found word for word in the snapshot, name mapped to ISO-3 by a fixed list in code | App: `src/countryRisk/validate.js`, `iso3166.js` | No |
| Save the JSON (database and one file per view), or keep the last good one and mark it stale | App | No |

The agent never fetches, never maps a name to a code and never decides a colour. Its output is checked in code
before anything is saved, the same way crawler records are checked today.

### The views

One registry file, `src/countryRisk/views.config.js`, is the single definition of each view: id, label, source name,
source URL, kind (categorical or score), which way the source's scale runs, the scale ends, method, and the parser.
The service, the API, the legend and the tests read it. Nothing about which countries are listed is in it.

| View id | Method (to be confirmed on the first permitted look at each site) | Kind |
| --- | --- | --- |
| `fatf_lists` | Page, then same-site links to the latest two statements, then the ADK agent | Categorical: `call_for_action` red, `increased_monitoring` amber, not listed neutral |
| `basel_aml` | Parsed file if a public file exists; otherwise "Needs upload" | Score, high is bad |
| `cpi` | The app's own CPI table. Not fetched. This is the existing "CPI 2025" button, not a second entry | Score, low is bad, inverted for colour |
| `trace_bribery` | Parsed file if a public file exists; otherwise "Needs upload" | Score, high is bad |
| `fsi` | Parsed file | Score, high is bad |
| `cthi` | Parsed file | Score, high is bad |
| `ofac_programmes` | See "OFAC and EU" below | Categorical, one category |
| `eu_regimes` | See "OFAC and EU" below | Categorical, one category |

I have not opened any of these sites. Whether a file exists, its columns, the scale ends, and each site's terms are
**not verified**. Rule 6 (do not guess) applies: the parsers are written only after a permitted look (question 7).
If a site needs JavaScript to show its content, blocks the bot, or disallows it in `robots.txt`, the view becomes
"Needs upload" and nothing is worked around.

### OFAC and EU: how the country view would be derived

Both lists name people and entities. The data carries a **programme** (OFAC) or **regime** (EU) per entry, not a
target country. Getting from a programme to a country without a hard-coded table leaves two options:

- **A (recommended):** take the distinct programme or regime names from the source, and match each name against the
  fixed ISO country-name list in code. A programme whose name contains a country name colours that country. The
  evidence quote is the programme name exactly as the source writes it. No LLM.
- **B:** the ADK agent maps programmes to countries with a quote. Costs LLM calls and is harder to check.

What you must know about A, and why the label matters:
- A country is coloured because **a programme is named after it**, not because of how many names are listed. The
  view is labelled "Named in an OFAC sanctions programme" / "Named in an EU sanctions regime", with "programme
  level, not a count of names" in the legend.
- A name match is not the same as "targeted". A programme about Russia's actions in Ukraine names Ukraine. Under A
  both countries are coloured, and the tooltip shows the programme name so the user can see why. I would rather show
  that honestly than keep a hand-written exceptions list, which would be hard-coding.
- Programmes with no country in the name (terrorism, narcotics, cyber, human rights) colour nothing and are logged.
- "Comprehensive" versus "targeted" sanctions is not in the data as far as I know, so the view has one category and
  one colour. See question 3.

Which file or page carries the programme names for each list is **not verified**; I will report the exact fields
used, with examples, in the walkthrough.

### JSON, database and files

- Format exactly as you gave it. Added fields only, none renamed: `last_changed_at`, `sample` (true for a shipped
  sample), `rejected` (names that failed, with the reason), and for OFAC and EU `programme` per country.
- New tables (added, nothing existing changes): `country_risk_views` (one row per view: the last good JSON, hash,
  last checked, last changed, enabled, stale since, stale reason) and `country_risk_log` (one row per check: result,
  LLM calls, reason). Each workspace has its own database, as today.
- Setting `country_risk_refresh` (`manual` | `daily` | `weekly` | `monthly`, default `weekly`) in the existing
  per-workspace `app_settings` table.
- Files: `country-risk/<workspace>/<view_id>.json` and snapshots under `snapshots/<workspace>/country-risk/`, through
  the existing `objectStorage` (Cloud Storage on UAT, local folder in dev).
- Samples: `demo-data/country-risk/<view_id>.sample.json`, labelled "Sample data, may be out of date (<date>)".
- One fetch per source per tick, shared across workspaces in memory, so a site is not read once per workspace and
  Gemini is not called once per workspace.

### Validation and "Stale"

A country is rejected when: it has no `evidence_quote`; the quote is not in the saved snapshot word for word; its
name is not in the fixed ISO list; its category is not one the view allows; a score is outside the view's scale.
The whole refresh is rejected, the last good version kept, and the view marked "Stale since <date>" when: the fetch
fails; the schema fails; no country survives; or the number of countries drops by more than half against the last
good version (a guard against a half-read page; the fraction is a setting in the registry). The reason is logged.
The map is never coloured from anything that failed.

### API

| Route | Who | What |
| --- | --- | --- |
| `GET /api/country-risk/views` | Any signed-in account | The views with status, last checked, next check, last changed, method, LLM calls this month, refresh setting |
| `GET /api/country-risk/views/:id` | Any signed-in account | The validated JSON of one view |
| `PUT /api/country-risk/settings` | Compliance officers | The refresh frequency |
| `PUT /api/country-risk/views/:id` | Compliance officers | Turn one view's refresh on or off |
| `POST /api/country-risk/refresh` | Compliance officers, rate limited | "Refresh now", one view or all |
| `POST /api/country-risk/views/:id/upload` | Compliance officers | The downloaded file for a "Needs upload" view |

### Screen (`safe-globe.html`)

- Country fill: the three-button row cannot hold eleven options. It becomes a short list of radio rows in the same
  panel: the existing three first, then the new views, each with a small status mark (Sample, Stale, Needs upload).
- Bottom of the Layers panel: "Refresh" (Manual only, Daily, Weekly, Monthly), "Refresh now", "LLM calls this month:
  n", and per view "Last checked / Next check" with an on/off switch. Read-only for employees.
- Legend per view: source name, last fetched, last changed, method (Parsed file, AI extracted, Uploaded), which way
  the scale runs, and the sample or stale label.
- Clicking a country: its value in the source's own number, category, evidence quote, and a link to the source.
- Colour: one small shared file, `country-risk-views.js`, used by the page and by the tests (the same pattern as
  `dilly-loader.js`). It turns a view and a country value into "how risky, 0 to 1" and a colour from the existing
  tokens `--low`, `--mid`, `--high`. No data is `--land-none` (grey). Score views run as one gradient between the
  source's own scale ends; I do not invent bands the source does not publish.
- Sources tab: a "Country risk files" block where an officer uploads the Basel or TRACE file.

### Offline, placeholders, guide

- With every placeholder commented and no internet: the map works from the samples; refresh says "Offline sample".
- With no agents service: structured views still refresh; FATF keeps its last good data and says why.
- New placeholder block: `COUNTRY_RISK_DAILY_CAP` (Gemini calls by the country risk agent per day). No new secret.
- `DEPLOY_GUIDE.md` steps 7 (the daily tick now also checks the views) and 13 (the cap), in the same change.
- No new Google Cloud resource. No scheduler job, topic or bucket is added.

## Files

New: `src/countryRisk/{views.config,countryRiskService,validate,iso3166}.js`, `src/countryRisk/parsers/*.js`,
`src/routes/countryRisk.js`, `country-risk-views.js`, `agents/app/country_risk.py`,
`demo-data/country-risk/*.sample.json`, `tests/country-risk.test.js`.
Changed: `src/services/crawlerService.js` (file downloads, one level of same-site links; existing behaviour and
exports unchanged), `src/db/sqlite.js` (two tables), `src/events/handlers.js` (due-check on `rescreen-due`),
`src/services/agentsClient.js`, `src/server.js`, `src/config.js`, `agents/app/{main,models}.py`,
`agents/tests/test_agents.py`, `safe-globe.html`, `Dockerfile`, `package.json` (test list), `.env.example`,
`DEPLOY_GUIDE.md`, `README.md`, `docs/agent/{task,walkthrough,decisions}.md`.

## Order of work

1. Registry, ISO list, validation, tables, service with sample data, API, role checks, tests. No network.
2. Screen: the view list, colours, legend, country click, refresh control.
3. Fetch extensions and the due-check, tested against local fixtures.
4. The ADK agent and its endpoint, tested with a stand-in model.
5. Section 9.1: ask before the first live fetch of each website, one site at a time. Write each parser from what the
   site really serves. Save the first good result as that view's sample.
6. `walkthrough.md`: how to switch views, change the refresh setting and trigger a refresh. Stop and wait.

## Tests (offline, Gemini disabled)

JSON schema; ISO-3 mapping including alternative spellings and unknown names; a country with no quote, or a quote
not in the snapshot, is rejected; an unchanged hash makes no agent call; a failed refresh keeps the last good data
and reports "Stale since"; only a compliance officer can change the setting, switch a view off, upload or refresh,
while an employee can read; every view's scale gives a higher colour value for higher risk, with CPI inverted and no
data grey; the due-check for each frequency; no score, confidence or route changes after a refresh; the Python
agent's output parsing.

## Risks

- **Time.** Submission is 16 Oct 2026, 12:00 Singapore time. Eight sources with eight different formats is the
  largest part. Recommended first version in question 1.
- **Sites that block bots or need JavaScript.** The view becomes "Needs upload". Not worked around.
- **Large files.** Sanctions data files can be tens of megabytes. They are hashed and parsed as a stream, with a size
  limit; if a file is over the limit the view is stale with that reason.
- **Statements that exist only as PDF.** Checking a quote word for word needs the PDF's text in code, which needs a
  new library. Not added unless a source needs it, and I will ask first.
- **Licences.** Some indices may not allow their data to be redistributed. A sample is committed to the repository
  only when the terms I find allow it; the `licence_note` field records what I found.
- **Spend.** Gemini is called only for FATF and only when the page changed: a few calls a month.

## Questions

Yours:
1. Which views in the first version, and in what order? Recommended: FATF lists, OFAC, EU, CPI (existing), then
   Financial Secrecy Index and Corporate Tax Haven Index if time allows; Basel and TRACE as "Needs upload".
2. Basel AML Index and TRACE: if a download needs registration, will you upload the files, or leave those views out?
3. OFAC and EU: is "named in a sanctions programme" (option A above, one colour) the right meaning, knowing that a
   programme name can mention a country that is not the target? Red or amber for that one colour?
4. Default refresh: Weekly?
5. Should the FATF lists later add risk points, or stay display only? (This plan: display only.)

Mine:
6. Where does the fetch run? **(a) Recommended:** as feature 3 works today: the app fetches and parses, the ADK
   agent in the agents service only extracts (FATF). The tested guards are reused and file-based views work with the
   agents service off. **(b)** As your message reads: the agents service fetches, parses and extracts in Python. The
   guards are written a second time, and it needs a way to save snapshots from that service.
7. May I open each of the eight sites now, read-only, from this computer (the page, `robots.txt`, the terms and the
   download links), so the parsers and the "Needs upload" answers are based on what is really there? This is separate
   from the app's first live fetch, which I will still ask about site by site.
8. "How Dilly works" is not built. Build a minimal page now for this line, or record the line in `walkthrough.md`
   and add it when feature 15 is built? Recommended: the second.
9. CPI covers 21 of 182 countries in the app. Keep the 21, or may the CPI view fetch the full file from Transparency
   International once (which is fetching it, against "reuse, don't fetch")?
