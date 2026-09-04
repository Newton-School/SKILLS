// Per-section screenshot capture, pixel diff, and difference localization.
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

const MAX_CAPTURE_HEIGHT_CSS_PX = 24000;

async function shotRange(page, rect, outPath) {
  let prepareAttempted = false;
  let primaryError;
  try {
    prepareAttempted = true;
    await page.evaluate(({ y0, y1 }) => window.__pcPrepRange(y0, y1), { y0: rect.y, y1: rect.y + rect.h });
    await page.waitForTimeout(120);
    const requestedHeight = Math.max(8, rect.h);
    const clip = {
      x: rect.x,
      y: rect.y,
      width: Math.max(8, rect.w),
      height: Math.min(requestedHeight, MAX_CAPTURE_HEIGHT_CSS_PX),
    };
    const buf = await page.screenshot({ fullPage: true, clip });
    if (outPath) writeFileSync(outPath, buf);
    return {
      buf,
      clip,
      requestedHeight,
      truncated: requestedHeight > clip.height,
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (prepareAttempted) {
      try {
        await page.evaluate(() => window.__pcRestore());
      } catch (restoreError) {
        if (!primaryError) throw restoreError;
      }
    }
  }
}

function crop(source, width, height) {
  if (source.width === width && source.height === height) return source;
  const output = new PNG({ width, height });
  PNG.bitblt(source, output, 0, 0, width, height, 0, 0);
  return output;
}

// Convert noisy pixel-level differences into a small set of horizontal bands.
function clustersFromMask(mask, dpr) {
  const { width, height, data } = mask;
  const rowCounts = new Array(height).fill(0);
  let total = 0;
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (data[((width * y + x) << 2) + 3] > 0) count += 1;
    }
    rowCounts[y] = count;
    total += count;
  }

  const rowThreshold = Math.max(6, Math.round(width * 0.02));
  const bands = [];
  let current = null;
  for (let y = 0; y < height; y++) {
    if (rowCounts[y] >= rowThreshold) {
      if (current && y - current.y1 <= 8) current.y1 = y;
      else {
        current = { y0: y, y1: y };
        bands.push(current);
      }
    }
  }

  for (const band of bands) {
    let pixels = 0;
    let x0 = width;
    let x1 = 0;
    for (let y = band.y0; y <= band.y1; y++) {
      for (let x = 0; x < width; x++) {
        if (data[((width * y + x) << 2) + 3] > 0) {
          pixels += 1;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      }
    }
    band.px = pixels;
    band.x0 = x0;
    band.x1 = x1;
  }
  bands.sort((a, b) => b.px - a.px);

  return {
    totalDiffPx: total,
    clusters: bands.slice(0, 8).map((band) => ({
      y0: Math.round(band.y0 / dpr),
      y1: Math.round((band.y1 + 1) / dpr),
      x0: Math.round(band.x0 / dpr),
      x1: Math.round((band.x1 + 1) / dpr),
      px: band.px,
      density: Math.round((band.px / Math.max(1, (band.y1 - band.y0 + 1) * (band.x1 - band.x0 + 1))) * 100) / 100,
    })),
  };
}

function montage(aPng, bPng, diffPng) {
  const separator = 4;
  const width = aPng.width + separator + bPng.width + separator + diffPng.width;
  const height = Math.max(aPng.height, bPng.height, diffPng.height);
  const output = new PNG({ width, height });
  output.data.fill(255);
  let x = 0;
  for (const png of [aPng, bPng, diffPng]) {
    PNG.bitblt(png, output, 0, 0, png.width, png.height, x, 0);
    x += png.width + separator;
  }
  return output;
}

// Rank inventory elements under a cluster by intersection over union.
function attribute(cluster, inventory) {
  const clusterArea = Math.max(1, (cluster.x1 - cluster.x0) * (cluster.y1 - cluster.y0));
  const scored = [];
  for (const element of inventory) {
    const overlapX = Math.min(element.x + element.w, cluster.x1) - Math.max(element.x, cluster.x0);
    const overlapY = Math.min(element.y + element.h, cluster.y1) - Math.max(element.y, cluster.y0);
    if (overlapX <= 0 || overlapY <= 0) continue;
    const overlap = overlapX * overlapY;
    scored.push([overlap / (element.w * element.h + clusterArea - overlap), element]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, 4).map(([, element]) => {
    if (element.role === 'text' || element.role === 'cta') {
      return `<${element.tag}> "${element.text || ''}" ${element.fontSize ? `${element.fontSize}px ${element.fontWeight || ''}` : ''} ${element.color || ''}`.replace(/\s+/g, ' ').trim();
    }
    if (element.role === 'img') return `<img alt="${element.alt || ''}" ${element.w}x${element.h}>`;
    if (element.role === 'decorated') return `<${element.tag}> bg:${element.bg || element.bgImg || '?'} ${element.w}x${element.h}`;
    return `<${element.tag}> ${element.w}x${element.h}`;
  });
}

async function diffSection(pageA, pageB, secA, secB, key, outDir, dpr) {
  const dir = join(outDir, key);
  mkdirSync(dir, { recursive: true });
  const shotA = await shotRange(pageA, secA.rect, join(dir, 'a.png'));
  const shotB = await shotRange(pageB, secB.rect, join(dir, 'b.png'));

  let a = PNG.sync.read(shotA.buf);
  let b = PNG.sync.read(shotB.buf);
  const cssDelta = {
    width: Math.round(secA.rect.w - secB.rect.w),
    height: Math.round(secA.rect.h - secB.rect.h),
  };
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  a = crop(a, width, height);
  b = crop(b, width, height);

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: 0.12,
    includeAA: false,
    alpha: 0.4,
  });
  const mask = new PNG({ width, height });
  pixelmatch(a.data, b.data, mask.data, width, height, {
    threshold: 0.12,
    includeAA: false,
    diffMask: true,
  });
  const { clusters } = clustersFromMask(mask, dpr);

  let selfChange = null;
  const ratio = diffPixels / (width * height);
  if (ratio > 0.01) {
    await pageA.waitForTimeout(1200);
    const secondA = await shotRange(pageA, secA.rect, null).catch(() => null);
    const secondB = await shotRange(pageB, secB.rect, null).catch(() => null);
    const selfDiff = (first, second) => {
      if (!first || !second) return null;
      let png1 = PNG.sync.read(first);
      let png2 = PNG.sync.read(second);
      const selfWidth = Math.min(png1.width, png2.width);
      const selfHeight = Math.min(png1.height, png2.height);
      png1 = crop(png1, selfWidth, selfHeight);
      png2 = crop(png2, selfWidth, selfHeight);
      const changed = pixelmatch(png1.data, png2.data, null, selfWidth, selfHeight, { threshold: 0.12, includeAA: false });
      return Math.round((changed / (selfWidth * selfHeight)) * 10000) / 10000;
    };
    selfChange = {
      a: selfDiff(shotA.buf, secondA?.buf),
      b: selfDiff(shotB.buf, secondB?.buf),
    };
  }

  for (const cluster of clusters) {
    cluster.elementsA = attribute(cluster, secA.inv);
    cluster.elementsB = attribute(cluster, secB.inv);
    const overlapsDynamic = [...secA.dynamics, ...secB.dynamics].some((dynamic) => dynamic.y < cluster.y1 && dynamic.y + dynamic.h > cluster.y0);
    if (overlapsDynamic) cluster.dynamicOverlap = true;
  }

  writeFileSync(join(dir, 'diff.png'), PNG.sync.write(diff));
  writeFileSync(join(dir, 'montage.png'), PNG.sync.write(montage(a, b, diff)));

  const captureTruncation = shotA.truncated || shotB.truncated
    ? {
        limitCssPx: MAX_CAPTURE_HEIGHT_CSS_PX,
        a: { requestedHeight: Math.round(shotA.requestedHeight), capturedHeight: Math.round(shotA.clip.height), truncated: shotA.truncated },
        b: { requestedHeight: Math.round(shotB.requestedHeight), capturedHeight: Math.round(shotB.clip.height), truncated: shotB.truncated },
      }
    : null;

  return {
    w: Math.round(width / dpr),
    h: Math.round(height / dpr),
    cssDelta,
    diffPixels,
    diffRatio: Math.round(ratio * 10000) / 10000,
    selfChange,
    captureTruncation,
    clusters,
  };
}

module.exports = {
  diffSection,
  shotRange,
  MAX_CAPTURE_HEIGHT_CSS_PX,
  _clustersFromMask: clustersFromMask,
  _montage: montage,
};
