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
  const { getStore } = await import('./blobs.mjs');
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
  // One query for the whole collection. The Blobs version listed the keys and then read
  // each one, which was a round trip per lead every time the admin panel opened.
  const leads = [];
  for (const { key, value } of await store.entries()) {
    if (!value) continue;
    try {
      leads.push({ key, ...JSON.parse(value) });
    } catch (err) {
      console.error('[leads] ' + key + ' is not readable JSON, skipping: ' + err.message);
    }
  }
  return leads;
}

export async function addLead(key, record) {
  if (LOCAL) {
    const path = LOCAL_PATH();
    // Same key overwrites, the way Blobs' setJSON does, so re-saving a record does not
    // leave the local file holding two copies of it.
    const existing = (await listLeads()).filter((lead) => lead.key !== key);
    existing.push({ key, ...record });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(existing, null, 2) + '\n');
    return;
  }
  const store = await blobStore();
  await store.setJSON(key, record);
}

// One record by key, or null. The webhook uses it to answer a replayed Stripe event
// without writing a second enrollment.
export async function getLead(key) {
  if (LOCAL) {
    const found = (await listLeads()).find((lead) => lead.key === key);
    return found || null;
  }
  const store = await blobStore();
  return (await store.get(key, { type: 'json' })) || null;
}
