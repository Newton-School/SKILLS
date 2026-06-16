# framer-to-code

**Domain:** design
**Author:** @iamshubhransh

## What it does

Converts a Framer-published website into a fully self-contained, pixel-perfect coded static site that depends on nothing from Framer's servers. It mirrors all pages, images, videos, fonts, the Framer JS runtime, Rive animations, and YouTube thumbnails locally, strips Framer analytics/tracking/editor, and verifies zero remote requests so the result deploys to any static host with no build step.

## When to use it

- A user pastes a Framer site URL (`*.framer.website`, `*.framer.app`, or a custom domain built on Framer) and wants to migrate off Framer, export it, or replicate it as code.
- The goal is an exact, low-maintenance copy the user owns and hosts themselves on Vercel / Netlify / Cloudflare Pages / GitHub Pages / any static host.
- **Don't** use it for a from-scratch redesign or when the user wants clean hand-written React/HTML to heavily edit — the mirror is faithful but the markup is Framer-generated and verbose.

## How to use it

The skill ships three tested scripts in `scripts/`. Run them with the target output directory as the last argument (let `$SKILL` be this skill's folder and `$OUT` the project folder you're building into):

1. **Crawl** — download all pages and assets, walking the JS module graph:
   ```bash
   node "$SKILL/scripts/crawl.mjs" "<FRAMER_URL>" "$OUT"
   ```
2. **Build** — localize URLs, relocate media, patch the runtime, write deploy configs and a zero-dep `server.mjs`:
   ```bash
   node "$SKILL/scripts/build.mjs" "<FRAMER_URL>" "$OUT"
   ```
3. **Preview & verify** — serve locally and run a headless-browser check for remote leaks, 404s, and console errors:
   ```bash
   cd "$OUT" && node server.mjs &      # http://localhost:4178
   PORT=4178 node "$SKILL/scripts/verify.mjs" "$OUT"   # add --shots for screenshots
   ```
   Goal: `TOTAL leaks=0 404s=0` across all pages.
4. **Fix & iterate** — if verify reports leaks or 404s, use the gotchas table in `SKILL.md`, re-run `build.mjs`, and re-verify until clean.

Example prompt:

```text
Convert this Framer site to code: https://example.framer.website
```

See `SKILL.md` for the full workflow, the known-Framer-gotchas reference table, and deployment notes.

## Requirements

- Node 18+ (uses global `fetch`, top-level `await`, ES modules).
- For verification: `npm i -D playwright && npx playwright install chromium`.
- `curl` is handy for spot checks but not required.

## Notes

- The output is a faithful mirror of Framer-generated markup, not a clean rewrite. For a maintainable hand-coded rebuild, that's a separate, much larger task.
- The site must be served from the domain root — Framer's runtime requests assets at root paths (`/images`, `/videos`, `/media`).
- The #1 post-migration surprise is a stale Framer service worker caching the old site; the build injects a worker-cleanup script, and you can always verify with an incognito window.
- Re-run `crawl.mjs` + `build.mjs` any time to re-sync if the Framer source changes.
