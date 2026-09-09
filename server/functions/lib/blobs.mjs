// The key/value store the functions write to in production. Netlify Blobs until
// September 2026; Firestore now, in the project the coach app already uses
// (fast-basketball-b3ebe).
//
// The surface is deliberately the small slice of the Netlify Blobs API this codebase
// actually used, so leads.mjs, rate-limit.mjs and draft.mjs kept their own shape and only
// swapped an import. Firestore is strongly consistent by default, which is the property
// draft.mjs used to have to ask Netlify for by name: a save then a reload can never hand
// the owner back the previous draft.
//
// LOCAL MODE NEVER GETS HERE. Every caller checks isLocal first and writes to a
// gitignored JSON file instead, so a laptop needs no credentials, no emulator and no
// network. That is also why firebase-admin is imported dynamically: `npm run dev` and
// `npm test` must not need it installed.
//
// Documents are { v: <string> }. Everything is stringified on the way in and parsed on
// the way out, rather than letting Firestore keep native maps and arrays, because
// Firestore silently rejects nested arrays and reorders nothing else predictably. One
// shape in, one shape out, and what comes back is byte-identical to what went in.

let appPromise = null;

async function firestore() {
  if (!appPromise) {
    appPromise = (async () => {
      const { getApps, initializeApp } = await import('firebase-admin/app');
      // Inside Cloud Functions the default credentials and project id are ambient, so
      // initializeApp() needs no arguments. getApps() keeps a warm instance from
      // initialising twice, which throws.
      if (!getApps().length) initializeApp();
      const { getFirestore } = await import('firebase-admin/firestore');
      return getFirestore();
    })();
  }
  return appPromise;
}

// A Firestore document id may not contain "/", may not be "." or "..", and stops at
// 1500 bytes. Our keys are things like "registration:<uuid>", "media/__index" and
// "src/data/site.json", so percent-encoding is enough and stays readable in the console.
// Exported for blobs.test.mjs: a key that encodes one way and decodes another would strand
// a lead where listLeads could never name it again.
export function docId(key) {
  const id = encodeURIComponent(String(key));
  if (!id || id === '.' || id === '..') throw new Error('bad store key: ' + key);
  if (id.length > 1500) throw new Error('store key too long: ' + key);
  return id;
}

export const decodeId = (id) => decodeURIComponent(id);

export async function getStore(nameOrOptions) {
  const name = typeof nameOrOptions === 'string' ? nameOrOptions : nameOrOptions.name;
  const db = await firestore();
  const col = db.collection(name);

  return {
    async get(key, options = {}) {
      const snap = await col.doc(docId(key)).get();
      if (!snap.exists) return null;
      const value = snap.get('v');
      if (value == null) return null;
      return options.type === 'json' ? JSON.parse(value) : value;
    },
    async set(key, value) {
      await col.doc(docId(key)).set({ v: String(value), at: new Date().toISOString() });
    },
    async setJSON(key, value) {
      await col.doc(docId(key)).set({ v: JSON.stringify(value), at: new Date().toISOString() });
    },
    async delete(key) {
      await col.doc(docId(key)).delete();
    },
    // One query instead of a list followed by a read per key, which is what the Blobs
    // version cost. Callers that only want the keys can ignore `value`.
    async entries() {
      const snap = await col.get();
      return snap.docs.map((d) => ({ key: decodeId(d.id), value: d.get('v') }));
    }
  };
}

// ---------------------------------------------------------------- staged photos
//
// Staged uploads are capped at 8MB by admin-media.mjs and arrive base64 encoded, which a
// Firestore document (1MB) cannot hold. They go to the project's Cloud Storage bucket
// instead. The base64 string is stored verbatim rather than decoded to bytes, so the
// contract draft.mjs and admin-media.mjs already agree on does not change.
//
// The bucket has to exist: enable Storage once in the Firebase console. Until then these
// throw, admin-media reports the upload failed, and nothing else on the site notices.

const MEDIA_PREFIX = 'staged-media/';

async function bucket() {
  const { getApps, initializeApp } = await import('firebase-admin/app');
  if (!getApps().length) initializeApp();
  const { getStorage } = await import('firebase-admin/storage');
  return getStorage().bucket();
}

export async function getMediaObject(id) {
  const file = (await bucket()).file(MEDIA_PREFIX + id);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  return buf.toString('utf8');
}

export async function putMediaObject(id, base64) {
  await (await bucket()).file(MEDIA_PREFIX + id).save(String(base64), { contentType: 'text/plain' });
}

export async function deleteMediaObject(id) {
  // ignoreNotFound: a publish deletes every staged photo, and a retry must not throw on
  // the ones the first run already removed.
  await (await bucket()).file(MEDIA_PREFIX + id).delete({ ignoreNotFound: true });
}
