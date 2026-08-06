// Turns canvas sections into static HTML and static CSS. Nothing here ships to the
// browser as JavaScript — the output is the same kind of page the site already serves.
//
// The responsive guarantee lives in this file. Three things make free positioning
// survivable, and all three are compiler behaviour rather than editor discipline:
//
//   1. Every coordinate is a PERCENTAGE of its section, so a layout scales with the
//      viewport instead of sitting at fixed pixels and overlapping.
//   2. Every font size is emitted as clamp(floor, Ncqw, ceiling). It scales with the
//      container, and it can never scale below readable or above absurd.
//   3. Below the phone breakpoint a section stops being a canvas and becomes a flow
//      column, in reading order, unless the owner explicitly laid out that breakpoint.
//      This is the default, so a broken phone layout is not something you can inherit
//      by forgetting to check. It is Wix's single loudest complaint, designed out.

import { escapeHtml } from '../render.mjs';
import { ELEMENT_TYPES, DESIGN_WIDTH, colorValue, validateElement } from './canvas-schema.mjs';

const TABLET_MAX = 1000;
const MOBILE_MAX = 750;

// A font size scales with its container, bounded at both ends. The ceiling stops it
// ballooning on an ultrawide monitor; the floor does far more work than it looks.
//
// Inside a 375px phone the container is ~335px, so 1cqw is 3.35px and the cqw term
// collapses to single digits for everything. The floor IS the phone size. So it is
// picked as "what should this actually be on a phone", not as a flat fraction:
//
//   Body copy barely shrinks — a 21px lede wants ~17px on a phone, not 10px. Anything
//   in body range is held at 14-20px, which keeps it readable.
//   Display type shrinks hard — an 88px headline wants ~44px, because a phone is not
//   a billboard and 88px would be four words to a line.
//
// A flat 0.5 multiplier floored the lede at 14px, which is small enough to be a
// readability complaint rather than a design choice. The curve is monotonic: a bigger
// design size never produces a smaller phone size.
export function scalePx(px) {
  const n = Number(px) || 16;
  const cqw = (n / DESIGN_WIDTH) * 100;
  const floor = n <= 32
    ? Math.max(14, Math.min(Math.round(n * 0.8), 20))
    : Math.max(20, Math.round(n * 0.5));
  const ceiling = Math.round(n * 1.15);
  return 'clamp(' + floor + 'px, ' + cqw.toFixed(3) + 'cqw, ' + ceiling + 'px)';
}

function declBlock(selector, decls) {
  const body = Object.entries(decls)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => k + ':' + v)
    .join(';');
  return body ? selector + '{' + body + '}' : '';
}

function boxDecls(box) {
  const out = {
    left: box.x + '%',
    top: box.y + '%',
    width: box.w + '%'
  };
  // h omitted means "as tall as the content needs", which is what text almost always
  // wants. Forcing a height on text is how you get clipped descenders.
  if (box.h !== undefined && box.h !== null && box.h !== 'auto') out.height = box.h + '%';
  if (box.rot) out.transform = 'rotate(' + box.rot + 'deg)';
  return out;
}

// Reading order: down the page first, then across. Two elements on the same visual
// row (within 4% vertically) are ordered left to right, which is what a person means
// by "this row", rather than by a raw y-sort that would interleave them arbitrarily.
export function readingOrder(elements) {
  return [...elements].sort((a, b) => {
    const ay = a.box.desktop.y;
    const by = b.box.desktop.y;
    if (Math.abs(ay - by) > 4) return ay - by;
    return a.box.desktop.x - b.box.desktop.x;
  });
}

// What an element's height becomes once the section stops being a canvas.
//
// Text and buttons carry their own content, so height:auto is right. The other two
// do not, and height:auto makes them disappear: a shape renders nothing at all, and
// an image has no box to fill. Each keeps a height derived from how it was drawn.
function stackSize(el, designHeight) {
  const def = ELEMENT_TYPES[el.type];
  const box = el.box.desktop;
  const behaviour = def?.stackBehaviour || 'auto';

  if (behaviour === 'fixed-height' && box.h) {
    // Width comes back too, because the stack's blanket width:100% turns a 5%-wide
    // accent rule into a full-width red slab across the phone layout. A decorative
    // shape was drawn at a deliberate size; keep its proportions and let it cap at the
    // column rather than stretching edge to edge.
    return {
      width: 'min(100%, ' + Math.round((box.w / 100) * DESIGN_WIDTH) + 'px)',
      height: Math.max(2, Math.round((box.h / 100) * designHeight)) + 'px'
    };
  }
  if (behaviour === 'aspect' && box.h && box.w) {
    const w = (box.w / 100) * DESIGN_WIDTH;
    const h = (box.h / 100) * designHeight;
    return { height: 'auto', 'aspect-ratio': w.toFixed(1) + '/' + h.toFixed(1) };
  }
  return { height: 'auto' };
}

function sectionBackground(section) {
  const bg = section.background;
  if (!bg) return {};
  if (bg.kind === 'color') return { background: colorValue(bg.value) };
  if (bg.kind === 'image' && bg.src) {
    return {
      'background-image': 'url("' + bg.src + '")',
      'background-size': 'cover',
      'background-position': (bg.focalX ?? 50) + '% ' + (bg.focalY ?? 50) + '%'
    };
  }
  return {};
}

export function compileSection(section, ctx) {
  const errors = [];
  const css = [];
  const secSel = '#' + section.id;
  const elements = (section.elements || []).filter((el) => !el.deleted);

  // ---- section box
  const ratio = section.aspect || (DESIGN_WIDTH + '/' + (section.designHeight || 720));
  css.push(declBlock(secSel, {
    position: 'relative',
    'container-type': 'inline-size',
    'aspect-ratio': ratio,
    ...sectionBackground(section)
  }));

  // ---- elements
  let html = '';
  for (const el of elements) {
    const def = ELEMENT_TYPES[el.type];
    if (!def) { errors.push('section "' + section.id + '": unknown element type "' + el.type + '"'); continue; }
    errors.push(...validateElement(el));

    const sel = '#' + el.id;
    const inner = def.render(el.props || {}, ctx) || '';
    html += '<div class="cv-el cv-' + el.type + '" id="' + el.id + '">' + inner + '</div>\n';

    // Geometry belongs to the wrapper; appearance belongs to whatever actually renders
    // it. A type with a cssScope writes its style onto the child (#id .cv-t, #id .btn)
    // because base.css styles those elements directly, and a child's own declaration
    // always beats a value inherited from its parent. Without the split, every
    // typographic field on a heading or a button was a control that did nothing.
    const geometry = {
      position: 'absolute',
      ...boxDecls(el.box.desktop),
      'z-index': String(el.z ?? 1)
    };
    const appearance = def.css ? def.css(el.props || {}, ctx) : {};

    if (def.cssScope) {
      css.push(declBlock(sel, geometry));
      css.push(declBlock(sel + def.cssScope, appearance));
    } else {
      css.push(declBlock(sel, { ...geometry, ...appearance }));
    }
    if (el.hidden?.desktop) css.push(declBlock(sel, { display: 'none' }));
  }

  // ---- narrow breakpoints
  //
  // A canvas section cannot just be scaled down. Its height comes from an aspect ratio,
  // so it halves as the viewport halves — but font sizes are floored so they stay
  // readable, and so the text does NOT halve with it. Somewhere below 1000px the
  // content outgrows the box and elements land on top of each other. That is not a
  // tuning problem: proportional geometry and clamped type are incompatible by
  // construction, and one of them has to give.
  //
  // So the canvas is a desktop surface, and anything narrower auto-stacks unless the
  // owner laid that breakpoint out by hand. Wix Studio reaches the same conclusion from
  // the other direction — it gives tablet its own layout rather than scaling desktop
  // into it — except there you must do it yourself, and forgetting is the platform's
  // loudest complaint. Here forgetting is the safe path.
  const designHeight = section.designHeight || 720;
  const tabletHandLaid = elements.some((el) => el.box.tablet);
  const mobileHandLaid = elements.some((el) => el.box.mobile);

  const stackRules = () => {
    const rules = [declBlock(secSel, {
      'aspect-ratio': 'auto',
      display: 'flex',
      'flex-direction': 'column',
      gap: 'var(--cv-stack-gap,20px)',
      padding: 'var(--cv-stack-pad,48px 20px)'
    })];
    readingOrder(elements).forEach((el, i) => {
      rules.push(declBlock('#' + el.id, {
        position: 'static',
        width: '100%',
        transform: 'none',
        order: String(i + 1),
        ...stackSize(el, designHeight)
      }));
    });
    return rules;
  };

  const emit = (maxWidth, rules) => {
    const body = rules.filter(Boolean).join('');
    if (body) css.push('@media(max-width:' + maxWidth + 'px){' + body + '}');
  };

  // Tablet and below.
  const tabletRules = tabletHandLaid
    ? elements.filter((el) => el.box.tablet).map((el) => declBlock('#' + el.id, boxDecls(el.box.tablet)))
    : stackRules();
  if (tabletHandLaid && section.tabletHeight) {
    tabletRules.push(declBlock(secSel, { 'aspect-ratio': DESIGN_WIDTH + '/' + section.tabletHeight }));
  }
  for (const el of elements) {
    if (el.hidden?.tablet) tabletRules.push(declBlock('#' + el.id, { display: 'none' }));
  }
  emit(TABLET_MAX, tabletRules);

  // Phone. Only needs a block of its own when it differs from what tablet already
  // emitted: a hand-laid-out phone layout, or a hand-laid-out tablet that phone has to
  // stack back out of.
  const mobileRules = [];
  if (mobileHandLaid) {
    for (const el of elements) {
      if (el.box.mobile) mobileRules.push(declBlock('#' + el.id, boxDecls(el.box.mobile)));
    }
    if (section.mobileHeight) mobileRules.push(declBlock(secSel, { 'aspect-ratio': '375/' + section.mobileHeight }));
  } else if (tabletHandLaid) {
    mobileRules.push(...stackRules());
  }
  for (const el of elements) {
    if (el.hidden?.mobile) mobileRules.push(declBlock('#' + el.id, { display: 'none' }));
  }
  emit(MOBILE_MAX, mobileRules);

  const attrs = ' class="cv-sec band"' +
    (section.name ? ' aria-label="' + escapeHtml(section.name) + '"' : '');
  const sectionHtml = '<section id="' + section.id + '"' + attrs + '>\n' + html + '</section>\n';

  return { html: sectionHtml, css: css.filter(Boolean).join('\n'), errors };
}

export function compilePage(page, ctx) {
  const parts = [];
  const css = [];
  const errors = [];
  for (const section of page.sections || []) {
    if (section.hidden) continue;
    if (section.type === 'legacy') { parts.push(ctx.legacy(section)); continue; }
    const out = compileSection(section, ctx);
    parts.push(out.html);
    css.push(out.css);
    errors.push(...out.errors);
  }
  return { html: parts.join('\n'), css: css.join('\n'), errors };
}
