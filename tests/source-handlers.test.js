const test = require('node:test');
const assert = require('node:assert');
const { handleDataset, handleDocument, handleApi, handleWebsite, convertAndStoreSource } = require('../src/services/sourceHandlers');
const { getDb } = require('../src/db');

test('Source Handlers - Dataset CSV conversion', () => {
  const csvContent = `name,reg,country,status,notes
Baltic Energy Trans LLC,RU-88291,RUS,Sanctioned,Sectoral gas trading
Nordic Bunkers AS,NO-99120,NOR,Clean,Verified Scandinavian fuel supplier`;

  const result = handleDataset({
    sourceId: 's_test_ds',
    label: 'Test Blocklist CSV',
    format: 'CSV',
    content: csvContent
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.recordsCount, 2);
  assert.strictEqual(result.records[0].entity_name, 'Baltic Energy Trans LLC');
  assert.strictEqual(result.records[0].risk_level, 'High');
  assert.strictEqual(result.records[1].entity_name, 'Nordic Bunkers AS');
  assert.strictEqual(result.records[1].risk_level, 'Low');
});

test('Source Handlers - Dataset JSON conversion', () => {
  const jsonContent = JSON.stringify([
    { name: 'Caspian Trade FZE', reg: 'AE-9921', country: 'ARE', risk: 85, summary: 'Offshore trading hub' }
  ]);

  const result = handleDataset({
    sourceId: 's_test_json',
    label: 'Test JSON Feed',
    format: 'JSON',
    content: jsonContent
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.recordsCount, 1);
  assert.strictEqual(result.records[0].entity_name, 'Caspian Trade FZE');
  assert.strictEqual(result.records[0].risk_level, 'High');
});

test('Source Handlers - Document text/PDF conversion', () => {
  const docText = `ENFORCEMENT NOTICE 2026:
The authority has restricted operations of Severny Agro Export LLC and chartered vessel Aurora Venture.
Director Alexander Viktorov has been named in proceedings.`;

  const result = handleDocument({
    sourceId: 's_test_doc',
    label: 'Gazette Notice',
    category: 'Regulatory enforcement gazette',
    content: docText,
    filename: 'gazette_2026.pdf'
  });

  assert.strictEqual(result.success, true);
  assert(result.recordsCount >= 2);
  const names = result.records.map(r => r.entity_name);
  assert(names.some(n => n.includes('Severny Agro Export') || n.includes('Aurora Venture')));
});

test('Source Handlers - API connector conversion', async () => {
  const result = await handleApi({
    sourceId: 's_test_api',
    label: 'Vendor Risk API',
    url: 'https://example-kyc.internal/api',
    sampleData: [
      { name: 'Apex Shipping Pte Ltd', reg_no: 'UEN 20210012A', country: 'SGP', risk_level: 'Low' }
    ]
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.recordsCount, 1);
  assert.strictEqual(result.records[0].entity_name, 'Apex Shipping Pte Ltd');
  assert.strictEqual(result.records[0].jurisdiction, 'SGP');
});

test('Source Handlers - Public Website monitor conversion', async () => {
  const html = `<html><body><h1>Regulator Warning List</h1><p>Aethelgard Finance Pte Ltd reprimanded under AML provisions.</p></body></html>`;

  const result = await handleWebsite({
    sourceId: 's_test_web',
    label: 'MAS Watch Page',
    url: 'https://www.mas.gov.sg/test',
    content: html
  });

  assert.strictEqual(result.success, true);
  assert(result.recordsCount >= 1);
  assert(result.records[0].entity_name.includes('Aethelgard') || result.records[0].summary.includes('reprimand'));
});

test('Source Handlers - Universal convertAndStoreSource persists to SQLite', async () => {
  const db = getDb();
  const source = {
    id: 's_uni_test',
    label: 'Custom Maritime Feed',
    type: 'Data feed',
    content: 'name,imo,flag,status\nOcean Star Tanker,9488192,LBR,Sanctioned\n',
    config: { format: 'CSV' }
  };

  const res = await convertAndStoreSource(source);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.recordsCount, 1);

  const stored = db.getSourceRecordsBySource('s_uni_test');
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(stored[0].entity_name, 'Ocean Star Tanker');
  assert.strictEqual(stored[0].risk_level, 'High');
});
