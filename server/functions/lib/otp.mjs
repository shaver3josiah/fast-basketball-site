// The one-time sign-in code for /admin. There is a single owner, so there is a single
// record: key 'owner'. Only the HMAC of the code is stored, never the code, with an expiry
// and a tries counter so a six-digit code cannot be brute-forced in its ten-minute life.
//
// Local mode never touches the hosted store (same rule as leads.mjs): it writes a gitignored
// JSON file so `npm run dev` and the tests need no credentials and no network.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const LOCAL = process.env.FB_LOCAL === 'true';
const LOCAL_PATH = () => resolve(process.cwd(), '.local/otp.json');
const KEY = 'owner';

async function store() {
  const { getStore } = await import('./blobs.mjs');
  return getStore('admin-otp');
}

export async function setOtp(record) {
  if (LOCAL) {
    const path = LOCAL_PATH();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(record) + '\n');
    return;
  }
  await (await store()).setJSON(KEY, record);
}

export async function getOtp() {
  if (LOCAL) {
    const path = LOCAL_PATH();
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  }
  return (await (await store()).get(KEY, { type: 'json' })) || null;
}

export async function clearOtp() {
  if (LOCAL) {
    const path = LOCAL_PATH();
    if (existsSync(path)) rmSync(path);
    return;
  }
  await (await store()).delete(KEY);
}
