// The script injected into both pages. It defines helpers only; the Node-side
// orchestrator calls them after page stabilization.
//
// __pcOutline()       Detect content leaves, headings, and floating elements.
// __pcRegroup(bounds) Build one fingerprinted section per shared slice.
// __pcPrepRange()     Prepare a slice for capture and hide overlay chrome.
// __pcRestore()       Restore elements hidden for capture.
//
// Shared heading anchors keep corresponding content aligned even when the two
// pages use different wrapper structures. Color values are normalized through
// canvas so equivalent CSS color syntaxes compare consistently.
const INJECT = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const vis = (e) => {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) <= 0.01) return false;
    const r = e.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const docRect = (e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };

  const cctx = document.createElement('canvas').getContext('2d');
  const normColor = (v) => {
    if (!v) return v;
    try {
      cctx.fillStyle = '#010203';
      cctx.fillStyle = v;
      const a = cctx.fillStyle;
      cctx.fillStyle = '#fefdfc';
      cctx.fillStyle = v;
      const b = cctx.fillStyle;
      return a === b ? a : v;
    } catch {
      return v;
    }
  };
  const TRANSPARENT = /^rgba\\(\\d+, \\d+, \\d+, 0\\)$/;
  const bgOf = (el) => {
    let current = el;
    while (current && current !== document.documentElement) {
      const color = normColor(getComputedStyle(current).backgroundColor);
      if (color && color !== 'transparent' && !TRANSPARENT.test(color)) return color;
      current = current.parentElement;
    }
    const body = normColor(getComputedStyle(document.body).backgroundColor);
    return body && body !== 'transparent' && !TRANSPARENT.test(body) ? body : '#ffffff';
  };

  const SKIP_TAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1 };
  const DYN_SEL = 'video, iframe, canvas, [class*="marquee" i], [class*="carousel" i], [class*="swiper" i], [class*="slick" i], [class*="lottie" i], [class*="ticker" i], [class*="slider" i]';

  const headStyle = (heading) => {
    const cs = getComputedStyle(heading);
    return {
      t: norm(heading.innerText).slice(0, 120),
      tag: heading.tagName.toLowerCase(),
      size: Math.round(parseFloat(cs.fontSize)),
      weight: cs.fontWeight,
      family: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(),
      color: normColor(cs.color),
    };
  };

  window.__pcOutline = () => {
    const leaves = [];
    const maxHeight = Math.max(1400, innerHeight * 1.6);
    const childrenOf = (element, depth = 0) => {
      const out = [];
      for (const child of element.children) {
        if (SKIP_TAG[child.tagName]) continue;
        if (depth < 6 && getComputedStyle(child).display === 'contents') {
          out.push(...childrenOf(child, depth + 1));
          continue;
        }
        if (vis(child) && child.getBoundingClientRect().height >= 24) out.push(child);
      }
      return out;
    };
    const explode = (element, depth) => {
      const height = element.getBoundingClientRect().height;
      const children = childrenOf(element);
      if (depth < 12 && children.length === 1 && children[0].getBoundingClientRect().height >= 0.85 * height) {
        return explode(children[0], depth + 1);
      }
      if (depth < 12 && height > maxHeight && children.length >= 2) {
        const coverage = children.reduce((sum, child) => sum + child.getBoundingClientRect().height, 0) / height;
        if (coverage > 0.55) {
          for (const child of children) explode(child, depth + 1);
          return;
        }
      }
      leaves.push(element);
    };
    explode(document.body, 0);

    const floats = [];
    const flow = [];
    for (const element of leaves) {
      const item = { el: element, r: docRect(element) };
      if (getComputedStyle(element).position === 'fixed') floats.push(item);
      else flow.push(item);
    }
    flow.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
    window.__pcFlow = flow;

    window.__pcFixedInfo = [];
    for (const element of document.querySelectorAll('*')) {
      const position = getComputedStyle(element).position;
      if (position === 'fixed' || position === 'sticky') {
        window.__pcFixedInfo.push({ el: element, r: docRect(element), kind: position });
      }
    }

    const headings = [];
    flow.forEach((item, leafIdx) => {
      const found = [];
      if (item.el.matches && item.el.matches('h1,h2,h3,h4,h5,h6')) found.push(item.el);
      found.push(...item.el.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      for (const heading of found) {
        if (!vis(heading)) continue;
        const style = headStyle(heading);
        if (!style.t) continue;
        headings.push({ ...style, y: docRect(heading).y, leafIdx, leafTop: item.r.y });
      }
    });

    const floatOut = floats.filter((item) => vis(item.el)).map((item) => ({
      rect: item.r,
      text: norm(item.el.innerText).slice(0, 100),
      cls: (typeof item.el.className === 'string' ? item.el.className : '').slice(0, 80),
      tag: item.el.tagName.toLowerCase(),
      hasImg: !!item.el.querySelector('img,svg'),
    }));

    return {
      meta: {
        url: location.href,
        title: document.title,
        docW: document.documentElement.scrollWidth,
        docH: document.documentElement.scrollHeight,
        vw: innerWidth,
        vh: innerHeight,
      },
      leaves: flow.map((item) => item.r),
      headings,
      floats: floatOut,
    };
  };

  window.__pcRegroup = (boundaries) => {
    const flow = window.__pcFlow || [];
    const query = (elements, selector) => {
      const out = [];
      for (const element of elements) {
        if (element.matches && element.matches(selector)) out.push(element);
        out.push(...element.querySelectorAll(selector));
      }
      return out;
    };

    const inventoryOf = (elements, offsetX, offsetY) => {
      const out = [];
      const all = elements.flatMap((element) => [element, ...element.querySelectorAll('*')]);
      for (const element of all) {
        if (out.length >= 250) break;
        if (element.ownerSVGElement || SKIP_TAG[element.tagName]) continue;
        if (!vis(element)) continue;

        const cs = getComputedStyle(element);
        const rect = docRect(element);
        const directText = norm([...element.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(' '));
        const tag = element.tagName.toLowerCase();
        let role;
        if (tag === 'img') role = 'img';
        else if (tag === 'svg') role = 'svg';
        else if (tag === 'video') role = 'video';
        else if (tag === 'iframe') role = 'iframe';
        else if (directText) role = 'text';
        else if (tag === 'a' || tag === 'button') role = 'cta';
        else {
          const backgroundColor = cs.backgroundColor;
          const decorated = cs.backgroundImage !== 'none'
            || (backgroundColor && backgroundColor !== 'transparent' && !TRANSPARENT.test(backgroundColor))
            || cs.boxShadow !== 'none'
            || parseFloat(cs.borderTopWidth) > 0;
          if (!decorated) continue;
          role = 'decorated';
        }

        const item = { tag, role, x: rect.x - offsetX, y: rect.y - offsetY, w: rect.w, h: rect.h };
        if (directText) {
          item.text = directText.slice(0, 60);
          item.fontSize = Math.round(parseFloat(cs.fontSize));
          item.fontWeight = cs.fontWeight;
          item.fontFamily = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
          item.color = normColor(cs.color);
        }
        if (role === 'img') {
          item.alt = norm(element.getAttribute('alt')).slice(0, 60);
          item.src = (element.currentSrc || element.src || '').slice(0, 140);
        }
        if (role === 'decorated') {
          item.bg = normColor(cs.backgroundColor);
          if (cs.backgroundImage !== 'none') item.bgImg = cs.backgroundImage.slice(0, 120);
        }
        out.push(item);
      }
      return out;
    };

    const sections = [];
    for (let index = 0; index + 1 < boundaries.length; index++) {
      const y0 = boundaries[index];
      const y1 = boundaries[index + 1];
      const members = flow.filter((item) => {
        const center = item.r.y + item.r.h / 2;
        return center >= y0 && center < y1;
      });
      const elements = members.map((item) => item.el);
      const rect = { x: 0, y: y0, w: innerWidth, h: y1 - y0 };
      const headings = query(elements, 'h1,h2,h3,h4,h5,h6').filter(vis).slice(0, 8).map(headStyle).filter((heading) => heading.t);
      const lines = elements.flatMap((element) => (element.innerText || '').split('\\n')).map(norm).filter(Boolean).slice(0, 220);
      const alts = query(elements, 'img').filter(vis).map((image) => norm(image.getAttribute('alt'))).filter(Boolean).slice(0, 20);
      const ctas = query(elements, 'a,button').filter(vis).map((cta) => norm(cta.innerText)).filter(Boolean).slice(0, 20);
      const imgCount = query(elements, 'img').filter(vis).length;
      const dynamics = query(elements, DYN_SEL).filter(vis).slice(0, 20).map((dynamic) => {
        const dynamicRect = docRect(dynamic);
        const cls = (typeof dynamic.className === 'string' ? dynamic.className : (dynamic.className && dynamic.className.baseVal) || '').slice(0, 60);
        return { kind: dynamic.tagName.toLowerCase(), cls, x: dynamicRect.x, y: dynamicRect.y - y0, w: dynamicRect.w, h: dynamicRect.h };
      });
      let animCount = 0;
      try {
        animCount = elements.reduce((count, element) => count + element.getAnimations({ subtree: true }).filter((animation) => {
          try {
            return animation.effect && animation.effect.getTiming().iterations === Infinity;
          } catch {
            return false;
          }
        }).length, 0);
      } catch {}
      const largest = members.reduce((current, item) => (item.r.w * item.r.h > current.area ? { area: item.r.w * item.r.h, element: item.el } : current), { area: 0, element: elements[0] || document.body });
      sections.push({
        i: index,
        rect,
        headings,
        lines,
        alts,
        ctas,
        imgCount,
        dynamics,
        animCount,
        bg: bgOf(largest.element),
        inv: inventoryOf(elements, 0, y0),
      });
    }
    return sections;
  };

  window.__pcPrepRange = (y0, y1) => {
    for (const video of document.querySelectorAll('video')) {
      try {
        video.pause();
        video.currentTime = 0;
      } catch {}
    }
    window.scrollTo(0, Math.max(0, y0));
    window.__pcHidden = window.__pcHidden || [];
    for (const { el, r, kind } of window.__pcFixedInfo || []) {
      const outside = r.y + r.h <= y0 || r.y >= y1;
      if ((kind === 'fixed' || outside) && el.style.visibility !== 'hidden') {
        window.__pcHidden.push([el, el.style.visibility]);
        el.style.visibility = 'hidden';
      }
    }
    return true;
  };

  window.__pcRestore = () => {
    for (const [element, visibility] of window.__pcHidden || []) element.style.visibility = visibility;
    window.__pcHidden = [];
  };
})()`;

module.exports = { INJECT };
