// One storage interface, two backings.
//
// In production the admin panel's writes are commits to GitHub, which is what
// triggers the Netlify rebuild. On a laptop there is no token, no repo API and no
// deploy, so the same writes go straight to the working tree and the local dev
// server rebuilds in place.
//
// The point of the split is that netlify/functions/* never knows which one it is
// talking to. The same handler code runs in both places, so the local demo is
// exercising the real thing rather than a mock of it.
//
// Local mode is on when FB_LOCAL=true, which only scripts/dev-server.mjs sets.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import * as github from './github.mjs';

const LOCAL = process.env.FB_LOCAL === 'true';

// Functions run from the repo root in both Netlify and the dev server, so a
// repo-relative path resolves the same way in each.
function localPath(path) {
  return resolve(process.cwd(), path);
}

// GitHub hands back a blob sha for optimistic concurrency: you send it with a write
// and the API rejects the write if the file moved under you. Locally there is no
// such service, so hash the content and enforce the same contract by hand. Two admin
// tabs open on one laptop is a real way to lose an edit, and silently taking the
// last write is how it gets lost.
function localSha(body) {
  return createHash('sha256').update(body).digest('hex');
}

export async function getFile(path) {
  if (!LOCAL) return github.getFile(path);
  const full = localPath(path);
  if (!existsSync(full)) return { content: null, sha: null };
  const content = readFileSync(full, 'utf8');
  return { content, sha: localSha(content) };
}

export async function putFile(path, content, message, sha) {
  if (!LOCAL) return github.putFile(path, content, message, sha);

  const full = localPath(path);
  if (sha && existsSync(full)) {
    const current = localSha(readFileSync(full, 'utf8'));
    if (current !== sha) {
      const err = new Error('conflict: ' + path + ' changed since you loaded it');
      err.status = 409;
      throw err;
    }
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  console.log('[store] wrote ' + path + (message ? ' — ' + message : ''));
  return { local: true, path };
}

// Binary writes (photo uploads) take a Buffer. github.putFile already base64-encodes
// a Buffer; locally it just goes to disk as-is.
export async function putBinary(path, buffer, message) {
  if (!LOCAL) return github.putFile(path, buffer, message);
  const full = localPath(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, buffer);
  console.log('[store] wrote ' + path + ' (' + buffer.length + ' bytes)' + (message ? ' — ' + message : ''));
  return { local: true, path };
}

export const isLocal = LOCAL;
