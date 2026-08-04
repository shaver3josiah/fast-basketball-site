import { verifyRequestSession } from './lib/auth.mjs';
import { getFile, putFile } from './lib/github.mjs';
import { validateContentShape } from '../../src/lib/content-schema.mjs';

const CONTENT_PATH = 'src/data/content.json';

async function maybeTriggerBuild() {
  const hook = process.env.NETLIFY_BUILD_HOOK_URL;
  if (!hook) return;
  try {
    await fetch(hook, { method: 'POST' });
  } catch (err) {
    console.error('build hook trigger failed', err.message);
  }
}

export default async (request) => {
  if (!verifyRequestSession(request)) {
    return new Response(JSON.stringify({ error: 'not authenticated' }), { status: 401 });
  }

  if (request.method === 'GET') {
    const { content } = await getFile(CONTENT_PATH);
    if (!content) return new Response(JSON.stringify({ error: 'content.json not found in repository' }), { status: 404 });
    return new Response(content, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return new Response(JSON.stringify({ error: 'invalid request body' }), { status: 400 });
    }

    const errors = validateContentShape(payload);
    if (errors.length > 0) {
      return new Response(JSON.stringify({ error: 'save rejected', details: errors }), { status: 422 });
    }

    payload.version = 1;
    payload.updated = new Date().toISOString();
    if (!Array.isArray(payload.resumeExtra)) payload.resumeExtra = [];

    const { sha } = await getFile(CONTENT_PATH);
    await putFile(CONTENT_PATH, JSON.stringify(payload, null, 2) + '\n', 'admin: update site content', sha);
    await maybeTriggerBuild();

    return new Response(JSON.stringify({ ok: true, updated: payload.updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
};
