// Compiles one section for the editor's canvas, using the SAME compiler the build
// uses. This is the whole reason the editor has no renderer of its own.
//
// Every visual editor has to solve preview fidelity, and the usual answers are bad:
// re-implement the renderer in the browser (two renderers, guaranteed to drift), or
// approximate it (the preview lies). Running the real compiler over an endpoint means
// what the owner drags is what the build will emit, because it is the same function.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyRequestSession } from './lib/auth.mjs';
import { isLocal } from './lib/store.mjs';
import { compileSection, scalePx } from '../../src/lib/canvas-compile.mjs';
import { renderImage } from '../../src/render.mjs';
import { validateSite } from '../../src/lib/site-schema.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});

function loadImageContext() {
  const root = process.cwd();
  const content = JSON.parse(readFileSync(resolve(root, 'src/data/content.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(root, 'src/data/responsive-manifest.json'), 'utf8'));
  return { content, manifest };
}

export default async (request) => {
  if (!verifyRequestSession(request)) return json({ error: 'not authenticated' }, 401);
  if (!isLocal) return json({ error: 'the canvas editor only runs locally for now' }, 503);
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let section;
  try {
    ({ section } = await request.json());
  } catch {
    return json({ error: 'invalid request body' }, 400);
  }
  if (!section || !section.id) return json({ error: 'no section supplied' }, 400);

  const { content, manifest } = loadImageContext();
  const warnings = [];
  const ctx = {
    scalePx,
    warn: (m) => warnings.push(m),
    legacy: () => '',
    renderImage: (key, alt, opts = {}) => {
      const image = content.images[key];
      if (!image || !manifest[key]) return null;
      const local = { images: { [key]: { ...image, alt: alt || image.alt } } };
      return renderImage(key, local, manifest, {
        loading: opts.priority ? 'eager' : 'lazy',
        fetchpriority: opts.priority ? 'high' : 'auto',
        sizes: '(max-width: 750px) 92vw, 45vw'
      });
    }
  };

  // Validation errors are returned rather than thrown. The editor is where a half-built
  // element legitimately exists — an image the owner has not written alt text for yet
  // is a warning to show in the inspector, not a reason to refuse to draw the canvas.
  // The BUILD is where the same errors are fatal. Same check, different consequence.
  const out = compileSection(section, ctx);

  // The same validator the save endpoint runs, on the same shape, reported live.
  // Dragging an element off the canvas edge renders perfectly well but fails
  // validateBox — so without this the owner only found out at Save, by which point the
  // offending element was off-screen and hard to find. Reusing the validator rather
  // than re-checking here is the point: one definition of "valid", two moments.
  const shapeErrors = validateSite({
    pages: [{ id: 'preview', path: '/preview', title: 'preview', sections: [section] }]
  }).filter((e) => !/^page "preview"/.test(e) || /element/.test(e));

  return json({
    html: out.html,
    css: out.css,
    errors: [...out.errors, ...shapeErrors],
    warnings
  });
};
