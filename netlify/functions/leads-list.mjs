import { getStore } from '@netlify/blobs';
import { verifyRequestSession } from './lib/auth.mjs';

export default async (request) => {
  if (!verifyRequestSession(request)) {
    return new Response(JSON.stringify({ error: 'not authenticated' }), { status: 401 });
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
  }

  const store = getStore('leads');
  const { blobs } = await store.list();
  const leads = [];
  for (const blob of blobs) {
    const record = await store.get(blob.key, { type: 'json' });
    if (record) leads.push({ key: blob.key, ...record });
  }
  leads.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  return new Response(JSON.stringify({ leads }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
