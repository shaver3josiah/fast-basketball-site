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

// The Contents API (putFile, above) commits one file per call — N files would be N
// commits, and every commit triggers a production deploy. The Git Data API can build
// one commit out of any number of file changes, which is the whole point of staging
// media uploads instead of committing each one as it arrives.
export async function putFiles(files, message) {
  const { token, repo, branch } = config();
  const jsonHeaders = { ...headers(token), 'Content-Type': 'application/json' };

  // 1+2: where the branch is right now, and the tree its tip commit points at — the new
  // tree only has to describe what changed, not the whole repo.
  const refRes = await fetch(API_ROOT + '/repos/' + repo + '/git/ref/heads/' + branch, { headers: headers(token) });
  if (!refRes.ok) throw new Error('GitHub ref read failed: ' + refRes.status);
  const baseSha = (await refRes.json()).object.sha;

  const baseCommitRes = await fetch(API_ROOT + '/repos/' + repo + '/git/commits/' + baseSha, { headers: headers(token) });
  if (!baseCommitRes.ok) throw new Error('GitHub base commit read failed: ' + baseCommitRes.status);
  const baseTreeSha = (await baseCommitRes.json()).tree.sha;

  // 3: one blob per file that has content; a null content is a deletion and needs no blob.
  const tree = [];
  for (const file of files) {
    if (file.content === null) {
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const encoded = Buffer.isBuffer(file.content) ? file.content.toString('base64') : Buffer.from(file.content, 'utf8').toString('base64');
    const blobRes = await fetch(API_ROOT + '/repos/' + repo + '/git/blobs', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ content: encoded, encoding: 'base64' })
    });
    if (!blobRes.ok) throw new Error('GitHub blob create failed for ' + file.path + ': ' + blobRes.status);
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: (await blobRes.json()).sha });
  }

  // 4+5: one tree, one commit, covering every file in the batch.
  const treeRes = await fetch(API_ROOT + '/repos/' + repo + '/git/trees', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ base_tree: baseTreeSha, tree })
  });
  if (!treeRes.ok) throw new Error('GitHub tree create failed: ' + treeRes.status);
  const newTreeSha = (await treeRes.json()).sha;

  const commitRes = await fetch(API_ROOT + '/repos/' + repo + '/git/commits', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ message, tree: newTreeSha, parents: [baseSha] })
  });
  if (!commitRes.ok) throw new Error('GitHub commit create failed: ' + commitRes.status);
  const newCommitSha = (await commitRes.json()).sha;

  // 6: move the branch, without force. The new commit's parent is the baseSha read in
  // step 1, so this can only fail as a non-fast-forward — someone else published while
  // this batch was being assembled — which is exactly the conflict admin-publish.mjs
  // already knows how to report for a single file.
  const patchRes = await fetch(API_ROOT + '/repos/' + repo + '/git/refs/heads/' + branch, {
    method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ sha: newCommitSha })
  });
  if (!patchRes.ok) {
    const err = new Error('ref moved since this batch started: ' + patchRes.status);
    err.status = 409;
    throw err;
  }
  return patchRes.json();
}
