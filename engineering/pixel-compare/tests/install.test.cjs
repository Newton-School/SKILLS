const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { delimiter, dirname, join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const INSTALLER = resolve(__dirname, '..', 'install.sh');

function runInstaller(target, { cwd, home, installer = INSTALLER, env = {} }) {
  return spawnSync('bash', [installer, target], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env, HOME: home },
  });
}

function guardedPath(sandbox) {
  const bin = join(sandbox, 'guarded-bin');
  const log = join(sandbox, 'destructive-command.log');
  mkdirSync(bin);
  for (const command of ['rm', 'cp']) {
    const executable = join(bin, command);
    writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '${command}' >> "$PIXEL_COMPARE_TEST_COMMAND_LOG"\nexit 97\n`);
    chmodSync(executable, 0o755);
  }
  return {
    env: {
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      PIXEL_COMPARE_TEST_COMMAND_LOG: log,
    },
    log,
  };
}

test('installer rejects normalized home, working directory, agent roots, and their ancestors', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'pixel-compare-install-guard-'));
  const home = join(sandbox, 'home');
  const cwd = join(sandbox, 'workspace', 'project');
  const homeChild = join(home, 'child');
  const cwdChild = join(cwd, 'child');
  const codexHome = join(home, '.codex');
  const codexSkills = join(codexHome, 'skills');
  const claudeHome = join(home, '.claude');
  const claudeSkills = join(claudeHome, 'skills');
  const homeLink = join(sandbox, 'home-link');
  const homeSentinel = join(home, 'keep-home.txt');
  const cwdSentinel = join(cwd, 'keep-cwd.txt');
  const codexSentinel = join(codexSkills, 'keep-codex.txt');
  const claudeSentinel = join(claudeSkills, 'keep-claude.txt');

  mkdirSync(homeChild, { recursive: true });
  mkdirSync(cwdChild, { recursive: true });
  mkdirSync(codexSkills, { recursive: true });
  mkdirSync(claudeSkills, { recursive: true });
  writeFileSync(homeSentinel, 'keep');
  writeFileSync(cwdSentinel, 'keep');
  writeFileSync(codexSentinel, 'keep');
  writeFileSync(claudeSentinel, 'keep');
  symlinkSync(home, homeLink, 'dir');

  const repeatedSlashHome = home.replace(/\/([^/]+)$/, '//$1');
  const unsafeTargets = [
    `${home}/`,
    `${home}/.`,
    join(homeChild, '..'),
    repeatedSlashHome,
    `${homeLink}/.`,
    `${cwd}/`,
    `${cwd}/.`,
    join(cwdChild, '..'),
    join(cwd, '..'),
    sandbox,
    codexHome,
    `${codexSkills}/.`,
    claudeHome,
    `${claudeSkills}/`,
  ];

  try {
    for (const target of unsafeTargets) {
      const result = runInstaller(target, { cwd, home });
      assert.notEqual(result.status, 0, `expected rejection for ${target}`);
      assert.match(result.stderr, /Refusing unsafe install target/);
      assert.ok(existsSync(homeSentinel), `home sentinel removed for ${target}`);
      assert.ok(existsSync(cwdSentinel), `cwd sentinel removed for ${target}`);
      assert.ok(existsSync(codexSentinel), `Codex sentinel removed for ${target}`);
      assert.ok(existsSync(claudeSentinel), `Claude sentinel removed for ${target}`);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('installer rejects normalized root without invoking destructive commands', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'pixel-compare-install-root-guard-'));
  const home = join(sandbox, 'home');
  const cwd = join(sandbox, 'workspace');
  mkdirSync(home);
  mkdirSync(cwd);
  const guard = guardedPath(sandbox);

  try {
    for (const target of ['/', '/./', '////']) {
      const result = runInstaller(target, { cwd, home, env: guard.env });
      assert.notEqual(result.status, 0, `expected rejection for ${target}`);
      assert.match(result.stderr, /Refusing unsafe install target/);
      assert.equal(existsSync(guard.log), false, `destructive command reached for ${target}`);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('installer rejects source overlap before invoking destructive commands', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'pixel-compare-install-overlap-'));
  const source = join(sandbox, 'fixture', 'pixel-compare');
  const installer = join(source, 'install.sh');
  const home = join(sandbox, 'home');
  const cwd = join(sandbox, 'workspace');
  const sentinel = join(source, 'keep-source.txt');
  const externalReferent = join(sandbox, 'external-referent');
  const nestedDestinationLink = join(source, 'nested-destination-link');

  mkdirSync(join(source, 'scripts'), { recursive: true });
  mkdirSync(home);
  mkdirSync(cwd);
  mkdirSync(externalReferent);
  copyFileSync(INSTALLER, installer);
  writeFileSync(join(source, 'SKILL.md'), '---\nname: pixel-compare\ndescription: test fixture\n---\n');
  writeFileSync(join(source, 'package.json'), '{}\n');
  writeFileSync(sentinel, 'keep');
  symlinkSync(externalReferent, nestedDestinationLink, 'dir');
  const guard = guardedPath(sandbox);

  try {
    for (const target of [source, join(source, 'nested-install'), nestedDestinationLink, dirname(source)]) {
      const result = runInstaller(target, { cwd, home, installer, env: guard.env });
      assert.notEqual(result.status, 0, `expected overlap rejection for ${target}`);
      assert.match(result.stderr, /Refusing (unsafe install target|install target that overlaps the skill source)/);
      assert.ok(existsSync(sentinel), `source sentinel removed for ${target}`);
      assert.equal(existsSync(guard.log), false, `destructive command reached for ${target}`);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('installer replaces a destination symlink without deleting its referent', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'pixel-compare-install-symlink-'));
  const home = join(sandbox, 'home');
  const cwd = join(sandbox, 'workspace');
  const referent = join(sandbox, 'unrelated-directory');
  const destination = join(sandbox, 'pixel-compare-link');
  const sentinel = join(referent, 'keep-unrelated.txt');

  mkdirSync(home);
  mkdirSync(cwd);
  mkdirSync(referent);
  writeFileSync(sentinel, 'keep');
  symlinkSync(referent, destination, 'dir');

  try {
    const result = runInstaller(`${destination}/`, { cwd, home });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(sentinel));
    assert.equal(lstatSync(destination).isSymbolicLink(), false);
    assert.ok(existsSync(join(destination, 'SKILL.md')));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('installer rejects ambiguous parent traversal through a symlink', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'pixel-compare-install-symlink-parent-'));
  const home = join(sandbox, 'home');
  const cwd = join(sandbox, 'workspace');
  const referent = join(sandbox, 'elsewhere', 'nested');
  const link = join(sandbox, 'linked-parent');
  const guard = guardedPath(sandbox);

  mkdirSync(home);
  mkdirSync(cwd);
  mkdirSync(referent, { recursive: true });
  symlinkSync(referent, link, 'dir');

  try {
    const result = runInstaller(`${link}/../pixel-compare`, { cwd, home, env: guard.env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing ambiguous install target/);
    assert.equal(existsSync(guard.log), false);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('installer normalizes a safe destination before copying', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'pixel-compare-install-safe-'));
  const home = join(sandbox, 'home');
  const cwd = join(sandbox, 'workspace');
  const installParent = join(sandbox, 'safe installs');
  const destination = join(installParent, 'pixel-compare');
  const requestedDestination = `${installParent}//staging/../pixel-compare/`;

  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(installParent, 'staging'), { recursive: true });

  try {
    const result = runInstaller(requestedDestination, { cwd, home });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(destination, 'SKILL.md')));
    assert.ok(result.stdout.includes(`Installed pixel-compare skill to ${destination}`));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
