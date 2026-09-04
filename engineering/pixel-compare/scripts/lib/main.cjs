// Orchestration: for each viewport, load and settle both URLs in one browser,
// match their heading outlines into shared anchors, capture corresponding
// slices, produce deterministic findings, and write the reports.
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { openAndSettle } = require('./settle.cjs');
const { matchAnchors, buildBoundaries, fallbackBoundaries, ensureNonEmpty, similarity, alignFloats } = require('./pair.cjs');
const { diffSection } = require('./capture.cjs');
const { sectionFindings, floatFindings } = require('./facts.cjs');
const { writeReport, statusOf } = require('./report.cjs');

const slug = (value) => {
  const normalized = String(value || '').normalize('NFKC').toLowerCase();
  const safe = normalized.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return [...safe].slice(0, 40).join('').replace(/-+$/g, '');
};

// Cluster attribution consumes the full inventory during capture; omit that
// bulky field from data.json afterwards.
const slim = (section) => {
  const { inv, ...rest } = section;
  return rest;
};

async function closeContext(result) {
  if (!result || !result.ctx) return;
  await result.ctx.close().catch(() => {});
}

async function run({ playwright, config = {} }) {
  if (!playwright || !playwright.chromium) throw new Error('A Playwright runtime with Chromium is required.');

  const A = config.a ?? process.env.A;
  const B = config.b ?? process.env.B;
  if (!A || !B) throw new Error('Set A=<url> and B=<url>, or pass both URLs on the command line.');

  const labels = config.labels || { a: process.env.LABEL_A || 'A', b: process.env.LABEL_B || 'B' };
  const vps = config.vps || (process.env.VPS || '360,1440').split(',').map((value) => Number(value.trim()));
  const generatedAt = new Date().toISOString();
  const timestamp = generatedAt.replace(/[:.]/g, '-');
  const OUT = config.out || process.env.OUT || join(tmpdir(), `pixel-compare-${timestamp}`);
  mkdirSync(OUT, { recursive: true });

  const browser = await playwright.chromium.launch({ headless: true });
  const data = {
    meta: { a: A, b: B, labels, vps, generatedAt },
    results: {},
  };

  try {
    for (const vp of vps) {
      console.log(`\n═══ viewport ${vp}px ═══`);
      const outVp = join(OUT, String(vp));
      mkdirSync(outVp, { recursive: true });

      let pa;
      let pb;
      try {
        console.log(`  loading A (${labels.a}): ${A}`);
        pa = await openAndSettle(browser, A, vp);
        console.log(`  loading B (${labels.b}): ${B}`);
        pb = await openAndSettle(browser, B, vp);

        const oa = await pa.page.evaluate(() => window.__pcOutline());
        const ob = await pb.page.evaluate(() => window.__pcOutline());
        console.log(`  leaves: A=${oa.leaves.length} B=${ob.leaves.length} · headings: A=${oa.headings.length} B=${ob.headings.length} · floats: A=${oa.floats.length} B=${ob.floats.length}`);

        const anchors = matchAnchors(oa.headings, ob.headings);
        let sliceMode = 'anchors';
        let bounds;
        if (anchors.length >= 1) {
          bounds = buildBoundaries(anchors, oa.meta.docH, ob.meta.docH);
        } else {
          sliceMode = 'proportional-fallback';
          bounds = fallbackBoundaries(oa.meta.docH, ob.meta.docH);
        }
        bounds = ensureNonEmpty(bounds.bA, bounds.bB, bounds.anchors, oa.leaves, ob.leaves);
        console.log(`  slicing: ${sliceMode}, ${bounds.bA.length - 1} slices (${anchors.length} matched headings, ${bounds.anchors.length} retained cuts)`);

        const secsA = await pa.page.evaluate((boundaries) => window.__pcRegroup(boundaries), bounds.bA);
        const secsB = await pb.page.evaluate((boundaries) => window.__pcRegroup(boundaries), bounds.bB);

        // A matched heading remains a valid counterpart even when its leaf-top
        // cut is dropped for being too close to another boundary. Use every
        // semantic match here so dropped cuts do not become false
        // "heading only on A/B" findings.
        const matchedA = new Set(anchors.map((anchor) => `${anchor.a.y}|${anchor.a.t}`));
        const matchedB = new Set(anchors.map((anchor) => `${anchor.b.y}|${anchor.b.t}`));
        const sliceOf = (boundaries, y) => Math.max(0, boundaries.findIndex((cut, i) => i + 1 < boundaries.length && y >= cut && y < boundaries[i + 1]));
        const extraFindings = new Map();
        const noteUnmatched = (headings, matched, boundaries, label) => {
          for (const heading of headings) {
            if (matched.has(`${heading.y}|${heading.t}`)) continue;
            const index = sliceOf(boundaries, heading.y);
            if (!extraFindings.has(index)) extraFindings.set(index, []);
            extraFindings.get(index).push({ sev: 'info', type: 'unmatched-heading', msg: `Heading only on ${label}: "${heading.t.slice(0, 90)}" (<${heading.tag}>, y=${heading.y}) — no equivalent heading found on the other page` });
          }
        };
        noteUnmatched(oa.headings, matchedA, bounds.bA, labels.a);
        noteUnmatched(ob.headings, matchedB, bounds.bB, labels.b);

        const result = { pageA: oa.meta, pageB: ob.meta, sliceMode, sections: [], onlyA: [], onlyB: [], floats: null };
        const used = new Set();

        for (let k = 0; k < secsA.length; k++) {
          const secA = secsA[k];
          const secB = secsB[k];
          const anchor = k > 0 ? bounds.anchors[k - 1] : null;
          let key = anchor ? slug(anchor.a.t) : (slug(secA.headings[0]?.t) || 'page-top');
          if (!key) key = `slice-${k}`;
          let unique = key;
          let suffix = 2;
          while (used.has(unique)) unique = `${key}-${suffix++}`;
          used.add(unique);
          key = unique;

          const sim = Math.round(similarity(secA, secB, oa.meta.docH, ob.meta.docH) * 100) / 100;
          process.stdout.write(`  · ${key} (content sim ${Math.round(sim * 100)}%) `);
          let shot;
          try {
            shot = await diffSection(pa.page, pb.page, secA, secB, key, outVp, pa.dpr);
          } catch (error) {
            shot = { error: String(error.message || error).slice(0, 200) };
          }
          const findings = [...sectionFindings(secA, secB, labels, shot), ...(extraFindings.get(k) || [])];
          const entry = { key, sim, shot, findings, secA: slim(secA), secB: slim(secB) };
          result.sections.push(entry);
          console.log(shot?.diffRatio != null ? `${(shot.diffRatio * 100).toFixed(2)}% diff → ${statusOf(entry)}` : `ERROR ${shot?.error || shot?.missing || ''}`);
        }

        const floatAlignment = alignFloats(oa.floats, ob.floats);
        result.floats = { pairs: floatAlignment.pairs.length, findings: floatFindings(floatAlignment, labels) };
        data.results[vp] = result;
        // Persist completed viewports as checkpoints so a later navigation or
        // capture failure does not discard all earlier results.
        writeReport(OUT, data);
      } finally {
        await Promise.all([closeContext(pa), closeContext(pb)]);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  writeReport(OUT, data);

  console.log('\n════════ SUMMARY ════════');
  for (const vp of vps) {
    const result = data.results[vp];
    const flagged = result.sections.filter((section) => statusOf(section) !== 'MATCH' || section.findings.some((finding) => finding.sev === 'major'));
    console.log(`${vp}px [${result.sliceMode}]: ${result.sections.length} slices (${flagged.length} flagged), ${result.floats.findings.length} floating-UI findings`);
  }
  console.log(`\nReport:  ${join(OUT, 'index.html')}`);
  console.log(`Summary: ${join(OUT, 'SUMMARY.md')}`);
  console.log(`Data:    ${join(OUT, 'data.json')}`);
}

module.exports = { run, slug };
