const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const { diffFloatingUI } = require('../scripts/lib/capture.cjs');
const { floatFindings } = require('../scripts/lib/facts.cjs');
const { INJECT } = require('../scripts/lib/inject.cjs');
const { alignFloats } = require('../scripts/lib/pair.cjs');

const browserInstalled = existsSync(chromium.executablePath());

function fixedPage({ pageColor, controlColor, hiddenColor = 'orange', right }) {
  return `<!doctype html>
    <style>
      html, body { margin: 0; background: ${pageColor}; }
      main { height: 1200px; }
      .overlay { position: fixed; right: ${right}px; bottom: 24px; width: 64px; height: 64px; }
      .overlay button { width: 64px; height: 64px; border: 0; border-radius: 50%; background: ${controlColor}; }
      .overlay .icon { display: block; width: 18px; height: 18px; margin: auto; border-radius: 4px; background: white; }
      .overlay .hidden { visibility: hidden; width: 10px; height: 10px; background: ${hiddenColor}; }
    </style>
    <main><h1>Same content</h1></main>
    <div class="overlay"><button aria-label="Support"><span class="icon"></span><span class="hidden"></span></button></div>`;
}

async function outline(page, html) {
  await page.setContent(html);
  await page.evaluate(INJECT);
  return page.evaluate(() => window.__pcOutline());
}

test('isolated fixed UI capture excludes page chrome and detects nested control changes', { skip: !browserInstalled }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'pixel-compare-floating-test-'));
  const browser = await chromium.launch({ headless: true });

  try {
    const [pageA, pageB] = await Promise.all([
      browser.newPage({ viewport: { width: 400, height: 300 } }),
      browser.newPage({ viewport: { width: 400, height: 300 } }),
    ]);

    const noFixedA = '<style>body{background:red}body::before{content:"A";display:block;width:100px;height:100px;background:orange}</style>direct A';
    const noFixedB = '<style>body{background:blue}body::before{content:"B";display:block;width:100px;height:100px;background:purple}</style>direct B';
    const [emptyA, emptyB] = await Promise.all([outline(pageA, noFixedA), outline(pageB, noFixedB)]);
    assert.equal(emptyA.floats.length, 0);
    assert.equal(emptyB.floats.length, 0);
    const emptyShot = await diffFloatingUI(pageA, pageB, join(output, 'empty'), 1);
    assert.equal(emptyShot.diffPixels, 0);

    const [changedA, changedB] = await Promise.all([
      outline(pageA, fixedPage({ pageColor: 'red', controlColor: 'green', right: 26 })),
      outline(pageB, fixedPage({ pageColor: 'blue', controlColor: 'purple', right: 32 })),
    ]);
    assert.equal(changedA.floats.length, 1);
    assert.ok(changedA.floats[0].visual.some((entry) => entry.tag === 'button'));
    assert.ok(changedA.floats[0].visual.some((entry) => entry.tag === 'span'));

    const changedShot = await diffFloatingUI(pageA, pageB, join(output, 'changed'), 1);
    const changedFindings = floatFindings(
      alignFloats(changedA.floats, changedB.floats),
      { a: 'Reference', b: 'Candidate' },
      changedShot,
    );
    assert.ok(changedShot.diffPixels > 0);
    assert.ok(changedFindings.some((finding) => finding.type === 'floating-ui-pixels'));
    assert.ok(changedFindings.some((finding) => finding.type === 'floating-ui'));

    const identicalB = await outline(pageB, fixedPage({ pageColor: 'blue', controlColor: 'green', hiddenColor: 'purple', right: 26 }));
    const identicalShot = await diffFloatingUI(pageA, pageB, join(output, 'identical'), 1);
    assert.equal(identicalShot.diffPixels, 0);
    assert.deepEqual(
      floatFindings(
        alignFloats(changedA.floats, identicalB.floats),
        { a: 'Reference', b: 'Candidate' },
        identicalShot,
      ),
      [],
    );

    const canvasHtml = '<style>body{margin:0;background:#111}canvas{position:fixed;right:20px;bottom:20px;width:50px;height:50px}</style><canvas width="50" height="50"></canvas>';
    const [canvasA, canvasB] = await Promise.all([outline(pageA, canvasHtml), outline(pageB, canvasHtml)]);
    await pageA.evaluate(() => {
      const context = document.querySelector('canvas').getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 50, 50);
    });
    const canvasShot = await diffFloatingUI(pageA, pageB, join(output, 'canvas'), 1);
    assert.equal(canvasShot.variants.light.diffPixels, 0);
    assert.ok(canvasShot.variants.dark.diffPixels > 0);
    assert.equal(canvasShot.matte, 'dark');
    assert.ok(
      floatFindings(
        alignFloats(canvasA.floats, canvasB.floats),
        { a: 'Reference', b: 'Candidate' },
        canvasShot,
      ).some((finding) => finding.type === 'floating-ui-pixels'),
    );
  } finally {
    await browser.close();
    rmSync(output, { recursive: true, force: true });
  }
});
