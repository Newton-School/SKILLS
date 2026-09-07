// Generate OUT/index.html, OUT/SUMMARY.md, and OUT/data.json. Rebuild mode
// merges optional OUT/notes.json without recapturing screenshots.
const { writeFileSync, readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mdEsc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|');
const md = (value) => mdEsc(value).replace(/\r?\n/g, ' ');

function statusOf(entry) {
  if (entry.missingOn) return `ONLY-${entry.missingOn}`;
  if (!entry.shot || entry.shot.error) return 'ERROR';
  const ratio = entry.shot.diffRatio;
  if (!Number.isFinite(ratio)) return 'ERROR';
  if (ratio < 0.003) return 'MATCH';
  if (ratio < 0.015) return 'LOW';
  if (ratio < 0.05) return 'MEDIUM';
  return 'HIGH';
}

const STATUS_COLOR = {
  MATCH: '#16a34a',
  LOW: '#ca8a04',
  MEDIUM: '#ea580c',
  HIGH: '#dc2626',
  'ONLY-A': '#7c3aed',
  'ONLY-B': '#7c3aed',
  ERROR: '#64748b',
};
const SEV_COLOR = { major: '#dc2626', minor: '#ca8a04', info: '#64748b', dynamic: '#0284c7' };

function pct(ratio) {
  return Number.isFinite(ratio) ? `${(ratio * 100).toFixed(2)}%` : '—';
}

function summaryMd(data, notes) {
  const labels = data.meta.labels;
  const out = [];
  out.push(`# Pixel compare — ${md(labels.a)} vs ${md(labels.b)}`);
  out.push('');
  out.push(`- **A (${md(labels.a)})**: ${md(data.meta.a)}`);
  out.push(`- **B (${md(labels.b)})**: ${md(data.meta.b)}`);
  out.push(`- Generated: ${md(data.meta.generatedAt)} · viewports: ${data.meta.vps.join(', ')}`);
  out.push('');

  for (const vp of data.meta.vps) {
    const result = data.results[vp];
    if (!result) continue;
    out.push(`## ${vp}px`);
    out.push('');
    out.push('| section | status | pixel diff | major | minor | dynamic |');
    out.push('|---|---|---|---|---|---|');
    const ranked = [...result.sections].sort((a, b) => (b.shot?.diffRatio ?? 1) - (a.shot?.diffRatio ?? 1));
    for (const section of ranked) {
      const count = (severity) => section.findings.filter((finding) => finding.sev === severity).length;
      out.push(`| ${md(section.key)} | ${statusOf(section)} | ${pct(section.shot?.diffRatio)} | ${count('major')} | ${count('minor')} | ${count('dynamic')} |`);
    }
    for (const section of result.onlyA) out.push(`| ${md(section.key)} | ONLY-A (missing on ${md(labels.b)}) | — | 1 | 0 | 0 |`);
    for (const section of result.onlyB) out.push(`| ${md(section.key)} | ONLY-B (missing on ${md(labels.a)}) | — | 1 | 0 | 0 |`);
    out.push('');

    for (const section of ranked) {
      const worthShowing = section.findings.filter((finding) => finding.sev !== 'info');
      const note = notes[`${vp}/${section.key}`];
      if (!worthShowing.length && !note && statusOf(section) === 'MATCH') continue;
      out.push(`### ${md(section.key)} (${vp}px) — ${statusOf(section)}, ${pct(section.shot?.diffRatio)}`);
      if (note) out.push(`> **Likely cause:** ${mdEsc(note).replace(/\r?\n/g, '\n> ')}`);
      for (const finding of worthShowing.slice(0, 25)) out.push(`- [${md(finding.sev)}] ${md(finding.msg)}`);
      if (worthShowing.length > 25) out.push(`- …and ${worthShowing.length - 25} more (see index.html)`);
      const clusters = (section.shot?.clusters || []).filter((cluster) => cluster.px > 400);
      for (const cluster of clusters.slice(0, 5)) {
        out.push(`- [cluster${cluster.dynamicOverlap ? ' · dynamic-overlap' : ''}] y ${cluster.y0}–${cluster.y1}px, x ${cluster.x0}–${cluster.x1}px (${cluster.px}px²) — A: ${md(cluster.elementsA?.[0] || '?')} \| B: ${md(cluster.elementsB?.[0] || '?')}`);
      }
      out.push('');
    }

    if (result.floats?.findings?.length) {
      const floatShot = result.floats.shot;
      const floatStatus = floatShot?.error ? 'ERROR' : 'DIFF';
      out.push(`### Fixed/sticky UI (${vp}px) — ${floatStatus}`);
      if (Number.isFinite(floatShot?.diffRatio)) {
        out.push(`- Strongest isolated ${floatShot.matte ? `${md(floatShot.matte)}-matte ` : ''}capture: ${pct(floatShot.diffRatio)} (${floatShot.diffPixels} pixels) — [montage](./${vp}/floating-ui/montage.png)`);
      }
      for (const finding of result.floats.findings) out.push(`- [${md(finding.sev)}] ${md(finding.msg)}`);
      out.push('');
    }
  }
  return out.join('\n');
}

function sectionCard(section, vp, labels, notes) {
  const status = statusOf(section);
  const note = notes[`${vp}/${section.key}`];
  const dir = `./${vp}/${section.key}`;
  const findings = section.findings || [];
  const clusters = (section.shot?.clusters || []).filter((cluster) => cluster.px > 400);
  let image;
  if (section.missingOn) {
    image = `<a href="${dir}/${section.missingOn === 'A' ? 'b' : 'a'}.png" target="_blank"><img loading="lazy" src="${dir}/${section.missingOn === 'A' ? 'b' : 'a'}.png" alt="${esc(section.key)}"></a>
       <p class="mono dim">Section exists only on ${section.missingOn === 'A' ? `${esc(labels.b)} (B)` : `${esc(labels.a)} (A)`} — no counterpart found on the other page.</p>`;
  } else if (!section.shot || section.shot.error || !Number.isFinite(section.shot.diffRatio)) {
    image = `<div class="capture-error"><strong>Capture failed</strong><br>${esc(section.shot?.error || 'No valid pixel-diff result was produced.')}</div>`;
  } else {
    image = `<a href="${dir}/montage.png" target="_blank"><img loading="lazy" src="${dir}/montage.png" alt="${esc(section.key)} montage"></a>
       <p class="mono dim">left: A (${esc(labels.a)}) · middle: B (${esc(labels.b)}) · right: diff — <a href="${dir}/a.png" target="_blank">A</a> · <a href="${dir}/b.png" target="_blank">B</a> · <a href="${dir}/diff.png" target="_blank">diff</a></p>`;
  }
  const metrics = Number.isFinite(section.shot?.diffRatio)
    ? `${pct(section.shot.diffRatio)} pixels differ · ${section.shot.w}×${section.shot.h}px`
    : '';

  return `
  <details class="card" ${status === 'MATCH' && !findings.some((finding) => finding.sev === 'major') ? '' : 'open'}>
    <summary>
      <span class="chip" style="background:${STATUS_COLOR[status] || '#64748b'}">${status}</span>
      <strong>${esc(section.key)}</strong>
      <span class="dim">${metrics}${section.sim != null ? `${metrics ? ' ·' : ''} pairing confidence ${Math.round(section.sim * 100)}%` : ''}</span>
    </summary>
    ${note ? `<div class="note"><strong>Likely cause</strong><br>${esc(note).replace(/\n/g, '<br>')}</div>` : ''}
    ${image}
    ${findings.length ? `<ul class="findings">${findings.map((finding) => `<li><span class="sev" style="color:${SEV_COLOR[finding.sev]}">[${finding.sev}]</span> ${esc(finding.msg)}</li>`).join('')}</ul>` : '<p class="dim">No structural/content findings.</p>'}
    ${clusters.length ? `<div class="clusters"><strong>Diff hot-spots</strong><ul>${clusters.map((cluster) => `
      <li>y ${cluster.y0}–${cluster.y1}px, x ${cluster.x0}–${cluster.x1}px · ${cluster.px}px² ${cluster.dynamicOverlap ? '<em>(overlaps dynamic content — may be render timing)</em>' : ''}<br>
      <span class="mono">A: ${esc((cluster.elementsA || []).join(' · ') || '?')}</span><br>
      <span class="mono">B: ${esc((cluster.elementsB || []).join(' · ') || '?')}</span></li>`).join('')}</ul></div>` : ''}
  </details>`;
}

function indexHtml(data, notes) {
  const labels = data.meta.labels;
  const viewportBlocks = data.meta.vps.map((vp) => {
    const result = data.results[vp];
    if (!result) return '';
    const ranked = [...result.sections].sort((a, b) => (b.shot?.diffRatio ?? 1) - (a.shot?.diffRatio ?? 1));
    const unpaired = [
      ...result.onlyA.map((section) => ({ ...section, missingOn: 'B' })),
      ...result.onlyB.map((section) => ({ ...section, missingOn: 'A' })),
    ];
    const floats = result.floats?.findings || [];
    const floatShot = result.floats?.shot;
    const floatImage = Number.isFinite(floatShot?.diffRatio)
      ? `<a href="./${vp}/floating-ui/montage.png" target="_blank"><img loading="lazy" src="./${vp}/floating-ui/montage.png" alt="fixed and sticky UI montage"></a>
        <p class="mono dim">strongest isolated ${floatShot.matte ? `${esc(floatShot.matte)}-matte ` : ''}capture · ${pct(floatShot.diffRatio)} (${floatShot.diffPixels} pixels) · left: A · middle: B · right: diff</p>`
      : (floatShot?.error ? `<div class="capture-error"><strong>Capture failed</strong><br>${esc(floatShot.error)}</div>` : '');
    return `
    <section>
      <h2>${vp}px ${vp < 700 ? '(mobile)' : '(desktop)'}</h2>
      ${unpaired.map((section) => sectionCard(section, vp, labels, notes)).join('')}
      ${ranked.map((section) => sectionCard(section, vp, labels, notes)).join('')}
      ${floats.length ? `<details class="card" open><summary><span class="chip" style="background:#7c3aed">FLOATING UI DIFF</span><strong>fixed/sticky elements</strong></summary>
        ${floatImage}<ul class="findings">${floats.map((finding) => `<li><span class="sev" style="color:${SEV_COLOR[finding.sev]}">[${finding.sev}]</span> ${esc(finding.msg)}</li>`).join('')}</ul></details>` : ''}
    </section>`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pixel compare — ${esc(labels.a)} vs ${esc(labels.b)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #f1f5f9; }
  header { background: #0f172a; color: #f8fafc; padding: 18px 28px; }
  header h1 { margin: 0 0 6px; font-size: 18px; }
  header .mono { color: #94a3b8; }
  main { max-width: 1500px; margin: 0 auto; padding: 20px 28px 80px; }
  h2 { margin: 34px 0 12px; font-size: 16px; border-bottom: 2px solid #cbd5e1; padding-bottom: 6px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; margin: 14px 0; padding: 0 16px 14px; }
  .card summary { cursor: pointer; padding: 12px 0; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .chip { color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 99px; letter-spacing: .03em; }
  .dim { color: #64748b; font-size: 12px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  img { max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 6px; display: block; }
  .findings { margin: 10px 0; padding-left: 18px; }
  .findings li { margin: 3px 0; }
  .sev { font-weight: 700; font-size: 11px; }
  .note { background: #fefce8; border: 1px solid #fde047; border-radius: 8px; padding: 10px 14px; margin: 10px 0; }
  .capture-error { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 10px 14px; margin: 10px 0; color: #991b1b; }
  .clusters { background: #f8fafc; border-radius: 8px; padding: 10px 14px; margin-top: 10px; }
  .clusters li { margin: 6px 0; }
  .legend { margin: 8px 0 0; }
</style></head>
<body>
<header>
  <h1>Pixel compare — ${esc(labels.a)} (A) vs ${esc(labels.b)} (B)</h1>
  <div class="mono">A: ${esc(data.meta.a)}<br>B: ${esc(data.meta.b)}</div>
  <div class="legend dim">Generated ${esc(data.meta.generatedAt)} · pixelmatch threshold 0.12, anti-aliasing ignored · statuses: MATCH &lt;0.3% · LOW &lt;1.5% · MEDIUM &lt;5% · HIGH ≥5% of pixels</div>
</header>
<main>${viewportBlocks}</main>
</body></html>`;
}

function readNotes(outDir) {
  const notesPath = join(outDir, 'notes.json');
  if (!existsSync(notesPath)) return {};
  try {
    const notes = JSON.parse(readFileSync(notesPath, 'utf8'));
    return notes && typeof notes === 'object' && !Array.isArray(notes) ? notes : {};
  } catch {
    return {};
  }
}

function writeReport(outDir, data) {
  const notes = readNotes(outDir);
  writeFileSync(join(outDir, 'data.json'), JSON.stringify(data, null, 1));
  writeFileSync(join(outDir, 'SUMMARY.md'), summaryMd(data, notes));
  writeFileSync(join(outDir, 'index.html'), indexHtml(data, notes));
}

function rebuild(outDir) {
  const data = JSON.parse(readFileSync(join(outDir, 'data.json'), 'utf8'));
  writeReport(outDir, data);
  console.log(`rebuilt ${join(outDir, 'index.html')} and SUMMARY.md (notes merged: ${existsSync(join(outDir, 'notes.json'))})`);
}

module.exports = { writeReport, rebuild, statusOf, summaryMd, indexHtml };
