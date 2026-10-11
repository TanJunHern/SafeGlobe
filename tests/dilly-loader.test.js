const test = require('node:test');
const assert = require('node:assert');

const { createLoadTimer, poseForRoute, TASKS } = require('../dilly-loader');

// Records which hooks fired, in order
function harness() {
  const events = [];
  const timer = createLoadTimer({
    onShow: () => events.push('show'),
    onSlow: () => events.push('slow'),
    onHide: () => events.push('hide')
  });
  return { events, timer, done: () => events.push('done') };
}

test('DillyLoader timing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

  await t.test('a request faster than 300ms never shows the loader', () => {
    const { events, timer, done } = harness();
    timer.start();
    t.mock.timers.tick(299);
    timer.finish(done);
    t.mock.timers.tick(10000);
    assert.deepEqual(events, ['done']);
  });

  await t.test('the loader appears at 300ms', () => {
    const { events, timer } = harness();
    timer.start();
    t.mock.timers.tick(299);
    assert.deepEqual(events, []);
    t.mock.timers.tick(1);
    assert.deepEqual(events, ['show']);
    timer.cancel();
  });

  await t.test('once shown it stays for at least 600ms', () => {
    const { events, timer, done } = harness();
    timer.start();
    t.mock.timers.tick(300);          // shown
    t.mock.timers.tick(100);          // request settles 100ms later
    timer.finish(done);
    assert.deepEqual(events, ['show']);
    t.mock.timers.tick(499);          // 599ms visible
    assert.deepEqual(events, ['show']);
    t.mock.timers.tick(1);            // 600ms visible
    assert.deepEqual(events, ['show', 'hide', 'done']);
  });

  await t.test('a loader already visible for 600ms hides as soon as the request settles', () => {
    const { events, timer, done } = harness();
    timer.start();
    t.mock.timers.tick(300);          // shown
    t.mock.timers.tick(600);          // visible for 600ms
    timer.finish(done);
    assert.deepEqual(events, ['show', 'hide', 'done']);
  });

  await t.test('after 8s it adds the "taking longer" line, once', () => {
    const { events, timer, done } = harness();
    timer.start();
    t.mock.timers.tick(7999);
    assert.deepEqual(events, ['show']);
    t.mock.timers.tick(1);
    assert.deepEqual(events, ['show', 'slow']);
    t.mock.timers.tick(20000);        // e.g. the Gemini client falling back to another model
    assert.deepEqual(events, ['show', 'slow']);
    timer.finish(done);
    assert.deepEqual(events, ['show', 'slow', 'hide', 'done']);
  });

  await t.test('a request that settles before 8s never shows the "taking longer" line', () => {
    const { events, timer, done } = harness();
    timer.start();
    t.mock.timers.tick(5000);
    timer.finish(done);
    t.mock.timers.tick(10000);
    assert.deepEqual(events, ['show', 'hide', 'done']);
  });
});

test('DillyLoader route -> pose mapping', () => {
  assert.equal(poseForRoute('monitor'), 'dilly_done.svg');            // Auto-clear
  assert.equal(poseForRoute('Auto-clear'), 'dilly_done.svg');
  assert.equal(poseForRoute('investigate'), 'dilly_medium.svg');
  assert.equal(poseForRoute('escalate', true), 'dilly_sanctions.svg'); // sanctions match
  assert.equal(poseForRoute('escalate', false), 'dilly_medium.svg');   // any other reason
  assert.equal(poseForRoute('escalate'), 'dilly_medium.svg');
  assert.equal(poseForRoute('gaps'), null);                            // Fill the gaps
  assert.equal(poseForRoute(''), null);                                // no route yet
  assert.equal(poseForRoute(undefined), null);
  // A system error is never a risk pose
  ['monitor', 'investigate', 'escalate', 'gaps', ''].forEach(r => assert.notEqual(poseForRoute(r, true), 'dilly_error.svg'));
});

test('DillyLoader task -> image and text', () => {
  assert.equal(TASKS.document.image, 'dilly_reading.svg');
  ['screen', 'policy', 'source'].forEach(k => assert.equal(TASKS[k].image, 'dilly_loading.svg'));
  assert.equal(TASKS.document.text, 'Dilly is reading the document');
  assert.equal(TASKS.screen.text, 'Dilly is screening');
  assert.equal(TASKS.policy.text, 'Dilly is checking the policies');
  assert.equal(TASKS.source.text, 'Dilly is reading the source');
});
