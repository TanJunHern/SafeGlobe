/**
 * A small BigQuery client over REST (jobs.query and getQueryResults), signed with the service account's token.
 * Used by the review model (src/learning/bqModel.js). No query library is installed.
 *
 *   query(sql, opts)   runs a statement and waits for its rows
 *   start(sql, opts)   starts a long statement (training) and returns its job; poll(job) says when it is done
 *
 * Every ordinary query carries maximumBytesBilled, so a mistake fails instead of costing money.
 */
const config = require('../config');

const project = () => config.googleCloudProject || config.gcpProjectId;
const dataset = () => config.bigquery.dataset || `duedilly_${config.appEnv === 'uat' ? 'uat' : 'dev'}`;
const live = () => config.bigquery.mode === 'bigquery' && Boolean(project());
/** `project.dataset.name`, for use inside SQL. Names are fixed in code, never taken from a user. */
const table = name => `\`${project()}.${dataset()}.${String(name).replace(/[^A-Za-z0-9_]/g, '')}\``;

let authClient = null;
async function accessToken() {
  if (!authClient) {
    const { GoogleAuth } = require('google-auth-library');
    authClient = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/bigquery'] }).getClient();
  }
  const token = await authClient.getAccessToken();
  return token.token || token;
}

async function call(method, path, body) {
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project()}/${path}`, {
    method, headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`BigQuery answered ${res.status}: ${((data.error && data.error.message) || '').slice(0, 300)}`), { status: res.status });
  return data;
}

/** Rows as plain objects. Nested and repeated values are asked for as JSON text in the SQL, so cells are simple here. */
function rowsOf(data) {
  const fields = ((data.schema && data.schema.fields) || []).map(f => f.name);
  return (data.rows || []).map(r => Object.fromEntries(r.f.map((cell, i) => [fields[i], cell.v])));
}

const stringParams = params => Object.entries(params || {}).map(([name, value]) => ({ name, parameterType: { type: 'STRING' }, parameterValue: { value: String(value) } }));

function request(sql, { params, timeoutMs, limitBytes = true } = {}) {
  return Object.assign({ query: sql, useLegacySql: false, location: config.bigquery.location, timeoutMs, parameterMode: 'NAMED', queryParameters: stringParams(params), labels: { app: 'duedilly' } },
    limitBytes ? { maximumBytesBilled: String(config.bigquery.maxBytesBilled) } : {});
}

const summary = data => ({ jobId: data.jobReference && data.jobReference.jobId, location: (data.jobReference && data.jobReference.location) || config.bigquery.location, bytesProcessed: Number(data.totalBytesProcessed || 0), bytesBilled: data.totalBytesBilled === undefined ? null : Number(data.totalBytesBilled) });

/** Runs a statement and waits up to waitMs for it. Returns { rows, jobId, bytesProcessed, bytesBilled }. */
async function query(sql, { params, waitMs = 60000, limitBytes = true } = {}) {
  let data = await call('POST', 'queries', request(sql, { params, timeoutMs: Math.min(waitMs, 20000), limitBytes }));
  const deadline = Date.now() + waitMs;
  while (!data.jobComplete) {
    if (Date.now() > deadline) throw new Error('BigQuery did not finish in time');
    const job = summary(data);
    data = Object.assign({ jobReference: data.jobReference }, await call('GET', `queries/${job.jobId}?location=${encodeURIComponent(job.location)}&timeoutMs=10000`));
  }
  return Object.assign({ rows: rowsOf(data) }, summary(data));
}

/** Starts a statement without waiting (model training takes minutes). */
async function start(sql, { params, limitBytes = false } = {}) {
  const data = await call('POST', 'queries', request(sql, { params, timeoutMs: 1000, limitBytes }));
  return Object.assign({ done: Boolean(data.jobComplete) }, summary(data));
}

/** { done, error } for a job started with start(). */
async function poll(job) {
  try {
    const data = await call('GET', `queries/${job.jobId}?location=${encodeURIComponent(job.location)}&timeoutMs=1000&maxResults=0`);
    return { done: Boolean(data.jobComplete), error: null, bytesProcessed: Number(data.totalBytesProcessed || 0) };
  } catch (err) {
    return { done: true, error: err.message };
  }
}

const status = () => ({ mode: live() ? 'bigquery' : 'local', project: live() ? project() : null, dataset: live() ? dataset() : null, location: config.bigquery.location, maxBytesBilled: config.bigquery.maxBytesBilled });

module.exports = { query, start, poll, live, table, dataset, status, request, rowsOf };
