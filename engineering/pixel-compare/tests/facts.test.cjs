const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
