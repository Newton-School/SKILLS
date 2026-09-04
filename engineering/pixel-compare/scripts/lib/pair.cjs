// Match headings across both pages and turn matched pairs into shared y-axis
// cut points. Reciprocal-best matching plus a weighted increasing-subsequence
// pass keeps anchors in document order.
const norm = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const WORD_SEGMENTER = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('und', { granularity: 'word' })
  : null;
const MAX_FALLBACK_SLICES = 200;

function tokens(value) {
  const normalized = norm(value);
  const words = WORD_SEGMENTER
    ? [...WORD_SEGMENTER.segment(normalized)].filter((part) => part.isWordLike).map((part) => part.segment)
    : normalized.match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  return new Set(words.filter((word) => [...word].length > 1 || !/^\p{Script=Latin}$/u.test(word)));
}

function jaccard(a, b) {
  if (!a.size && !b.size) return null;
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

const MIN_HEAD_SIM = 0.55;

// headingsA/headingsB contain {t, y, leafTop, ...} in document order.
// The result is sorted by A and monotonic in B.
function matchAnchors(headingsA, headingsB) {
  const tokensA = headingsA.map((heading) => tokens(heading.t));
  const tokensB = headingsB.map((heading) => tokens(heading.t));
  const candidates = [];

  for (let i = 0; i < headingsA.length; i++) {
    let best = -1;
    let bestSimilarity = 0;
    for (let j = 0; j < headingsB.length; j++) {
      const score = jaccard(tokensA[i], tokensB[j]) ?? 0;
      if (score > bestSimilarity) {
        bestSimilarity = score;
        best = j;
      }
    }
    if (best < 0 || bestSimilarity < MIN_HEAD_SIM) continue;

    let reciprocalBest = -1;
    let reciprocalSimilarity = 0;
    for (let k = 0; k < headingsA.length; k++) {
      const score = jaccard(tokensA[k], tokensB[best]) ?? 0;
      if (score > reciprocalSimilarity) {
        reciprocalSimilarity = score;
        reciprocalBest = k;
      }
    }
    if (reciprocalBest === i) candidates.push({ ai: i, bi: best, sim: bestSimilarity });
  }

  candidates.sort((left, right) => headingsA[left.ai].y - headingsA[right.ai].y);
  const count = candidates.length;
  const scores = new Array(count).fill(0);
  const previous = new Array(count).fill(-1);
  let bestEnd = -1;
  let bestScore = 0;

  for (let i = 0; i < count; i++) {
    scores[i] = candidates[i].sim;
    for (let j = 0; j < i; j++) {
      if (headingsB[candidates[j].bi].y < headingsB[candidates[i].bi].y && scores[j] + candidates[i].sim > scores[i]) {
        scores[i] = scores[j] + candidates[i].sim;
        previous[i] = j;
      }
    }
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      bestEnd = i;
    }
  }

  const kept = [];
  for (let i = bestEnd; i >= 0; i = previous[i]) kept.push(candidates[i]);
  kept.reverse();
  return kept.map((candidate) => ({
    a: headingsA[candidate.ai],
    b: headingsB[candidate.bi],
    sim: candidate.sim,
  }));
}

// Cut at the top of each matched heading's containing content leaf. A cut pair
// is dropped when either side would create an impractically small slice.
function buildBoundaries(anchors, docHeightA, docHeightB, minGap = 150) {
  const boundariesA = [0];
  const boundariesB = [0];
  const kept = [];
  for (const anchor of anchors) {
    const cutA = anchor.a.leafTop;
    const cutB = anchor.b.leafTop;
    if (cutA - boundariesA[boundariesA.length - 1] < minGap || cutB - boundariesB[boundariesB.length - 1] < minGap) continue;
    if (docHeightA - cutA < minGap || docHeightB - cutB < minGap) continue;
    boundariesA.push(cutA);
    boundariesB.push(cutB);
    kept.push(anchor);
  }
  boundariesA.push(docHeightA);
  boundariesB.push(docHeightB);
  return { bA: boundariesA, bB: boundariesB, anchors: kept };
}

// If no heading anchors can be matched, split both pages at the same
// proportional positions. The report marks this less precise mode explicitly.
function fallbackBoundaries(docHeightA, docHeightB, step = 1400) {
  const count = Math.min(MAX_FALLBACK_SLICES, Math.max(2, Math.round(Math.max(docHeightA, docHeightB) / step)));
  const boundariesA = [];
  const boundariesB = [];
  for (let i = 0; i <= count; i++) {
    boundariesA.push(Math.round((docHeightA * i) / count));
    boundariesB.push(Math.round((docHeightB * i) / count));
  }
  return { bA: boundariesA, bB: boundariesB, anchors: [] };
}

// Drop interior cut pairs that leave either side without a content leaf.
function ensureNonEmpty(boundariesA, boundariesB, anchors, leavesA, leavesB) {
  const countIn = (leaves, y0, y1) => leaves.filter((rect) => {
    const center = rect.y + rect.h / 2;
    return center >= y0 && center < y1;
  }).length;

  // At most every interior cut can be removed. Derive the guard from the
  // input instead of stopping after an arbitrary number, which left empty
  // slices on very long proportional fallbacks.
  const maxDrops = Math.max(0, Math.min(boundariesA.length, boundariesB.length) - 2);
  for (let guard = 0; guard < maxDrops; guard++) {
    let dropped = false;
    for (let index = 0; index + 1 < boundariesA.length; index++) {
      if (countIn(leavesA, boundariesA[index], boundariesA[index + 1]) === 0 || countIn(leavesB, boundariesB[index], boundariesB[index + 1]) === 0) {
        const cut = index > 0 ? index : 1;
        boundariesA.splice(cut, 1);
        boundariesB.splice(cut, 1);
        anchors.splice(cut - 1, 1);
        dropped = true;
        break;
      }
    }
    if (!dropped) break;
  }
  return { bA: boundariesA, bB: boundariesB, anchors };
}

// Informational content similarity shown in the report. Slices are already
// aligned by their shared anchors before this score is calculated.
function similarity(a, b) {
  const parts = [];
  const headingScore = jaccard(tokens(a.headings.map((heading) => heading.t).join(' ')), tokens(b.headings.map((heading) => heading.t).join(' ')));
  if (headingScore !== null) parts.push([0.45, headingScore]);
  const textScore = jaccard(tokens(a.lines.slice(0, 60).join(' ')), tokens(b.lines.slice(0, 60).join(' ')));
  if (textScore !== null) parts.push([0.35, textScore]);
  const altScore = jaccard(tokens(a.alts.join(' ')), tokens(b.alts.join(' ')));
  if (altScore !== null) parts.push([0.10, altScore]);
  const ctaScore = jaccard(tokens(a.ctas.join(' ')), tokens(b.ctas.join(' ')));
  if (ctaScore !== null) parts.push([0.10, ctaScore]);
  if (!parts.length) return 0;
  const weight = parts.reduce((sum, [partWeight]) => sum + partWeight, 0);
  return parts.reduce((sum, [partWeight, score]) => sum + partWeight * score, 0) / weight;
}

// Loosely align floating UI by its text/class fingerprint and tag. Findings
// focus on elements present on only one page.
function alignFloats(floatsA, floatsB) {
  const usedB = new Set();
  const pairs = [];
  const onlyA = [];
  for (const floatA of floatsA) {
    let best = -1;
    let bestScore = 0;
    floatsB.forEach((floatB, index) => {
      if (usedB.has(index)) return;
      let score = jaccard(tokens(`${floatA.text} ${floatA.cls}`), tokens(`${floatB.text} ${floatB.cls}`)) ?? 0;
      if (floatA.tag === floatB.tag) score += 0.1;
      if (floatA.hasImg && floatB.hasImg) score += 0.1;
      const widthScale = Math.max(1, floatA.rect.w, floatB.rect.w);
      const heightScale = Math.max(1, floatA.rect.h, floatB.rect.h);
      const similarlySized = Math.abs(floatA.rect.w - floatB.rect.w) / widthScale <= 0.1
        && Math.abs(floatA.rect.h - floatB.rect.h) / heightScale <= 0.1;
      if (similarlySized) score += 0.15;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    if (best >= 0 && bestScore >= 0.3) {
      usedB.add(best);
      pairs.push({ a: floatA, b: floatsB[best] });
    } else {
      onlyA.push(floatA);
    }
  }
  const onlyB = floatsB.filter((_, index) => !usedB.has(index));
  return { pairs, onlyA, onlyB };
}

module.exports = {
  matchAnchors,
  buildBoundaries,
  fallbackBoundaries,
  ensureNonEmpty,
  similarity,
  alignFloats,
  tokens,
  jaccard,
  MAX_FALLBACK_SLICES,
};
