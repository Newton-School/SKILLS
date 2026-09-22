---
name: share-memory
description: Export a curated, redacted bundle of a repo's Claude memory into a visible ./context folder to share with teammates — aggregating across all clones and worktrees of that repo — import a teammate's bundle, or consolidate your own scattered memory into one place. Use when the user wants to export/share Claude memory, import a memory bundle, or merge memory scattered across multiple checkouts/worktrees.
---

# share-memory

Share Claude Code per-project memory between teammates safely. Three modes:

- `/share-memory` or `/share-memory export` — gather this repo's memory from **every** clone/worktree on this machine, curate, and write it to `context/`.
- `/share-memory import [path]` — merge a bundle into local memory for this project. Path optional (see resolution order below).
- `/share-memory consolidate` — merge your own scattered memory (from extra clones, worktrees, review checkouts) into the main checkout's memory dir. No sharing involved.

## Where collected context lives

All collected context goes in **one visible folder: `<repo-root>/context/`** — `git rev-parse --show-toplevel`, or the cwd when not in a git repo. Never a temp/scratch directory: the point is that the user can open the folder and see exactly what was collected. Layout:

```
context/
  MANIFEST.md          <- what was collected, excluded, redacted, and why
  IMPORT.md            <- one-line instructions for the recipient
  <memory-file>.md     <- the curated memory files, original filenames kept
```

**Keep `context/` out of git.** Before writing, ensure `context/` is listed in `<repo-root>/.git/info/exclude` (append it if absent). Use that file, never the repo's tracked `.gitignore` — the ignore is a local convenience and must not show up as a repo diff. Then confirm `git status --porcelain` does not list the folder, and tell the user it is locally ignored. If the repo's own `.gitignore` already covers it, leave things alone.

Do not zip the folder by default — the folder is the deliverable. Zip only if the user asks for an archive to send.

## Discovery: find all memory dirs for this repo

Claude Code keys project memory to the session's cwd: `~/.claude/projects/<slug>/memory/`, where `<slug>` is the absolute path with `/` and `.` replaced by `-`. So `web-app`, `web-app-2`, `web-app-pr-123`, and every worktree each accumulate a **separate** memory dir for the same repo. Export and consolidate therefore start with repo-wide discovery, not just the cwd's slug.

1. **Establish repo identity** from the cwd: `git rev-parse --show-toplevel`, then normalize `git remote get-url origin` — lowercase; strip protocol, credentials, `git@...:` form, and trailing `.git` (both `git@github.com:acme/api.git` and `https://github.com/Acme/api` → `github.com/acme/api`). No remote → fall back to the top-level dir's basename and say so.
2. **Enumerate candidates**: every `~/.claude/projects/*/` that contains `memory/` with at least one `.md` file besides `MEMORY.md`.
3. **Recover each candidate's real path** — do NOT decode the slug (it's lossy: `-` may mean `/`, `.`, or a literal `-`). Instead grep the newest `*.jsonl` session file in that project dir for its first `"cwd":"..."` value. If the dir has no session files (pruned by retention), attempt a slug decode by testing path existence segment-by-segment; if that fails, treat as unresolvable.
4. **Match**: a candidate belongs to this repo iff its recovered path exists and its normalized origin URL equals the target. Also run `git worktree list --porcelain` in each matched checkout — linked worktrees may have memory dirs of their own; check those slugs too.
5. **Unresolvable-but-suspicious** candidates (slug contains the repo name but the path is gone — e.g. a deleted worktree): don't silently include or drop; list them for the user in the manifest/summary as "unverified" and include only entries the user confirms.

Report the discovery result before proceeding: which folders were found, how many memory files each contributes.

## Merging across sources (used by export and consolidate)

- Union by filename. Identical content → keep one.
- Same name, different content → keep the newest (file mtime), record the conflict and both source paths.
- Track each file's source folder for the manifest.
- Rebuild the `MEMORY.md` index from the merged set (one line per file: `- [Title](file.md) — hook`), never by concatenating the per-folder indexes.

## Export mode

1. Run discovery + merge above to get the full memory set for this repo.

2. **Classify each memory file** into exactly one bucket:
   - **EXCLUDE — personal**: `metadata.type: user`, or anything describing the person rather than the project. Never include these, even if asked to "just include everything".
   - **EXCLUDE — secret**: contains credentials. Scan for: API keys/tokens (`sk-`, `ghp_`, `xoxb-`, `AKIA`, `Bearer `, `api_key`, `token=`), passwords, connection strings with credentials (`://user:pass@`), private key blocks. If a file is valuable but has one secret line, include it with the secret replaced by `[REDACTED]` and note the redaction in the manifest.
   - **FLAG — machine-specific**: absolute paths under the user's home dir, `localhost` ports, local env state ("local points at staging DB"), OS-specific setup. Include, but prepend this line directly under the frontmatter: `> ⚠️ Machine-specific — verify before trusting on your machine.`
   - **UPSTREAM CANDIDATE**: encodes a team-wide convention, review pattern, or "how we do X here" that is true for everyone (not just this machine/person). Include in the bundle, but also list it in the manifest's "Upstream candidates" section — these belong in the repo's `.claude/rules/` or CLAUDE.md via a PR, which beats memory-sharing for anything team-general.
   - **SHARE**: everything else — project context, decisions, non-obvious facts, external references.

3. **Check the target folder before writing.** If `context/` already exists and its `MANIFEST.md` names a *different* exporter, it is someone else's bundle — do not clobber it. Stop and tell the user to import it first (or move it aside). If the existing bundle is this same user's earlier export, refresh in place; remove stale files that are no longer part of the set and say which.

4. **Write the bundle** to `<repo-root>/context/` per the layout above:
   - The curated memory files (SHARE + FLAG + UPSTREAM, with redactions applied). Keep original filenames and frontmatter.
   - `MANIFEST.md`, starting with an `Exported-by: <user> @ <hostname> on <YYYY-MM-DD>` line plus the repo identity, then sections: **Sources** (each folder discovered and files contributed), **Included** (one line per file: name — description — source folder), **Excluded** (name + one-word reason: personal / secret), **Redactions made**, **Merge conflicts** (same-name files that differed, which version won), **Unverified sources** (if any), **Upstream candidates** (with a one-line "why it generalizes").
   - `IMPORT.md` telling the recipient to drop the folder at their repo root and run `/share-memory import` from there.

5. **Show the user the manifest and the folder path.** Sharing is distribution — the user must see exactly what was collected. Since the folder lives in their repo and is git-ignored, writing it needs no separate approval gate; but do not send it anywhere (Slack, email, upload) unless the user explicitly asks in this session.

## Import mode

1. **Resolve the bundle folder**, in order:
   1. an explicit path argument, if given;
   2. the cwd, if it directly contains `MANIFEST.md` (the user has cd'd into a bundle);
   3. `<cwd>/context/`;
   4. `<repo-root>/context/`.

   If none resolve, say so and stop — don't guess or search the filesystem.

2. Read `MANIFEST.md` first; refuse politely if there isn't one (ask the sender to re-export with this skill — unvetted raw memory dumps skip the redaction pass). If its `Exported-by` line names this same user and machine, say so and confirm before proceeding — importing your own export is usually a mistake.

3. Import into the **main checkout's** project memory dir — if the cwd is a linked worktree or secondary clone, resolve the main checkout (`git worktree list` shows it first) and target its slug, telling the user why.

4. For each memory file in the bundle:
   - If a local file with the same name exists, compare: skip if identical; if different, keep the local one and note the conflict for the user rather than overwriting.
   - Otherwise copy it in, adding directly under the frontmatter: `> Imported from <sender>'s bundle on <date>; facts reflect their machine/context at export time.`
   - Append the corresponding index line to local `MEMORY.md` (create the line from the file's name + description if the bundle's index doesn't have one).

5. Report: how many imported, skipped, conflicted; list any ⚠️ machine-specific entries the user should verify; and repeat the bundle's upstream candidates with a reminder that a `.claude/rules/` PR would make them team-wide permanently. Leave the `context/` folder in place — it's the record of what arrived.

## Consolidate mode

For cleaning up your own machine — no redaction pass needed since nothing leaves it.

1. Run discovery + merge above.
2. Target = the main checkout's project memory dir (create if missing). Copy every merged memory file that's missing or older there; rebuild its `MEMORY.md` index.
3. Leave the scattered source dirs untouched (sessions rooted in those folders still read them). Print the list of secondary memory dirs so the user can delete any belonging to disposable worktrees/checkouts if they want — never delete them yourself.
4. Summarize: files consolidated, conflicts and which version won, and any unverified sources skipped.

## Guardrails

- Collected context always lands in `<repo-root>/context/`, never a scratch/temp dir, and is added to `.git/info/exclude` (never the tracked `.gitignore`).
- Never export without completing the classification pass; never include `user`-type memories.
- Never overwrite someone else's `context/` bundle; never overwrite an existing local memory file on import; never delete source memory dirs in consolidate.
- Repo identity comes from the git remote, never from folder-name similarity alone; name-similarity may only nominate "unverified" candidates for the user to confirm.
