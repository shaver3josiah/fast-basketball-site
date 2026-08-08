// The element registry. One entry per thing you can drag onto the canvas.
//
// Each entry declares its `fields` AND its `render`. That colocation is the whole
// point: the build calls render(), the admin panel generates its inspector form from
// fields[], and neither can drift from the other because there is one object. The
// admin never hand-writes an input for a prop that isn't declared here, and a prop
// declared here is editable the moment it exists.
//
// Adding an element type is: add one entry. It appears in the toolbox automatically.

import { escapeHtml } from '../render.mjs';

// Every stored coordinate is a percentage of its section, and every stored font size
// is px measured at this design width. The compiler converts px to container-relative
// units against this number, which is what makes a canvas layout scale instead of
// shatter when the viewport is not 1440 wide.
export const DESIGN_WIDTH = 1440;

// Matching Wix Studio's defaults, because they are what anyone who has used a site
// builder already expects. Unlike Wix, nothing caps how many of these can exist.
export const BREAKPOINTS = [
  { id: 'desktop', label: 'Desktop', min: 1001, max: null },
  { id: 'tablet', label: 'Tablet', min: 751, max: 1000 },
  { id: 'mobile', label: 'Phone', min: 320, max: 750 }
];

export const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'];

// Named depths rather than a free-form shadow editor. Four presets a non-designer can
// choose between beat six numeric inputs they have to combine correctly, and these are
// the site's own shadow tokens, so canvas elements sit at the same depths as the rest
// of the page instead of inventing new ones.
export const SHADOWS = {
  none: undefined,
  soft: 'var(--shadow-hover)',
  card: 'var(--shadow-card)',
  lifted: 'var(--shadow-sheet)'
};

// A small curated icon set, inline. Bundling Lucide would mean a new dependency, a
// sprite build step and ~1400 icons to ship one whistle — for a basketball trainer's
// site these are the ones that actually get used. Adding another is one line here.
// Declared above ELEMENT_TYPES because the registry reads Object.keys(ICONS) while it
// is being built, which is module-evaluation time, not call time.
// ponytail: swap for a real icon package the day someone needs one that is not listed.
export const ICONS = {
  whistle: 'M3 12a6 6 0 1 0 12 0 6 6 0 0 0-12 0M15 9h6M15 12h4M9 12h.01',
  basketball: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  check: 'M4 12.5 9 17.5 20 6.5',
  star: 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M10 19h4M12 14v5',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  pin: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11M12 8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
  arrowRight: 'M4 12h15M13 6l6 6-6 6'
};

// Canvas elements reference the design system's own tokens rather than defining a
// parallel set. Change --fast-red in tokens.css and every canvas element using "Brand
// red" moves with it, which is the whole point of a brand kit.
export const FONT_FAMILIES = {
  display: { label: 'Display (Anton)', token: '--font-display' },
  condensed: { label: 'Condensed (Barlow Condensed)', token: '--font-eyebrow' },
  body: { label: 'Body (Barlow)', token: '--font-body' },
  numeric: { label: 'Numerals (Bebas Neue)', token: '--font-num' }
};

// The colour picker's named swatches. Raw hex is still allowed as an escape hatch,
// but a token is offered first so brand changes stay global.
export const THEME_COLORS = [
  { token: '--bone', label: 'White' },
  { token: '--chalk', label: 'Chalk' },
  { token: '--text-body-dark', label: 'Body grey' },
  { token: '--text-faint-dark', label: 'Faint grey' },
  { token: '--fast-red', label: 'Brand red' },
  { token: '--red-hot', label: 'Hot red' },
  { token: '--miami-teal', label: 'Miami teal' },
  { token: '--court-black', label: 'Court black' },
  { token: '--ink', label: 'Ink' },
  { token: '--ink-lift', label: 'Ink lift' }
];

// ---------------------------------------------------------------- field helpers

const f = {
  text: (name, label, extra = {}) => ({ name, label, kind: 'text', ...extra }),
  richline: (name, label, extra = {}) => ({ name, label, kind: 'richline', ...extra }),
  select: (name, label, options, extra = {}) => ({ name, label, kind: 'select', options, ...extra }),
  color: (name, label, extra = {}) => ({ name, label, kind: 'color', ...extra }),
  number: (name, label, extra = {}) => ({ name, label, kind: 'number', ...extra }),
  image: (name, label, extra = {}) => ({ name, label, kind: 'image', ...extra }),
  link: (name, label, extra = {}) => ({ name, label, kind: 'link', ...extra }),
  toggle: (name, label, extra = {}) => ({ name, label, kind: 'toggle', ...extra })
};

// A colour prop holds either a theme token name ("ink", "red") or a raw CSS colour.
// Token-first keeps the brand kit meaningful: change the token, every element that
// referenced it moves with it. A raw value is the escape hatch, not the default.
export function colorValue(v) {
  if (!v) return 'inherit';
  return /^--/.test(v) ? 'var(' + v + ')' : v;
}

// ---------------------------------------------------------------- element types

export const ELEMENT_TYPES = {
  text: {
    label: 'Text',
    icon: 'type',
    // Typography must be written onto the element that actually renders the text, not
    // onto the wrapper. base.css styles bare h1/h2/h3 (font-family, size, weight,
    // line-height, letter-spacing, text-transform), and a child's own rule always
    // beats a value inherited from its parent — so putting these on the wrapper meant
    // six of this type's ten inspector fields silently did nothing on any heading.
    // #id .cv-t is (1,1,0) and wins cleanly over base.css's (0,0,1) element selectors.
    cssScope: ' .cv-t',
    defaults: { content: 'New text', tag: 'p', fontSize: 24, weight: 400, align: 'left', color: '--chalk', family: 'body', lineHeight: 1.4, tracking: 0, transform: 'none' },
    fields: [
      f.richline('content', 'Text', { multiline: true }),
      f.select('tag', 'HTML tag', HEADING_TAGS, { help: 'Controls the page outline for search engines and screen readers, not the visible size.' }),
      f.select('family', 'Font', Object.keys(FONT_FAMILIES)),
      f.number('fontSize', 'Size', { unit: 'px', min: 8, max: 240 }),
      f.select('weight', 'Weight', [400, 500, 600, 700]),
      f.select('align', 'Align', ['left', 'center', 'right']),
      f.select('transform', 'Caps', ['none', 'uppercase', 'lowercase', 'capitalize']),
      f.number('lineHeight', 'Line height', { step: 0.05, min: 0.8, max: 2.4 }),
      f.number('tracking', 'Letter spacing', { unit: 'em', step: 0.005, min: -0.06, max: 0.4 }),
      f.color('color', 'Colour')
    ],
    render(props, ctx) {
      const tag = HEADING_TAGS.includes(props.tag) ? props.tag : 'p';
      // Line breaks the owner typed are meaningful; everything else is escaped.
      const body = escapeHtml(props.content || '').replace(/\n/g, '<br>');
      return '<' + tag + ' class="cv-t">' + body + '</' + tag + '>';
    },
    css(props, ctx) {
      const family = FONT_FAMILIES[props.family] || FONT_FAMILIES.body;
      return {
        'font-family': 'var(' + family.token + ')',
        'font-size': ctx.scalePx(props.fontSize || 24),
        'font-weight': String(props.weight || 400),
        'line-height': String(props.lineHeight || 1.4),
        'letter-spacing': (props.tracking || 0) + 'em',
        'text-align': props.align || 'left',
        'text-transform': props.transform || 'none',
        color: colorValue(props.color)
      };
    }
  },

  image: {
    label: 'Image',
    icon: 'image',
    // In the phone auto-stack a box goes to height:auto. An image would then have no
    // height of its own to fill, so it keeps the proportions it was drawn at instead.
    stackBehaviour: 'aspect',
    defaults: { key: null, alt: '', fit: 'cover', focalX: 50, focalY: 50, radius: 0, shadow: 'none', priority: false },
    fields: [
      f.image('key', 'Photo'),
      f.text('alt', 'Alt text', { required: true, help: 'Describes the photo for screen readers and search. Required — a photo without it cannot be saved.' }),
      f.select('fit', 'Fit', ['cover', 'contain']),
      f.number('focalX', 'Focal point across', { unit: '%', min: 0, max: 100 }),
      f.number('focalY', 'Focal point down', { unit: '%', min: 0, max: 100 }),
      f.number('radius', 'Corner radius', { unit: 'px', min: 0, max: 200 }),
      f.select('shadow', 'Shadow', Object.keys(SHADOWS)),
      // Every canvas image used to be lazy, including one sitting at the top of the
      // page. A lazy hero is a measurable LCP hit, because the browser waits to find
      // out it was needed all along. The hand-built homepage hero has always been
      // eager+high; this is the same control, made explicit.
      f.toggle('priority', 'Load immediately', { help: 'Turn on for a photo visible before scrolling. Leave off for everything below the fold.' })
    ],
    render(props, ctx) {
      const alt = escapeHtml(props.alt || '');
      const pic = ctx.renderImage(props.key, alt, { priority: !!props.priority });
      if (!pic) {
        // An element pointing at a deleted photo renders as a labelled placeholder
        // rather than a broken <img>, and the build logs it. Silent breakage on a
        // live page is worse than a visible gap the owner can find and fix.
        ctx.warn('image element references missing photo "' + props.key + '"');
        return '<div class="cv-img-missing" role="img" aria-label="' + alt + '">Photo not found</div>';
      }
      return pic;
    },
    css(props) {
      return {
        'border-radius': (props.radius || 0) + 'px',
        overflow: 'hidden',
        'box-shadow': SHADOWS[props.shadow] || undefined,
        '--cv-fit': props.fit || 'cover',
        '--cv-pos': (props.focalX ?? 50) + '% ' + (props.focalY ?? 50) + '%'
      };
    }
  },

  shape: {
    label: 'Shape',
    icon: 'square',
    // A shape renders no content at all, so height:auto collapses it to nothing and
    // the element silently vanishes on phones. It keeps its drawn height in pixels.
    stackBehaviour: 'fixed-height',
    defaults: { shape: 'rect', fill: '--fast-red', radius: 0, strokeWidth: 0, stroke: '--bone', opacity: 1, shadow: 'none' },
    fields: [
      f.select('shape', 'Shape', ['rect', 'ellipse', 'line']),
      f.color('fill', 'Fill'),
      f.number('radius', 'Corner radius', { unit: 'px', min: 0, max: 400 }),
      f.number('strokeWidth', 'Border width', { unit: 'px', min: 0, max: 40 }),
      f.color('stroke', 'Border colour'),
      f.number('opacity', 'Opacity', { step: 0.05, min: 0, max: 1 }),
      f.select('shadow', 'Shadow', Object.keys(SHADOWS))
    ],
    render() {
      return '';
    },
    css(props) {
      const out = {
        background: colorValue(props.fill),
        opacity: String(props.opacity ?? 1),
        'box-shadow': SHADOWS[props.shadow] || undefined
      };
      if (props.shape === 'ellipse') out['border-radius'] = '50%';
      else if (props.shape === 'line') { out.background = 'transparent'; out['border-top'] = (props.strokeWidth || 2) + 'px solid ' + colorValue(props.stroke); }
      else out['border-radius'] = (props.radius || 0) + 'px';
      if (props.shape !== 'line' && props.strokeWidth > 0) {
        out.border = props.strokeWidth + 'px solid ' + colorValue(props.stroke);
      }
      return out;
    }
  },

  icon: {
    label: 'Icon',
    icon: 'star',
    stackBehaviour: 'fixed-height',
    defaults: { name: 'basketball', color: '--fast-red', stroke: 2.2 },
    fields: [
      f.select('name', 'Icon', Object.keys(ICONS)),
      f.color('color', 'Colour'),
      f.number('stroke', 'Line weight', { step: 0.2, min: 0.5, max: 6 })
    ],
    render(props) {
      const path = ICONS[props.name] || ICONS.basketball;
      // currentColor so the CSS below is the single place the colour is decided.
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
        (Number(props.stroke) || 2.2) + '" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true" focusable="false"><path d="' + escapeHtml(path) + '"/></svg>';
    },
    css(props) {
      return { color: colorValue(props.color) };
    }
  },

  divider: {
    label: 'Divider',
    icon: 'minus',
    stackBehaviour: 'fixed-height',
    defaults: { color: '--line-dark', thickness: 1, style: 'solid' },
    fields: [
      f.color('color', 'Colour'),
      f.number('thickness', 'Thickness', { unit: 'px', min: 1, max: 12 }),
      f.select('style', 'Style', ['solid', 'dashed', 'dotted'])
    ],
    render() {
      return '';
    },
    css(props) {
      return {
        'border-top': (props.thickness || 1) + 'px ' + (props.style || 'solid') + ' ' + colorValue(props.color),
        background: 'transparent'
      };
    }
  },

  button: {
    label: 'Button',
    icon: 'mouse-pointer-click',
    // Same reason as text: .btn in base.css sets its own font-size (.74rem), which beat
    // the wrapper's inherited value and made the Size field inert.
    cssScope: ' .btn',
    defaults: { label: 'Book a session', href: '/contact', variant: 'primary', fontSize: 16, newTab: false },
    fields: [
      f.text('label', 'Button text', { required: true }),
      f.link('href', 'Goes to', { required: true }),
      f.select('variant', 'Style', ['primary', 'ghost']),
      f.number('fontSize', 'Size', { unit: 'px', min: 10, max: 48 }),
      f.toggle('newTab', 'Open in a new tab')
    ],
    render(props, ctx) {
      const href = escapeHtml(props.href || '#');
      const external = props.newTab || /^https?:\/\//.test(props.href || '');
      // rel is not optional on a target=_blank link: without noopener the opened page
      // gets a handle on this one via window.opener.
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      const cls = props.variant === 'ghost' ? 'btn btn-ghost' : 'btn btn-primary';
      return '<a class="' + cls + '" href="' + href + '"' + attrs + '>' + escapeHtml(props.label || '') + '</a>';
    },
    css(props, ctx) {
      return { 'font-size': ctx.scalePx(props.fontSize || 16) };
    }
  }
};

export function elementDefaults(type) {
  const def = ELEMENT_TYPES[type];
  if (!def) throw new Error('unknown element type "' + type + '"');
  return JSON.parse(JSON.stringify(def.defaults));
}

// Validation runs on save AND at build time. The build one is the guard that matters:
// a page that cannot render correctly should fail loudly at compile, not ship blank.
export function validateElement(el) {
  const errors = [];
  const def = ELEMENT_TYPES[el.type];
  if (!def) return ['unknown element type "' + el.type + '"'];
  for (const field of def.fields) {
    if (!field.required) continue;
    const v = el.props?.[field.name];
    if (v === undefined || v === null || String(v).trim() === '') {
      errors.push(el.type + ' element "' + (el.id || '?') + '" is missing ' + field.label);
    }
  }
  return errors;
}
