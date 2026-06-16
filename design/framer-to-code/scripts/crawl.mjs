// crawl.mjs <FRAMER_URL> [OUT_DIR]
// Downloads a Framer-published site's pages + every asset, walking the JS module graph.
// Writes raw pages to <OUT>/_work/pages, assets into <OUT>/assets|images|... , and a manifest.
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] || '').replace(/\/+$/, '');
const OUT = path.resolve(process.argv[3] || 'site');
if (!BASE) { console.error('usage: node crawl.mjs <framer-url> [out-dir]'); process.exit(1); }
const HOST = new URL(BASE).host;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const WORK = path.join(OUT, '_work');
fs.mkdirSync(path.join(WORK, 'pages'), { recursive: true });

async function fetchBuf(u, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': '*/*' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); }
    catch (e) { if (i === tries - 1) throw e; await new Promise(s => setTimeout(s, 500 * (i + 1))); }
  }
}
const txt = async u => (await fetchBuf(u)).toString('utf8');
const canon = u => u.split('#')[0].split('?')[0];
const basename = u => canon(u).split('/').pop();

// ---- 1) pages from sitemap (map paths onto the pasted domain; the sitemap often
//        lists the canonical *.framer.app host, not the custom domain). Fallback: homepage.
let urls = [];
try { const sm = await txt(BASE + '/sitemap.xml'); urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => { try { return BASE + new URL(m[1].trim()).pathname; } catch { return null; } }).filter(Boolean); } catch {}
urls = [...new Set(urls)];
if (!urls.length) urls = [BASE + '/'];
const slug = u => { const p = new URL(u).pathname.replace(/\/+$/, ''); return p === '' ? 'index' : p.replace(/^\//, '').replace(/\//g, '-'); };
const pageList = [...new Map(urls.map(u => [slug(u), { url: u, slug: slug(u) }])).values()];
fs.writeFileSync(path.join(WORK, 'pages.json'), JSON.stringify(pageList, null, 2));
console.log('pages:', pageList.map(p => p.slug).join(', '));

const pageText = {};
for (const p of pageList) { const h = await txt(p.url); pageText[p.slug] = h; fs.writeFileSync(path.join(WORK, 'pages', p.slug + '.html'), h); }

// ---- 2) asset discovery + mapping (download paths under assets/) ----
const ASSET = /https?:\/\/(?:framerusercontent\.com|fonts\.gstatic\.com|app\.framerstatic\.com)\/[^\s"'`)<>\\,]+/g;
const GAPI = /https?:\/\/fonts\.googleapis\.com\/css2[^\s"'`)<>\\]*/g;
const MJSREL = /["'`](\.\/[A-Za-z0-9._-]+\.mjs)["'`]/g;
const downloadSet = new Map();  // canonUrl -> localRel
const gapi = new Set();
function mapAsset(u) {
  const c = canon(u); let x; try { x = new URL(c); } catch { return null; }
  const n = basename(c); const e = (n.includes('.') ? n.split('.').pop() : '').toLowerCase();
  if (x.host === 'framerusercontent.com') {
    const p = x.pathname;
    if (p.startsWith('/images/')) return 'assets/images/' + n;
    if (p.startsWith('/sites/')) return 'assets/framer/' + n;
    if (p.startsWith('/third-party-assets/')) return 'assets/fonts/' + n;
    if (p.startsWith('/assets/')) {
      if (['woff2', 'woff', 'ttf', 'otf', 'eot'].includes(e)) return 'assets/fonts/' + n;
      if (['mp4', 'webm', 'mov', 'm4v'].includes(e)) return 'assets/videos/' + n;
      return 'assets/media/' + n;
    }
    return 'assets/media/' + n;
  }
  if (x.host === 'fonts.gstatic.com') return 'assets/fonts/google/' + n;
  // Framer's built-in fonts (Inter, etc.) — fonts only, never the editor chunks (.mjs)
  if (x.host === 'app.framerstatic.com') return ['woff2', 'woff', 'ttf', 'otf', 'eot'].includes(e) ? 'assets/fonts/' + n : null;
  return null;
}
const add = u => { const c = canon(u); if (downloadSet.has(c)) return; const l = mapAsset(c); if (l) downloadSet.set(c, l); };
for (const h of Object.values(pageText)) {
  for (const m of h.matchAll(ASSET)) add(m[0]);
  for (const m of h.matchAll(GAPI)) gapi.add(m[0].replace(/&amp;/g, '&'));
}

// ---- 3) BFS the .mjs module graph (resolve ./ imports per-module: works for any site id) ----
const mjsText = {};
let frontier = [...downloadSet.keys()].filter(u => u.endsWith('.mjs'));
while (frontier.length) {
  const next = [];
  await Promise.all(frontier.map(async u => {
    if (mjsText[u] !== undefined) return;
    try {
      const t = await txt(u); mjsText[u] = t; const dir = u.slice(0, u.lastIndexOf('/') + 1);
      for (const m of t.matchAll(MJSREL)) { const abs = dir + m[1].slice(2); if (!downloadSet.has(abs)) { add(abs); next.push(abs); } }
      for (const m of t.matchAll(ASSET)) { const c = canon(m[0]); if (!downloadSet.has(c)) { add(c); if (c.endsWith('.mjs')) next.push(c); } }
    } catch (e) { console.warn('  mjs fail', u, e.message); }
  }));
  frontier = next;
}

// ---- 4) Google Fonts css -> referenced gstatic woff2 ----
let css = '';
for (const g of gapi) { try { css += `/* ${g} */\n` + await txt(g) + '\n'; } catch {} }
for (const m of css.matchAll(ASSET)) add(m[0]);

// ---- 5) download everything ----
const entries = [...downloadSet.entries()]; let done = 0; const failed = [];
const pool = Array.from({ length: 14 }, () => []); entries.forEach((e, i) => pool[i % 14].push(e));
await Promise.all(pool.map(async list => {
  for (const [u, l] of list) {
    const fp = path.join(OUT, l); fs.mkdirSync(path.dirname(fp), { recursive: true });
    if (u.endsWith('.mjs') && mjsText[u] !== undefined) fs.writeFileSync(fp, mjsText[u]);
    else { try { fs.writeFileSync(fp, await fetchBuf(u)); } catch (e) { failed.push([u, e.message]); } }
    if (++done % 25 === 0) console.log(`  downloaded ${done}/${entries.length}`);
  }
}));
fs.writeFileSync(path.join(WORK, 'manifest.json'), JSON.stringify({ base: BASE, host: HOST, assets: Object.fromEntries(downloadSet), gapi: [...gapi], failed }, null, 2));
console.log(`CRAWL done: ${done} assets, ${failed.length} failed.`);
if (failed.length) console.log(failed.slice(0, 10));
