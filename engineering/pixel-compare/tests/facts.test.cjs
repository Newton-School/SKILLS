const test = require('node:test');
const assert = require('node:assert/strict');

const {
  floatFindings,
  sectionFindings,
  setDiff,
  splitDynamicText,
} = require('../scripts/lib/facts.cjs');

function section(overrides = {}) {
  return {
    rect: { h: 500 },
    bg: 'rgb(255, 255, 255)',
    headings: [],
    lines: [],
    imgCount: 0,
    alts: [],
    ctas: [],
    dynamics: [],
    animCount: 0,
    ...overrides,
  };
}

function heading(overrides = {}) {
  return {
    t: 'Crème brûlée 東京',
    tag: 'h2',
    size: 32,
    weight: '700',
    family: 'Inter',
    color: 'rgb(0, 0, 0)',
    ...overrides,
  };
}

function floating(overrides = {}) {
  return {
    kind: 'fixed',
    tag: 'button',
    cls: 'support',
    text: '',
    role: 'Support',
    hasImg: true,
    rect: { x: 20, y: 720, w: 48, h: 48 },
    media: ['svg|0 0 24 24|<path d="M1 1"/>'],
    style: { color: '#ffffff', bg: '#2563eb', radius: '24px' },
    visual: [{
      tag: 'svg', x: 12, y: 12, w: 24, h: 24, text: '',
      media: ['svg|0 0 24 24|<path d="M1 1"/>'], pseudo: [],
      style: { fill: '#ffffff', stroke: 'none' },
    }],
    ...overrides,
  };
}

test('setDiff is case-insensitive, trims whitespace, and preserves duplicate counts', () => {
  assert.deepEqual(
    setDiff([' Same ', 'same', 'Only A'], ['same', 'Only B']),
    { onlyA: ['same', 'Only A'], onlyB: ['Only B'] },
  );
});

test('splitDynamicText recognizes changes containing non-ASCII numerals', () => {
  const result = splitDynamicText(
    ['शेष सीटें: १२', 'केवल A'],
    ['शेष सीटें: ९', 'केवल B'],
  );

  assert.deepEqual(result.dynamic, [{ a: 'शेष सीटें: १२', b: 'शेष सीटें: ९' }]);
  assert.deepEqual(result.restA, ['केवल A']);
  assert.deepEqual(result.restB, ['केवल B']);
});

test('section findings pair Unicode headings and classify structural facts', () => {
  const secA = section({
    headings: [heading()],
    lines: ['Seats available: 12', 'Reference-only copy'],
  });
  const secB = section({
    headings: [heading({ t: 'CRÈME BRÛLÉE: 東京', size: 36 })],
    lines: ['Seats available: 8', 'Candidate-only copy'],
  });

  const findings = sectionFindings(secA, secB, { a: 'Reference', b: 'Candidate' }, null);
  const classification = findings.map(({ sev, type }) => ({ sev, type }));

  assert.equal(classification.filter(({ type }) => type === 'heading').length, 1);
  assert.ok(classification.some(({ sev, type }) => sev === 'major' && type === 'heading'));
  assert.equal(classification.filter(({ sev, type }) => sev === 'dynamic' && type === 'dynamic-text').length, 1);
  assert.equal(classification.filter(({ sev, type }) => sev === 'major' && type === 'copy').length, 2);
});

test('isolated fixed UI pixel changes are major even below section MATCH thresholds', () => {
  const control = floating();
  const findings = floatFindings(
    { pairs: [{ a: control, b: structuredClone(control) }], onlyA: [], onlyB: [] },
    { a: 'Reference', b: 'Candidate' },
    { diffPixels: 1, diffRatio: 0.000001 },
  );

  assert.ok(findings.some(({ sev, type }) => sev === 'major' && type === 'floating-ui-pixels'));
});

test('paired fixed controls report geometry, root style, and nested visual changes', () => {
  const controlA = floating();
  const controlB = floating({
    rect: { x: 30, y: 720, w: 48, h: 48 },
    style: { color: '#ffffff', bg: '#dc2626', radius: '24px' },
    visual: [{
      ...floating().visual[0],
      style: { fill: '#111111', stroke: 'none' },
    }],
  });
  const findings = floatFindings(
    { pairs: [{ a: controlA, b: controlB }], onlyA: [], onlyB: [] },
    { a: 'Reference', b: 'Candidate' },
    { diffPixels: 0, diffRatio: 0 },
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].sev, 'major');
  assert.match(findings[0].msg, /geometry/);
  assert.match(findings[0].msg, /root style/);
  assert.match(findings[0].msg, /painted subtree record/);
});

test('fixed UI comparison ignores two-pixel geometry rounding drift', () => {
  const controlA = floating();
  const controlB = floating({
    rect: { x: 22, y: 718, w: 50, h: 46 },
    visual: [{ ...floating().visual[0], x: 14, y: 10, w: 26, h: 22 }],
  });

  assert.deepEqual(
    floatFindings(
      { pairs: [{ a: controlA, b: controlB }], onlyA: [], onlyB: [] },
      { a: 'Reference', b: 'Candidate' },
      { diffPixels: 0, diffRatio: 0 },
    ),
    [],
  );
});

test('unmatched fixed roots remain major findings', () => {
  const findings = floatFindings(
    { pairs: [], onlyA: [floating()], onlyB: [floating({ cls: 'chat' })] },
    { a: 'Reference', b: 'Candidate' },
    { diffPixels: 0, diffRatio: 0 },
  );

  assert.equal(findings.length, 2);
  assert.ok(findings.every(({ sev, type }) => sev === 'major' && type === 'floating-ui'));
});
