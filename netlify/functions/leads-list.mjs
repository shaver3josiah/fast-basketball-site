import { verifyRequestSession } from './lib/auth.mjs';
import { listLeads } from './lib/leads.mjs';

export default async (request) => {
  if (!verifyRequestSession(request)) {
    return new Response(JSON.stringify({ error: 'not authenticated' }), { status: 401 });
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
  }

  const leads = await listLeads();
  leads.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  return new Response(JSON.stringify({ leads }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
