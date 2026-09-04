const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const Module = require('node:module');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const {
  HELP,
  cli,
  parseArgs,
  parseViewports,
  validatePageUrl,
} = require('../scripts/compare.cjs');

const HEAVY_DEPENDENCIES = new Set(['playwright', 'pixelmatch', 'pngjs']);

async function withHeavyDependencyGuard(callback) {
  const originalLoad = Module._load;
  const attempted = [];
  Module._load = function guardedLoad(request, ...args) {
    if (HEAVY_DEPENDENCIES.has(request)) {
      attempted.push(request);
      throw new Error(`Unexpected runtime dependency load: ${request}`);
    }
    return originalLoad.call(this, request, ...args);
  };
  try {
    await callback();
    assert.deepEqual(attempted, []);
  } finally {
    Module._load = originalLoad;
  }
}

async function withoutConsoleOutput(callback) {
  const originalLog = console.log;
  const output = [];
  console.log = (...args) => output.push(args.join(' '));
  try {
    await callback(output);
  } finally {
    console.log = originalLog;
  }
}

test('parseArgs supports positional URLs, aliases, equals syntax, and -- passthrough', () => {
  assert.deepEqual(
    parseArgs([
      'https://reference.example',
      'https://candidate.example',
      '--label-a=Reference',
      '--label-b', 'Candidate',
      '--vps', '390,1440',
      '--out=./report',
    ]),
    {
      positional: ['https://reference.example', 'https://candidate.example'],
      labelA: 'Reference',
      labelB: 'Candidate',
      viewports: '390,1440',
      out: './report',
    },
  );
  assert.deepEqual(parseArgs(['--', '--literal-url']), { positional: ['--literal-url'] });
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
  assert.throws(() => parseArgs(['--label-a', '--rebuild']), /requires a value/);
});

test('parseViewports validates bounds and de-duplicates widths in input order', () => {
  assert.deepEqual(parseViewports('1440, 390,1440,768'), [1440, 390, 768]);
  assert.deepEqual(parseViewports('100,4096'), [100, 4096]);

  for (const invalid of ['', '0', '99', '4097', '-1', '390.5', 'wide', '390,']) {
    assert.throws(() => parseViewports(invalid), undefined, invalid);
  }
});

test('validatePageUrl accepts web URLs and rejects unsafe protocols or credentials', () => {
  const valid = 'https://example.com/path?preview=1';
  assert.equal(validatePageUrl(valid, 'Reference'), valid);
  assert.throws(() => validatePageUrl('ftp://example.com/file', 'Reference'), /http:\/\/ or https:\/\//);
  assert.throws(() => validatePageUrl('https://user:secret@example.com', 'Reference'), /embedded credentials/);
  assert.throws(() => validatePageUrl('/relative-path', 'Reference'), /valid absolute URL/);
});

test('--help completes without loading browser or image dependencies', async () => {
  await withHeavyDependencyGuard(async () => {
    await withoutConsoleOutput(async (output) => {
      await cli(['--help'], {});
      assert.deepEqual(output, [HELP]);
    });
  });
});

test('--rebuild and rebuild environment variables work without runtime dependencies', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'pixel-compare-cli-test-'));
  const data = {
    meta: {
      a: 'https://reference.example',
      b: 'https://candidate.example',
      labels: { a: 'Reference', b: 'Candidate' },
      vps: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    },
    results: {},
  };

  try {
    writeFileSync(join(outDir, 'data.json'), JSON.stringify(data));
    await withHeavyDependencyGuard(async () => {
      await withoutConsoleOutput(async () => {
        await cli(['--rebuild', '--out', outDir], {});
        await cli([], { REBUILD: 'yes', OUT: outDir });
      });
    });

    assert.ok(existsSync(join(outDir, 'index.html')));
    assert.ok(existsSync(join(outDir, 'SUMMARY.md')));
    assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'data.json'), 'utf8')), data);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
