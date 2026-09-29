// Google Search Console, from inside the Cloud Function, with no key file.
//
// The function runs as a Google service account. Cloud Functions' metadata server hands that
// account an access token for whatever OAuth scope is asked for (the `scopes` query parameter
// is supported on Cloud Functions and Cloud Run), so nothing secret is stored here. What makes
// the token useful is one owner step: adding that account's email as a user on the Search
// Console property. Until then every call answers 403, which this module reports as "not
// connected" rather than as a failure, and the panel shows the email to add.
//
// Plain REST (webmasters v3), because the whole API used here is four calls.

const META = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default';
const API = 'https://www.googleapis.com/webmasters/v3';
// Read and write: the write half is only ever sitemaps.submit.
const SCOPE = 'https://www.googleapis.com/auth/webmasters';

export class NotConnected extends Error {
  constructor(message, email) { super(message); this.name = 'NotConnected'; this.email = email || null; }
}

async function meta(path, fetchImpl) {
  const res = await fetchImpl(META + path, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error('metadata ' + path + ' answered ' + res.status);
  return res;
}

/** The service account's email, the thing Blake adds in Search Console. Null off Google Cloud. */
export async function accountEmail(fetchImpl = fetch) {
  try { return (await (await meta('/email', fetchImpl)).text()).trim(); } catch { return null; }
}

async function token(fetchImpl) {
  try {
    const res = await meta('/token?scopes=' + encodeURIComponent(SCOPE), fetchImpl);
    return (await res.json()).access_token;
  } catch (err) {
    throw new NotConnected('Search Console can only be reached from the live site (' + err.message + ').');
  }
}

/** A tiny client. `fetchImpl` is a seam for the tests. */
export function searchConsole({ fetchImpl = fetch, siteHost = 'fast-basketball.com' } = {}) {
  let bearer = null;
  let site = null;

  async function call(method, path, body) {
    if (!bearer) bearer = await token(fetchImpl);
    const res = await fetchImpl(API + path, {
      method,
      headers: { Authorization: 'Bearer ' + bearer, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401 || res.status === 403) {
      throw new NotConnected('Search Console refused this account (' + res.status + '). Add it as a user on the property.', await accountEmail(fetchImpl));
    }
    if (!res.ok) throw new Error('Search Console ' + method + ' ' + path.split('?')[0] + ' answered ' + res.status + ': ' + (await res.text()).slice(0, 200));
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  return {
    /** The property this account can see: the domain property if there is one, else the URL one. */
    async property() {
      if (site) return site;
      const out = await call('GET', '/sites');
      const entries = (out && out.siteEntry) || [];
      const usable = entries.filter((e) => e.permissionLevel && e.permissionLevel !== 'siteUnverifiedUser');
      const pick = usable.find((e) => e.siteUrl === 'sc-domain:' + siteHost)
        || usable.find((e) => e.siteUrl === 'https://' + siteHost + '/')
        || usable.find((e) => e.siteUrl.includes(siteHost));
      if (!pick) throw new NotConnected('This account has no access to a Search Console property for ' + siteHost + ' yet.', await accountEmail(fetchImpl));
      site = pick.siteUrl;
      return site;
    },
    /** Search analytics rows for [page, query] between two YYYY-MM-DD dates. */
    async rows(startDate, endDate) {
      const p = await this.property();
      const out = await call('POST', '/sites/' + encodeURIComponent(p) + '/searchAnalytics/query', {
        startDate, endDate, dimensions: ['page', 'query'], rowLimit: 5000, type: 'web'
      });
      return (out && out.rows) || [];
    },
    /** Tell Google the sitemap is there (the authenticated replacement for the retired ping). */
    async submitSitemap(sitemapUrl) {
      const p = await this.property();
      await call('PUT', '/sites/' + encodeURIComponent(p) + '/sitemaps/' + encodeURIComponent(sitemapUrl));
      return p;
    }
  };
}
