import { fileURLToPath } from 'node:url';
import { verifyRequestSession } from './lib/auth.mjs';
import { loadData, loadSections, assembleHomepage } from '../../src/render.mjs';
import { renderCoachPage } from '../../src/lib/coach-page.mjs';
import { renderSuburbPage } from '../../src/lib/suburb-page.mjs';

// fileURLToPath, not .pathname. A file:// URL is percent-encoded, so any space in the
// checkout path survives as %20 and every read under ROOT fails with ENOENT — which is
// exactly what happened on a machine with a project folder called "Fast Basketball".
// fileURLToPath decodes and handles the Windows drive letter, which the hand-rolled
// regex this replaces did not.
// Exported only so preview.test.mjs can assert it resolves to a real directory. That
// assertion is the whole regression guard: it fails on any checkout path containing a
// space if this ever goes back to string-slicing a URL.
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export default async (request) => {
  if (!verifyRequestSession(request)) {
    return new Response('not authenticated', { status: 401 });
  }
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return new Response('invalid request body', { status: 400 });
  }

  const data = loadData(ROOT);
  const { sections, prelude } = loadSections(ROOT);

  const draftContent = {
    ...data.content,
    text: { ...data.content.text, ...(payload.text || {}) }
  };

  let html;
  if (payload.page === 'coach') {
    html = renderCoachPage({ content: draftContent, responsiveManifest: data.responsiveManifest, prelude });
  } else if (payload.page === 'suburb' && payload.slug) {
    const suburb = data.suburbs.find((s) => s.slug === payload.slug);
    if (!suburb) return new Response('unknown suburb slug', { status: 404 });
    html = renderSuburbPage({ suburb, content: draftContent, prelude });
  } else {
    html = assembleHomepage({ sections, prelude, content: draftContent, responsiveManifest: data.responsiveManifest, playbookTemplates: data.playbookTemplates });
  }

  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
};
