// Leads live in Netlify Blobs in production. There is no Blobs service on a laptop,
// so locally they live in a gitignored JSON file. Same two calls either way, so the
// Leads tab in the admin panel does not need to know which one it is reading.
//
// Local capture is deliberately thin for now: the dev server has no Netlify Forms
// endpoint, so the local file starts empty and the admin panel shows its empty
// state. Phase 3 wires local form submissions into it, alongside CSV export.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const LOCAL = process.env.FB_LOCAL === 'true';
const LOCAL_PATH = () => resolve(process.cwd(), '.local/leads.json');

async function blobStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore('leads');
}

export async function listLeads() {
  if (LOCAL) {
    const path = LOCAL_PATH();
    if (!existsSync(path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('[leads] .local/leads.json is not readable JSON: ' + err.message);
      return [];
    }
  }
  const store = await blobStore();
  const { blobs } = await store.list();
  const leads = [];
  for (const blob of blobs) {
    const record = await store.get(blob.key, { type: 'json' });
    if (record) leads.push({ key: blob.key, ...record });
  }
  return leads;
}

export async function addLead(key, record) {
  if (LOCAL) {
    const path = LOCAL_PATH();
    const existing = await listLeads();
    existing.push({ key, ...record });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(existing, null, 2) + '\n');
    return;
  }
  const store = await blobStore();
  await store.setJSON(key, record);
}
