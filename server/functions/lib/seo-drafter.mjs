// Researched title and description drafts, written by Claude with live web search.
//
// One request per page: Claude searches the live results for the page's real searches (from
// Search Console) and the phrases people are typing now (autocomplete), looks at how the
// results it finds present themselves, and drafts a title and description for this page using
// only the facts given here. lib/seo.mjs checkProposal then judges the draft against the site's
// rules before anyone sees it, so this module never has the last word.
//
// Enabled by ANTHROPIC_API_KEY in functions/.env. Without it the weekly run still gathers and
// analyses every live source; it just does not draft.

// Only these facts may appear in a draft. They are the site's own standing facts (CLAUDE.md);
// the one gym, and no public price for the evaluation or the 1-on-1.
export const FACTS = [
  'Fast Basketball is Coach Blake Kingsley’s basketball training for players about 11 to 18.',
  'Every session happens at one place: the Salvation Army Fort Lauderdale Corps gym, 100 SW 9th Ave, Fort Lauderdale, FL.',
  'Families come from South Florida: Fort Lauderdale, Miami, Hollywood, Coral Springs, Parkland, Coconut Creek, Margate and Tamarac.',
  'Programs: group training memberships, private 1-on-1 training, and an evaluation session. Enrollment is online.',
  'Coach Blake coached on the staffs of the 2025 Horizon League champion Robert Morris Colonials and the 2024 NJCAA Region 16 champion Moberly Area Community College.'
].join('\n');

const SYSTEM = [
  'You write the search-result title and meta description for one page of the Fast Basketball website, fast-basketball.com.',
  'Base them on live evidence: use web search to see what currently ranks for the searches you are given, in the Fort Lauderdale area, and write something a parent choosing between those results would click.',
  'Use only the facts listed below. Never state a price, never say sessions happen anywhere but the one gym, never use superlatives nobody can check (best, #1, top-rated, guaranteed), never use a long dash, and never use the words watch, eye or next level.',
  'The title is 25 to 60 characters and ends with "| Fast Basketball". The description is 120 to 155 characters.',
  'If the page names a city, the title or description names that city.',
  'Finish with one JSON object and nothing after it: {"title": "...", "description": "...", "why": "one sentence on what the live results showed and why this wording"}.',
  '',
  'Facts:',
  FACTS
].join('\n');

function sourcesOf(content) {
  const seen = new Map();
  for (const block of content || []) {
    // Citations first: the pages Claude actually drew on.
    if (block.type === 'text' && Array.isArray(block.citations)) {
      for (const c of block.citations) if (c.url && !seen.has(c.url)) seen.set(c.url, c.title || c.url);
    }
  }
  for (const block of content || []) {
    // Then what the searches returned. An error result's content is an object, not a list.
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url && !seen.has(r.url)) seen.set(r.url, r.title || r.url);
    }
  }
  return [...seen].slice(0, 6).map(([url, title]) => ({ url, title }));
}

export function parseDraft(content) {
  const text = (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const end = text.lastIndexOf('}');
  const start = end >= 0 ? text.lastIndexOf('{', text.lastIndexOf('"title"')) : -1;
  if (start < 0 || end < start) throw new Error('no JSON in the answer');
  const d = JSON.parse(text.slice(start, end + 1));
  return { title: String(d.title || ''), description: String(d.description || ''), why: String(d.why || '').slice(0, 400) };
}

/**
 * A drafter for lib/seo-research.mjs, or null when no key is configured. `client` is a seam for
 * the tests; production builds the official SDK client lazily so nothing else pays for it.
 */
export async function claudeDrafter({ apiKey = process.env.ANTHROPIC_API_KEY, client = null, model = 'claude-opus-5' } = {}) {
  if (!client) {
    if (!apiKey) return null;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey, timeout: 180000 });
  }
  return async (page, { findings = [], queries = [], phrases = [] } = {}) => {
    const brief = [
      'Page: ' + page.url,
      page.city ? 'City this page is about: ' + page.city : '',
      'Current title: ' + page.title,
      'Current description: ' + page.description,
      queries.length ? 'Searches that showed this page (Search Console, last 28 days): ' + queries.slice(0, 6).map((q) => q.query + ' (' + q.impressions + ' views, position ' + Math.round(q.position) + ')').join('; ') : 'No Search Console data for this page yet.',
      phrases.length ? 'What people are typing right now (Google autocomplete): ' + phrases.slice(0, 6).join('; ') : '',
      findings.length ? 'What the data says is wrong now: ' + findings.map((f) => f.text).join(' ') : ''
    ].filter(Boolean).join('\n');

    const messages = [{ role: 'user', content: brief }];
    const params = {
      model,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      tools: [{
        type: 'web_search_20260209', name: 'web_search', max_uses: 4,
        user_location: { type: 'approximate', city: 'Fort Lauderdale', region: 'Florida', country: 'US', timezone: 'America/New_York' }
      }],
      // Server-side refusal fallback, on by default for this model: a declined request is
      // re-run on the fallback model inside the same call instead of simply stopping.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages
    };
    let response = await client.beta.messages.create(params);
    const seenContent = [...response.content];
    // A long search can pause the server-side loop; resending the paused turn resumes it.
    // Searches made before the pause still count as sources.
    for (let i = 0; response.stop_reason === 'pause_turn' && i < 4; i += 1) {
      messages.push({ role: 'assistant', content: response.content });
      response = await client.beta.messages.create({ ...params, messages });
      seenContent.push(...response.content);
    }
    if (response.stop_reason === 'refusal') throw new Error('the request was declined');
    const draft = parseDraft(response.content);
    return { ...draft, sources: sourcesOf(seenContent) };
  };
}
