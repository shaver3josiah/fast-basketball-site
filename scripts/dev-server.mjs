// The whole local demo: the site, the admin panel, and the admin API, on one port,
// with no Netlify account, no GitHub token and no CLI to install.
//
//   npm run dev
//
// What it does:
//   - serves dist/ as static files
//   - routes /.netlify/functions/<name> to netlify/functions/<name>.mjs, the same
//     handler code Netlify runs, with FB_LOCAL=true so writes land on disk instead
//     of becoming GitHub commits
//   - watches src/ and admin/, rebuilds on change, and live-reloads open tabs
//
// Deliberately zero-dependency (node: builtins only). The netlify CLI would do this
// too, at the cost of a 27-package install and a login, and it would still not give
// the local filesystem write path that makes the demo work offline.
//
// ponytail: fs.watch + a debounce, not chokidar. Swap it the day watching gets
// genuinely unreliable across platforms, not before.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch, existsSync } from 'node:fs';
import { resolve, join, extname, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIST = resolve(ROOT, 'dist');
const FUNCTIONS = resolve(ROOT, 'netlify/functions');
const PORT = Number(process.env.PORT || 8899);

// Dev-only credentials. Production reads the same names from the Netlify environment;
// these exist so the demo runs on a fresh clone with nothing configured.
process.env.FB_LOCAL = 'true';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'fastbasketball';
process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'local-dev-secret-not-for-production';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff'
};

// ---------------------------------------------------------------- live reload

const clients = new Set();

function notifyReload() {
  for (const res of clients) res.write('data: reload\n\n');
}

const RELOAD_SNIPPET = `<script>
(function(){
  var es = new EventSource('/__dev/reload');
  es.onmessage = function(){ location.reload(); };
  es.onerror = function(){ /* server restarting; EventSource retries on its own */ };
})();
</script>
`;

// ---------------------------------------------------------------- the build

let building = false;
let queued = false;

function runBuild(reason) {
  if (building) { queued = true; return; }
  building = true;
  const started = Date.now();
  console.log('\n[build] ' + reason);
  const child = spawn(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  child.stdout.on('data', (d) => { tail += d; });
  child.stderr.on('data', (d) => { tail += d; process.stderr.write(d); });
  child.on('close', (code) => {
    building = false;
    if (code === 0) {
      const summary = tail.split('\n').filter((l) => l.startsWith('Build complete')).join('');
      console.log('[build] ok in ' + (Date.now() - started) + 'ms. ' + summary);
      notifyReload();
    } else {
      // Leave the last good dist/ in place. A broken build should not blank the
      // preview the owner is looking at; it should say so and keep the old page.
      console.error('[build] FAILED (exit ' + code + '). dist/ left at the last good build.');
    }
    if (queued) { queued = false; runBuild('queued change'); }
  });
}

// The cache key for every function import. Node caches an ESM module for the life of
// the process, keyed by URL — and that cache covers the module's ENTIRE import graph.
// Keying off the function file's own mtime therefore does almost nothing: editing
// src/lib/canvas-compile.mjs leaves admin-canvas-render.mjs untouched, so the server
// keeps serving the compiler it loaded at boot. That is exactly how the editor ends up
// rendering with a different compiler than the build uses, which shows up as the
// editor and the published page quietly disagreeing.
//
// One counter, bumped by the watcher on any source change, busts the whole graph.
let sourceGeneration = Date.now();

function watchSources() {
  // netlify/ is watched for the cache bump only — functions are not part of dist, so
  // changing one needs no rebuild, just a fresh import.
  const rebuildDirs = ['src', 'admin'].map((d) => resolve(ROOT, d)).filter(existsSync);
  const bumpOnlyDirs = ['netlify'].map((d) => resolve(ROOT, d)).filter(existsSync);
  let timer = null;

  for (const dir of rebuildDirs) {
    watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      // responsive-manifest.json is written BY the build, inside src/data. Without
      // this guard every build triggers the next one and the server spins forever.
      if (String(filename).includes('responsive-manifest.json')) return;
      sourceGeneration = Date.now();
      clearTimeout(timer);
      timer = setTimeout(() => runBuild('changed ' + String(filename).split(/[\\/]/).pop()), 150);
    });
  }

  for (const dir of bumpOnlyDirs) {
    watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      sourceGeneration = Date.now();
      console.log('[watch] function reloaded: ' + String(filename).split(/[\\/]/).pop());
    });
  }

  const total = rebuildDirs.length + bumpOnlyDirs.length;
  console.log('[watch] ' + total + ' source director' + (total === 1 ? 'y' : 'ies'));
}

// ---------------------------------------------------------------- functions

async function callFunction(name, req, res) {
  const file = join(FUNCTIONS, name + '.mjs');
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'no function named "' + name + '"' }));
  }

  // Keyed on sourceGeneration, not this file's mtime. Node's module cache spans the
  // whole import graph, so the handler must be re-imported whenever ANY source it
  // depends on changes, not only when the handler itself is edited.
  const mod = await import(pathToFileURL(file).href + '?v=' + sourceGeneration);
  if (typeof mod.default !== 'function') {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: name + '.mjs has no default export' }));
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const request = new Request('http://localhost:' + PORT + req.url, {
    method: req.method,
    headers: req.headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
  });

  let response;
  try {
    response = await mod.default(request);
  } catch (err) {
    console.error('[fn ' + name + '] ' + err.stack);
    // status is set by store.mjs on a write conflict; anything else is a real 500.
    const status = err.status || 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message }));
  }

  const headers = Object.fromEntries(response.headers);
  // Set-Cookie must survive as its own header; Object.fromEntries folds duplicates.
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  if (cookies.length) { delete headers['set-cookie']; headers['Set-Cookie'] = cookies; }

  const payload = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(payload);

  // A successful admin write changed a source file on disk; the watcher will see it
  // and rebuild. Nothing to do here beyond logging the shape of what happened.
  if (response.status < 300 && req.method === 'POST') console.log('[fn ' + name + '] ' + response.status);
}

// ---------------------------------------------------------------- static files

async function serveStatic(urlPath, res) {
  // normalize collapses ../ before the prefix check, so a crafted path cannot climb
  // out of dist/ and start serving the repo (netlify.toml, .git, node_modules).
  let filePath = normalize(join(DIST, decodeURIComponent(urlPath)));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath).catch(() => null);
    if (info && info.isDirectory()) filePath = join(filePath, 'index.html');
    else if (!info && !extname(filePath)) filePath = join(filePath, 'index.html');

    let body = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();

    // Live-reload is for the SITE, not for the editor. The editor holds the document,
    // the selection and the whole undo stack in memory, and every save rewrites
    // site.json — which the watcher sees, which reloaded the editor and threw all of
    // that away the moment you pressed Save. The canvas iframe is excluded for the
    // same reason: reloading it mid-edit drops the node moveable is holding.
    if (ext === '.html' && !urlPath.startsWith('/admin/')) {
      body = Buffer.from(body.toString('utf8').replace('</body>', RELOAD_SNIPPET + '</body>'));
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (err) {
    const notFound = resolve(DIST, '404.html');
    if (existsSync(notFound)) {
      const body = (await readFile(notFound, 'utf8')).replace('</body>', RELOAD_SNIPPET + '</body>');
      res.writeHead(404, { 'Content-Type': MIME['.html'] }).end(body);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + urlPath);
    }
  }
}

// ---------------------------------------------------------------- server

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const path = url.pathname;

  if (path === '/__dev/reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 500\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (path.startsWith('/.netlify/functions/')) {
    return callFunction(path.slice('/.netlify/functions/'.length).split('/')[0], req, res);
  }

  // The one redirect from netlify.toml the admin panel and playbook form depend on.
  if (path === '/playbook/generate') return callFunction('playbook', req, res);

  return serveStatic(path, res);
});

if (!existsSync(DIST)) {
  console.log('No dist/ yet — building first.');
  runBuild('first run');
}

watchSources();

// A stale `serve` or a previous run still holding the port is the single most common
// way this fails, and dying with EADDRINUSE makes the owner go hunting for a PID.
// Walk up to the next free port instead and print the one actually in use.
//
// The banner is bound to 'listening' ONCE, not passed to server.listen(). A callback
// passed to listen() is registered on 'listening' even when that attempt dies with
// EADDRINUSE, so every failed port left a live listener behind and the successful
// bind fired all of them — printing a banner for a port nothing was serving.
let activePort = PORT;
let attemptsLeft = 10;

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE' || attemptsLeft-- <= 0) throw err;
  console.log('[serve] port ' + activePort + ' is busy, trying ' + (activePort + 1));
  activePort += 1;
  server.listen(activePort);
});

server.on('listening', () => {
  console.log('\n  Fast Basketball, running locally');
  console.log('  ───────────────────────────────────────────');
  console.log('  Site    http://localhost:' + activePort + '/');
  console.log('  Admin   http://localhost:' + activePort + '/admin/');
  console.log('  Password: ' + process.env.ADMIN_PASSWORD);
  console.log('');
  console.log('  Saves write to src/ on disk, then rebuild and reload.');
  console.log('  Nothing here touches GitHub or Netlify.');
  console.log('');
});

server.listen(activePort);
