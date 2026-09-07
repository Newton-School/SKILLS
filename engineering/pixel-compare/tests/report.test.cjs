const test = require('node:test');
const assert = require('node:assert/strict');

const { indexHtml, statusOf, summaryMd } = require('../scripts/lib/report.cjs');

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

test('reports label fixed UI pixel evidence as a diff and link its montage', () => {
  const finding = { sev: 'major', type: 'floating-ui-pixels', msg: 'Fixed/sticky UI renders differently' };
  const data = {
    meta: {
      a: 'https://reference.example/',
      b: 'https://candidate.example/',
      labels: { a: 'Reference', b: 'Candidate' },
      vps: [390],
      generatedAt: '2026-01-01T00:00:00.000Z',
    },
    results: {
      390: {
        sections: [],
        onlyA: [],
        onlyB: [],
        floats: { shot: { diffPixels: 1, diffRatio: 0.000001 }, findings: [finding] },
      },
    },
  };

  const markdown = summaryMd(data, {});
  const html = indexHtml(data, {});
  assert.match(markdown, /Fixed\/sticky UI \(390px\) — DIFF/);
  assert.match(markdown, /\.\/390\/floating-ui\/montage\.png/);
  assert.match(html, /FLOATING UI DIFF/);
  assert.match(html, /\.\/390\/floating-ui\/montage\.png/);
});
