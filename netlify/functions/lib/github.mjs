const API_ROOT = 'https://api.github.com';

function config() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPO must be configured');
  return { token, repo, branch };
}

function headers(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'fast-basketball-admin'
  };
}

export async function getFile(path) {
  const { token, repo, branch } = config();
  const res = await fetch(API_ROOT + '/repos/' + repo + '/contents/' + path + '?ref=' + branch, { headers: headers(token) });
  if (res.status === 404) return { content: null, sha: null };
  if (!res.ok) throw new Error('GitHub read failed for ' + path + ': ' + res.status);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { content, sha: data.sha };
}

export async function putFile(path, content, message, sha) {
  const { token, repo, branch } = config();
  const encoded = Buffer.isBuffer(content) ? content.toString('base64') : Buffer.from(content, 'utf8').toString('base64');
  const body = {
    message,
    content: encoded,
    branch
  };
  if (sha) body.sha = sha;
  const res = await fetch(API_ROOT + '/repos/' + repo + '/contents/' + path, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('GitHub write failed for ' + path + ': ' + res.status + ' ' + text);
  }
  return res.json();
}
