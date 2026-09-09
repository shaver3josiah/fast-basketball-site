// One function serves every endpoint, and this maps the URL to the handler.
//
// Netlify gave each file in netlify/functions/ its own endpoint for free. Firebase bills
// and cold-starts per function, so twelve functions would be twelve cold starts and
// twelve sets of secrets to bind. One function with a router is cheaper, warmer, and the
// handlers themselves did not have to change: they are still
// (Request, context) => Response, which is what Netlify passed them too.
//
// Handlers load on demand so a checkout does not pay to parse the admin panel's seven
// modules. Node caches the module after the first hit, so a warm instance pays once.

const HANDLERS = {
  'admin-canvas-render': () => import('./functions/admin-canvas-render.mjs'),
  'admin-content': () => import('./functions/admin-content.mjs'),
  'admin-login': () => import('./functions/admin-login.mjs'),
  'admin-media': () => import('./functions/admin-media.mjs'),
  'admin-publish': () => import('./functions/admin-publish.mjs'),
  'admin-site': () => import('./functions/admin-site.mjs'),
  'admin-upload': () => import('./functions/admin-upload.mjs'),
  checkout: () => import('./functions/checkout.mjs'),
  contact: () => import('./functions/contact.mjs'),
  'leads-list': () => import('./functions/leads-list.mjs'),
  playbook: () => import('./functions/playbook.mjs'),
  preview: () => import('./functions/preview.mjs'),
  'stripe-webhook': () => import('./functions/stripe-webhook.mjs')
};

export const ENDPOINTS = Object.keys(HANDLERS);

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});

// The first path segment after /api/ names the handler. Anything deeper is the handler's
// own business: it gets the whole Request and can read the rest of the path itself.
export function endpointFrom(pathname) {
  const rest = pathname.replace(/^\/api\/?/, '');
  return rest.split('/')[0] || '';
}

export async function route(request, context) {
  const name = endpointFrom(new URL(request.url).pathname);
  const load = Object.hasOwn(HANDLERS, name) ? HANDLERS[name] : null;
  if (!load) return json(404, { error: 'no endpoint named "' + name + '"' });

  const mod = await load();
  if (typeof mod.default !== 'function') return json(500, { error: name + ' has no default export' });
  return mod.default(request, context);
}
