const test = require('node:test');
const assert = require('node:assert');

const M = require('../dilly-motion');

test('DillyMotion pure helpers', async (t) => {
  await t.test('once is true only the first time a key is seen', () => {
    const once = M.createOnce();
    assert.equal(once('why:aurora:85'), true);
    assert.equal(once('why:aurora:85'), false);
    assert.equal(once('why:aurora:60'), true, 'a new score plays again');
  });

  await t.test('the plane flies away unless the server says the message was not sent', () => {
    assert.equal(M.planeOutcome({ success: true, message: 'DDQ link dispatched' }), 'away');
    assert.equal(M.planeOutcome({ delivery: { sent: true } }), 'away');
    assert.equal(M.planeOutcome({ delivery: { sent: false, reason: 'not on the demo allowlist' } }), 'back');
    assert.equal(M.planeOutcome(null), 'away');
  });

  await t.test('stamps match the officer actions and keep the stored action values', () => {
    assert.deepEqual(M.stampFor('Approve'), { word: 'Approved', tone: 'low' });
    assert.deepEqual(M.stampFor('Rejected'), { word: 'Rejected', tone: 'high' });
    assert.deepEqual(M.stampFor('Bounce Back'), { word: 'More info', tone: 'mid' });
    assert.deepEqual(M.stampFor('signed'), { word: 'Signed', tone: 'accent' });
    assert.equal(M.stampFor('Escalate'), null);
    assert.equal(M.stampFor(undefined), null);
  });

  await t.test('the count-up starts at 0, never goes down and lands exactly on the total', () => {
    assert.equal(M.countAt(85, 0), 0);
    assert.equal(M.countAt(85, 1), 85);
    assert.equal(M.countAt(85, 2), 85, 'clamped after the end');
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = M.countAt(85, i / 20);
      assert.ok(v >= prev, `step ${i} went down`);
      prev = v;
    }
  });

  await t.test('plane paths start at the button and the loop comes back to it', () => {
    const away = M.bezierPoints([0, 0], [14, 26], [100, -20], [300, -200], 14);
    assert.deepEqual(away[0], [0, 0]);
    assert.deepEqual(away[away.length - 1], [300, -200]);
    const loop = M.loopPoints();
    assert.deepEqual(loop[0], [0, 0]);
    const end = loop[loop.length - 1];
    assert.ok(Math.abs(end[0]) < 1e-9 && Math.abs(end[1]) < 1e-9);
  });

  await t.test('path keyframes run from offset 0 to 1 and never turn more than half a circle per step', () => {
    const frames = M.pathFrames(M.loopPoints(), () => 1, () => 1);
    assert.equal(frames[0].offset, 0);
    assert.equal(frames[frames.length - 1].offset, 1);
    const angles = frames.map(f => Number(/rotate\((-?[\d.]+)deg\)/.exec(f.transform)[1]));
    for (let i = 1; i < angles.length; i++) assert.ok(Math.abs(angles[i] - angles[i - 1]) <= 180, `jump at frame ${i}`);
    for (let i = 1; i < frames.length; i++) assert.ok(frames[i].offset > frames[i - 1].offset);
  });

  await t.test('a packet arc starts at the sender, ends at the receiver and lifts above the straight line', () => {
    const pts = M.arcPoints(400, 0);
    assert.deepEqual(pts[0], [0, 0]);
    assert.ok(Math.abs(pts[pts.length - 1][0] - 400) < 1e-9 && Math.abs(pts[pts.length - 1][1]) < 1e-9);
    assert.ok(pts[Math.floor(pts.length / 2)][1] < 0, 'the middle of the arc is above the line');
  });

  await t.test('DOM helpers do nothing in Node and never throw', () => {
    assert.equal(M.reduced(), true);
    assert.doesNotThrow(() => { M.fly(null, 'away'); M.stamp(null, 'Approve'); M.tally(null, 'k'); M.pop(null, 'k'); M.hop(null); M.waddle(null, 'k'); M.packet(null, null); M.rise(null); });
  });
});
