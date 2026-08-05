import { readFileSync } from 'node:fs';
import { getStore } from '@netlify/blobs';

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 6;

function loadPlaybookTemplates() {
  const path = new URL('../../src/data/playbook-templates.json', import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function checkRateLimit(ip) {
  const store = getStore('rate-limits');
  const key = 'playbook:' + ip;
  const now = Date.now();
  const existing = await store.get(key, { type: 'json' });
  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    await store.setJSON(key, { count: 1, windowStart: now });
    return true;
  }
  if (existing.count >= RATE_LIMIT_MAX) return false;
  await store.setJSON(key, { count: existing.count + 1, windowStart: existing.windowStart });
  return true;
}

function buildPlaybookHtml({ name, grade, positionLabel, skillGap }) {
  const drillRows = skillGap.drills.map((d, i) =>
    '<tr><td class="n">' + (i + 1) + '</td><td>' + escapeHtml(d.name) + '<div class="cue">' + escapeHtml(d.cue) + '</div></td><td class="reps">' + escapeHtml(d.reps) + '</td></tr>'
  ).join('');

  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(name) + ' | Fast Basketball Playbook</title>' +
    '<style>' +
    'body{font-family:Georgia,\'Times New Roman\',serif;background:#0A0A0C;color:#fff;margin:0;padding:40px 20px;}' +
    '.w{max-width:760px;margin:0 auto;}' +
    '.brand-name{margin-bottom:26px;color:#E60C20;font-weight:600;font-size:.9rem;letter-spacing:.24em;text-transform:uppercase;}' +
    'h1{font-size:2.4rem;text-transform:uppercase;line-height:1;margin:0 0 6px;font-family:Arial,sans-serif;}' +
    '.r{color:#E60C20;}' +
    '.sub{color:#8C8C99;font-size:.82rem;letter-spacing:.2em;text-transform:uppercase;margin-bottom:24px;}' +
    '.credential{background:rgba(230,12,32,.09);border:1px solid rgba(230,12,32,.35);border-radius:10px;padding:16px 18px;font-size:.9rem;color:#C4C4CE;margin-bottom:26px;}' +
    '.meta{display:flex;gap:26px;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,.1);border-bottom:1px solid rgba(255,255,255,.1);padding:18px 0;margin-bottom:30px;}' +
    '.meta div span{display:block;font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;color:#75757F;}' +
    '.meta div b{font-size:1.05rem;}' +
    'h2{font-family:Arial,sans-serif;text-transform:uppercase;font-size:1.3rem;margin:34px 0 6px;}' +
    '.diagnosis{color:#8C8C99;font-size:.92rem;margin-bottom:16px;}' +
    'table{width:100%;border-collapse:collapse;}' +
    'td{padding:14px 10px;border-bottom:1px solid rgba(255,255,255,.09);font-size:.98rem;vertical-align:top;}' +
    '.cue{color:#8C8C99;font-size:.82rem;margin-top:3px;}' +
    '.n{color:#E60C20;font-weight:700;width:28px;}' +
    '.reps{width:120px;color:#C4C4CE;}' +
    '.note{background:rgba(255,255,255,.05);border-radius:10px;padding:18px;margin-top:30px;font-size:.92rem;color:#C4C4CE;}' +
    '.ft{margin-top:40px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1);font-size:.78rem;color:#66666F;}' +
    '@media print{body{background:#fff;color:#000;}td{border-color:#ccc;}}' +
    '</style></head><body><div class="w">' +
    '<div class="brand-name">Fast Basketball</div>' +
    '<h1>' + escapeHtml(name) + "'s <span class=\"r\">4 Week Block</span></h1>" +
    '<div class="sub">North Broward, FL / Built by Coach Blake Kingsley</div>' +
    '<div class="credential">Coach Blake Kingsley spent the two seasons before founding Fast Basketball on staff for the 2025 Horizon League champion Robert Morris Colonials and the 2024 NJCAA Region 16 champion Moberly Area Community College Greyhounds.</div>' +
    '<div class="meta">' +
    '<div><span>Grade</span><b>' + escapeHtml(grade) + '</b></div>' +
    '<div><span>Position</span><b>' + escapeHtml(positionLabel) + '</b></div>' +
    '<div><span>Primary Focus</span><b>' + escapeHtml(skillGap.label) + '</b></div>' +
    '</div>' +
    '<h2>The Diagnosis</h2><p class="diagnosis">' + escapeHtml(skillGap.diagnosis) + '</p>' +
    '<h2>Daily Work</h2><table>' + drillRows + '</table>' +
    '<h2>Progression</h2><p class="diagnosis">' + escapeHtml(skillGap.progression) + '</p>' +
    '<div class="note">Log every session. Two to three weeks for form changes to show up, six to eight for them to survive a live game.</div>' +
    '<div class="ft">Fast Basketball, north Broward FL. Forward this to another parent, a teammate, or a coach.</div>' +
    '</div></body></html>';
}

async function sendEmail({ to, name, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PLAYBOOK_FROM_EMAIL;
  if (!apiKey || !from) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: from,
        to: [to],
        subject: name + "'s Fast Basketball playbook is ready",
        html: html
      })
    });
    return res.ok;
  } catch (err) {
    console.error('playbook email send failed', err.message);
    return false;
  }
}

async function storeLead(record) {
  try {
    const store = getStore('leads');
    const key = new Date().toISOString() + '-' + Math.random().toString(36).slice(2, 8);
    await store.setJSON(key, record);
  } catch (err) {
    console.error('lead storage failed', err.message);
  }
}

export default async (request, context) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
  }

  const ip = context.ip || request.headers.get('x-nf-client-connection-ip') || 'unknown';
  const allowed = await checkRateLimit(ip);
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'too many requests, try again later' }), { status: 429 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'invalid request body' }), { status: 400 });
  }

  if (payload['pb-hp']) {
    return new Response(JSON.stringify({ html: '', emailSent: false }), { status: 200 });
  }

  const name = (payload.name || '').trim();
  const email = (payload.email || '').trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'name and a valid email are required' }), { status: 422 });
  }

  const templates = loadPlaybookTemplates();
  const skillGap = templates.skill_gaps.find((g) => g.id === payload.focus) || templates.skill_gaps[0];
  const position = templates.positions.find((p) => p.id === payload.position) || templates.positions[0];
  const grade = (payload.grade || '').trim() || 'Not specified';

  const html = buildPlaybookHtml({ name, grade, positionLabel: position.label, skillGap });
  const emailSent = await sendEmail({ to: email, name, html });

  await storeLead({
    type: 'playbook',
    timestamp: new Date().toISOString(),
    name,
    email,
    grade,
    position: position.id,
    focus: skillGap.id,
    guardianConfirmed: payload.guardianConfirmed === true,
    referrer: payload.referrer || null,
    ip,
    emailSent
  });

  return new Response(JSON.stringify({ html, emailSent }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
