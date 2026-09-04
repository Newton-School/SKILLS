// Page loading and stabilization. The page is progressively scrolled to load
// lazy content before motion is frozen, fonts are awaited, and videos are reset.
const { INJECT } = require('./inject.cjs');

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const FREEZE_CSS = '*{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important} ::-webkit-scrollbar{display:none}';
const NAVIGATION_TIMEOUT_MS = 90000;
const LOAD_SETTLE_TIMEOUT_MS = 10000;
const SETTLE_SCROLL_TIMEOUT_MS = 20000;
const SETTLE_SCROLL_MAX_STEPS = 1200;
const FONT_TIMEOUT_MS = 8000;

function contextOptions(vp) {
  const mobile = vp < 700;
  return mobile
    ? { viewport: { width: vp, height: 844 }, isMobile: true, deviceScaleFactor: 2, userAgent: MOBILE_UA }
    : { viewport: { width: vp, height: 1000 }, deviceScaleFactor: 1 };
}

async function settleLazyContent(page) {
  await page.evaluate(async ({ maxDurationMs, maxSteps }) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const startedAt = Date.now();
    let y = 0;
    let steps = 0;

    try {
      while (steps < maxSteps && Date.now() - startedAt < maxDurationMs) {
        window.scrollTo(0, y);
        await wait(35);
        steps += 1;

        const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        if (y >= Math.max(0, height - innerHeight)) break;
        y += 450;
      }
    } finally {
      window.scrollTo(0, 0);
    }
    await wait(400);
  }, { maxDurationMs: SETTLE_SCROLL_TIMEOUT_MS, maxSteps: SETTLE_SCROLL_MAX_STEPS });
}

async function waitForFonts(page) {
  await page.evaluate(async (timeoutMs) => {
    if (!document.fonts || !document.fonts.ready) return;
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }, FONT_TIMEOUT_MS).catch(() => {});
}

// Returns an open context and page. If setup fails before that handoff, the
// context is closed here so callers never have to recover a partially opened page.
async function openAndSettle(browser, url, vp) {
  const opts = contextOptions(vp);
  const ctx = await browser.newContext(opts);

  try {
    const page = await ctx.newPage();
    await page.addInitScript(INJECT);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState('load', { timeout: LOAD_SETTLE_TIMEOUT_MS }).catch(() => {});

    await settleLazyContent(page);
    await page.addStyleTag({ content: FREEZE_CSS });
    await waitForFonts(page);
    await page.evaluate(() => {
      for (const video of document.querySelectorAll('video')) {
        try {
          video.pause();
          video.currentTime = 0;
        } catch {}
      }
    });
    await page.waitForTimeout(350);
    return { ctx, page, dpr: opts.deviceScaleFactor };
  } catch (error) {
    await ctx.close().catch(() => {});
    throw error;
  }
}

module.exports = {
  contextOptions,
  openAndSettle,
  settleLazyContent,
  waitForFonts,
  MOBILE_UA,
  IPHONE_UA: MOBILE_UA,
  NAVIGATION_TIMEOUT_MS,
  LOAD_SETTLE_TIMEOUT_MS,
  SETTLE_SCROLL_TIMEOUT_MS,
  FONT_TIMEOUT_MS,
};
