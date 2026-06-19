---
name: framer-to-code
description: >-
  Convert a Framer-published website into a fully self-contained, pixel-perfect
  coded static site that depends on nothing from Framer's servers. Use whenever a
  user pastes a Framer site URL (e.g. *.framer.website, *.framer.app, or a custom
  domain built on Framer) and wants to migrate off Framer, export it, or replicate
  it as code they can host on Vercel / Netlify / GitHub Pages / any static host.
  Triggers: "convert this Framer site to code", "export my Framer website",
  "move off Framer", "turn this Framer URL into a coded website", "replicate this
  Framer site pixel-perfect".
---

# Framer → Coded Website

Turn a live Framer site (just its URL) into a **self-contained, pixel-perfect static
site**: all pages, images, videos, fonts, the Framer JS runtime (so animations and
interactions still work), Rive animations, and YouTube thumbnails are downloaded and
served locally. Framer analytics, tracking, and the editor bar are stripped. The
result deploys to any static host with no build step.

The approach is a **localized mirror, not a hand-rebuild** — it reuses Framer's own
generated CSS/runtime, which is the only way to guarantee pixel-perfection on an
animation-heavy Framer site. A verification pass then proves zero remote requests,
zero 404s, and visual parity.

## When to use / not use

- **Use** when the input is a *published Framer site URL* and the goal is an exact,
  low-maintenance copy the user owns and hosts themselves.
- **Don't use** for a from-scratch redesign, or when the user wants clean
  hand-written React/HTML they'll heavily edit — say so and offer a rebuild instead.
  (This mirror is faithful but the markup is Framer-generated and verbose.)

## Inputs

- **The Framer site URL** — pull it from the user's message. Confirm it loads. The
  scripts auto-discover all pages via `/sitemap.xml`, so no page list is needed.

## Prerequisites

- Node 18+ (uses global `fetch`, top-level `await`, ES modules).
- For verification: `npm i -D playwright && npx playwright install chromium`.
- `curl` is handy for spot checks but not required.

## Bundled scripts

This skill ships four tested scripts in its `scripts/` folder (next to this file).
Run them with the **target output directory** as the last argument. Let `$SKILL` be
this skill's directory and `$OUT` the project folder you're building into:

| Script | Purpose |
|---|---|
| `crawl.mjs <url> <out>`  | Download pages + every asset; walk the JS module graph. |
| `build.mjs <url> <out>`  | Localize URLs, relocate media, patch the runtime, write configs. |
| `verify.mjs <out>`       | Headless-browser check: remote leaks, 404s, console errors. |
| (build also writes) `server.mjs` | Zero-dep local preview server in `$OUT`. |

## Workflow

> Run steps in order. The whole thing is automated; the only judgement step is the
> verify-and-fix loop (Step 4), which is the safety net that makes it robust across
> different Framer sites.

**Step 0 — Set up.** Pick an output dir (e.g. the repo root the user wants). Confirm
the URL is a live Framer site (`curl -sI <url>` → look for Framer markers, or just
that it 200s).

**Step 1 — Crawl.**
```bash
node "$SKILL/scripts/crawl.mjs" "<FRAMER_URL>" "$OUT"
```
Downloads all pages and assets into `$OUT` and writes `$OUT/_work/{pages,manifest.json,pages.json}`.
Expect a count like "downloaded N assets, 0 failed". A couple of spurious
truncated-prefix failures (URLs ending `/fontshare/` or `/s/`) are harmless.

**Step 2 — Build.**
```bash
node "$SKILL/scripts/build.mjs" "<FRAMER_URL>" "$OUT"
```
This produces the final site. Every page should print `leak-refs=0`. It relocates
media to root paths, patches the runtime, writes `server.mjs`, `vercel.json`,
`netlify.toml`, `.nojekyll`, `robots.txt`, `sitemap.xml`, and a `404.html`.

**Step 3 — Preview & verify.**
```bash
cd "$OUT" && node server.mjs &      # http://localhost:4178
# (separately) install playwright once, then:
PORT=4178 node "$SKILL/scripts/verify.mjs" "$OUT"   # add --shots to capture screenshots
```
Goal: **`TOTAL leaks=0 404s=0`** across all pages. Also eyeball a few screenshots (or
the live site side-by-side) — full-page heights should match the original exactly.

**Step 4 — Fix any leaks or 404s (iterate).** If verify reports anything, use the
**gotchas table below** to fix it, then re-run `build.mjs` (it re-fetches the JS
bundles fresh each time, so patches are deterministic) and re-verify. Repeat until
clean. This loop is what makes the skill reliable on sites with quirks the defaults
don't already cover.

**Step 5 — Deliver & deploy.** Write a short README, then follow the deployment notes.

## Known Framer gotchas & how the build handles them

These are the non-obvious things that break a naive mirror. The build already handles
all of them; the table is your reference when verify surfaces a *new* variant.

| Symptom in verify | Cause | Fix (already applied / how to extend) |
|---|---|---|
| `404 /images/X.png`, `/videos/X.mp4`, `/media/X.riv` | Framer's runtime **rebuilds asset URLs at root paths** (`/images`, `/videos`, `/media`) regardless of where the static HTML points. | Media is relocated to those exact root paths and refs rewritten to match. **The site must be hosted at the domain root**, not a subpath. |
| `TypeError: Failed to construct 'URL': Invalid URL` + `Minified React error #423` (hydration) | A bundle does `new URL("/images/X.png")` — once localized to a root-relative path, `new URL` has no base and throws, which crashes hydration. | Build rewrites single-arg `new URL("/…")` calls in bundles to `new URL("/…", document.baseURI)` (also makes the asset resolve to the current origin = local). |
| Only the homepage is converted | The site's `sitemap.xml` lists its **canonical `*.framer.app` host**, not the custom domain you pasted, so a host filter drops every page. | Crawl maps each sitemap entry's **path** onto the pasted domain instead of filtering by host. |
| `LEAK fonts.googleapis.com` / `fonts.gstatic.com` | The runtime injects its own Google-Fonts `<link>` at load. | Build repoints the runtime's `css2?family=…` URL to the local `/assets/css/google-fonts.css`. **Do not** blanket-replace the bare `fonts.googleapis.com`/`fonts.gstatic.com` host strings — the runtime calls `new URL()` on them and a relative replacement throws. |
| `LEAK app.framerstatic.com/Inter-*.woff2` (often 100+) | The site uses Framer's **built-in fonts** (Inter, etc.) served from `app.framerstatic.com`. | Build discovers + localizes framerstatic **font files only** (never its editor `.mjs` chunks) to `/assets/fonts/`. |
| `LEAK framer.com/edit`, `app.framerstatic.com/*`, `api.framer.com/auth` | The runtime lazy-imports the **editor bar** from `framer.com/edit/init.mjs`, which cascades to those hosts. | That one import is replaced with a local no-op module (`/assets/lib/noop-editor.mjs`). If a site references `app.framerstatic`/`api.framer` *directly*, neutralize those literals too. |
| `LEAK unpkg.com/@rive-app/...wasm` | Rive animations fetch the WASM from unpkg. | Build detects the version from the bundle, downloads `rive.wasm` locally, and rewrites the URL. |
| `LEAK i.ytimg.com/...` | A YouTube component rebuilds thumbnail URLs from video IDs. | Thumbnails are downloaded to `/assets/yt/<id>/…` and the `i.ytimg.com/vi(_webp)?/` host prefix is rewritten to `/assets/yt/`. |
| `LEAK clarity.ms`, `c.bing.com`, `events.framer.com` | Microsoft Clarity + Framer analytics inline scripts. | Those `<script>` blocks are stripped. |
| A **new** remote leak not in this table | Some other runtime-built URL. | Find where it's constructed: `grep -rao 'THEHOST[^"'\''\`]*' "$OUT/assets/framer/"*.mjs`. If it's a host prefix, add a `.split('https://thehost/').join('/local/path')` (and download the asset) to `build.mjs` step 6, then rebuild. |
| Page elements invisible / content missing | Framer hides un-scrolled elements via JS (`opacity:0`); if the runtime fails to load, they stay hidden. | Means a JS bundle 404'd or a bad patch broke a module — check `404s` and console errors, fix the path, rebuild. |

Other built-in cleanups: localizes Fontshare + custom woff2, strips dead
`preconnect` links, rewrites self-domain anchor links to relative, makes
`og:image`/`twitter:image` absolute to the production domain, and injects a
**service-worker cleanup** script (see deployment).

## Deployment notes (share these with the user)

- **Static, no build.** Works on Vercel, Netlify, Cloudflare Pages, GitHub Pages, etc.
- **Vercel:** the generated `vercel.json` pins `framework:null`, no build, no install,
  `outputDirectory:"."`. Import the repo and **don't override** build settings — if a
  deploy ever serves only `index.html` (assets 404), it's because Vercel ran a build;
  the config prevents that. `.nojekyll` is included for GitHub Pages (some asset files
  start with `_`).
- **Must be served from the domain root** (Framer's runtime requests `/images/…`),
  which is how a custom domain is pointed anyway.
- **The #1 post-migration surprise — stale Framer service worker.** Framer registers a
  service worker that aggressively caches the old site. After you point the domain at
  the new host, returning visitors (and *you*) may still see the **old** site served
  from that cached worker, even though the server is correct. Verify the server is
  right with an **incognito window** (no worker). The build injects a worker-cleanup
  script into every page that auto-unregisters Framer's worker and clears its caches on
  load, so returning visitors self-heal within a load or two. To clear it manually:
  DevTools → Application → Service Workers → Unregister, then Clear site data, then hard
  reload.
- **Repo size:** background videos make these repos large (often 100–300 MB). Fine for
  GitHub as long as no single file exceeds 100 MB (Framer videos are usually < 10 MB).
- **Social cards / canonical** point to the production domain derived from the input
  URL. If deploying to a *different* domain, update `og:image`/`canonical`/`sitemap.xml`/`robots.txt`.

## Notes & limits

- Re-run `crawl.mjs` + `build.mjs` any time to re-sync if the Framer source changes.
- `_work/` holds raw downloads + the manifest (needed to re-run `build.mjs` without
  re-downloading). Git-ignore `_work/`, `node_modules/`, and screenshots.
- The markup is Framer-generated; this is a faithful mirror, not a clean rewrite. For a
  maintainable hand-coded rebuild, that's a different (much larger) task.
