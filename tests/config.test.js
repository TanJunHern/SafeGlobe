const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const gemini = require('../src/services/geminiClient');
const { startServer, stopServer } = require('../src/server');

const TEST_PORT = 8097;
const KEY = 'AIzaSy-example-key-that-is-long-enough';

test('Environment validation', () => {
  const v = env => config.validateEnv(env);

  // No APP_ENV (npm start, npm test) and dev need nothing: Gemini-disabled mode is valid
  assert.deepEqual(v({}), []);
  assert.deepEqual(v({ APP_ENV: 'dev' }), []);
  assert.deepEqual(v({ APP_ENV: 'dev', PORT: '8080', GEMINI_BACKEND: 'aistudio' }), []);

  assert.match(v({ APP_ENV: 'prod' })[0], /APP_ENV must be "dev" or "uat"/);
  assert.match(v({ PORT: 'eighty' })[0], /PORT must be a port number/);
  assert.match(v({ GEMINI_BACKEND: 'openai' })[0], /GEMINI_BACKEND must be "aistudio" or "vertex"/);

  // uat: own JWT secret, an explicit backend, and what that backend needs
  const bare = v({ APP_ENV: 'uat', DEMO_MODE: 'true' });
  assert.equal(bare.length, 2);
  assert.match(bare[0], /JWT_SECRET/);
  assert.match(bare[1], /GEMINI_BACKEND must be set in uat/);
  assert.match(v({ APP_ENV: 'uat', DEMO_MODE: 'true', JWT_SECRET: 'safeglobe-ddq-secure-hmac-key-2026', GEMINI_BACKEND: 'aistudio', GEMINI_API_KEY: KEY })[0], /JWT_SECRET/);

  const vertex = v({ APP_ENV: 'uat', DEMO_MODE: 'true', JWT_SECRET: 'my-own-secret', GEMINI_BACKEND: 'vertex' });
  assert.deepEqual(vertex.map(p => p.split(' ')[0]), ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'VERTEX_GEMINI_MODEL']);
  assert.deepEqual(v({ APP_ENV: 'uat', DEMO_MODE: 'true', JWT_SECRET: 'my-own-secret', GEMINI_BACKEND: 'vertex', GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_CLOUD_LOCATION: 'asia-southeast1', VERTEX_GEMINI_MODEL: 'a-model-the-project-has' }), []);
  // Without demo mode the only way in is Google sign-in
  assert.match(v({ APP_ENV: 'uat', JWT_SECRET: 'my-own-secret', GEMINI_BACKEND: 'aistudio', GEMINI_API_KEY: KEY })[0], /GOOGLE_CLIENT_ID is required in uat unless DEMO_MODE=true/);
  assert.deepEqual(v({ APP_ENV: 'uat', JWT_SECRET: 'my-own-secret', GEMINI_BACKEND: 'aistudio', GEMINI_API_KEY: KEY, GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com' }), []);

  assert.match(v({ APP_ENV: 'uat', DEMO_MODE: 'true', JWT_SECRET: 'my-own-secret', GEMINI_BACKEND: 'aistudio' })[0], /GEMINI_API_KEY is required/);
  assert.match(v({ APP_ENV: 'uat', DEMO_MODE: 'true', JWT_SECRET: 'my-own-secret', GEMINI_BACKEND: 'aistudio', GEMINI_API_KEY: 'YOUR_GOOGLE_AI_STUDIO_API_KEY' })[0], /GEMINI_API_KEY is required/);
  assert.deepEqual(v({ APP_ENV: 'uat', DEMO_MODE: 'true', JWT_SECRET: 'my-own-secret', GEMINI_BACKEND: 'aistudio', GEMINI_API_KEY: KEY }), []);
});

test('Health endpoints report the environment without secrets', async () => {
  await startServer(TEST_PORT);
  try {
    // The test command blanks the Gemini keys, so the shared client is in "Gemini disabled" mode
    assert.equal(gemini.backend(), 'disabled');
    assert.equal(gemini.isConfigured(), false);

    const res = await fetch(`http://localhost:${TEST_PORT}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { env: 'local', version: config.version, gemini: 'disabled' });

    const health = await (await fetch(`http://localhost:${TEST_PORT}/api/health`)).json();
    assert.equal(health.status, 'healthy');
    assert.equal(health.env, 'local');
    assert.equal(health.gemini, 'disabled');
    assert.equal(health.service, 'DueDilly Compliance Platform');
  } finally {
    await stopServer();
  }
});
