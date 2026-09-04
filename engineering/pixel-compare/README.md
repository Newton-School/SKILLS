# Pixel Compare

**Domain:** engineering
**Author:** @DipeshRajoria007

## What it does

Pixel Compare is an agent-agnostic skill for comparing two reachable web pages section by section. It captures configurable mobile and desktop viewports, measures pixel differences, identifies content and style mismatches, attributes visual hot spots to nearby elements, and produces HTML, Markdown, JSON, and image reports.

## When to use it

- Check visual parity between a reference page and a candidate implementation.
- Compare production with staging, an old page with a redesign, or two independently rendered versions of the same content.
- Find copy, heading, CTA, image, background, layout, fixed-UI, and dynamic-content differences without writing page-specific configuration.
- Use a report-only visual audit when functional interaction testing or automatic code fixes are outside the request.

## Install

This skill is distributed as a self-contained folder. Copy the whole `engineering/pixel-compare/` directory into the location where your coding agent reads reusable skills.

One-command install for Codex-style skill folders:

```bash
curl -fsSL https://raw.githubusercontent.com/Newton-School/SKILLS/master/engineering/pixel-compare/install.sh | bash -s -- codex
```

One-command install for Claude-style skill folders:

```bash
curl -fsSL https://raw.githubusercontent.com/Newton-School/SKILLS/master/engineering/pixel-compare/install.sh | bash -s -- claude
```

One-command install for another destination:

```bash
curl -fsSL https://raw.githubusercontent.com/Newton-School/SKILLS/master/engineering/pixel-compare/install.sh | bash -s -- "$HOME/.config/my-agent/skills/pixel-compare"
```

From a local checkout of this repository:

```bash
./engineering/pixel-compare/install.sh codex   # or: claude, or a destination path
```

Install the runtime dependencies once inside the installed skill directory:

```bash
npm ci
npx playwright install chromium
```

## How to use it

Run the bundled CLI with the reference URL first and the candidate URL second:

```bash
node scripts/compare.cjs \
  https://www.example.com/page \
  http://localhost:3000/page \
  --label-a Reference \
  --label-b Candidate \
  --viewports 360,1440 \
  --out /tmp/pixel-compare-report
```

An environment-variable interface is also supported:

```bash
A=https://www.example.com/page \
B=http://localhost:3000/page \
LABEL_A=Reference \
LABEL_B=Candidate \
VPS=360,1440 \
OUT=/tmp/pixel-compare-report \
node scripts/compare.cjs
```

Read `SUMMARY.md` first, then inspect each flagged `montage.png` in the output directory. To add human interpretation, create `notes.json` with keys such as `"360/hero"`, then rebuild without recapturing:

```bash
node scripts/compare.cjs --rebuild --out /tmp/pixel-compare-report
```

Run `node scripts/compare.cjs --help` for all options.

## Requirements

- Node.js 20 or newer and npm.
- Playwright's Chromium browser, installed with `npx playwright install chromium`.
- Network access to both target URLs, or separately started local development servers.
- Write access to the selected output directory.
- Pages that can load in clean browser contexts without an interactive login. Authenticated flows require a separately prepared public or authenticated test surface.

## Notes

- The skill reports differences; it does not edit either page or its source code unless the user separately asks for fixes.
- Dynamic regions are still compared, but the report flags them for manual verification because timing can create false positives.
- Heading alignment is best effort. Pages without shared headings use proportional slices, which makes boundaries coarser.
- Individual captures are capped at 24,000 CSS pixels in height and are marked as truncated when the cap applies.
- Reports contain page text and screenshots. Write them outside the skill repository and do not commit sensitive output.
