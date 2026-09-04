const test = require('node:test');
const assert = require('node:assert/strict');

const { statusOf } = require('../scripts/lib/report.cjs');

test('status thresholds include each boundary in the more severe band', () => {
  const cases = [
    [0, 'MATCH'],
    [0.002999, 'MATCH'],
    [0.003, 'LOW'],
    [0.014999, 'LOW'],
    [0.015, 'MEDIUM'],
    [0.049999, 'MEDIUM'],
    [0.05, 'HIGH'],
    [1, 'HIGH'],
  ];

  for (const [diffRatio, expected] of cases) {
    assert.equal(statusOf({ shot: { diffRatio } }), expected, `diffRatio ${diffRatio}`);
  }
});

test('missing and failed captures take precedence over pixel thresholds', () => {
  assert.equal(statusOf({ missingOn: 'A', shot: { diffRatio: 0 } }), 'ONLY-A');
  assert.equal(statusOf({ missingOn: 'B' }), 'ONLY-B');
  assert.equal(statusOf({}), 'ERROR');
  assert.equal(statusOf({ shot: {} }), 'ERROR');
  assert.equal(statusOf({ shot: { diffRatio: Number.NaN } }), 'ERROR');
  assert.equal(statusOf({ shot: { error: 'capture failed', diffRatio: 0 } }), 'ERROR');
});
