// build.mjs <FRAMER_URL> [OUT_DIR]
// Turns the crawled download into a self-contained static site:
//  - relocates media to the root paths the Framer runtime expects (/images /videos /media)
//  - localizes every URL, repoints the runtime's editor/Google-fonts/Rive/YouTube calls to local
//  - strips analytics + editor bar, injects a service-worker cleanup, writes host configs.
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] || '').replace(/\/+$/, '');
const OUT = path.resolve(process.argv[3] || 'site');
if (!BASE) { console.error('usage: node build.mjs <framer-url> [out-dir]'); process.exit(1); }
const HOST = new URL(BASE).host;
const ORIGIN = 'https://' + HOST;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const WORK = path.join(OUT, '_work');
const manifest = JSON.parse(fs.readFileSync(path.join(WORK, 'manifest.json'), 'utf8'));
const pageList = JSON.parse(fs.readFileSync(path.join(WORK, 'pages.json'), 'utf8'));
const canon = u => u.split('#')[0].split('?')[0];
const basename = u => canon(u).split('/').pop();
const GOOGLE_CSS = '/assets/css/google-fonts.css';
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Removes any stale Framer service worker + caches (returning visitors of the old site).
const SW_KILLER = `<script>(function(){try{if('serviceWorker'in navigator){var c=navigator.serviceWorker.controller;navigator.serviceWorker.getRegistrations().then(function(rs){var had=rs.length>0;rs.forEach(function(r){r.unregister()});if(self.caches&&caches.keys){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k)})})}if((had||c)&&!sessionStorage.getItem('__sw_cleared')){sessionStorage.setItem('__sw_cleared','1');location.reload()}}).catch(function(){})}}catch(e){}})();</script>`;

async function fetchBuf(u, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); }
    catch (e) { if (i === tries - 1) throw e; await new Promise(s => setTimeout(s, 500 * (i + 1))); }
  }
}

// canonical external URL -> final root-relative path the runtime expects
function refFor(u) {
  const c = canon(u); let x; try { x = new URL(c); } catch { return null; }
  const n = basename(c); const e = (n.includes('.') ? n.split('.').pop() : '').toLowerCase();
  if (x.host === 'framerusercontent.com') {
    const p = x.pathname;
    if (p.startsWith('/images/')) return '/images/' + n;
    if (p.startsWith('/sites/')) return '/assets/framer/' + n;
    if (p.startsWith('/third-party-assets/')) return '/assets/fonts/' + n;
    if (p.startsWith('/assets/')) {
      if (['woff2', 'woff', 'ttf', 'otf', 'eot'].includes(e)) return '/assets/fonts/' + n;
      if (['mp4', 'webm', 'mov', 'm4v'].includes(e)) return '/videos/' + n;
      return '/media/' + n;
    }
    return '/media/' + n;
  }
  if (x.host === 'fonts.gstatic.com') return '/assets/fonts/google/' + n;
  if (x.host === 'app.framerstatic.com') return ['woff2', 'woff', 'ttf', 'otf', 'eot'].includes(e) ? '/assets/fonts/' + n : null;
  if (x.host === 'i.ytimg.com') return '/assets/yt/' + x.pathname.replace(/^\/vi(_webp)?\//, '');
  return null;
}
const refMap = [];
for (const u of Object.keys(manifest.assets)) { if (u.endsWith('/fontshare/') || u.endsWith('/s/')) continue; const r = refFor(u); if (r) refMap.push([u, r]); }
const sortRefs = () => refMap.sort((a, b) => b[0].length - a[0].length);
sortRefs();
const localize = t => { for (const [u, r] of refMap) if (t.includes(u)) t = t.split(u).join(r); return t; };

// ---- 1) relocate media dirs to root ----
for (const [from, to] of [['assets/images', 'images'], ['assets/videos', 'videos'], ['assets/media', 'media']]) {
  const s = path.join(OUT, from), d = path.join(OUT, to);
  if (fs.existsSync(s)) { fs.mkdirSync(d, { recursive: true }); for (const f of fs.readdirSync(s)) fs.renameSync(path.join(s, f), path.join(d, f)); fs.rmdirSync(s); }
}

// ---- 2) re-fetch the JS bundles fresh (deterministic base for patching) ----
const mjsUrls = Object.keys(manifest.assets).filter(u => u.endsWith('.mjs'));
fs.mkdirSync(path.join(OUT, 'assets/framer'), { recursive: true });
await Promise.all(mjsUrls.map(async u => { try { fs.writeFileSync(path.join(OUT, 'assets/framer', basename(u)), await fetchBuf(u)); } catch (e) { console.warn('mjs refetch fail', u, e.message); } }));
console.log('refetched', mjsUrls.length, 'bundles');

// ---- 3) YouTube thumbnails (literal urls in pages) ----
const ytSet = new Set(); const YT = /https:\/\/i\.ytimg\.com\/vi(?:_webp)?\/[A-Za-z0-9_-]+\/[a-z]+\.(?:webp|jpg)/g;
for (const p of pageList) { const t = fs.readFileSync(path.join(WORK, 'pages', p.slug + '.html'), 'utf8'); for (const m of t.matchAll(YT)) ytSet.add(m[0]); }
fs.rmSync(path.join(OUT, 'assets/yt'), { recursive: true, force: true });
let ytOk = 0; for (const u of ytSet) { const out = path.join(OUT, refFor(u).slice(1)); fs.mkdirSync(path.dirname(out), { recursive: true }); try { fs.writeFileSync(out, await fetchBuf(u)); ytOk++; } catch {} }
for (const u of ytSet) { const r = refFor(u); if (r) refMap.push([canon(u), r]); }
sortRefs();
if (ytSet.size) console.log('yt thumbnails:', ytOk, '/', ytSet.size);

// ---- 4) Rive wasm (detect @rive-app version) + noop editor module ----
fs.mkdirSync(path.join(OUT, 'assets/lib'), { recursive: true });
let riveVer = null;
for (const f of fs.readdirSync(path.join(OUT, 'assets/framer'))) {
  if (!f.endsWith('.mjs')) continue;
  const m = fs.readFileSync(path.join(OUT, 'assets/framer', f), 'utf8').match(/@rive-app\/canvas","version":"([\d.]+)"/);
  if (m) { riveVer = m[1]; break; }
}
if (riveVer) { try { fs.writeFileSync(path.join(OUT, 'assets/lib/rive.wasm'), await fetchBuf(`https://unpkg.com/@rive-app/canvas@${riveVer}/rive.wasm`)); console.log('rive.wasm', riveVer); } catch (e) { console.warn('rive wasm fail', e.message); } }
fs.writeFileSync(path.join(OUT, 'assets/lib/noop-editor.mjs'), `export function createEditorBar(){return function(){return null}}\nexport default function(){return null}\n`);

// ---- 5) process pages ----
function cleanHtml(t) {
  t = t.replace(/https?:\/\/fonts\.googleapis\.com\/css2[^"'`)<>\\]*/g, GOOGLE_CSS);
  t = localize(t);
  t = t.replace(/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?(?:clarity|__framer_force_showing_editorbar|events\.framer\.com)(?:(?!<\/script>)[\s\S])*?<\/script>/gi, '');
  t = t.replace(/<script\b[^>]*events\.framer\.com[^>]*>(?:[\s\S]*?<\/script>)?/gi, '');
  t = t.replace(/<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>/gi, '');
  t = t.replace(new RegExp(`(<a\\b[^>]*\\bhref=")https?:\\/\\/${esc(HOST)}(\\/[^"]*)"`, 'g'), (_m, a, b) => `${a}.${b}"`);
  t = t.replace(/(<meta\b[^>]*\b(?:property|name)="(?:og:image|twitter:image)"[^>]*\bcontent=")(\/[^"]*)"/gi, (_m, a, b) => `${a}${ORIGIN}${b}"`);
  t = t.replace(/(<meta\b[^>]*\bcontent=")(\/[^"]*)("[^>]*\b(?:property|name)="(?:og:image|twitter:image)")/gi, (_m, a, b, c) => `${a}${ORIGIN}${b}${c}`);
  t = t.replace(/<head([^>]*)>/i, `<head$1>${SW_KILLER}`);
  return t;
}
for (const p of pageList) {
  const out = cleanHtml(fs.readFileSync(path.join(WORK, 'pages', p.slug + '.html'), 'utf8'));
  fs.writeFileSync(path.join(OUT, p.slug + '.html'), out);
  const leak = (out.match(/https?:\/\/(?:framerusercontent\.com|fonts\.g(?:static|oogleapis)\.com|events\.framer\.com|i\.ytimg\.com|unpkg\.com|app\.framerstatic\.com|clarity\.ms)/g) || []).length;
  console.log(`  page ${p.slug.padEnd(20)} leak-refs=${leak}`);
}

// ---- 6) patch the JS bundles: repoint every runtime-built remote URL to local ----
for (const f of fs.readdirSync(path.join(OUT, 'assets/framer'))) {
  if (!f.endsWith('.mjs')) continue;
  const fp = path.join(OUT, 'assets/framer', f);
  let t = localize(fs.readFileSync(fp, 'utf8'));
  t = t.replace(/https:\/\/framer\.com\/edit\/init\.mjs/g, '/assets/lib/noop-editor.mjs');     // editor bar -> noop
  t = t.replace(/https:\/\/fonts\.googleapis\.com\/css2\?family=[^`'"]*/g, GOOGLE_CSS);          // runtime font link -> local
  // NB: do NOT blanket-replace the bare fonts.googleapis.com / fonts.gstatic.com hosts —
  // the runtime calls `new URL(host)` on them; a relative replacement throws "Invalid URL".
  // They are only preconnect hints / string checks and cause no request leak when left as-is.
  t = t.replace(/https:\/\/unpkg\.com\/[^"'`]*rive\.wasm/g, '/assets/lib/rive.wasm');            // rive wasm -> local
  t = t.split('https://app.framerstatic.com/').join('/assets/fonts/');                           // Framer built-in fonts -> local
  t = t.split('https://i.ytimg.com/vi_webp/').join('/assets/yt/');
  t = t.split('https://i.ytimg.com/vi/').join('/assets/yt/');
  // After localizing asset URLs to root-relative paths, `new URL("/path")` would throw
  // (no base). Give single-arg new URL() calls on a root path the document base so they
  // resolve to the current origin (also makes the asset load locally).
  t = t.replace(/new URL\((["'])(\/[^"'`]*)\1\)/g, 'new URL($1$2$1,document.baseURI)');
  fs.writeFileSync(fp, t);
}

// ---- 7) Google Fonts stylesheet (localized) ----
let gcss = '';
for (const g of manifest.gapi) { try { gcss += `/* ${g} */\n` + (await (await fetch(g, { headers: { 'User-Agent': UA } })).text()) + '\n'; } catch {} }
gcss = localize(gcss);
fs.mkdirSync(path.join(OUT, 'assets/css'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'assets/css/google-fonts.css'), gcss);

// ---- 8) host configs + extras ----
const w = (rel, content) => fs.writeFileSync(path.join(OUT, rel), content);
w('.nojekyll', '');
w('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
w('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  pageList.map(p => `<url><loc>${ORIGIN}${p.slug === 'index' ? '/' : '/' + p.slug.replace(/-/g, '/')}</loc></url>`).join('\n') + `\n</urlset>\n`);
w('vercel.json', JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json', framework: null, buildCommand: null,
  outputDirectory: '.', installCommand: "echo 'static site — no install/build'",
  cleanUrls: true, trailingSlash: false,
  headers: [
    { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    { source: '/(images|videos|media)/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
  ],
}, null, 2) + '\n');
w('netlify.toml', `[build]\n  publish = "."\n\n[[headers]]\n  for = "/assets/*"\n  [headers.values]\n    Cache-Control = "public, max-age=31536000, immutable"\n\n[[headers]]\n  for = "/images/*"\n  [headers.values]\n    Cache-Control = "public, max-age=31536000, immutable"\n`);
w('404.html', `<!doctype html><html lang="en"><head>${SW_KILLER}<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;color:#1a1a1a;text-align:center}h1{font-size:72px;margin:0}p{color:#666}a{color:inherit}</style></head><body><div><h1>404</h1><p>This page could not be found.</p><p><a href="/">&larr; back home</a></p></div></body></html>\n`);
w('server.mjs', SERVER_JS());
console.log('BUILD done. Pages:', pageList.length, '| host:', HOST);

function SERVER_JS() {
  return `// Zero-dependency local preview:  node server.mjs  -> http://localhost:4178
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url)); const PORT = process.env.PORT || 4178;
const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.xml':'application/xml','.txt':'text/plain; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.wasm':'application/wasm','.riv':'application/octet-stream' };
function resolveFile(u){ let p=decodeURIComponent(u.split('?')[0]); if(p.endsWith('/'))p+='index.html'; const fp=path.join(ROOT,p); if(fs.existsSync(fp)&&fs.statSync(fp).isFile())return fp; if(fs.existsSync(fp+'.html'))return fp+'.html'; if(fs.existsSync(fp)&&fs.statSync(fp).isDirectory()){const i=path.join(fp,'index.html'); if(fs.existsSync(i))return i;} return null; }
http.createServer((req,res)=>{ const fp=resolveFile(req.url); if(!fp){const nf=path.join(ROOT,'404.html'); if(fs.existsSync(nf)){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});return fs.createReadStream(nf).pipe(res);} res.writeHead(404);return res.end('404');} const type=MIME[path.extname(fp).toLowerCase()]||'application/octet-stream'; const stat=fs.statSync(fp); const range=req.headers.range; if(range&&/^bytes=/.test(range)){const[s,e]=range.replace('bytes=','').split('-'); const start=parseInt(s,10)||0,end=e?parseInt(e,10):stat.size-1; res.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':\`bytes \${start}-\${end}/\${stat.size}\`,'Content-Length':end-start+1}); fs.createReadStream(fp,{start,end}).pipe(res);} else { res.writeHead(200,{'Content-Type':type,'Content-Length':stat.size,'Accept-Ranges':'bytes'}); fs.createReadStream(fp).pipe(res);} }).listen(PORT,()=>console.log('preview at http://localhost:'+PORT));
`;
}
