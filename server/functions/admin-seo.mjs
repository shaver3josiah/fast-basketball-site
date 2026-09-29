// /api/admin-seo: the Search section of the Traffic tab. Session-gated.
//   GET                                       -> the latest research report, the titles already
//                                                put in the draft, and whether a run is queued
//   POST {action:'run'}                       -> queue a research run (the Firestore-triggered
//                                                function does it; minutes, not seconds)
//   POST {action:'apply', path, title, description} -> put a title and description in the
//                                                content DRAFT; live only when Blake publishes
//   POST {action:'remove', path}              -> take one back out of the draft
//
// "Apply" never touches the live site. It writes content.seo[path] into the same draft every
// admin edit goes to, and render.mjs buildHead reads it at the next publish. The proposal is
// re-checked against the site's rules HERE, whatever the page sent, because a request can say
// anything.
import { randomUUID } from 'node:crypto';
import { verifyRequestSession } from './lib/auth.mjs';
import { json } from './lib/stripe.mjs';
import { getFile, putFile } from './lib/store.mjs';
import { getDraft, putDraft, usesDraft } from './lib/draft.mjs';
import { checkProposal } from './lib/seo.mjs';
import { getSeo, putSeo, cityOf, runResearch } from './lib/seo-research.mjs';
import { accountEmail } from './lib/searchconsole.mjs';

const CONTENT_PATH = 'src/data/content.json';
// A queued run costs a few Claude requests with web search; one per quarter hour is plenty.
const RUN_EVERY_MS = 15 * 60 * 1000;
const PATH_RE = /^\/[a-z0-9/_-]{0,120}$/;

async function readContent() {
  const draft = usesDraft ? await getDraft(CONTENT_PATH) : null;
  return JSON.parse(draft || (await getFile(CONTENT_PATH)).content);
}
async function writeContent(content) {
  content.updated = new Date().toISOString();
  const body = JSON.stringify(content, null, 2) + '\n';
  if (usesDraft) return putDraft(CONTENT_PATH, body);
  const { sha } = await getFile(CONTENT_PATH);
  return putFile(CONTENT_PATH, body, 'admin: search title and description', sha);
}

export default (request) => handle(request, { now: Date.now() });

export async function handle(request, { now, run = runResearch } = {}) {
  if (!verifyRequestSession(request)) return json(401, { error: 'not authenticated' });

  if (request.method === 'GET') {
    const [report, queued, content] = await Promise.all([getSeo('latest'), getSeo('queued'), readContent().catch(() => ({}))]);
    return json(200, {
      report,
      applied: (content && content.seo) || {},
      queued: queued && !queued.doneAt ? queued : null,
      account: report?.sources?.searchConsole?.email || (await accountEmail())
    });
  }
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') return json(400, { error: 'invalid request body' });

  if (body.action === 'run') {
    const last = await getSeo('queued');
    if (last && now - Date.parse(last.at) < RUN_EVERY_MS) {
      return json(429, { error: 'Research ran or was asked for in the last 15 minutes. Try again shortly.', queued: last });
    }
    const q = { id: randomUUID(), at: new Date(now).toISOString(), doneAt: null };
    await putSeo('queued', q);
    if (process.env.FB_LOCAL === 'true') {
      // No Firestore trigger on a laptop: run it here, without drafts.
      await run({ now, reason: 'on demand (local)' });
      await putSeo('queued', { ...q, doneAt: new Date().toISOString() });
      return json(200, { queued: null, ran: true });
    }
    const { getStore } = await import('./lib/blobs.mjs');
    await (await getStore('seo-requests')).setJSON(q.id, q);
    return json(202, { queued: q });
  }

  if (body.action === 'apply' || body.action === 'remove') {
    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!PATH_RE.test(path)) return json(422, { error: 'That is not one of the site’s pages.' });
    const content = await readContent();
    const seo = content.seo && typeof content.seo === 'object' ? content.seo : {};
    if (body.action === 'remove') {
      delete seo[path];
    } else {
      const check = checkProposal(body, { city: cityOf(path) });
      if (!check.ok) return json(422, { error: 'Not saved: ' + check.problems.join('; ') + '.', problems: check.problems });
      seo[path] = { title: check.title, description: check.description, at: new Date(now).toISOString(), from: 'search research' };
    }
    content.seo = seo;
    await writeContent(content);
    return json(200, { applied: seo, draft: usesDraft });
  }

  return json(400, { error: 'unknown action' });
}
