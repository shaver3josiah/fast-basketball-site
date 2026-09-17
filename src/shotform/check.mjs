// Runs the pure block of index.html (the Shot Form tracker) under node:vm against synthetic reps and frames.
// node src/shotform/check.mjs   -- from build/site
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const block = html.split('/* @fb-pure-start */')[1].split('/* @fb-pure-end */')[0];
const api = vm.runInNewContext('(function(){' + block + '\nreturn {LM,BONES,BALL_DIAM_M,G,dist,mid,angleAt,signedAngle,slope,quadFit,BallFinder,ShotMachine,fitArc,get TARGETS(){return TARGETS},DEFAULT_TARGETS,BounceLearner,readReferencePose,bandsFromReference,angle3,setTargetEdits,defaultTarget,targetText,statusOf,evaluate,cardSvg,cardHtml,animSvg,OneEuro,PoseSmoother,csvOf,csvCell,esc};})()', {});
const { BallFinder, ShotMachine, fitArc, angleAt, signedAngle, quadFit, cardSvg, cardHtml, animSvg, DEFAULT_TARGETS, setTargetEdits, defaultTarget, targetText, statusOf, evaluate, BALL_DIAM_M, G, OneEuro, PoseSmoother, csvOf, csvCell } = api;
const TARGETS = api.TARGETS;

let n = 0, fails = 0;
const ok = (cond, msg, extra = '') => { n++; if (!cond) { fails++; console.log('  FAIL', msg, extra); } };
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

// ---------- geometry ----------
console.log('geometry');
ok(near(angleAt({x:0,y:0},{x:1,y:0},{x:1,y:1}), 90, 1e-9), 'right angle');
ok(near(angleAt({x:0,y:0},{x:1,y:0},{x:2,y:0}), 180, 1e-9), 'straight');
ok(near(signedAngle({x:0,y:-1},{x:0.766,y:-0.643}), 50, 0.1), 'signed angle clockwise on screen is positive', signedAngle({x:0,y:-1},{x:0.766,y:-0.643}));
ok(near(signedAngle({x:0,y:-1},{x:-0.766,y:-0.643}), -50, 0.1), 'counter-clockwise negative');
const q = quadFit([0,0.1,0.2,0.3,0.4],[0,0.1,0.2,0.3,0.4].map(t => 5 + 3*t + 4*t*t));
ok(near(q[0],5,1e-6) && near(q[1],3,1e-6) && near(q[2],4,1e-6), 'quadratic fit exact', JSON.stringify(q));

// ---------- ball finder on a synthetic frame ----------
console.log('ball finder');
const W = 320, H = 180;
function frame(paint) { const d = new Uint8ClampedArray(W*H*4); for (let i = 0; i < W*H; i++) { d[i*4]=40; d[i*4+1]=45; d[i*4+2]=60; d[i*4+3]=255; }
  const img = { data: d, width: W, height: H }; const px = (x,y,c) => { if (x<0||y<0||x>=W||y>=H) return; const i=(y*W+x)*4; d[i]=c[0]; d[i+1]=c[1]; d[i+2]=c[2]; };
  const disc = (cx,cy,r,c) => { for (let y=Math.floor(cy-r); y<=cy+r; y++) for (let x=Math.floor(cx-r); x<=cx+r; x++) if ((x-cx)**2+(y-cy)**2 <= r*r) px(x,y,c); };
  const rect = (x0,y0,x1,y1,c) => { for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++) px(x,y,c); };
  paint({ px, disc, rect }); return img; }
const ORANGE = [235,120,40], FLOOR = [215,130,60], SKIN = [220,170,140], JERSEY = [230,40,30];
const f1 = frame(({disc, rect}) => { rect(0,140,W,H,FLOOR); disc(200,90,8,ORANGE); disc(120,100,10,SKIN); rect(60,60,90,130,JERSEY); rect(0,0,W,6,ORANGE); });
const bf = new BallFinder(W, H);
let b = bf.find(f1, null);
ok(b && near(b.x,200,1.5) && near(b.y,90,1.5), 'untaught: finds the ball, not the floor, skin, jersey or a stripe', JSON.stringify(b));
ok(!bf.find(frame(({rect}) => rect(0,140,W,H,FLOOR)), null), 'floor only: nothing');
const cal = bf.calibrate(f1, 201, 89);
ok(cal.ok && near(cal.r, 8, 1), 'calibrate from a tap gives the radius', JSON.stringify(cal));
ok(bf.calibrate(f1, 10, 100).ok === false, 'tap on background refuses');
b = bf.find(f1, { x: 205, y: 95, radius: 40 });
ok(b && near(b.x,200,1.5), 'taught + hint: still the ball', JSON.stringify(b));
const f2 = frame(({disc, rect}) => { rect(0,140,W,H,FLOOR); disc(200,90,8,ORANGE); disc(250,120,26,ORANGE); });
b = bf.find(f2, null);
ok(b && near(b.x,200,1.5), 'taught: a much bigger orange blob (a cone, a bag) loses to the right-sized one', JSON.stringify(b));
const f3 = frame(({disc, rect}) => { rect(0,100,W,H,FLOOR); disc(200,90,8,ORANGE); });
b = bf.find(f3, { x: 200, y: 92, radius: 30 });
ok(b && near(b.x,200,2) && near(b.y,90,2), 'ball just above a warm floor with a hint', JSON.stringify(b));

// ---------- synthetic rep ----------
console.log('shot machine');
const FPS = 30, PPM = 200, HEIGHT = 1.78, VW = 1280, VH = 720;
function rot(v, a) { const c = Math.cos(a), s = Math.sin(a); return { x: v.x*c - v.y*s, y: v.x*s + v.y*c }; }
// Build one rep. facing = +1 (rim to the right) or -1 (mirrored). withBall false => ball null on every frame.
const LEG = 0.2655; // each leg link as a fraction of stature; standing hip-to-ankle is 0.53
const DIP_M = (0.53 - 2*LEG*Math.sin(60*Math.PI/180)) * HEIGHT; // hip drop that closes the knee to 120 degrees
function rep({ facing = 1, withBall = true, angleDeg = 50, speed = 7, lean = 5, headUp = 15, snap = 50, tRel = 1.70, fps = FPS, occludeElbow = null, holdDrift = 0, dropKnuckles = 0 } = {}) {
  const frames = [];
  const ankleY0 = 650, hPx = HEIGHT*PPM, baseX = 640;
  const g = G*PPM; let relPos = null, relV = null;
  for (let i = 0; i < fps*4.5; i++) {
    const t = i/fps;
    let dip = 0, jump = 0, elbow = 90, armUp = 0, flexed = 0, leanNow = 0, headNow = 0;
    if (t >= 1.0 && t < 1.4) { const u = (t-1.0)/0.4; dip = DIP_M*Math.sin(u*Math.PI/2); }
    else if (t >= 1.4 && t < 1.6) { const u = (t-1.4)/0.2; dip = DIP_M*(1-u); }
    if (t >= 1.6 && t < 2.0) { const u = (t-1.6)/0.4; jump = 0.25*4*u*(1-u); }        // parabolic 0.25 m jump, apex 1.8
    if (t >= 1.5) { armUp = Math.min(1, (t-1.5)/0.2); elbow = 90 + 85*armUp; }
    if (t >= 2.4) { const u = Math.min(1,(t-2.4)/0.3); armUp = 1-u; elbow = 175 - 85*u; }
    if (t >= tRel+0.08 && t < 2.4) flexed = snap;
    if (t >= 1.4 && t < 2.4) { leanNow = lean; headNow = headUp; }
    const ankleY = ankleY0 - jump*PPM;
    const hipY = ankleY - 0.53*hPx + dip*PPM; const D = ankleY - hipY, L = LEG*hPx; const kneeY = (hipY + ankleY)/2, kneeFwd = Math.sqrt(Math.max(0, L*L - (D/2)*(D/2)));
    const shoY = hipY - 0.29*hPx, noseY = shoY - 0.11*hPx;
    const hipX = baseX, shoX = hipX + Math.tan(leanNow*Math.PI/180)*(hipY-shoY)*facing;
    const kneeX = hipX + kneeFwd*facing, ankX = hipX;
    const noseX = shoX + 20*facing;
    const headV = rot({ x: 30*facing, y: -5 }, -headNow*Math.PI/180*facing); // ear->nose, tilt up
    const ear = { x: noseX - headV.x, y: noseY - headV.y };
    const upper = 0.17*hPx, fore = 0.15*hPx, hand = 0.09*hPx;
    const shoulderAng = (-30 + (-130 - -30)*armUp) * Math.PI/180;           // -30 = slightly ahead and down, -130 = up-forward
    const elbP = { x: shoX + Math.cos(shoulderAng)*upper*facing, y: shoY - Math.sin(-shoulderAng)*upper };
    const upperDir = { x: elbP.x - shoX, y: elbP.y - shoY }; const ul = Math.hypot(upperDir.x, upperDir.y);
    const ud = { x: upperDir.x/ul, y: upperDir.y/ul };
    const fd = rot(ud, (180-elbow)*Math.PI/180*facing);
    const wri = { x: elbP.x + fd.x*fore, y: elbP.y + fd.y*fore };
    const hd = rot(fd, flexed*Math.PI/180*facing);
    const idx = { x: wri.x + hd.x*hand, y: wri.y + hd.y*hand };
    let ball = null;
    if (withBall) {
      if (t < tRel) { ball = { x: wri.x + 0.12*PPM*facing, y: wri.y - 0.06*PPM, r: BALL_DIAM_M/2*PPM }; relPos = ball; }
      else { if (!relV) { const a = angleDeg*Math.PI/180; relV = { vx: speed*Math.cos(a)*PPM*facing, vy: -speed*Math.sin(a)*PPM }; }
        const dt = t - tRel + 1/(2*fps);   // the ball left the hand half a frame before the first free frame
        const x = relPos.x + relV.vx*dt, y = relPos.y + relV.vy*dt + 0.5*g*dt*dt;
        ball = (x > 0 && x < VW && y > 0) ? { x, y, r: BALL_DIAM_M/2*PPM } : null; }
    }
    const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
    const set = (i, p, v = 0.95) => { lm[i] = { x: p.x, y: p.y, v }; };
    set(0, { x: noseX, y: noseY }); set(2, { x: noseX - 8*facing, y: noseY - 12 }); set(5, { x: noseX - 8*facing, y: noseY - 12 }, 0.4);
    set(7, ear); set(8, ear, 0.3);
    const nearSide = facing > 0 ? 'R' : 'L';
    const A = { R: [12,14,16,20], L: [11,13,15,19] };
    // occludeElbow: a window of frames where the model collapses the elbow onto the shoulder, as it does when the
    // guide hand or the body hides it. The angle then reads near zero, which is anatomically impossible.
    const occluded = occludeElbow && t >= occludeElbow[0] && t <= occludeElbow[1];
    // holdDrift: centimetres the hand wanders after release, the difference between a frozen finish and a collapsing one
    const drift = holdDrift && t > tRel + 0.1 ? Math.sin((t - tRel) * 9) * holdDrift / 100 * PPM : 0;
    const wriD = { x: wri.x + drift * facing, y: wri.y + drift * 0.4 };
    set(A[nearSide][0], { x: shoX, y: shoY }); set(A[nearSide][1], occluded ? { x: shoX + 2, y: shoY + 2 } : elbP); set(A[nearSide][2], wriD);
    // the knuckles the hand direction is averaged from; dropKnuckles hides some, as a real model does
    const knu = [[A[nearSide][3], idx], [nearSide === 'R' ? 18 : 17, { x: idx.x - 6*facing, y: idx.y + 3 }], [nearSide === 'R' ? 22 : 21, { x: idx.x + 5*facing, y: idx.y - 3 }]];
    knu.forEach(([j, p], k) => set(j, { x: p.x + drift * facing, y: p.y + drift * 0.4 }, k < 3 - dropKnuckles ? 0.9 : 0.1));
    const farSide = nearSide === 'R' ? 'L' : 'R';
    set(A[farSide][0], { x: shoX - 6*facing, y: shoY + 4 }, 0.7); set(A[farSide][1], { x: elbP.x - 20*facing, y: elbP.y + 10 }, 0.6);
    set(A[farSide][2], { x: wri.x - 40*facing, y: wri.y + 10 }, 0.6); set(A[farSide][3], { x: idx.x - 40*facing, y: idx.y + 10 }, 0.5);
    set(23, { x: hipX, y: hipY }); set(24, { x: hipX, y: hipY });
    set(25, { x: kneeX, y: kneeY }); set(26, { x: kneeX, y: kneeY });
    set(27, { x: ankX, y: ankleY }); set(28, { x: ankX, y: ankleY });
    set(31, { x: ankX + 25*facing, y: ankleY + 8 }); set(32, { x: ankX + 25*facing, y: ankleY + 8 });
    frames.push({ t, lm, ball, w: VW, h: VH });
  }
  return frames;
}
function run(frames, opts = {}) { const m = new ShotMachine({ heightM: HEIGHT, hand: 'auto', ...opts }); const shots = [], missed = []; const states = new Set();
  for (const f of frames) { const s = m.push(f); states.add(m.state); if (s && s.missed) missed.push(s.missed); else if (s) shots.push(s); } return { m, shots, missed, states }; }
const T_REL = 1.70 - 1/(2*FPS);   // the generator's true release instant
// seeded gaussian jitter on every landmark, the way a phone pose model behaves
function jitter(frames, sigma, seed) { let a = seed * 7919 >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return frames.map(f => ({ ...f, lm: f.lm.map(p => ({ x: p.x + gauss() * sigma, y: p.y + gauss() * sigma, v: p.v })) })); }

// right-hander, ball tracked
{
  const { m, shots, states } = run(rep());
  ok(shots.length === 1, 'one rep produces exactly one shot', shots.length);
  const s = shots[0] || { metrics: {} }, mt = s.metrics;
  ok(['dip','rise','flight'].every(x => states.has(x)), 'passed through dip, rise, flight', [...states].join(','));
  ok(near(m.ppmBody, PPM, PPM*0.08), 'scale from the body within 8%', m.ppmBody);
  ok(s.side === 'R' && s.facing === 1, 'right hand, facing right', s.side + ' ' + s.facing);
  ok(mt.releaseBy === 'ball', 'release read from the ball');
  ok(near(s.tRel, T_REL, 0.02), 'release time at the midpoint between the last held and first free frame', s.tRel);
  ok(near(mt.dipToRelease, 0.68, 0.08), 'dip to release', mt.dipToRelease);
  ok(near(mt.lowToRelease, 0.28, 0.08), 'bottom to release', mt.lowToRelease);
  ok(near(mt.legArmLag, 0.10, 0.07), 'legs before arm lag', mt.legArmLag);
  ok(near(mt.releaseVsApex, -0.12, 0.07), 'release before the apex', mt.releaseVsApex);
  ok(near(mt.jumpHeightCm, 25, 4), 'jump height', mt.jumpHeightCm);
  ok(near(mt.kneeMinDeg, 120, 4), 'knee minimum (two-link leg closed to 120)', mt.kneeMinDeg);
  ok(near(mt.elbowReleaseDeg, 90 + 85 * (T_REL - 1.5) / 0.2, 5), 'elbow at the release instant, not at lockout', mt.elbowReleaseDeg);
  ok(near(mt.elbowLockDeg, 175, 5), 'elbow at lockout for reference', mt.elbowLockDeg);
  ok(near(mt.elbowSetDeg, 90, 5), 'elbow at set', mt.elbowSetDeg);
  ok(near(mt.trunkLeanDeg, 5, 2), 'trunk lean toward the rim is positive', mt.trunkLeanDeg);
  ok(near(mt.headPitchDeltaDeg, 15, 4), 'head tilted up relative to standing', mt.headPitchDeltaDeg);
  ok(near(mt.quietHeadSec, 0.28, 0.07), 'head settled since the tilt at 1.4 s, so about 0.3 s before release', mt.quietHeadSec);
  ok(near(mt.releaseHeightRatio, 1.15, 0.15), 'release height as a ratio of stature, hand based like the papers', mt.releaseHeightRatio);
  ok(near(mt.wristSnapDeg, 50, 6), 'wrist snap forward is positive', mt.wristSnapDeg);
  ok(mt.holdSec >= 0.5, 'follow-through held', mt.holdSec);
  ok(near(mt.launchAngleDeg, 50, 1.0), 'launch angle from the arc within a degree', mt.launchAngleDeg);
  ok(near(mt.releaseSpeedMs, 7, 0.25), 'release speed (scale from fitted g when the ball is untaught)', mt.releaseSpeedMs);
  ok(near(s.fit && s.fit.a / G, PPM, PPM*0.08), 'fitted gravity recovers the scale', s.fit && s.fit.a / G);
  ok(mt.releaseHeightM > 1.8 && mt.releaseHeightM < 2.6, 'release height is the hand at release', mt.releaseHeightM);
  const svg = cardSvg(s); ok((svg.match(/<g stroke=/g) || []).length === 3 && /<polyline/.test(svg) && /\d{2}°/.test(svg), 'card has three figures, an arc and the angle');
  const doc = cardHtml([s]); ok(!/<video|<img|data:image/i.test(doc) && /<svg/.test(doc), 'export carries no pixels, only SVG');
  ok(Array.isArray(s.cues), 'cues evaluated');
  if (process.env.FB_DUMP) fs.writeFileSync(process.env.FB_DUMP, JSON.stringify(s));   // a rep for the UI test rig
  if (process.env.FB_DUMP_BAD) { const b = run(rep({ angleDeg: 38, lean: 14, snap: 8, headUp: -8 })).shots[0]; fs.writeFileSync(process.env.FB_DUMP_BAD, JSON.stringify(b)); }
}
// left-hander, mirrored
{
  const { shots } = run(rep({ facing: -1 }));
  const s = shots[0] || { metrics: {} }, mt = s.metrics;
  ok(shots.length === 1 && s.side === 'L' && s.facing === -1, 'left hander facing left', shots.length + ' ' + s.side + ' ' + s.facing);
  ok(near(mt.trunkLeanDeg, 5, 2) && near(mt.wristSnapDeg, 50, 6) && near(mt.launchAngleDeg, 50, 2.5), 'signs hold when mirrored', [mt.trunkLeanDeg, mt.wristSnapDeg, mt.launchAngleDeg].join(','));
  ok(near(mt.headPitchDeltaDeg, 15, 4), 'head aim sign holds when mirrored', mt.headPitchDeltaDeg);
}
// no ball at all
{
  const { shots } = run(rep({ withBall: false }));
  const s = shots[0] || { metrics: {} }, mt = s.metrics;
  ok(shots.length === 1 && mt.releaseBy === 'wrist', 'without a ball the rep still completes from the wrist peak', shots.length + ' ' + mt.releaseBy);
  ok(mt.launchAngleDeg == null && mt.arcOk === false, 'no arc is claimed without a ball');
  ok(near(s.tRel, 1.70, 0.12), 'wrist-peak release within about 3 frames', s.tRel);
}
// taught ball: gravity is known, so four points fit and the speed comes from the tap scale
{
  const frames = rep(); const m = new ShotMachine({ heightM: HEIGHT }); m.ppmBall = PPM; let s = null; for (const f of frames) { const r = m.push(f); if (r && !r.missed) s = r; }
  ok(s && near(s.metrics.releaseSpeedMs, 7, 0.25) && near(s.metrics.launchAngleDeg, 50, 1.0), 'taught ball: speed from the tap scale, angle within a degree', s && [s.metrics.releaseSpeedMs, s.metrics.launchAngleDeg].join(','));
  // the ball drops out for three frames right after release: still a card, the angle still right or absent
  const drop = rep().map(f => (f.t > T_REL + 0.05 && f.t < T_REL + 0.16) ? { ...f, ball: null } : f);
  const m2 = new ShotMachine({ heightM: HEIGHT }); m2.ppmBall = PPM; let s2 = null; for (const f of drop) { const r = m2.push(f); if (r && !r.missed) s2 = r; }
  ok(s2 && (s2.metrics.launchAngleDeg == null || near(s2.metrics.launchAngleDeg, 50, 5)), 'three lost frames after release never give a wrong angle', s2 && s2.metrics.launchAngleDeg);
}
// jitter: 3 px gaussian on every landmark, twelve seeds, one card each with the metrics still inside tolerance
{
  let worst = { knee: 0, elbow: 0, angle: 0, t: 0 }, cards = 0;
  for (let seed = 1; seed <= 12; seed++) { const { shots } = run(jitter(rep(), 3, seed)); if (shots.length !== 1) continue; cards++; const mt = shots[0].metrics;
    worst.knee = Math.max(worst.knee, Math.abs(mt.kneeMinDeg - 120)); worst.elbow = Math.max(worst.elbow, Math.abs(mt.elbowReleaseDeg - (90 + 85 * (T_REL - 1.5) / 0.2)));
    if (mt.launchAngleDeg != null) worst.angle = Math.max(worst.angle, Math.abs(mt.launchAngleDeg - 50)); worst.t = Math.max(worst.t, Math.abs(shots[0].tRel - T_REL)); }
  ok(cards === 12, 'every jittered rep still cuts exactly one card', cards);
  ok(worst.knee <= 8 && worst.elbow <= 8 && worst.angle <= 4 && worst.t <= 0.07, 'jittered metrics stay inside tolerance', JSON.stringify(worst));
}
// a jump with the ball held the whole time is a missed rep, said so, not a card
{
  const { shots, missed } = run(rep({ tRel: 99 }));
  ok(shots.length === 0 && missed.length >= 1, 'held-ball jump: no card, one missed notice', shots.length + ' ' + missed.join('|'));
}
// a bad arc (ball jumps to the floor) is refused, not drawn
{
  const bad = [[0,0,0],[10,-5,0.033],[20,-9,0.066],[300,400,0.1],[40,-15,0.133],[50,-16,0.166]];
  ok(fitArc(bad, 0, 10, null) === null, 'noisy arc rejected by residual');
  const up = Array.from({length: 8}, (_, i) => [i*10, -i*i*3, i*0.033]);
  ok(fitArc(up, 0, 10, null) === null, 'an arc accelerating upward is rejected');
}
// cues: evaluate marks the right side
{
  const c = evaluate({ launchAngleDeg: 38, elbowReleaseDeg: 140, holdSec: 0.2, trunkLeanDeg: 20, headDriftCm: 2 });
  ok(c[0] && c[0].key === 'launchAngleDeg' && c.every(x => x.status === 'fix'), 'heaviest fix first', c.map(x => x.key).join(','));
  ok(!c.find(x => x.key === 'headDriftCm'), 'in-range metric gives no cue');
}
// ---------- smoothing ----------
// The point of the velocity-adaptive cutoff: heavy smoothing when still, almost none when fast.
console.log('smoothing');
{
  let a = 12345; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  // standing still at 0.5 with 0.004 of jitter (about 3 px on a 720 px frame)
  const f = new OneEuro(); let rawErr = 0, smErr = 0, N = 0;
  for (let i = 0; i < 150; i++) { const t = i / 30, noise = gauss() * 0.004, out = f.filter(0.5 + noise, t);
    if (i > 30) { rawErr += noise * noise; smErr += (out - 0.5) ** 2; N++; } }
  const cut = Math.sqrt(smErr / N) / Math.sqrt(rawErr / N);
  ok(cut < 0.55, 'standing still: jitter cut to about half of raw', cut.toFixed(3));
  // a wrist accelerating to release: velocity ramps over 5 frames to a third of the frame in 0.2 s, the way an
  // arm actually moves. Lag is measured at the fast end, where release is read.
  const ramped = t => { const u = Math.max(0, t - 10 / 30); return 0.5 + 1.5 * (u <= 1 / 6 ? u * u * 3 : u - 1 / 12); };
  // stated as time, not as distance: at 1.5 frame-widths a second, 12 ms of lag is 0.018 of the frame
  for (const fps of [24, 30, 60]) { const g = new OneEuro(); let lag = 0;
    for (let i = 0; i < fps; i++) { const t = i / fps, x = ramped(t), out = g.filter(x, t); if (t > 0.45) lag = Math.max(lag, Math.abs(out - x)); }
    ok(lag / 1.5 < 0.012, `fast move at ${fps} fps: under 12 ms of lag`, (lag / 1.5 * 1000).toFixed(1) + ' ms'); }
  // a backward jump in time (a looped clip) restarts rather than blending across the seam
  const h = new OneEuro(); h.filter(0.9, 5); ok(h.filter(0.1, 0) === 0.1, 'a time jump backwards resets the filter');
  const ps = new PoseSmoother(3);
  const out = ps.smooth([{ x: 1, y: 2, visibility: 0.7 }, { x: 0, y: 0, visibility: 0.1 }, { x: .5, y: .5, visibility: 1 }], 0);
  ok(out.length === 3 && out[0].v === 0.7 && out[1].v === 0.1, 'visibility passes through the smoother unchanged', JSON.stringify(out[0]));
}
// a jittered rep is measured at least as well through the smoother as without it
{
  const worstOf = useSmoother => { let w = 0;
    for (let seed = 1; seed <= 12; seed++) { let frames = jitter(rep(), 3, seed);
      if (useSmoother) { const ps = new PoseSmoother(); const H = VH;
        frames = frames.map(f => ({ ...f, lm: ps.smooth(f.lm.map(p => ({ x: p.x / VW, y: p.y / H, visibility: p.v })), f.t).map(p => ({ x: p.x * VW, y: p.y * H, v: p.v })) })); }
      const { shots } = run(frames); if (shots.length !== 1) { w = 99; continue; }
      w = Math.max(w, Math.abs(shots[0].metrics.kneeMinDeg - 120)); }
    return w; };
  const raw = worstOf(false), sm = worstOf(true);
  ok(sm <= raw + 0.5, 'smoothing does not make the jittered knee reading worse', `raw ${raw.toFixed(1)} smoothed ${sm.toFixed(1)}`);
}

// ---------- spreadsheet ----------
console.log('spreadsheet');
{
  const s = run(rep()).shots[0];
  s.at = '2026-09-17T14:05:09.000Z'; s.athlete = 'Jordan Reyes'; s.drill = 'Free throws'; s.result = 'made'; s.heightCm = 178;
  const bad = { ...s, athlete: '=SUM(A1)', drill: 'Corner, "left"', result: null };
  const csv = csvOf([s, bad]);
  const lines = csv.trim().split('\r\n');
  ok(lines.length === 3, 'a header and one row per rep', lines.length);
  const cols = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const head = cols(lines[0]), r1 = cols(lines[1]), r2 = cols(lines[2]);
  ok(head.length === r1.length && head.length === r2.length, 'every row has exactly as many cells as the header', `${head.length}/${r1.length}/${r2.length}`);
  ok(head[0] === 'Date' && r1[0] === '2026-09-17' && r1[1] === '14:05:09', 'date and time split into their own columns', r1.slice(0, 2).join(' '));
  ok(r1[2] === 'Jordan Reyes' && r1[4] === 'made' && r1[5] === 'right', 'athlete, result and hand carried', r1.slice(2, 6).join('|'));
  ok(r2[2] === "'=SUM(A1)", 'a name that looks like a formula is quoted with an apostrophe', r2[2]);
  ok(lines[2].includes('"Corner, ""left"""'), 'a comma and quotes in a drill name are escaped, not split', lines[2].slice(0, 60));
  const angleCol = head.findIndex(h => h.startsWith('Launch angle'));
  ok(angleCol > 0 && Math.abs(+r1[angleCol] - 50) < 1.5, 'launch angle is a bare number a spreadsheet can average', r1[angleCol]);
  ok(!/°|m\/s/.test(r1[angleCol]), 'no units inside the value cell');
  ok(head.some(h => /\(°\)/.test(h)) && head.some(h => /\(s\)/.test(h)), 'units live in the header');
  ok(csvCell(null) === '' && csvCell(NaN) === '' && csvCell(Infinity) === '', 'empty, NaN and Infinity export as blank, never as text');
  ok(head.includes('Needs work') && head.includes('Cues'), 'the coach gets a flags column and a cue column');
}
// ---------- movement that is not a shot ----------
// A session is mostly not shooting. None of this may cut a card or speak a verdict.
console.log('not a shot');
// A crouched dribble: the ball rises off the floor toward the hand (which passes a naive separation test) while
// the hips bob. The hand never carries the ball above the shoulder, which is what tells them apart.
function dribble({ bounces = 3, fps = FPS, hz = 1.8, crouch = 0.08 } = {}) {
  const frames = [], hPx = HEIGHT*PPM, ankleY = 650, baseX = 640;
  for (let i = 0; i < fps*3; i++) {
    const t = i/fps, dip = t > 0.5 ? crouch*PPM : 0, bob = t > 0.5 ? Math.sin(t*hz*2*Math.PI)*0.03*PPM : 0;
    const hipY = ankleY - 0.53*hPx + dip + bob, shoY = hipY - 0.29*hPx, noseY = shoY - 0.11*hPx;
    const D = ankleY - hipY, L = 0.2655*hPx, kneeY = (hipY+ankleY)/2, kneeFwd = Math.sqrt(Math.max(0, L*L - (D/2)*(D/2)));
    const wri = { x: baseX + 0.28*hPx, y: hipY - 0.05*hPx };                       // hand at hip height, never above the shoulder
    const elbP = { x: baseX + 0.16*hPx, y: (shoY+hipY)/2 };
    const phase = ((t - 0.5)*hz) % 1, up = phase < 0.5 ? phase*2 : (1-phase)*2;     // ball between floor and hand
    const ball = t > 0.5 && i/fps < 0.5 + bounces/hz ? { x: wri.x + 6, y: ankleY - up*(ankleY - wri.y), r: BALL_DIAM_M/2*PPM } : null;
    const lm = Array.from({length:33}, () => ({x:0,y:0,v:0})); const set = (j,p,v=0.95) => { lm[j] = {x:p.x,y:p.y,v}; };
    set(0,{x:baseX+20,y:noseY}); set(2,{x:baseX+12,y:noseY-12}); set(5,{x:baseX+12,y:noseY-12},0.4); set(7,{x:baseX-10,y:noseY-5}); set(8,{x:baseX-10,y:noseY-5},0.3);
    set(12,{x:baseX,y:shoY}); set(14,elbP); set(16,wri); set(20,{x:wri.x+10,y:wri.y+8});
    set(11,{x:baseX-6,y:shoY+4},0.7); set(13,{x:elbP.x-20,y:elbP.y+10},0.6); set(15,{x:wri.x-40,y:wri.y+10},0.6); set(19,{x:wri.x-45,y:wri.y+12},0.5);
    set(23,{x:baseX,y:hipY}); set(24,{x:baseX,y:hipY}); set(25,{x:baseX+kneeFwd,y:kneeY}); set(26,{x:baseX+kneeFwd,y:kneeY});
    set(27,{x:baseX,y:ankleY}); set(28,{x:baseX,y:ankleY}); set(31,{x:baseX+25,y:ankleY+8}); set(32,{x:baseX+25,y:ankleY+8});
    frames.push({ t, lm, ball, w: VW, h: VH });
  }
  return frames;
}
// Bending to pick the ball up, and jogging through frame. Both dip the hips; neither reaches the set.
function pickup({ fps = FPS } = {}) {
  const frames = [], hPx = HEIGHT*PPM, ankleY = 650, baseX = 640;
  for (let i = 0; i < fps*3; i++) {
    const t = i/fps, u = t < 1 ? 0 : t < 1.6 ? (t-1)/0.6 : t < 2.2 ? 1 : Math.max(0, 1-(t-2.2)/0.6);
    const dip = u*0.30*PPM, hipY = ankleY - 0.53*hPx + dip, shoY = hipY - 0.29*hPx, noseY = shoY - 0.11*hPx;
    const D = ankleY - hipY, L = 0.2655*hPx, kneeY = (hipY+ankleY)/2, kneeFwd = Math.sqrt(Math.max(0, L*L - (D/2)*(D/2)));
    const wri = { x: baseX + 0.25*hPx, y: hipY + u*0.30*hPx };
    const ball = { x: wri.x + 4, y: Math.min(ankleY - BALL_DIAM_M/2*PPM, wri.y + 8), r: BALL_DIAM_M/2*PPM };
    const lm = Array.from({length:33}, () => ({x:0,y:0,v:0})); const set = (j,p,v=0.95) => { lm[j] = {x:p.x,y:p.y,v}; };
    set(0,{x:baseX+20,y:noseY}); set(2,{x:baseX+12,y:noseY-12}); set(5,{x:baseX+12,y:noseY-12},0.4); set(7,{x:baseX-10,y:noseY-5}); set(8,{x:baseX-10,y:noseY-5},0.3);
    set(12,{x:baseX,y:shoY}); set(14,{x:baseX+0.14*hPx,y:(shoY+wri.y)/2}); set(16,wri); set(20,{x:wri.x+10,y:wri.y+8});
    set(11,{x:baseX-6,y:shoY+4},0.7); set(13,{x:baseX+0.10*hPx,y:(shoY+wri.y)/2},0.6); set(15,{x:wri.x-40,y:wri.y+10},0.6); set(19,{x:wri.x-45,y:wri.y+12},0.5);
    set(23,{x:baseX,y:hipY}); set(24,{x:baseX,y:hipY}); set(25,{x:baseX+kneeFwd,y:kneeY}); set(26,{x:baseX+kneeFwd,y:kneeY});
    set(27,{x:baseX,y:ankleY}); set(28,{x:baseX,y:ankleY}); set(31,{x:baseX+25,y:ankleY+8}); set(32,{x:baseX+25,y:ankleY+8});
    frames.push({ t, lm, ball, w: VW, h: VH });
  }
  return frames;
}
{
  const d = run(dribble());
  ok(d.shots.length === 0, 'a dribble cuts no card', d.shots.length + (d.shots[0] ? ' elbow ' + d.shots[0].metrics.elbowReleaseDeg.toFixed(0) : ''));
  ok(d.missed.length === 0, 'a dribble is not announced as a missed rep', d.missed.join('|'));
  // dribble, then gather straight into the shot: the real rep must survive
  const both = [...dribble({ bounces: 2 }), ...rep().map(f => ({ ...f, t: f.t + 3 }))];
  const r = run(both);
  ok(r.shots.length === 1, 'dribble then shoot: exactly the real rep is cut', r.shots.length);
  if (r.shots[0]) ok(near(r.shots[0].metrics.launchAngleDeg, 50, 2), 'the rep after a dribble still measures right', r.shots[0].metrics.launchAngleDeg);
  const p = run(pickup());
  ok(p.shots.length === 0 && p.missed.length === 0, 'picking the ball up is silent', `${p.shots.length} cards, missed: ${p.missed.join('|')}`);
  const j = run(pickup().map(f => ({ ...f, ball: null })));
  ok(j.shots.length === 0 && j.missed.length === 0, 'bending with no ball in view is silent', `${j.shots.length} cards, missed: ${j.missed.join('|')}`);
  // a real attempt that never releases is still announced
  const h = run(rep({ tRel: 99 }));
  ok(h.shots.length === 0 && h.missed.length === 1, 'a real attempt that never releases is still announced', h.missed.join('|'));
}

// ---------- frame rate ----------
// The camera is asked for 60 fps, so every rate the phone can deliver has to measure the same rep the same way.
console.log('frame rate');
for (const fps of [24, 30, 60]) {
  const trueRel = 1.70 - 1 / (2 * fps);
  const { shots } = run(rep({ fps }));
  ok(shots.length === 1, `${fps} fps: one card`, shots.length);
  if (!shots[0]) continue;
  const mt = shots[0].metrics;
  ok(Math.abs(shots[0].tRel - trueRel) < 0.02, `${fps} fps: release within 20 ms`, ((shots[0].tRel - trueRel) * 1000).toFixed(1) + ' ms');
  ok(near(mt.launchAngleDeg, 50, 2), `${fps} fps: launch angle within 2 degrees`, mt.launchAngleDeg);
  ok(near(mt.elbowReleaseDeg, 90 + 85 * (trueRel - 1.5) / 0.2, 6), `${fps} fps: elbow at release, not at lockout`, mt.elbowReleaseDeg);
  ok(near(mt.releaseSpeedMs, 7, 0.4), `${fps} fps: release speed`, mt.releaseSpeedMs);
}

// ---------- jitter, at the scale a real phone delivers ----------
// 100 seeds at two frame rates. A clean rep must never be told to fix its knees or its timing.
console.log('jitter at scale');
for (const fps of [30, 60]) {
  let cards = 0, falseFix = 0, worstKnee = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const { shots } = run(jitter(rep({ fps }), 3, seed));
    if (shots.length !== 1) continue; cards++;
    const mt = shots[0].metrics;
    worstKnee = Math.max(worstKnee, Math.abs(mt.kneeMinDeg - 120));
    if (shots[0].cues.some(c => c.status === 'fix' && ['kneeMinDeg', 'dipToRelease', 'legArmLag', 'lowToRelease'].includes(c.key))) falseFix++;
  }
  ok(cards >= 95, `${fps} fps: at least 95 of 100 jittered reps cut a card`, cards);
  ok(falseFix <= 2, `${fps} fps: at most 2 of 100 clean reps get a false timing or knee correction`, falseFix);
  ok(worstKnee <= 12, `${fps} fps: worst knee error under 12 degrees`, worstKnee.toFixed(1));
}
// the no-ball wrist-peak path under the same jitter
{
  let late = 0, worst = 0, timingCues = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const { shots } = run(jitter(rep({ withBall: false }), 3, seed));
    if (!shots[0]) continue;
    const err = Math.abs(shots[0].tRel - T_REL); worst = Math.max(worst, err);
    if (err > 0.05) late++;
    if (shots[0].cues.some(c => ['dipToRelease', 'legArmLag', 'holdSec', 'quietHeadSec', 'releaseVsApex'].includes(c.key))) timingCues++;
  }
  ok(worst < 0.15, 'no-ball release under jitter stays within 0.15 s', (worst * 1000).toFixed(0) + ' ms');
  ok(late <= 5, 'most no-ball reps land within half a frame', late + ' of 24 over 50 ms');
  ok(timingCues === 0, 'a wrist-read rep never speaks a timing correction it cannot stand behind', timingCues);
}

// ---------- noisy ball centres ----------
// The arc scale is known, so centroid noise can move the angle a little and must never move the speed absurdly.
console.log('noisy ball');
{
  let worstSpeed = 0, worstAngle = 0, fits = 0;
  for (let seed = 1; seed <= 60; seed++) {
    let a = seed * 2654435761 >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const frames = rep().map(f => ({ ...f, ball: f.ball ? { ...f.ball, x: f.ball.x + gauss() * 2, y: f.ball.y + gauss() * 2 } : null }));
    const { shots } = run(frames);
    const mt = shots[0] && shots[0].metrics;
    if (!mt || mt.releaseSpeedMs == null) continue; fits++;
    worstSpeed = Math.max(worstSpeed, Math.abs(mt.releaseSpeedMs - 7));
    worstAngle = Math.max(worstAngle, Math.abs(mt.launchAngleDeg - 50));
  }
  ok(fits >= 50, 'most noisy arcs still fit', fits + ' of 60');
  ok(worstSpeed < 1.5, 'a 2 px wobble never invents an absurd release speed', worstSpeed.toFixed(2) + ' m/s off');
  ok(worstAngle < 6, 'a 2 px wobble keeps the angle within 6 degrees', worstAngle.toFixed(1));
}

// ---------- occlusion ----------
// The real side-view clip read a 21 degree set elbow from occluded frames. No elbow reaches that.
console.log('occlusion');
{
  const { shots } = run(rep({ occludeElbow: [1.0, 1.25] }));
  ok(shots.length === 1, 'an occluded stretch still cuts the rep', shots.length);
  const v = shots[0] && shots[0].metrics.elbowSetDeg;
  ok(v == null || v > 45, 'the set elbow is never an impossible angle from an occluded frame', v);
}
// ---------- learning the ball from a bounce ----------
// Nobody should walk to the phone. A bounced ball is the one orange thing in a gym that travels, so the learner
// must take it and leave the floor, a cone and a stripe alone.
console.log('bounce');
{
  const { BounceLearner } = api;
  // a bounce filmed at 30 fps: the ball falls, hits, comes back up, against a warm wood floor with a cone in shot
  const bounceFrames = (withBall = true, extras = true) => Array.from({ length: 45 }, (_, i) => {
    const t = i / 30, u = (t * 1.4) % 1, y = 40 + 100 * (1 - Math.pow(2 * u - 1, 2));
    return frame(({ disc, rect }) => { if (extras) { rect(0, 150, W, H, FLOOR); disc(60, 120, 13, ORANGE); rect(0, 0, W, 5, ORANGE); }
      if (withBall) disc(210, y, 9, ORANGE); });
  });
  const learnFrom = frames => { const bf = new BallFinder(W, H), bl = new BounceLearner();
    frames.forEach((img, i) => { bf.find(img, null); bl.push(i / 30, bf.cands); }); return bl.verdict(); };
  const v = learnFrom(bounceFrames());
  ok(v && near(v.r, 9, 2.5), 'a bounced ball is learned at about the right size', v && v.r.toFixed(1));
  ok(v && v.reversals >= 1, 'the learner needs a real turn-around', v && v.reversals);
  ok(v && v.travel > 8, 'and a path many times the ball\'s own width', v && v.travel.toFixed(0));
  ok(v && v.rn > 0.4 && v.gn > 0.15 && v.gn < 0.45, 'it comes back with the ball\'s own colour, not the floor\'s', v && `${v.rn.toFixed(2)}/${v.gn.toFixed(2)}`);
  // nothing moving: a floor, a cone and a stripe must never be learned as a ball
  ok(learnFrom(bounceFrames(false, true)) === null, 'a still gym with orange in it teaches nothing');
  // one that only falls, never bounces, is not a bounce
  const fallOnly = Array.from({ length: 20 }, (_, i) => frame(({ disc, rect }) => { rect(0, 150, W, H, FLOOR); disc(210, 20 + i * 6, 9, ORANGE); }));
  ok(learnFrom(fallOnly) === null, 'a ball that only falls is not a bounce');
  // once learned, the finder tracks with it
  {
    const bf = new BallFinder(W, H), bl = new BounceLearner();
    bounceFrames().forEach((img, i) => { bf.find(img, null); bl.push(i / 30, bf.cands); });
    const got = bl.verdict(); bf.learn(got);
    ok(bf.taught === true, 'the learned ball is taught to the finder');
    const f2 = frame(({ disc, rect }) => { rect(0, 150, W, H, FLOOR); disc(210, 70, 9, ORANGE); disc(60, 120, 13, ORANGE); });
    const hit = bf.find(f2, null);
    ok(hit && near(hit.x, 210, 3), 'and it then picks the ball over a bigger orange thing', hit && JSON.stringify([hit.x | 0, hit.y | 0]));
  }
}

// ---------- the follow-through ----------
// The weakest thing the tracker measures, because it is read from the smallest and noisiest landmarks on the body.
console.log('follow-through');
{
  const still = run(rep()).shots[0].metrics, loose = run(rep({ holdDrift: 22 })).shots[0].metrics;
  ok(still.holdDriftCm != null && still.holdDriftCm < 4, 'a frozen finish reads a couple of centimetres of drift', still.holdDriftCm && still.holdDriftCm.toFixed(1));
  ok(loose.holdDriftCm > 12, 'a hand that wanders after release reads much more', loose.holdDriftCm && loose.holdDriftCm.toFixed(1));
  ok(evaluate({ ...loose, releaseBy: 'ball' }).some(c => c.key === 'holdDriftCm'), 'and the drifting finish is called out');
  ok(!evaluate({ ...still, releaseBy: 'ball' }).some(c => c.key === 'holdDriftCm'), 'the frozen one is not');
  ok(still.handPoints === 3, 'the hand direction averages every knuckle the model can see', still.handPoints);
  // losing knuckles must cost accuracy gracefully, not produce a wild angle
  const snaps = [0, 1, 2].map(d => run(rep({ dropKnuckles: d })).shots[0].metrics.wristSnapDeg);
  ok(snaps.every(v => v != null && Math.abs(v - snaps[0]) < 12), 'the wrist snap holds up as knuckles drop out', snaps.map(v => v && v.toFixed(0)).join(' / '));
  ok(run(rep({ dropKnuckles: 3 })).shots[0].metrics.wristSnapDeg == null, 'with no knuckles at all it reports nothing rather than guessing');
  // and it survives jitter, which one knuckle on its own did not
  let worst = 0;
  for (let seed = 1; seed <= 12; seed++) { const v = run(jitter(rep(), 3, seed)).shots[0]; if (v && v.metrics.wristSnapDeg != null) worst = Math.max(worst, Math.abs(v.metrics.wristSnapDeg - 50)); }
  ok(worst < 22, 'wrist snap under jitter stays within 22 degrees of the truth', worst.toFixed(0));
}

// ---------- setting the ideal form from a photo ----------
// The finding this exists to answer: two of three reference photos were not side on, so no angle could be read off
// them. In three dimensions the joint angle is the same from any camera, which is the whole point.
console.log('reference photo');
{
  const { readReferencePose, bandsFromReference, angle3 } = api;
  ok(near(angle3({x:0,y:0,z:0},{x:1,y:0,z:0},{x:1,y:1,z:0}), 90, 1e-9), 'a right angle in the picture plane');
  ok(near(angle3({x:0,y:0,z:0},{x:1,y:0,z:0},{x:1,y:0,z:1}), 90, 1e-9), 'and the same angle turned out of the picture plane');
  // a shooter posed with a known 95 degree elbow and 120 degree knee, rendered at four camera yaws
  const posed = yawDeg => {
    const yaw = yawDeg * Math.PI / 180, rotY = p => ({ x: p.x * Math.cos(yaw) + p.z * Math.sin(yaw), y: p.y, z: -p.x * Math.sin(yaw) + p.z * Math.cos(yaw) });
    const A = 95 * Math.PI / 180, K = 120 * Math.PI / 180;
    const w3 = { 12: {x:0,y:-0.5,z:0}, 14: {x:0.17,y:-0.32,z:0.02}, 16: null,
      24: {x:0.02,y:0,z:0}, 26: {x:0.06,y:0.42,z:0.10}, 28: null, 23: {x:-0.16,y:0,z:0}, 25: {x:-0.12,y:0.42,z:0.10}, 27: null,
      0: {x:0.04,y:-0.72,z:0.06}, 7: {x:-0.06,y:-0.70,z:0}, 8: {x:0.10,y:-0.70,z:0}, 11: {x:-0.18,y:-0.5,z:0},
      20: null, 18: null, 22: null, 13: {x:-0.30,y:-0.30,z:0.02}, 15: {x:-0.28,y:-0.05,z:0.02} };
    // wrist placed to make the elbow exactly A, ankles to make the knee exactly K
    const arm = (sho, elb, ang) => { const u = { x: sho.x-elb.x, y: sho.y-elb.y, z: sho.z-elb.z }, n = Math.hypot(u.x,u.y,u.z);
      const ux = { x:u.x/n, y:u.y/n, z:u.z/n }, perp = { x:-ux.y, y:ux.x, z:0 }, pn = Math.hypot(perp.x,perp.y,perp.z) || 1;
      const px = { x:perp.x/pn, y:perp.y/pn, z:perp.z/pn }, L = 0.26;
      return { x: elb.x + L*(Math.cos(ang)*ux.x + Math.sin(ang)*px.x), y: elb.y + L*(Math.cos(ang)*ux.y + Math.sin(ang)*px.y), z: elb.z + L*(Math.cos(ang)*ux.z + Math.sin(ang)*px.z) };
    };
    w3[16] = arm(w3[12], w3[14], A); w3[28] = arm(w3[24], w3[26], K); w3[27] = arm(w3[23], w3[25], K);
    w3[20] = { x: w3[16].x + 0.06, y: w3[16].y - 0.04, z: w3[16].z }; w3[18] = { x: w3[16].x + 0.05, y: w3[16].y - 0.05, z: w3[16].z }; w3[22] = { x: w3[16].x + 0.07, y: w3[16].y - 0.03, z: w3[16].z };
    const lm3 = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    const lm2 = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
    for (const [k, p] of Object.entries(w3)) { const q = rotY(p); lm3[k] = { ...q, visibility: 0.95 };
      lm2[k] = { x: 0.5 + q.x * 0.6, y: 0.5 + q.y * 0.6, visibility: 0.95 }; }
    return { lm2, lm3 };
  };
  const reads = [0, 30, 60, 90].map(y => { const { lm2, lm3 } = posed(y); return readReferencePose(lm2, lm3); });
  ok(reads.every(r => near(r.elbowDeg, 95, 2)), 'the elbow reads 95 from every camera angle', reads.map(r => r.elbowDeg.toFixed(0)).join(' / '));
  ok(reads.every(r => near(r.kneeDeg, 120, 3)), 'and the knee reads 120 from every camera angle', reads.map(r => r.kneeDeg.toFixed(0)).join(' / '));
  // yaw 0 puts the shoulders across the frame, which is the view facing the camera; yaw 90 turns them side on
  ok(reads[3].view === 'side on' && reads[0].view !== 'side on', 'the view itself is reported, and it is reported right', reads.map(r => r.view).join(' / '));
  ok(reads[0].cameraDependent.includes('trunkLeanDeg'), 'lean is declared camera dependent');
  // bands come out as a band around what the photo showed, never a point
  const b = bandsFromReference(reads[3], 'release');
  ok(b.elbowReleaseDeg && b.elbowReleaseDeg.hi > b.elbowReleaseDeg.lo, 'a photo becomes a band, not a single number', JSON.stringify(b.elbowReleaseDeg));
  ok(near((b.elbowReleaseDeg.lo + b.elbowReleaseDeg.hi) / 2, 95, 1), 'centred on what the photo showed');
  ok(bandsFromReference(reads[3], 'set').elbowSetDeg != null, 'the set-point phase maps to the set-point band');
  ok(Object.keys(bandsFromReference({ missing: [], cameraDependent: [] }, 'release')).length === 0, 'a photo with nothing readable yields no bands');
  // and those bands are usable
  setTargetEdits({ elbowReleaseDeg: { lo: b.elbowReleaseDeg.lo, hi: b.elbowReleaseDeg.hi } });
  ok(api.TARGETS.find(t => t.key === 'elbowReleaseDeg').edited === true, 'a band set from a photo is marked coach set');
  setTargetEdits({});
}

// ---------- the coach's ideal form ----------
// The coach can move any band, but a moved band must not keep borrowing the paper's authority, and a typo must not
// silently become the standard the athlete is graded against.
console.log('ideal form');
{
  const s = run(rep()).shots[0], m = s.metrics;
  const elbow = () => api.TARGETS.find(t => t.key === 'elbowReleaseDeg');
  ok(elbow().lo === defaultTarget('elbowReleaseDeg').lo, 'with no edits the published band is in force', elbow().lo);
  setTargetEdits({ elbowReleaseDeg: { lo: 172, hi: 180 } });
  ok(elbow().lo === 172 && elbow().edited === true, 'a coach-set band takes effect and is marked', `${elbow().lo} edited:${elbow().edited}`);
  const strict = evaluate({ ...m, releaseBy: 'ball' });
  ok(strict.some(c => c.key === 'elbowReleaseDeg'), 'a rep that passed the published band can fail a stricter one');
  setTargetEdits({ elbowReleaseDeg: { lo: 120, hi: 180 } });
  ok(!evaluate({ ...m, releaseBy: 'ball' }).some(c => c.key === 'elbowReleaseDeg'), 'and passes a softer one');
  // a backwards or nonsense range is refused, not applied
  setTargetEdits({ elbowReleaseDeg: { lo: 180, hi: 120 } });
  ok(elbow().lo === defaultTarget('elbowReleaseDeg').lo, 'a backwards range falls back to the published one', elbow().lo);
  setTargetEdits({ elbowReleaseDeg: { lo: 'x', hi: null } });
  ok(Number.isFinite(elbow().lo), 'nonsense in the box never produces a NaN band', elbow().lo);
  setTargetEdits({ holdSec: { lo: 0.9, hi: null } });
  ok(api.TARGETS.find(t => t.key === 'holdSec').hi === Infinity && targetText(api.TARGETS.find(t => t.key === 'holdSec')) === 'at least 0.9', 'an open-ended band stays open-ended', targetText(api.TARGETS.find(t => t.key === 'holdSec')));
  setTargetEdits({ launchAngleDeg: { lo: 40, hi: 60 } });
  ok(csvOf([s]).split('\r\n')[0].includes('Launch angle'), 'the spreadsheet still exports after a band moves');
  setTargetEdits({});
  ok(elbow().lo === defaultTarget('elbowReleaseDeg').lo && !elbow().edited, 'reset puts every published band back');
}

// ---------- the saved animation ----------
console.log('animation');
{
  const s = run(rep()).shots[0];
  ok(Array.isArray(s.anim) && s.anim.length === 16, 'every rep carries a sixteen frame flip-book', s.anim && s.anim.length);
  ok(s.anim[0].t < 0 && s.anim[s.anim.length - 1].t > 0, 'the flip-book spans the dip through the follow-through', `${s.anim[0].t} to ${s.anim[s.anim.length - 1].t}`);
  const svg = animSvg(s);
  ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.endsWith('</svg>'), 'it is a standalone svg document');
  ok((svg.match(/class="f[ "]/g) || []).length === 16, 'one group per frame', (svg.match(/class="f[ "]/g) || []).length);
  ok(/class="f key"/.test(svg), 'the release frame is opaque, so a viewer with no animation still shows the shot');
  ok(/@keyframes fb/.test(svg) && /animation-delay/.test(svg), 'the flip-book is driven by css, not by script');
  ok(!/<script|onload=|href=/.test(svg), 'the saved animation carries no script and no external reference');
  ok(!/<image|data:image|<video/.test(svg), 'and no pixels: it is joint coordinates only');
  ok(/prefers-reduced-motion/.test(svg), 'reduced motion is honoured inside the saved file');
  const withName = animSvg({ ...s, athlete: '<script>x</script>', drill: 'A & B' });
  ok(!/<script>x/.test(withName) && /&lt;script&gt;/.test(withName), 'a name is escaped into the saved file', withName.includes('&lt;script&gt;'));
  ok(/A &amp; B/.test(withName), 'an ampersand in a drill name is escaped');
  // the animation must survive the round trip through the browser's store
  const back = JSON.parse(JSON.stringify(s));
  ok(animSvg(back).length === svg.length, 'it rebuilds identically after being saved and reloaded');
  ok(JSON.stringify(s.anim).length < 9000, 'a rep\'s flip-book stays small enough to keep forty of them', JSON.stringify(s.anim).length + ' bytes');
}
console.log(`${n - fails} passed, ${fails} failed of ${n}`);
process.exit(fails ? 1 : 0);
