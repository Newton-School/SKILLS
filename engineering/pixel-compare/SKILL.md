---
name: pixel-compare
description: Generate section-by-section screenshot diffs for two reachable web page URLs, with responsive captures, content and typography findings, visual hot-spot attribution, and HTML and Markdown reports. Use for visual parity checks between a reference page and a candidate page. Do not use for standalone image-file diffs, functional interaction QA, or automatic implementation fixes.
---

# Pixel Compare

Compare a reference page and a candidate page without page-specific configuration. The bundled engine aligns both pages at shared heading anchors, captures corresponding content slices, measures their pixel differences, and generates evidence that can be interpreted before reporting back to the user.

This is a report-only workflow. Do not change either page or its source unless the user also requests fixes.

## Inputs

Collect or infer only what is needed:

- reference URL (A)
- candidate URL (B)
- optional labels for A and B
- viewport widths; default: `360,1440`
- output directory; if omitted, the CLI creates a timestamped directory under the system temporary directory

Treat A as the reference and B as the candidate unless the user states otherwise. Both pages must be reachable in clean, unauthenticated Playwright contexts. If a page redirects to login or requires interactive authentication, report that limitation instead of presenting the login screen as a valid comparison.

## Set Up the Runtime

The skill directory contains its own Node package. Install its pinned dependencies and Chromium once:

```bash
cd <pixel-compare-skill-directory>
npm ci
npx playwright install chromium
```

Do not silently install dependencies during a comparison. If they are missing, explain the prerequisite or install them only when that setup is within the user's requested scope.

## Run a Comparison

From the skill directory:

```bash
node scripts/compare.cjs \
  <reference-url> \
  <candidate-url> \
  --label-a Reference \
  --label-b Candidate \
  --viewports 360,1440 \
  --out <output-directory>
```

Environment variables remain available for automation:

```bash
A=<reference-url> \
B=<candidate-url> \
LABEL_A=Reference \
LABEL_B=Candidate \
VPS=360,1440 \
OUT=<output-directory> \
node scripts/compare.cjs
```

Use `node scripts/compare.cjs --help` for CLI details.

## How the Engine Compares Pages

For each viewport, the engine:

1. Loads both pages, progressively scrolls through lazy content, waits for fonts within a bounded interval, disables CSS animation and transitions, and pauses videos.
2. Detects section-sized content blocks and inventories headings, text, links, images, backgrounds, dynamic regions, and fixed UI.
3. Matches headings across the two pages and cuts both documents at corresponding content anchors. If no shared heading anchors can be matched, it reports a proportional-slicing fallback.
4. Captures each paired slice plus an isolated fixed/sticky-UI viewport, compares them with `pixelmatch`, creates A/B/diff montages, and attributes concentrated diff bands to nearby elements.
5. Produces deterministic findings for copy, heading typography, geometry, backgrounds, images, CTAs, fixed UI, and time-varying content.
6. Re-captures substantially different slices to estimate whether either page is changing on its own.

Dynamic content is not removed from the comparison. The engine freezes common CSS motion and pauses videos, then flags dynamic regions and self-changing slices so a human can distinguish implementation differences from timing noise.

## Output

The selected output directory contains:

```text
index.html          interactive report with findings and montages
SUMMARY.md          ranked, terminal-readable summary
data.json           machine-readable results
notes.json          optional human-authored interpretation
<viewport>/<slice>/ a.png, b.png, diff.png, montage.png
<viewport>/floating-ui/ a.png, b.png, diff.png, montage.png
<viewport>/floating-ui/ a-{light,dark}.png, b-{light,dark}.png, diff-{light,dark}.png, montage-{light,dark}.png
```

Reports can contain page text and screenshots. Store them outside the skill directory and do not commit sensitive output.

Pixel status thresholds are:

- `MATCH`: less than 0.3% different
- `LOW`: less than 1.5%
- `MEDIUM`: less than 5%
- `HIGH`: 5% or more

These statuses measure changed pixels, not product severity. A low pixel percentage can still accompany an important copy or CTA finding.

## Annotation Pass

After capture:

1. Read `SUMMARY.md` and use `data.json` for supporting detail.
2. Visually inspect `montage.png` for every slice that is not `MATCH` or has a major finding.
3. Separate real differences from font rendering, randomized content, timers, animation phase, and capture noise.
4. Add a concise likely-cause note for each flagged slice to `notes.json`:

```json
{
  "360/hero": "Candidate heading wraps one line earlier because its content rail is narrower.",
  "1440/testimonials": "Likely carousel phase rather than a static styling defect."
}
```

5. Rebuild the report without recapturing:

```bash
node scripts/compare.cjs --rebuild --out <output-directory>
```

## Interpretation Guidance

- A cascading vertical offset usually begins with one height or spacing difference. Identify the first divergence instead of treating every lower element as independently broken.
- Different font files, font metrics, or font-loading outcomes can cause broad text-wrap drift without copy differences.
- Counters, dates, rotating content, ads, personalization, locale, and experiments can produce legitimate run-to-run changes. Use the self-change evidence and verify manually.
- When headings were rewritten, reordered, or use scripts the matcher cannot align, proportional slicing remains visually useful but section boundaries are approximate.
- Fixed overlays are separated from ordinary slices where detectable so they do not contaminate every capture.
- A capture higher than 24,000 CSS pixels is truncated and marked. Do not claim full coverage for that slice.

## Deliver the Result

Give the user:

- the `index.html` and `SUMMARY.md` paths
- compared viewport and slice counts
- a ranked explanation of material differences, stating which side contains each behavior or element
- any limitations, fallbacks, truncated captures, dynamic regions, or blocked pages that affect confidence

Prefer interpreted findings over raw JSON or an unexplained headline percentage.
