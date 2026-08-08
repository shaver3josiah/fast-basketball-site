// Run: node src/lib/canvas-compile.test.mjs
//
// Guards the three promises that make free positioning safe to hand to a non-developer:
// coordinates stay relative, type sizes stay inside a readable band, and a section that
// nobody laid out for a phone still stacks in reading order with nothing collapsed.
// Break any one of these and the editor starts shipping broken phone layouts silently,
// which is the exact failure this whole design exists to avoid.

import assert from 'node:assert/strict';
import { compileSection, scalePx, readingOrder } from './canvas-compile.mjs';

const ctx = { scalePx, warn: () => {}, renderImage: () => '<img alt="">', legacy: () => '' };

const el = (id, type, box, props = {}, extra = {}) => ({ id, type, name: id, z: 1, props, box: { desktop: box, tablet: null, mobile: null }, ...extra });

// ---------------------------------------------------------------- scalePx

// A size must never resolve below readable or above absurd, whatever the container.
const floorOf = (px) => Number(scalePx(px).match(/clamp\((\d+)px/)[1]);
for (const px of [12, 16, 24, 48, 88, 200]) {
  const out = scalePx(px);
  const [, floor, , ceiling] = out.match(/clamp\((\d+)px, ([\d.]+)cqw, (\d+)px\)/);
  assert.ok(Number(floor) >= 14, px + 'px floor must stay legible, got ' + floor);
  assert.ok(Number(ceiling) >= Number(floor), px + 'px ceiling below its floor');
}
// Inside a phone the cqw term collapses, so the floor is the size the visitor reads.
assert.equal(floorOf(88), 44, 'display type shrinks hard on a phone');
assert.equal(floorOf(21), 17, 'a 21px lede must stay readable on a phone, not drop to 14');
assert.equal(floorOf(16), 14, 'small labels may sit at the 14px legibility floor');

// Monotonic: a bigger design size may never produce a smaller phone size, or the
// visual hierarchy inverts somewhere in the middle of the scale.
let previous = 0;
for (let px = 8; px <= 200; px++) {
  const floor = floorOf(px);
  assert.ok(floor >= previous, 'floor went backwards at ' + px + 'px: ' + previous + ' -> ' + floor);
  previous = floor;
}

// ---------------------------------------------------------------- reading order

// Down the page first, then across. Two boxes on the same visual row read left to right
// rather than being interleaved by a raw y-sort.
const rowA = el('a', 'text', { x: 60, y: 10, w: 20 });
const rowB = el('b', 'text', { x: 10, y: 12, w: 20 });
const below = el('c', 'text', { x: 10, y: 60, w: 20 });
assert.deepEqual(readingOrder([rowA, below, rowB]).map((e) => e.id), ['b', 'a', 'c']);

// ---------------------------------------------------------------- geometry is relative

const section = {
  id: 'sec', type: 'canvas', name: 'S', designHeight: 720,
  background: { kind: 'color', value: '--ink' },
  elements: [
    el('t', 'text', { x: 8, y: 26, w: 44, h: null }, { content: 'Hi', tag: 'h1', fontSize: 88 }),
    el('s', 'shape', { x: 8, y: 21, w: 5, h: 1.1 }, { shape: 'rect', fill: '--fast-red' }),
    el('i', 'image', { x: 56, y: 8, w: 36, h: 84 }, { key: 'hero.nets', alt: 'A photo' }),
    el('btn', 'button', { x: 8, y: 76, w: 26, h: null }, { label: 'Go', href: '/contact' })
  ]
};
const out = compileSection(section, ctx);
assert.equal(out.errors.length, 0, 'valid section must compile clean: ' + out.errors.join('; '));

// No absolute pixel geometry may reach the stylesheet — that is what makes a layout
// scale with the viewport instead of overlapping at every width nobody tested.
const desktopCss = out.css.split('@media')[0];
assert.ok(!/(left|top|width):\s*-?\d+px/.test(desktopCss), 'geometry must be relative, found px: ' + desktopCss);
assert.ok(/#t\{[^}]*left:8%/.test(out.css), 'element must position in percent');
assert.ok(/container-type:inline-size/.test(out.css), 'section must be a query container');

// ---------------------------------------------------------------- narrow auto-stack

// Each media query is emitted on its own line, so pull the exact line rather than
// regexing across the whole stylesheet — a `.+?` between the first `@media` and the
// last `}` happily spans two blocks and makes both of them look like one.
const block = (css, w) => {
  const open = '@media(max-width:' + w + 'px){';
  const line = css.split('\n').find((l) => l.startsWith(open));
  return line ? line.slice(open.length, -1) : '';
};

// The stack starts at TABLET, not phone. A canvas section's height comes from an
// aspect ratio and shrinks with the viewport, while its type is floored for
// legibility and does not — so between 751 and 1000px the content outgrows the box
// and elements overlap. This assertion is the regression guard for that exact bug.
const tablet = block(out.css, 1000);
assert.ok(/aspect-ratio:auto/.test(tablet), 'section must drop its canvas ratio at tablet');
assert.ok(/flex-direction:column/.test(tablet), 'section must become a column at tablet, not scale down');

// Reading order becomes flex order: image (y=8), shape (y=21), text (y=26), button (y=76).
for (const [id, order] of [['i', 1], ['s', 2], ['t', 3], ['btn', 4]]) {
  assert.ok(new RegExp('#' + id + '\\{[^}]*order:' + order + '\\b').test(tablet), '#' + id + ' should stack at order ' + order);
}

// Nothing may collapse. A shape renders no content, so height:auto would erase it;
// an image has no box to fill, so it must keep the proportions it was drawn at.
assert.ok(/#s\{[^}]*height:8px/.test(tablet), 'shape must keep a real height in the stack, got: ' + tablet);
assert.ok(/#i\{[^}]*aspect-ratio:[\d.]+\/[\d.]+/.test(tablet), 'image must keep its aspect in the stack');
assert.ok(/#t\{[^}]*height:auto/.test(tablet), 'text should size to its own content');

// Already stacked at tablet, so phone needs no second block of its own.
assert.equal(block(out.css, 750), '', 'phone should inherit the tablet stack, not repeat it');

// Rotation is dropped: rotated boxes in a narrow column overlap and clip.
const rotated = compileSection({ ...section, elements: [el('r', 'text', { x: 10, y: 10, w: 30, rot: 12 }, { content: 'x' })] }, ctx);
assert.ok(/rotate\(12deg\)/.test(rotated.css.split('@media')[0]), 'rotation applies on desktop');
assert.ok(/#r\{[^}]*transform:none/.test(block(rotated.css, 1000)), 'rotation must drop in the stack');

// ---------------------------------------------------------------- hand-laid-out breakpoints

// If the owner positioned a breakpoint themselves, the auto-stack must not overwrite it.
const handPhone = JSON.parse(JSON.stringify(section));
handPhone.elements[0].box.mobile = { x: 5, y: 5, w: 90, h: null };
const hp = compileSection(handPhone, ctx).css;
assert.ok(/#t\{left:5%/.test(block(hp, 750)), 'hand-set phone coordinates must survive');

// A hand-laid-out tablet keeps its canvas, and phone must then stack back out of it —
// otherwise a tablet layout would be inherited straight down onto a 375px screen.
const handTablet = JSON.parse(JSON.stringify(section));
handTablet.elements[0].box.tablet = { x: 4, y: 4, w: 92, h: null };
const ht = compileSection(handTablet, ctx).css;
assert.ok(/#t\{left:4%/.test(block(ht, 1000)), 'hand-set tablet coordinates must survive');
assert.ok(!/flex-direction:column/.test(block(ht, 1000)), 'a hand-laid-out tablet must stay a canvas');
assert.ok(/flex-direction:column/.test(block(ht, 750)), 'phone must stack out of a hand-laid-out tablet');

// ---------------------------------------------------------------- element vocabulary

// Every registered type must compile to something. A type that renders nothing AND
// styles nothing is a toolbox button that produces an invisible element.
import { ELEMENT_TYPES, SHADOWS, ICONS } from './canvas-schema.mjs';

for (const [type, def] of Object.entries(ELEMENT_TYPES)) {
  const box = { x: 10, y: 10, w: 20, h: def.stackBehaviour === 'auto' ? null : 10 };
  const probe = compileSection({
    id: 'probe', designHeight: 720,
    elements: [el('p1', type, box, JSON.parse(JSON.stringify(def.defaults)))]
  }, ctx);
  const errs = probe.errors.filter((e) => !/Alt text|Photo/.test(e));
  assert.equal(errs.length, 0, type + ' default element must compile clean: ' + errs.join('; '));
  const rule = probe.css.split('\n').find((l) => l.startsWith('#p1'));
  const renders = def.render(def.defaults, ctx);
  assert.ok(
    (renders && renders.length > 0) || /(background|border-top|color)/.test(rule || ''),
    type + ' must render markup or paint something; it does neither'
  );
}

// A shape with no content collapses in the stack unless it keeps a height AND a width.
const dividerStack = compileSection({
  id: 'ds', designHeight: 720,
  elements: [el('d1', 'divider', { x: 10, y: 40, w: 30, h: 0.3 }, { color: '--line-dark', thickness: 1, style: 'solid' })]
}, ctx);
const dsMobile = block(dividerStack.css, 1000);
assert.ok(/#d1\{[^}]*height:2px/.test(dsMobile), 'a divider must keep a visible height in the stack, got: ' + dsMobile);
assert.ok(/#d1\{[^}]*width:min\(100%/.test(dsMobile), 'a divider must keep its drawn width, not stretch edge to edge');

// Shadow presets must resolve to the site's own tokens, not invented values.
for (const [name, value] of Object.entries(SHADOWS)) {
  if (name === 'none') { assert.equal(value, undefined, 'none must emit no shadow'); continue; }
  assert.ok(/^var\(--shadow-/.test(value), name + ' must use a design-system shadow token, got ' + value);
}

// Icon paths must be real path data, or the icon renders as an empty box.
for (const [name, d] of Object.entries(ICONS)) {
  assert.ok(/^[Mm]/.test(d) && d.length > 8, 'icon "' + name + '" is not usable path data');
}

// ---------------------------------------------------------------- validation

// A required field left empty has to fail the build, not ship a broken page.
const bad = compileSection({ ...section, elements: [el('x', 'image', { x: 0, y: 0, w: 10, h: 10 }, { key: 'k', alt: '' })] }, ctx);
assert.ok(bad.errors.some((e) => /Alt text/.test(e)), 'missing alt text must be an error');

console.log('canvas-compile: ok');
