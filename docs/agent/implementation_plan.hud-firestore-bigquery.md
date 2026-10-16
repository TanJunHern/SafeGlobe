# Implementation plan: HUD, Firestore and BigQuery AI (Phases A to F)

Status: **Phase A (discovery) written 14 Oct 2026. Withdrawn by the user the same day ("i dont want to add the forecast etc."). Nothing was built. Kept for its findings.**
This track replaces the AI build spec (`GEMINI.md`) Phase 4. Earlier plans: `.phase1.md`, `.phase2.md`, `.accounts.md`, `.phase3.md`,
`.phase4-bigquery-ai.md` (not built; this track takes over its features 4, 11 and 13), `.review-model.md`,
`.country-risk.md`.

Submission is 16 Oct 2026, 12:00 Singapore time (`decisions.md`). That is under two days for six phases. See
"Time" at the end.

---

## A1. What is in the repo

### The database layer

- `src/db/sqlite.js` exports **one class**, `SqliteDatabase`, not functions. It has 118 methods over 27 tables:
  `entities, ownership_edges, statements, claims, cases, alerts, sources, policies, cpi, ddq_records,
  uploaded_files, source_records, kyc_requests, ddq_templates, ddq_translations, app_settings, findings,
  risk_checks, events_seen, source_proposals, country_risk_views, country_risk_log, review_labels, ml_models,
  ml_predictions, copilot_drafts, ddq_verifications`.
- **It is synchronous.** It uses Node's built-in `node:sqlite` (`DatabaseSync`). Every method returns its value
  directly, not a promise. About 310 calls of the form `db.method(...)` in 152 places outside `src/db` rely on that.
- **There are no transactions.** No `BEGIN`, `COMMIT` or `transaction(` anywhere in `src`. The one-time DDQ link is
  "locked" by a plain `UPDATE` (`updateDdqSubmission`), and account creation is a plain `INSERT`.
- `src/db/index.js` **already exists.** It returns one `SqliteDatabase` per workspace: the Demo workspace is the
  file at `DATABASE_PATH`, every created workspace has its own file. Callers already go through `getDb()`.
- A **second SQLite database** holds accounts: `src/accounts/accountsStore.js` (`workspaces`, `accounts`,
  `account_audit`), also synchronous.
- The test command runs **239** tests today, not 125, all on SQLite.

### Firebase

- `.firebaserc` and `firebase.json` exist but are switched off: their old Hosting settings sit under a `_disabled`
  key (your instruction of 12 Oct). `firestore.rules` and `firestore.indexes.json` do not exist.
- No `firebase-admin`, `@google-cloud/firestore` or `@google-cloud/bigquery` is installed. The only Google package
  is `google-auth-library`; BigQuery, Cloud Storage, Pub/Sub, Agent Search and Document AI are all called over REST.
  Current versions on npm: `firebase-admin` 14.5.0, `@google-cloud/firestore` 9.3.1, `@google-cloud/bigquery` 9.3.0.
  The first two need Node 22 or newer; this computer and the Docker image run Node 24.
- The `firebase` stub in `src/services/documentStorage.js` is for file storage, not the database: with
  `DOCUMENT_STORAGE=firebase` its `save` and `read` throw "not implemented yet".
- Java 23 is installed (the emulator needs JDK 11 or newer). The `firebase` command is **not** installed.
  `gcloud` and `bq` are.

### Variables that already exist (rule 8: reuse them)

| Your proposed name | Already in the code | Plan |
| --- | --- | --- |
| `DB_BACKEND=sqlite\|firestore` | `DATABASE_TYPE` (`sqlite` \| `firestore`, default `sqlite`; `firestore` today warns and falls back) | Use `DATABASE_TYPE` |
| `BQ_MODE=off\|live` | `BIGQUERY=local\|bigquery` (default `local`) | Use `BIGQUERY` |
| `BQ_DATASET` | `BIGQUERY_DATASET` (default `duedilly_uat` / `duedilly_dev`) | Use `BIGQUERY_DATASET` |
| `BQ_LOCATION` | `BIGQUERY_LOCATION` (default `asia-southeast1`) | Use `BIGQUERY_LOCATION` |
| `BQ_MAX_BYTES_BILLED` | `BIGQUERY_MAX_BYTES_BILLED` (default 100 MB) | Use it; the default is question g |
| `BQ_CONNECTION` | none | Only added if a connection turns out to be needed (A3) |
| `FORCE_OFFLINE` | none | New |
| `src/services/bigqueryService.js` | `src/services/bigquery.js` (REST client, sets `maximumBytesBilled` on every query) | Extend the existing file |
| `FIRESTORE_DATABASE_ID`, `FIRESTORE_EMULATOR_HOST`, `HUD_REFRESH_SECONDS` | none | New |

BigQuery today (`DEPLOY_GUIDE.md` step 6): dataset `duedilly_uat` in `asia-southeast1`, created by
`scripts/gcp-setup.sh`. Tables `review_labels`, model `review_risk_model`. **No connection exists.** The Cloud Run
service account `duedilly-run` has `bigquery.dataEditor`, `bigquery.jobUser` and `aiplatform.user`. It does not
have `datastore.user`.

Also already there: `npm run demo:reset` (`scripts/demo-reset.js`), Playwright (in `demovideo/`), a per-IP rate
limit and daily caps, and a fixed `FORECAST` list in the Globe page that the Pond forecast layer draws today.

---

## A2. What the official documentation says (read 14 Oct 2026, docs.cloud.google.com and firebase.google.com)

### AI.FORECAST

```
AI.FORECAST(
  { TABLE table | (QUERY_STATEMENT) },
  data_col => 'DATA_COL', timestamp_col => 'TIMESTAMP_COL'
  [, model => 'MODEL'] [, id_cols => ID_COLS] [, horizon => HORIZON]
  [, forecast_end_timestamp => ...] [, confidence_level => CONFIDENCE_LEVEL]
  [, output_historical_time_series => BOOL] [, context_window => CONTEXT_WINDOW])
```

| | |
| --- | --- |
| `data_col` | INT64, NUMERIC, BIGNUMERIC or FLOAT64 column |
| `timestamp_col` | TIMESTAMP, DATE or DATETIME column |
| `model` | default `TimesFM 2.5`; `TimesFM 3.0` is Preview |
| `id_cols` | ARRAY<STRING>; each combination is one series |
| `horizon` | INT64, default 10, 1 to 10,000 for TimesFM 2.5 |
| `confidence_level` | FLOAT64, **default 0.95**, range [0, 1) |
| `context_window` | 64, 128, 256, 512, 1024, 2048, 4096, 8192 or 15360; default the smallest that covers the data |
| Output | the id columns, `forecast_timestamp` TIMESTAMP, `forecast_value` FLOAT64 (the median), `confidence_level` FLOAT64, `prediction_interval_lower_bound` FLOAT64, `prediction_interval_upper_bound` FLOAT64, `ai_forecast_status` STRING. With `output_historical_time_series => TRUE`: `time_series_type` (`history` \| `forecast`), `time_series_timestamp`, `time_series_data` instead of the first two |
| Connection, CREATE MODEL | Neither is mentioned. The function is called directly on a table or query |
| Minimum history | "A minimum of 3 data points is required." Up to 15,360 points are passed to TimesFM 2.5 |
| Locations | "available in all supported BigQuery ML locations" |
| Price | the BigQuery ML on-demand evaluation, inspection and prediction rate. Not looked up as a number |

For us: one row per day and series, `horizon => 90`, default confidence 0.95, 365 days of history.

### AI.DETECT_ANOMALIES

```
AI.DETECT_ANOMALIES(
  { TABLE HISTORY_TABLE | (HISTORY_QUERY) },
  [ { TABLE TARGET_TABLE | (TARGET_QUERY) }, ]
  data_col => 'DATA_COL', timestamp_col => 'TIMESTAMP_COL'
  [, target_last_n_points => N] [, target_start_timestamp => TS] [, model => 'MODEL']
  [, id_cols => ID_COLS] [, anomaly_prob_threshold => P] [, context_window => W])
```

| | |
| --- | --- |
| Target | a second table or query with the same schema, **or** `target_last_n_points`, **or** `target_start_timestamp`. Only one of the three |
| `anomaly_prob_threshold` | FLOAT64, default 0.95, range [0, 1) |
| `model` | default `TimesFM 2.5` |
| Output | the id columns, `time_series_timestamp` TIMESTAMP, `time_series_data` FLOAT64, `is_anomaly` BOOL, `lower_bound` FLOAT64, `upper_bound` FLOAT64, `anomaly_probability` FLOAT64, `ai_detect_anomalies_status` STRING (empty on success) |
| Connection, CREATE MODEL | Not mentioned |
| Limits | minimum 3 history points; "Only the most recent 1,024 time points are evaluated for anomalies." |
| Locations | "available in all supported BigQuery ML locations" |

For us: one call per metric (`data_col` is one column), `id_cols => ['vessel_id']`, hourly rows, history before the
last 7 days and `target_start_timestamp` at 7 days ago (168 target points, inside the 1,024 limit).

### AI.GENERATE_EMBEDDING, and the alternative AI.EMBED

```
AI.GENERATE_EMBEDDING(
  MODEL `PROJECT_ID.DATASET.MODEL_NAME`,
  { TABLE ... | (QUERY_STATEMENT) },
  STRUCT([TASK_TYPE AS task_type] [, OUTPUT_DIMENSIONALITY AS output_dimensionality]))
```

- The `MODEL` argument is "the name of a remote model over an Agent Platform text embedding model". The examples
  create it with **`CREATE MODEL ... REMOTE WITH CONNECTION`**. So this function needs both a `CREATE MODEL`
  statement and a Cloud resource connection. Input column must be named `content`. Output: `embedding`
  ARRAY<FLOAT64>, `statistics` JSON, `status` STRING, plus the input columns.
- **`AI.EMBED` needs neither:**
  ```
  AI.EMBED([content =>] 'content', endpoint => 'endpoint'
    [, task_type => '...'] [, title => '...'] [, model_params => JSON] [, connection_id => 'PROJECT.LOCATION.ID'])
  ```
  It is a scalar function called in a `SELECT`. "For user-initiated queries, the CONNECTION argument is optional":
  the query then runs with the caller's own credentials, which need `roles/aiplatform.user` (`duedilly-run` has it).
  Output: a STRUCT with `result` ARRAY<FLOAT64> and `status` STRING. `task_type` values include
  `SEMANTIC_SIMILARITY`, `RETRIEVAL_QUERY` and `RETRIEVAL_DOCUMENT`. Each call is billed by Vertex AI.
- Text models for both: `gemini-embedding-001` (up to 3072 dimensions, multilingual), `gemini-embedding-2`,
  `text-embedding-005` (English), `text-multilingual-embedding-002`.

**This is the stop in step 4 of your brief. See question e.**

### VECTOR_SEARCH

```
VECTOR_SEARCH(
  { TABLE base_table | (base_table_query) }, column_to_search,
  { TABLE query_table | (query_table_query) }
  [, query_column_to_search => '...'] [, top_k => N] [, distance_type => '...'] [, options => '{...}'])
```

- `top_k` default 10. `distance_type`: `EUCLIDEAN` (default), `COSINE`, `DOT_PRODUCT`.
  `options`: `{"use_brute_force": true}` or `{"fraction_lists_to_search": x}`.
- Output: `query` STRUCT (the query row), `base` STRUCT (the matched row), `distance` FLOAT64. "The order of the
  output isn't guaranteed."
- An index is optional: "Brute force is used to return exact results when a vector index isn't available."
- For cosine, similarity = 1 − distance. That is arithmetic, not from the page.

### CREATE VECTOR INDEX

`CREATE [OR REPLACE] VECTOR INDEX [IF NOT EXISTS] name ON dataset.table(column) [STORING(...)]
OPTIONS(index_type = 'IVF' | 'TREE_AH', distance_type = 'EUCLIDEAN' | 'COSINE' | 'DOT_PRODUCT', ...)`

"If you create a vector index on a table that is smaller than 10 MB, then the vector index isn't populated."
The demo lists are far below 10 MB, so **no index is created**; plain `VECTOR_SEARCH` is exact there.

### Firestore (Node server SDK and emulator)

- Location: `asia-southeast1` (Singapore) is a regional location. "Once you provision a database instance, you
  cannot change its location setting." A project can hold several named databases, each with its own location.
- Transactions: `db.runTransaction(async t => { await t.get(ref); t.update(ref, ...) })`. "Read operations must be
  executed before write operations." A transaction is run again on a concurrent edit, "a finite number of times",
  so its function must not change application state. Limits quoted: 10 MiB per request, 270 seconds, 60 seconds idle.
- **Every call is asynchronous.** The SDK has no synchronous form.
- Emulator: needs JDK 11 or newer and the Firebase CLI 8.14.0 or newer; default port 8080 (the same as this app in
  dev, so another port must be set in `firebase.json`); `firebase emulators:start --only firestore` or
  `firebase emulators:exec --only firestore "<test command>"`. The Admin SDK connects by itself when
  `FIRESTORE_EMULATOR_HOST` is set. Data is cleared with
  `DELETE http://localhost:<port>/emulator/v1/projects/{project}/databases/(default)/documents`.
- Emulator limits: "does not currently implement all transaction behavior seen in production"; "does not track
  compound indexes and instead will execute any valid query"; "does not enforce all limits". So the emulator cannot
  tell us which composite indexes are needed: that list has to come from the queries themselves and from the first
  run on real Firestore.

---

## A3. asia-southeast1 (step 3) and connections

| Function | Needs a connection | Needs CREATE MODEL | asia-southeast1 |
| --- | --- | --- | --- |
| `AI.FORECAST` | No | No | The page says all BigQuery ML locations. Singapore is in the BigQuery ML table for built-in models, and boosted-tree training already ran there on 12 Oct. **Not confirmed for TimesFM by name** until a dry run |
| `AI.DETECT_ANOMALIES` | No | No | Same |
| `AI.GENERATE_EMBEDDING` | **Yes** | **Yes (remote)** | The query must run where the model is. See below |
| `AI.EMBED` | Optional | No | Runs "in all of the locations that support Agent Platform embedding models". Singapore is listed for `gemini-embedding-001` and `gemini-embedding-2`. `text-embedding-005` and `text-multilingual-embedding-002` are not on the page I read, so **not confirmed** for Singapore |
| `VECTOR_SEARCH`, `CREATE VECTOR INDEX` | No | No | No location limit found. Not stated either way on the pages read |

Nothing was found to be unsupported in `asia-southeast1`, so this is not the stop you asked for. Two points stay
unconfirmed until the first live dry run, and are flagged above. The dataset is not moved.

---

## A4. The problem with Phase B as written

"The same exported function names, arguments and return shapes" cannot hold: SQLite here is synchronous and
Firestore is asynchronous only. A `firestore.js` with the same names returns promises, so all 310 call sites in the
routes, services, agents and event handlers must become `await` calls, and so must the accounts store. With 239
tests as the safety net this is doable, but it is a change to almost every file in `src`, in the last two days.

| Option | What it is | Survives restarts | Risk before 16 Oct |
| --- | --- | --- | --- |
| **B1. Full port** (as written) | `firestore.js` with all 118 methods, every caller made async, contract tests on the emulator, indexes from the queries | Yes | High. Touches every route. Indexes cannot be verified on the emulator |
| **B2. Firestore as the durable store behind SQLite** (recommended) | The app keeps working on SQLite inside the container. Every write is also written to Firestore under `workspaces/{workspaceId}/{table}/{id}`, in order, by one small writer. On start, an empty container loads its tables back from Firestore. Cloud Run already runs one instance | Yes | Low. No caller changes. Firestore is still the live system of record on Cloud Run |
| **B3. Demo tables only** | B1 for a handful of tables | Partly | Medium, and two code paths to reason about |

B2 keeps your goals (UAT data survives restarts, SQLite stays for dev and tests, server-only rules, emulator tests,
setup and seed scripts, the banner rule). It does not give a Firestore-native query layer; B1 can follow after the
hackathon. Transactions: none exist today, so there is nothing to port; under B1 or B2 I would add one real
transaction where it matters, the one-time DDQ submit.

New dependency either way: `@google-cloud/firestore` 9.3.1 (the server SDK that `firebase-admin` wraps; smaller,
and enough for server-only access). The Firebase CLI is needed on your computer for the emulator and for deploying
rules and indexes.

---

## A5. HUD sketch (question a)

The Globe's corners are not free today: the KPI strip is top left, Globe/Map and Layers are top right, the legend
is bottom left above the Ripples ticker, and the watchlist runs down the left. Four more corner panels would cover
them. Proposed: the HUD takes over the KPI strip's place as one row of four panels under the top bar, the legend
and ticker stay, and the service chips sit at the right end of the ticker row.

```
+--------------------------------------------------------------------------------------------------+
| DueDilly                              Ask Dilly   Vessels   Intake                    [HUD: H]   |
+-----------+--------------------------------------------------------------------------------------+
|           | POND STATUS        | FORECAST  Cameroon v | UNUSUAL BEHAVIOUR  | NAME MATCHES        |
| Watchlist | (duck) Escalate    |      __/\  ....:::   | Aurora Venture     | "Severny Agro"      |
|           | 9 watched 4 ripples|  ___/    \/ band     | dark 31 h   99%    |  ~ Severnyi Agro 0.91|
| Arkady .. | [2][3][1][3]       | -90d    now    +90d  | +20 pts §5.4       |  Needs a 2nd id     |
| Aurora .. | last screen 09:42  | Forecast, not a      | Halcyon tug        | "Kestrel Trading"   |
| Tide   .. |                    | finding · Synthetic  | speed  no points   |  ~ Kestrel FZE 0.88 |
|           +--------------------+----------------------+--------------------+---------------------+
|           |                                                                   [Globe|Map] [Layers]|
|           |                                 ( globe )                                       [+][-]|
|           |  +---------------+                                                                    |
|           |  | legend        |                                                                    |
|           |  +---------------+                                                                    |
|           | RIPPLES  Aurora Venture: 31-hour AIS gap ...   Firestore* BigQuery* Gemini* ADK*      |
+-----------+--------------------------------------------------------------------------------------+
  * each chip: Connected, or Offline sample.     Under 900 px: one "HUD" button opens the four as a drawer.
```

The four KPI numbers (Screened, Under monitoring, Open reviews, Auto-cleared) move into Pond status. If you would
rather keep the KPI strip and have true corner panels, the alternative is: Pond status and Forecast in a second row
under the KPIs, and the other two as a right-hand column under Layers. Say which.

---

## A6. Notes for the later phases (not yet plans)

- **Synthetic data** is already allowed (`decisions.md`, answer 7, 12 Oct): labelled, saved as a demo data set,
  removed by `demo:clean`. I read that as covering 12 months of daily alert counts and 90 days of hourly AIS rows.
- **Name threshold.** An embedding threshold can only be measured after the first live embedding call. Before that
  I can measure the app's existing matcher on the built-in lists and report it; the embedding number follows the
  first run, for your approval, and stays a setting.
- **D2 rule check.** "Dark for more than 24 hours in the last 90 days" is a fact about the track, computed in SQL.
  An anomaly flag points at it but does not create it: the +20 comes from the points row, with the BigQuery row as
  its source. Speed and loitering have no points row, so they show as "Unusual behaviour, no points".
- **HUD cost.** `GET /api/hud` reads cache tables only. No Gemini call, no BigQuery job.
- **Rule 5.** Nothing in this track trains a model. `AI.FORECAST` and `AI.DETECT_ANOMALIES` use the pre-trained
  TimesFM. A remote embedding model would be a `CREATE MODEL` statement without training (question e).

## Time

Honest estimate against 16 Oct, 12:00: C, D and E on offline samples, plus live BigQuery AI after your go-ahead,
fit. B2 fits. B1 does not fit together with the rest. F fits only in part (`demo:reset` exists; `demo:check` with
Playwright and "passes on UAT twice" need a deployed build with time to spare). Suggested order if you agree:
**C, D, E first** (what a judge sees), **then B2, then F**. Features 6, 16 and 17 of the AI build spec (`GEMINI.md`) (Quack-Back, DDQ
email, Request more info) and "How Dilly works" (15) are still not built and are not in this track.

---

## Questions

a. **HUD layout:** the sketch above (one row replacing the KPI strip), or the alternative with true corners?
b. **Firestore scope and shape:** B1, B2 or B3 (section A4)? Recommended: B2, all tables.
c. **Firestore to BigQuery:** your default (1), the app writes typed rows, is what the plan assumes. Confirm.
d. **Synthetic data:** I read the 12 Oct approval as covering this. Confirm, or say no.
e. **Embeddings (the stop from step 4):** `AI.GENERATE_EMBEDDING` needs `CREATE MODEL ... REMOTE WITH CONNECTION`
   and a connection. `AI.EMBED` needs neither. May I use **`AI.EMBED` with `VECTOR_SEARCH`**, with
   `gemini-embedding-001` (multilingual, listed for Singapore)? Or do you want `AI.GENERATE_EMBEDDING` by name, with
   a remote-model `CREATE MODEL` in a script you run?
f. **Name threshold:** agreed that I propose it after the first live embedding run, as a setting?
g. **Cost cap:** `BIGQUERY_MAX_BYTES_BILLED` is 100 MB by default today. Raise the default to 1 GB, or keep 100 MB
   and set 1 GB only in `.env.uat`?
h. **Variable names:** reuse `DATABASE_TYPE`, `BIGQUERY`, `BIGQUERY_DATASET`, `BIGQUERY_LOCATION` and
   `BIGQUERY_MAX_BYTES_BILLED` instead of the new `DB_BACKEND` and `BQ_*` names (rule 8)?
i. **Order and scope before the deadline:** C, D, E, then B2, then F? Or something else first?
j. **New dependency and tool:** approve adding `@google-cloud/firestore`, and will you install the Firebase CLI
   (`npm install -g firebase-tools`) for the emulator?
