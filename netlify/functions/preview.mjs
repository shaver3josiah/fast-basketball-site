import { verifyRequestSession } from './lib/auth.mjs';
import { loadData, loadSections, assembleHomepage } from '../../src/render.mjs';
import { renderCoachPage } from '../../src/lib/coach-page.mjs';
import { renderSuburbPage } from '../../src/lib/suburb-page.mjs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');

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
