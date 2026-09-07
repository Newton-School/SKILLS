#!/usr/bin/env node

// Standalone entry point for the pixel-compare engine.
//
// Full comparison:
//   node scripts/compare.cjs <url-a> <url-b> \
//     --label-a Reference --label-b Candidate \
//     --viewports 360,1440 --out <output-directory>
//
// Rebuild reports after editing <output-directory>/notes.json:
//   node scripts/compare.cjs --rebuild --out <output-directory>
//
// The equivalent A, B, LABEL_A, LABEL_B, VPS, OUT, and REBUILD environment
// variables remain supported. Command-line options take precedence.
const { existsSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, join, parse: parsePath, resolve } = require('node:path');

const SCRIPT_DIR = __dirname;
const SKILL_DIR = dirname(SCRIPT_DIR);
const localRequire = createRequire(join(SKILL_DIR, 'package.json'));

const HELP = `Usage:
  node scripts/compare.cjs <url-a> <url-b> [options]
  node scripts/compare.cjs --rebuild --out <output-directory>

Options:
  --label-a <label>       Label for the reference page (default: A)
  --label-b <label>       Label for the candidate page (default: B)
  --viewports <widths>    Comma-separated widths from 100–4096 (default: 360,1440)
  --vps <widths>          Alias for --viewports
  --out <directory>       Output directory (default: a timestamped temp directory)
  --rebuild               Rebuild reports from data.json without recapturing
  -h, --help              Show this help

Environment compatibility:
  A, B, LABEL_A, LABEL_B, VPS, OUT, REBUILD

Examples:
  node scripts/compare.cjs https://example.com https://staging.example.com
  node scripts/compare.cjs https://example.com https://staging.example.com \
    --label-a Production --label-b Staging --vps 390,1440 --out ./pixel-report
  node scripts/compare.cjs --rebuild --out ./pixel-report`;

const VALUE_OPTIONS = new Map([
  ['--label-a', 'labelA'],
  ['--label-b', 'labelB'],
  ['--viewports', 'viewports'],
  ['--vps', 'viewports'],
  ['--out', 'out'],
]);

function parseArgs(argv) {
  const options = { positional: [] };
  let positionalOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (positionalOnly) {
      options.positional.push(arg);
      continue;
    }
    if (arg === '--') {
      positionalOnly = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--rebuild') {
      options.rebuild = true;
      continue;
    }

    const equal = arg.indexOf('=');
    const name = equal >= 0 ? arg.slice(0, equal) : arg;
    if (VALUE_OPTIONS.has(name)) {
      const value = equal >= 0 ? arg.slice(equal + 1) : argv[++i];
      if (value == null || value === '' || (equal < 0 && value.startsWith('--'))) {
        throw new Error(`${name} requires a value.`);
      }
      options[VALUE_OPTIONS.get(name)] = value;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    options.positional.push(arg);
  }

  return options;
}

function envEnabled(value) {
  if (value == null || value === '') return false;
  return !/^(?:0|false|no|off)$/i.test(value.trim());
}

function validatePageUrl(value, label) {
  if (!value) throw new Error(`Missing ${label}. Provide two positional URLs or set A and B.`);
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} contains control characters.`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid absolute URL: ${value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http:// or https://: ${value}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain embedded credentials because URLs are written to the report.`);
  }
  return parsed.href;
}

function parseViewports(value) {
  const raw = String(value ?? '').split(',').map((part) => part.trim());
  if (!raw.length || raw.some((part) => part === '')) {
    throw new Error('Viewports must be a comma-separated list of positive integer widths.');
  }

  const seen = new Set();
  const widths = [];
  for (const part of raw) {
    if (!/^\d+$/.test(part)) throw new Error(`Invalid viewport width: ${part}`);
    const width = Number(part);
    if (!Number.isSafeInteger(width) || width < 100 || width > 4096) {
      throw new Error(`Viewport width must be between 100 and 4096 pixels: ${part}`);
    }
    if (!seen.has(width)) {
      seen.add(width);
      widths.push(width);
    }
  }
  if (!widths.length) throw new Error('At least one viewport width is required.');
  if (widths.length > 20) throw new Error('At most 20 viewport widths may be compared in one run.');
  return widths;
}

function resolveOutput(value) {
  const out = resolve(value);
  if (out === parsePath(out).root) {
    throw new Error(`Refusing to write report files to filesystem root: ${out}`);
  }
  return out;
}

function runtimeDependency(name) {
  try {
    return localRequire(name);
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      const wrapped = new Error(`Missing runtime dependency "${name}". Install the pixel-compare dependencies before running a comparison.`);
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }
}

async function cli(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  const rebuild = args.rebuild === true || envEnabled(env.REBUILD);
  const outValue = args.out ?? env.OUT;

  if (rebuild) {
    if (args.positional.length) throw new Error('Rebuild mode does not accept page URLs.');
    if (!outValue) throw new Error('Rebuild mode requires --out <existing-output-directory> or OUT.');
    const out = resolveOutput(outValue);
    if (!existsSync(join(out, 'data.json'))) {
      throw new Error(`Rebuild input is missing: ${join(out, 'data.json')}`);
    }
    require('./lib/report.cjs').rebuild(out);
    return;
  }

  if (args.positional.length > 2) {
    throw new Error(`Expected two page URLs, received ${args.positional.length}.`);
  }
  const a = validatePageUrl(args.positional[0] ?? env.A, 'URL A');
  const b = validatePageUrl(args.positional[1] ?? env.B, 'URL B');
  const vps = parseViewports(args.viewports ?? env.VPS ?? '360,1440');
  const out = outValue ? resolveOutput(outValue) : undefined;
  const labels = {
    a: args.labelA ?? env.LABEL_A ?? 'A',
    b: args.labelB ?? env.LABEL_B ?? 'B',
  };

  // Load heavy runtime dependencies only after help/rebuild routing and input
  // validation. All dependencies resolve from this installed skill directory.
  const playwright = runtimeDependency('playwright');
  runtimeDependency('pixelmatch');
  runtimeDependency('pngjs');
  const { run } = require('./lib/main.cjs');
  await run({ playwright, config: { a, b, labels, vps, out } });
}

if (require.main === module) {
  cli().catch((error) => {
    console.error(`pixel-compare: ${error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = { HELP, cli, parseArgs, parseViewports, validatePageUrl, resolveOutput };
