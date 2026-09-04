const test = require('node:test');
const assert = require('node:assert/strict');

const {
  alignFloats,
  ensureNonEmpty,
  jaccard,
  matchAnchors,
  tokens,
} = require('../scripts/lib/pair.cjs');

test('heading tokens normalize case, compatibility characters, and Unicode text', () => {
  assert.deepEqual(
    [...tokens('  CAFE\u0301  ＡＰＩ  東京  １２３  x  ')],
    ['café', 'api', '東京', '123'],
  );
});

test('Unicode headings match across case, whitespace, and punctuation differences', () => {
  const headingsA = [
    { t: 'Crème brûlée — 東京', y: 240, leafTop: 200 },
    { t: 'डेटा साइंस के लिए आवेदन', y: 720, leafTop: 680 },
  ];
  const headingsB = [
    { t: 'CRÈME   BRÛLÉE: 東京', y: 260, leafTop: 220 },
    { t: 'डेटा साइंस के लिए आवेदन', y: 760, leafTop: 710 },
  ];

  const matches = matchAnchors(headingsA, headingsB);

  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map(({ a, b }) => [a.t, b.t]), [
    [headingsA[0].t, headingsB[0].t],
    [headingsA[1].t, headingsB[1].t],
  ]);
  assert.ok(matches.every(({ sim }) => sim === 1));
});

test('Jaccard similarity distinguishes empty and partially overlapping token sets', () => {
  assert.equal(jaccard(new Set(), new Set()), null);
  assert.equal(jaccard(tokens('alpha beta'), tokens('beta gamma')), 1 / 3);
  assert.equal(jaccard(tokens('alpha'), new Set()), 0);
});

test('empty-slice cleanup is bounded by all interior cuts, not a fixed limit', () => {
  const boundariesA = Array.from({ length: 42 }, (_, index) => index * 100);
  const boundariesB = [...boundariesA];
  const anchors = Array.from({ length: 40 }, () => ({}));
  const leaves = [{ y: 0, h: 4100 }];

  const result = ensureNonEmpty(boundariesA, boundariesB, anchors, leaves, leaves);

  assert.deepEqual(result.bA, [0, 4100]);
  assert.deepEqual(result.bB, [0, 4100]);
  assert.deepEqual(result.anchors, []);
});

test('matching floating icon controls can align without text or class names', () => {
  const icon = { tag: 'button', text: '', cls: '', hasImg: true, rect: { w: 48, h: 48 } };
  const result = alignFloats([icon], [{ ...icon, rect: { w: 50, h: 48 } }]);

  assert.equal(result.pairs.length, 1);
  assert.deepEqual(result.onlyA, []);
  assert.deepEqual(result.onlyB, []);
});
