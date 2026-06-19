// verify.mjs [OUT_DIR]   (requires: server.mjs running, and `npm i -D playwright` + `npx playwright install chromium`)
// Loads every page in a headless browser and reports the three things that matter:
//   - REMOTE leaks (any request that leaves your origin)  -> must be 0
//   - LOCAL 404s   (missing/mis-pathed assets)            -> must be 0
//   - console errors / page errors
// Pass --shots to also save full-page screenshots to <OUT>/_work/shots/.
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'site');
const SHOTS = process.argv.includes('--shots');
const PORT = process.env.PORT || 4178;
const LOCAL = `http://localhost:${PORT}`;
const pages = JSON.parse(fs.readFileSync(path.join(OUT, '_work/pages.json'), 'utf8'));
const routes = pages.map(p => (p.slug === 'index' ? '/' : '/' + p.slug.replace(/-/g, '/')));

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('Playwright not installed. Run: npm i -D playwright && npx playwright install chromium'); process.exit(2); }

const shotDir = path.join(OUT, '_work/shots');
if (SHOTS) fs.mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
let totalLeaks = 0, total404 = 0, totalErr = 0;
for (const route of routes) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  const leaks = new Set(), bad = new Set(), errs = [];
  pg.on('request', r => { const u = r.url(); if (!u.startsWith(LOCAL) && !u.startsWith('data:') && !u.startsWith('blob:')) leaks.add(u.split('?')[0]); });
  pg.on('response', r => { const u = r.url(); if (u.startsWith(LOCAL) && r.status() >= 400) bad.add(r.status() + ' ' + u.replace(LOCAL, '')); });
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  pg.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 160)));
  try {
    await pg.goto(LOCAL + route, { waitUntil: 'networkidle', timeout: 45000 });
    await pg.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 70)); } window.scrollTo(0, 0); });
    await pg.waitForTimeout(1200);
    if (SHOTS) await pg.screenshot({ path: path.join(shotDir, (route === '/' ? 'index' : route.replace(/\//g, '')) + '.png'), fullPage: true });
  } catch (e) { errs.push('NAV ' + e.message.slice(0, 100)); }
  totalLeaks += leaks.size; total404 += bad.size; totalErr += errs.length;
  const flag = (leaks.size || bad.size || errs.length) ? '⚠️ ' : '✓ ';
  console.log(`${flag}${route.padEnd(24)} leaks=${leaks.size} 404s=${bad.size} errors=${errs.length}`);
  [...leaks].forEach(l => console.log('    LEAK  ' + l));
  [...bad].forEach(b => console.log('    404   ' + b));
  errs.slice(0, 4).forEach(e => console.log('    ERR   ' + e));
  await ctx.close();
}
await browser.close();
console.log(`\nTOTAL  leaks=${totalLeaks}  404s=${total404}  errors=${totalErr}  ${(totalLeaks || total404) ? '<-- FIX THESE' : 'ALL CLEAN ✓'}`);
process.exit(totalLeaks || total404 ? 1 : 0);
