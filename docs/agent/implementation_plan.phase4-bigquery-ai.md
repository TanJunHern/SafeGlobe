# Implementation plan: Phase 4 (BigQuery: name matching, Pond forecast, AIS anomalies, calibration)

Status: **proposed on 12 Oct 2026. Waiting for the user's approval. No Phase 4 code has been written.**
Earlier plans: `implementation_plan.phase1.md`, `.phase2.md`, `.accounts.md`, `.phase3.md`.

## Goal and gate

Forecast and anomalies are visible on the UAT link: the Globe's Pond forecast layer shows a 90-day outlook with its
confidence band for the demo countries and sea lanes, from `AI.FORECAST`; a vessel's drawer shows unusual AIS
behaviour found by `AI.DETECT_ANOMALIES`; screening finds name candidates across spellings and scripts with
embeddings and `VECTOR_SEARCH`; and the Reviews calibration figures are computed from recorded decisions.
All of it works offline with every placeholder commented, from local tables and labelled sample results.

Features: 4 (Pond forecast), 11 (smarter name matching), 13 (AIS anomaly checks), plus the event tables and
calibration from decisions.

## Where things stand

- Datasets `duedilly_dev` and `duedilly_uat` exist in `asia-southeast1` (checked read-only on 12 Oct). There is no
  BigQuery connection. `duedilly-run` has `bigquery.dataEditor`, `bigquery.jobUser` and `aiplatform.user`.
- In the app today: the forecast layer shows six hard-coded numbers (`FORECAST` in `safe-globe.html`); the
  calibration card shows three hard-coded rates ("97.4%, n = 1,906"); name matching is by fixed patterns in
  `src/services/screening.js`; AIS signals are a few text lines on the vessel record. There is no history.
- Events `screening-completed`, `alert-raised` and `ddq-submitted` are already published (Phase 3) and have no
  listener yet. They feed the event tables here.

## What the function references say (read 12 Oct 2026)

| Function | What I confirmed |
| --- | --- |
| `AI.FORECAST` | Called directly on a table or query: `data_col`, `timestamp_col`, `id_cols`, `horizon` (up to 10,000), `confidence_level` (default 0.95). Returns `forecast_timestamp`, `forecast_value`, `prediction_interval_lower_bound`, `prediction_interval_upper_bound`, `ai_forecast_status`. Built-in TimesFM 2.5: **no model to create and no connection**. Needs at least 3 points per series. |
| `AI.DETECT_ANOMALIES` | Called directly: history table, `data_col`, `timestamp_col`, `id_cols`, `target_last_n_points`, `anomaly_prob_threshold` (default 0.95). Returns `is_anomaly`, `lower_bound`, `upper_bound`, `anomaly_probability`. Built-in TimesFM 2.5: no model, no connection. |
| `AI.GENERATE_EMBEDDING` | **Needs `CREATE MODEL ... REMOTE WITH CONNECTION`** first, and a Cloud resource connection. |
| `AI.EMBED` | Called directly with an endpoint name, for example `AI.EMBED(name, endpoint => 'text-multilingual-embedding-002')`. **No `CREATE MODEL`**, and no connection needed for a query run by the service account. |
| `VECTOR_SEARCH` | To read in step 0 before coding (arguments, output columns, whether an index is needed for a small table). |

Not confirmed yet: that the embedding endpoint can be called from a dataset in `asia-southeast1`. The first live
query will tell. If it cannot, the name table goes in a small dataset in a region where it can (a script for you
to run), and I tell you before anything is created.

**One conflict with the AI build spec (`GEMINI.md`), for you to decide (question 2).** Section 5 names `AI.GENERATE_EMBEDDING`. That
function needs `CREATE MODEL`, and rule 5 puts `CREATE MODEL` on hold. A remote model trains nothing, but the
statement is the one the rule names. `AI.EMBED` does the same job with no `CREATE MODEL` and no connection.
I recommend `AI.EMBED`, with a multilingual embedding model so names match across scripts.

## Step 0. Before coding

Read the `VECTOR_SEARCH` reference and the BigQuery REST `jobs.query` reference (parameters, job location,
`maximumBytesBilled`), and the BigQuery ML price for these functions. Note the exact shapes in `decisions.md`.
No new npm package: BigQuery is called over REST with `google-auth-library`, as Vertex AI, Pub/Sub and Agent
Search already are.

## Step A. BigQuery client and tables (`src/services/bigquery.js`, `scripts/bigquery-setup.sh`)

- One small client: `query(sql, params)` with a location, a timeout and **`maximumBytesBilled`** on every query
  (default 100 MB), so a mistake cannot run up a bill.
- `scripts/bigquery-setup.sh` (you run it) creates the tables in `duedilly_uat`. I will not create them myself.

| Table | Rows | Filled by |
| --- | --- | --- |
| `screenings` | one per `screening-completed` | the event handler |
| `alerts` | one per `alert-raised`, with country, sea lane and category | the event handler |
| `decisions` | one per case decision, with the computed route and confidence at the time | a new `decision-recorded` hook on the existing decision route |
| `ddq_submissions` | one per `ddq-submitted` | the event handler |
| `alert_daily` | daily alert counts per country and per sea lane | built from `alerts` plus the synthetic history |
| `ais_daily` | per vessel per day: dark hours, average speed, loitering hours | the synthetic demo tracks |
| `list_names` | one per name on the sanctions and PEP lists and in Readable Source Intelligence, with its embedding | "Sync names" in Sources |

- Offline fallback: the same tables in the app's own database (`BIGQUERY=local`, the default), filled the same way.
  Forecast and anomalies then come from labelled sample results, as section 9.1 says.
- Rows are written in small batches when an event arrives, never one query per page view.

## Step B. Synthetic demo data (decision 7: allowed, labelled, removed by the clear action)

- `scripts/demo-history.js` writes about 12 months of daily alert counts for the demo countries and three sea
  lanes (Arabian Sea, Strait of Hormuz, Singapore Strait), with a mild trend and weekly rhythm, from a fixed seed
  so it is the same every time. And about 120 days of daily AIS figures for the demo vessels, in which Aurora
  Venture's dark hours jump to 31 on the days its record already names.
- Every row carries `is_synthetic = true`. Every screen that uses it says "synthetic demo data". `npm run
  demo:clean` and the clear action remove it, locally and in BigQuery.

## Step C. Pond forecast (feature 4)

- `AI.FORECAST` over `alert_daily`, one series per country and per sea lane, `horizon => 90`. The result is stored
  (the outlook, its lower and upper bound, the date it was computed), so the Globe never waits on BigQuery.
  It is recomputed by a **Refresh forecast** button and once a week with the crawl schedule, not on every view.
- The top alert categories behind each series are computed in SQL. Gemini writes two sentences **only from those
  categories and counts**; the reply is rejected if it names a category that is not in the list.
- Globe layer: the outlook per country and sea lane with its band, "Forecast, not a finding", and
  "synthetic demo data" in the legend. The six hard-coded numbers are removed.
- A forecast never adds risk points and never changes a route. A test checks that.
- Fallback: a stored sample forecast, labelled "Offline sample".

## Step D. AIS anomaly checks (feature 13)

- `AI.DETECT_ANOMALIES` over `ais_daily` per vessel, for dark hours, speed and loitering, target = the last 14 days.
- **What becomes a finding:** an anomaly in dark hours **above the rule's threshold** (24 hours) becomes a
  `vessel_ais_dark` finding whose source is the BigQuery data (table, vessel, day, value, expected range), so it
  scores through the existing row, once per case. Anomalies in speed or loitering have **no row in the points
  table**, so they are shown in the vessel drawer as "unusual behaviour" with their data and add no points, unless
  you add a row for them in Reviews (question 5).
- Fallback: sample anomalies for the demo vessels, labelled "Offline sample".

## Step E. Smarter name matching (feature 11)

- `list_names` holds each list name with its embedding. A screening embeds the name being screened and
  `VECTOR_SEARCH` returns the nearest names (top 5, cosine distance).
- These are **candidates only**. Each goes to the sanctions or PEP agent as evidence marked "name candidate,
  similarity 0.xx". Embedding similarity alone never confirms a match: only a second identifier does, and the
  existing check in `pondGuardService.js` already enforces that. A test covers it.
- **"Strong name match"** (decision 5): I measure similarities on the lists in the app (same name, transliterations,
  reordered names, near misses) and propose a threshold with the numbers. It becomes a setting in the scoring
  rules, not a constant. Until you approve one, candidates below a conservative value count as weak.
- Used by Pond-Guard and the KYC screening when connected, with a 5 second limit; otherwise the existing matching.
- Fallback: local string similarity (normalised names, token overlap), labelled "Offline matching".

## Step F. Calibration from decisions

- The calibration card is computed from `decisions`: for each confidence band, the share of AI routes the
  reviewer upheld, with the real count. The three hard-coded rates are removed.
- The demo has few decisions, so the card will show small numbers honestly ("n = 4") unless you allow a labelled
  synthetic decision history (question 4).
- Fallback: the same calculation from the app's own database.

## Step G. Screens, settings, guide

- Globe: forecast layer and legend. Vessel drawer: "Unusual behaviour". Sources: "Sync names" and the name-matching
  status. Reviews: calibration from decisions. Each shows "BigQuery" or "Offline sample".
- New variables (placeholder blocks in `.env.example`, `DEPLOY_GUIDE.md` step 6): `BIGQUERY`, `BIGQUERY_DATASET`,
  `BIGQUERY_LOCATION`, `BIGQUERY_MAX_BYTES_BILLED`, `EMBEDDING_ENDPOINT`, `BIGQUERY_DAILY_CAP`.
- Every endpoint that starts a BigQuery AI query has the per-IP rate limit and a daily cap.

## Files

| New | Changed |
| --- | --- |
| `src/services/bigquery.js`, `analyticsStore.js`, `forecastService.js`, `anomalyService.js`, `nameMatchService.js`, `calibrationService.js` | `src/events/handlers.js`, `src/routes/stats.js`, `cases.js`, `sources.js`, `src/config.js`, `src/db/sqlite.js` (new tables only) |
| `src/routes/analytics.js` | `src/services/pondGuardService.js` (name candidates, anomaly findings), `src/services/screening.js` |
| `scripts/bigquery-setup.sh`, `scripts/demo-history.js` | `scripts/demo-reset.js`, `scripts/deploy.sh`, `safe-globe.html` |
| `tests/phase4.test.js` | `.env.example`, `DEPLOY_GUIDE.md` step 6, `package.json` test list |

## Risks

- **Cost.** BigQuery's first 1 TiB of queries a month is free and these tables are a few megabytes. The AI
  functions are billed at the BigQuery ML prediction rate on bytes processed, which here is tiny; embeddings are
  billed by Vertex AI per character, about 2,000 short names. `maximumBytesBilled`, the daily cap and stored
  results keep it bounded. I will report the first real job's bytes billed.
- **Region.** The embedding call from `asia-southeast1` is unconfirmed (see above).
- **Honesty of the forecast.** It is a forecast of synthetic history. The screen says so in two places.
- **Embeddings can mislead.** Two different people can have close names. That is why a candidate is never more
  than a candidate.
- **Time.** Planned for 13 Oct. Deadline 16 Oct, 12:00 Singapore time; Phases 5 and 6 follow.

## How I will verify

- Offline: `npm test` and `npm run test:agents` stay green. New tests: the query builder for each function (exact
  SQL and parameters), `maximumBytesBilled` always set, result parsing, the forecast never adding points, Gemini's
  reason rejected when it names an unknown category, an anomaly becoming a finding only above the rule's
  threshold, a name candidate never confirming a match, the threshold as a setting, calibration arithmetic,
  synthetic rows labelled and removed by the clear action, the daily cap, and each fallback.
- In Chrome: the forecast layer and legend, the vessel drawer, the calibration card.
- Live, after your go-ahead (section 9.1) and after you run `scripts/bigquery-setup.sh`: one query per function
  from this computer, then on the UAT link.

## Questions before I start

1. **Approve this plan?**
2. **Embeddings:** use `AI.EMBED` (no `CREATE MODEL`), as I recommend, or allow a remote model so that
   `AI.GENERATE_EMBEDDING` is used exactly as the AI build spec (`GEMINI.md`) names it?
3. **Sea lanes for the forecast:** Arabian Sea, Strait of Hormuz and Singapore Strait, fitting the Aurora Venture
   story?
4. **Calibration:** show the real, small counts from the demo's decisions, or also generate a labelled synthetic
   decision history (about 300 decisions) so the card looks like a system in use?
5. **Speed and loitering anomalies:** show them with no points (my proposal), or add a new row to the points
   table for "unusual vessel behaviour", and with how many points?
6. **Refresh:** forecast and anomalies recomputed by a button and once a week. Is that right for the demo?
