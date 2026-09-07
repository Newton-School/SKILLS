// Deterministic findings derived from each pair of section fingerprints.
const { jaccard, tokens } = require('./pair.cjs');

const norm = (value) => String(value || '').replace(/\s+/gu, ' ').trim();
const digitless = (value) => norm(value).toLowerCase().replace(/[\p{N},.:%]+/gu, '#');

function setDiff(aList, bList) {
  const a = aList.map(norm).filter(Boolean);
  const b = bList.map(norm).filter(Boolean);
  const bSet = new Map();
  for (const line of b) {
    const key = line.toLowerCase();
    bSet.set(key, (bSet.get(key) || 0) + 1);
  }

  const onlyA = [];
  for (const line of a) {
    const key = line.toLowerCase();
    if (bSet.get(key)) bSet.set(key, bSet.get(key) - 1);
    else onlyA.push(line);
  }

  const aSet = new Map();
  for (const line of a) {
    const key = line.toLowerCase();
    aSet.set(key, (aSet.get(key) || 0) + 1);
  }
  const onlyB = [];
  for (const line of b) {
    const key = line.toLowerCase();
    if (aSet.get(key)) aSet.set(key, aSet.get(key) - 1);
    else onlyB.push(line);
  }
  return { onlyA, onlyB };
}

// Lines that differ only by numbers are dynamic values rather than missing copy.
function splitDynamicText(onlyA, onlyB) {
  const bByKey = new Map();
  onlyB.forEach((line, index) => {
    const key = digitless(line);
    if (!bByKey.has(key)) bByKey.set(key, []);
    bByKey.get(key).push(index);
  });

  const dynamic = [];
  const restA = [];
  const usedB = new Set();
  for (const line of onlyA) {
    const key = digitless(line);
    const candidates = (bByKey.get(key) || []).filter((index) => !usedB.has(index));
    if (key.includes('#') && candidates.length) {
      const index = candidates[0];
      usedB.add(index);
      dynamic.push({ a: line, b: onlyB[index] });
    } else {
      restA.push(line);
    }
  }
  return { dynamic, restA, restB: onlyB.filter((_, index) => !usedB.has(index)) };
}

function pairHeadings(headingsA, headingsB) {
  const pairs = [];
  const usedB = new Set();
  for (const headingA of headingsA) {
    let best = -1;
    let bestSimilarity = 0;
    headingsB.forEach((headingB, index) => {
      if (usedB.has(index)) return;
      const score = jaccard(tokens(headingA.t), tokens(headingB.t)) ?? 0;
      if (score > bestSimilarity) {
        bestSimilarity = score;
        best = index;
      }
    });
    if (best >= 0 && bestSimilarity >= 0.5) {
      usedB.add(best);
      pairs.push({ a: headingA, b: headingsB[best] });
    }
  }
  return pairs;
}

function sectionFindings(secA, secB, labels, shot) {
  const findings = [];
  const add = (sev, type, msg) => findings.push({ sev, type, msg });
  const labelA = labels.a;
  const labelB = labels.b;

  if (shot && shot.cssDelta) {
    const { width: widthDelta, height: heightDelta } = shot.cssDelta;
    if (Math.abs(heightDelta) > Math.max(12, 0.02 * Math.max(secA.rect.h, secB.rect.h))) {
      add('major', 'size', `Section height differs: ${labelA} ${Math.round(secA.rect.h)}px vs ${labelB} ${Math.round(secB.rect.h)}px (Δ${heightDelta > 0 ? '+' : ''}${heightDelta}px)`);
    } else if (Math.abs(heightDelta) > 4) {
      add('minor', 'size', `Section height drift: Δ${heightDelta > 0 ? '+' : ''}${heightDelta}px (${labelA} ${Math.round(secA.rect.h)}px / ${labelB} ${Math.round(secB.rect.h)}px)`);
    }
    if (Math.abs(widthDelta) > 4) add('major', 'size', `Section width differs by ${widthDelta}px — check container width`);
  }

  if (shot?.captureTruncation) {
    const truncation = shot.captureTruncation;
    const sides = [];
    if (truncation.a.truncated) sides.push(`${labelA} requested ${truncation.a.requestedHeight}px`);
    if (truncation.b.truncated) sides.push(`${labelB} requested ${truncation.b.requestedHeight}px`);
    add('major', 'capture-truncated', `Screenshot capture was limited to the first ${truncation.limitCssPx}px (${sides.join(', ')}). Pixel-diff and hot-spot results do not cover the remainder of this slice.`);
  }

  if (secA.bg !== secB.bg) add('major', 'background', `Section background: ${labelA} ${secA.bg} vs ${labelB} ${secB.bg}`);

  for (const { a, b } of pairHeadings(secA.headings, secB.headings)) {
    const deltas = [];
    if (a.tag !== b.tag) deltas.push(`level <${a.tag}> vs <${b.tag}>`);
    if (Math.abs(a.size - b.size) > 1) deltas.push(`font-size ${a.size}px vs ${b.size}px`);
    if (a.weight !== b.weight) deltas.push(`weight ${a.weight} vs ${b.weight}`);
    if (a.family !== b.family) deltas.push(`family "${a.family}" vs "${b.family}"`);
    if (a.color !== b.color) deltas.push(`color ${a.color} vs ${b.color}`);
    if (deltas.length) {
      const severity = deltas.some((delta) => delta.startsWith('font-size') || delta.startsWith('family')) ? 'major' : 'minor';
      add(severity, 'heading', `Heading "${a.t.slice(0, 60)}": ${deltas.join(', ')} (${labelA} vs ${labelB})`);
    }
  }

  const { onlyA, onlyB } = setDiff(secA.lines, secB.lines);
  const { dynamic, restA, restB } = splitDynamicText(onlyA, onlyB);
  for (const value of dynamic.slice(0, 8)) {
    add('dynamic', 'dynamic-text', `Number/date differs (likely dynamic content): ${labelA} "${value.a.slice(0, 70)}" vs ${labelB} "${value.b.slice(0, 70)}"`);
  }
  for (const line of restA.slice(0, 20)) add('major', 'copy', `Text only on ${labelA}: "${line.slice(0, 90)}"`);
  for (const line of restB.slice(0, 20)) add('major', 'copy', `Text only on ${labelB}: "${line.slice(0, 90)}"`);
  if (restA.length > 20) add('info', 'copy', `…and ${restA.length - 20} more lines only on ${labelA}`);
  if (restB.length > 20) add('info', 'copy', `…and ${restB.length - 20} more lines only on ${labelB}`);

  if (secA.imgCount !== secB.imgCount) add('minor', 'images', `Image count: ${labelA} has ${secA.imgCount}, ${labelB} has ${secB.imgCount}`);
  const altDiff = setDiff(secA.alts, secB.alts);
  for (const alt of altDiff.onlyA.slice(0, 10)) add('minor', 'images', `Image alt only on ${labelA}: "${alt.slice(0, 80)}"`);
  for (const alt of altDiff.onlyB.slice(0, 10)) add('minor', 'images', `Image alt only on ${labelB}: "${alt.slice(0, 80)}"`);

  const ctaDiff = setDiff(secA.ctas, secB.ctas);
  const ctaDynamic = splitDynamicText(ctaDiff.onlyA, ctaDiff.onlyB);
  for (const value of ctaDynamic.dynamic.slice(0, 8)) {
    add('dynamic', 'dynamic-text', `CTA/link number or date differs: ${labelA} "${value.a.slice(0, 70)}" vs ${labelB} "${value.b.slice(0, 70)}"`);
  }
  for (const text of ctaDynamic.restA.slice(0, 10)) add('major', 'cta', `CTA/link only on ${labelA}: "${text.slice(0, 80)}"`);
  for (const text of ctaDynamic.restB.slice(0, 10)) add('major', 'cta', `CTA/link only on ${labelB}: "${text.slice(0, 80)}"`);

  if (shot?.selfChange && ((shot.selfChange.a || 0) > 0.002 || (shot.selfChange.b || 0) > 0.002)) {
    add('dynamic', 'self-animating', `Section re-renders itself over time (re-captured after 1.2s: ${labelA} changed ${((shot.selfChange.a || 0) * 100).toFixed(1)}%, ${labelB} changed ${((shot.selfChange.b || 0) * 100).toFixed(1)}%) — the A-vs-B pixel percentage may be timing-dependent, verify visually`);
  }

  const describeDynamics = (section) => section.dynamics.map((dynamicRegion) => `${dynamicRegion.kind}${dynamicRegion.cls ? `.${dynamicRegion.cls.split(/\s+/)[0]}` : ''} ${dynamicRegion.w}x${dynamicRegion.h}`).slice(0, 6);
  if (secA.dynamics.length || secB.dynamics.length) {
    add('dynamic', 'dynamic-region', `Dynamic content present — pixel differences may depend on render timing. ${labelA}: [${describeDynamics(secA).join(', ') || 'none'}] ${labelB}: [${describeDynamics(secB).join(', ') || 'none'}]`);
  }
  if ((secA.animCount || 0) + (secB.animCount || 0) > 0) {
    add('dynamic', 'dynamic-region', `Infinite animations detected (${labelA}: ${secA.animCount || 0}, ${labelB}: ${secB.animCount || 0}) — frozen during capture but their initial phases may differ`);
  }

  return findings;
}

function floatFindings(floatAlignment, labels, shot = null) {
  const findings = [];
  const describe = (float) => `${float.kind || 'fixed'} ${float.tag}${float.cls ? `.${float.cls.split(/\s+/)[0]}` : ''}${float.text ? ` "${float.text.slice(0, 50)}"` : ''}${float.hasImg ? ' [icon]' : ''} @(${float.rect.x ?? '?'},${float.rect.y ?? '?'}) ${float.rect.w}x${float.rect.h}`;
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changedStyleKeys = (a, b) => {
    const left = a || {};
    const right = b || {};
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => left[key] !== right[key]);
  };
  const geometryDiffers = (a, b, tolerance = 2) => ['x', 'y', 'w', 'h'].some((key) => {
    if (!Number.isFinite(a?.[key]) || !Number.isFinite(b?.[key])) return a?.[key] !== b?.[key];
    return Math.abs(a[key] - b[key]) > tolerance;
  });

  if (shot?.error) {
    findings.push({ sev: 'major', type: 'floating-ui-capture', msg: `Fixed/sticky UI capture failed: ${shot.error}` });
  } else if ((shot?.diffPixels || 0) > 0) {
    findings.push({
      sev: 'major',
      type: 'floating-ui-pixels',
      msg: `Fixed/sticky UI renders differently: ${shot.diffPixels} pixels differ in the strongest isolated ${shot.matte ? `${shot.matte}-matte ` : ''}capture (${((shot.diffRatio || 0) * 100).toFixed(3)}%)`,
    });
  }

  for (const pair of floatAlignment.pairs) {
    const changes = [];
    if (pair.a.kind !== pair.b.kind) changes.push(`position ${pair.a.kind || '?'} vs ${pair.b.kind || '?'}`);
    if (geometryDiffers(pair.a.rect, pair.b.rect)) {
      changes.push(`geometry (${pair.a.rect.x},${pair.a.rect.y}) ${pair.a.rect.w}x${pair.a.rect.h} vs (${pair.b.rect.x},${pair.b.rect.y}) ${pair.b.rect.w}x${pair.b.rect.h}`);
    }
    if (norm(pair.a.text).toLowerCase() !== norm(pair.b.text).toLowerCase()) changes.push('text');
    if (norm(pair.a.role).toLowerCase() !== norm(pair.b.role).toLowerCase()) changes.push('role/accessible label');
    if (!same(pair.a.media, pair.b.media)) changes.push('image/SVG content');
    const rootStyles = changedStyleKeys(pair.a.style, pair.b.style);
    if (rootStyles.length) changes.push(`root style (${rootStyles.slice(0, 5).join(', ')})`);

    const visualA = pair.a.visual || [];
    const visualB = pair.b.visual || [];
    let changedVisuals = Math.abs(visualA.length - visualB.length);
    for (let index = 0; index < Math.min(visualA.length, visualB.length); index++) {
      const a = visualA[index];
      const b = visualB[index];
      if (a.tag !== b.tag
          || geometryDiffers(a, b)
          || norm(a.text).toLowerCase() !== norm(b.text).toLowerCase()
          || !same(a.media, b.media)
          || !same(a.pseudo, b.pseudo)
          || changedStyleKeys(a.style, b.style).length) changedVisuals += 1;
    }
    if (changedVisuals) changes.push(`${changedVisuals} painted subtree record${changedVisuals === 1 ? '' : 's'}`);

    if (changes.length) {
      findings.push({
        sev: 'major',
        type: 'floating-ui',
        msg: `Fixed/sticky element differs (${labels.a} vs ${labels.b}): ${describe(pair.a)} — ${changes.join('; ')}`,
      });
    }
  }

  for (const float of floatAlignment.onlyA) findings.push({ sev: 'major', type: 'floating-ui', msg: `Fixed/floating element only on ${labels.a}: ${describe(float)}` });
  for (const float of floatAlignment.onlyB) findings.push({ sev: 'major', type: 'floating-ui', msg: `Fixed/floating element only on ${labels.b}: ${describe(float)}` });
  return findings;
}

module.exports = { sectionFindings, floatFindings, setDiff, splitDynamicText };
