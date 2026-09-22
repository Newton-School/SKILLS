# Memory Share

**Domain:** engineering
**Author:** @DipeshRajoria007

## What it does

Memory Share moves Claude Code's per-project memory between machines and teammates. It gathers a repo's memory from every clone and worktree on the machine, strips personal entries and credentials, flags facts that are only true locally, and writes the result into a visible `context/` folder at the repo root that the recipient can import in one command.

It also names the entries that shouldn't be private memory at all — team-wide conventions that belong in the repo's own agent instructions via a pull request.

## When to use it

- A teammate has accumulated useful project memory and you want it on your machine (onboarding onto an unfamiliar repo, or picking up a service someone else has been running).
- You want to hand your own memory to someone else without leaking personal notes, tokens, or machine-local assumptions.
- Your memory for one repo is scattered because you work in several clones or git worktrees, and each one built up its own separate memory.
- You want to see what an agent has actually remembered about a repo, in one folder you can read.

## Install

This skill is distributed as a plain folder. Install it by copying the whole `engineering/memory-share/` directory, including `SKILL.md`, into the place where your coding agent reads reusable skills or instructions.

One-command install for Claude-style skill folders:

```bash
curl -fsSL https://raw.githubusercontent.com/Newton-School/SKILLS/master/engineering/memory-share/install.sh | bash -s -- claude
```

One-command install for Codex-style skill folders:

```bash
curl -fsSL https://raw.githubusercontent.com/Newton-School/SKILLS/master/engineering/memory-share/install.sh | bash -s -- codex
```

One-command install for another destination:

```bash
curl -fsSL https://raw.githubusercontent.com/Newton-School/SKILLS/master/engineering/memory-share/install.sh | bash -s -- "$HOME/.config/my-agent/skills/memory-share"
```

From a local checkout of this repository:

```bash
git clone https://github.com/Newton-School/SKILLS.git
cd SKILLS
./engineering/memory-share/install.sh claude
```

For other coding agents, point the agent at `engineering/memory-share/SKILL.md`.

## How to use it

The skill has three modes. Run them from the repo whose memory you care about.

**Export** — collect this repo's memory into `context/`:

```text
/memory-share export
```

It reports which clones and worktrees it found, shows you a manifest of what was included, excluded, redacted, and flagged, and writes everything to `<repo-root>/context/`. Hand that folder to your teammate.

**Import** — merge a bundle someone gave you:

```text
/memory-share import
```

With no argument it looks for a bundle in the cwd, then `./context/`, then `<repo-root>/context/` — so dropping the folder at your repo root is enough. You can also pass a path explicitly:

```text
/memory-share import ~/Downloads/api-memory-bundle
```

Import never overwrites memory you already have; same-name entries that differ are reported as conflicts with your local version kept.

**Consolidate** — merge your own scattered memory into your main checkout:

```text
/memory-share consolidate
```

Useful when you've been working across several clones or worktrees of one repo. Nothing leaves the machine, and the secondary memory directories are left in place.

## Requirements

- Claude Code, or another agent that reads skill folders. Discovery targets Claude Code's memory layout (`~/.claude/projects/<cwd-slug>/memory/`), so on other agents the export and consolidate modes have nothing to find unless you point the skill at an equivalent directory.
- Git. Repo identity comes from the `origin` remote URL, which is what lets the skill recognise two differently-named folders as the same repo. Without a remote it falls back to the directory name and says so.
- Nothing else — the skill is plain Markdown instructions, with no runtime dependencies.

## Notes

- **Folder names lie; remotes don't.** Matching is done on the normalised `origin` URL, so `api`, `api-2`, and `api-pr-451` are recognised as one repo, while a similarly-named unrelated repo is not. Directory-name similarity can only nominate a candidate for you to confirm.
- **Paths are recovered from session files, not by decoding the memory directory name.** That name is lossy — a `-` may have been a `/`, a `.`, or a literal dash. Where session history has been pruned the skill falls back to a checked slug decode and reports anything it cannot resolve rather than guessing.
- **Personal entries never leave the machine**, and credentials are excluded or replaced with `[REDACTED]`. Facts that are only true locally (a local path, a port, "my local database points at staging") are included but banner-flagged for the recipient to verify.
- **`context/` is added to `.git/info/exclude`**, not the tracked `.gitignore`, so the collected files can't be committed by accident and the ignore itself doesn't show up as a repo diff.
- **Export won't clobber someone else's bundle.** If `context/` already holds a bundle exported by a different person, the skill stops and asks you to import or move it first. Import likewise warns when a bundle's `Exported-by` line is your own machine.
- Anything general enough to be true for the whole team is listed as an upstream candidate: put it in the repo's agent instructions (`CLAUDE.md`, `AGENTS.md`, or a rules file) via a PR instead of copying it between private memory directories. Shared memory is for the residue — project context, environment quirks, and in-flight decisions.
