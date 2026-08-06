/* Night Court slingshot — shared by the design preview and the shipped site.
   Angry-Birds mechanic: grab the ball, pull back against a band, release.
   Pointer Events only (mouse + iPhone touch). Every coordinate is derived from
   live rects, so the same code runs the 1240x560 desktop court and the 320x400
   phone court, including the 1.3x tablet scale. No dependencies. */

const BALL_SVG = '<svg class="bb" viewBox="0 0 44 44" aria-hidden="true"><defs><radialGradient id="bbShade2" cx="0.34" cy="0.28" r="0.85"><stop offset="0" stop-color="#FF3A41"></stop><stop offset="0.52" stop-color="#E60C20"></stop><stop offset="1" stop-color="#8E0F14"></stop></radialGradient></defs><circle cx="22" cy="22" r="21" fill="url(#bbShade2)"></circle><circle cx="15" cy="13" r="6" fill="rgba(255,255,255,.22)"></circle><g fill="none" stroke="rgba(10,10,12,.55)" stroke-width="1.5"><path d="M1 22 H43"></path><path d="M22 1 V43"></path><path d="M8.5 6.5 C16 14.5 16 29.5 8.5 37.5"></path><path d="M35.5 6.5 C28 14.5 28 29.5 35.5 37.5"></path></g><circle cx="22" cy="22" r="21.2" fill="none" stroke="rgba(10,10,12,.4)" stroke-width="1.2"></circle></svg>';

export function initNightCourt(stage, opts = {}){
  const court = stage.querySelector('.nite-court') || stage;
  const ball = stage.querySelector('.nball');
  const inner = ball && ball.querySelector('i');
  const rim = stage.querySelector('.rim');
  const board = stage.querySelector('.board');
  const net = stage.querySelector('.net');
  const flash = stage.querySelector('.swish-flash');
  const btn = document.getElementById('niteShotBtn') || stage.querySelector('.nite-cta .btn');
  const makesEl = stage.querySelector('.makes b');
  const reduced = opts.reduced != null ? opts.reduced : matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!court || !ball || !rim) return { destroy(){} };

  if(inner && !inner.querySelector('svg')) inner.innerHTML = BALL_SVG;

  const NS = 'http://www.w3.org/2000/svg';
  const sling = document.createElementNS(NS, 'svg');
  sling.setAttribute('class', 'nite-sling');
  sling.setAttribute('aria-hidden', 'true');
  const band = document.createElementNS(NS, 'line');
  sling.appendChild(band);
  const dots = [];
  for(let i = 0; i < 9; i++){
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', 'dot');
    c.setAttribute('r', '3');
    sling.appendChild(c);
    dots.push(c);
  }
  sling.hidden = true;
  court.appendChild(sling);

  let score = 0, mode = 'idle', raf = 0, drag = null;

  const geo = () => {
    const cr = court.getBoundingClientRect();
    const sx = (cr.width / court.offsetWidth) || 1;
    const W = court.offsetWidth, H = court.offsetHeight;
    const center = r => ({ x: (r.left + r.width / 2 - cr.left) / sx, y: (r.top + r.height / 2 - cr.top) / sx });
    const rrect = rim.getBoundingClientRect();
    const brect = board && board.getBoundingClientRect();
    return {
      cr, sx, W, H,
      g: H * 2.7,
      rim: center(rrect),
      rimHalf: (rrect.width / sx) / 2,
      board: brect ? {
        left: (brect.left - cr.left) / sx, right: (brect.right - cr.left) / sx,
        top: (brect.top - cr.top) / sx, bottom: (brect.bottom - cr.top) / sx
      } : null
    };
  };
  const ballR = () => ball.offsetWidth / 2;
  const toLocal = (e, G) => ({ x: (e.clientX - G.cr.left) / G.sx, y: (e.clientY - G.cr.top) / G.sx });
  const setBall = p => { ball.style.transform = 'translate(' + (p.x - ballR()) + 'px,' + (p.y - ballR()) + 'px)'; };
  const freeBall = () => {
    ball.classList.remove('idle');
    ball.style.offsetPath = 'none';
    ball.style.left = '0px';
    ball.style.top = '0px';
    ball.style.animation = 'none';
    if(inner) inner.style.animation = 'none';
  };
  const reset = () => {
    cancelAnimationFrame(raf);
    ball.removeAttribute('style');
    if(inner) inner.removeAttribute('style');
    ball.classList.add('idle');
    sling.hidden = true;
    mode = 'idle';
  };

  // Perfect-shot solution anchor->rim (flight time scaled to court height):
  // used to calibrate the pull strength and to power the button's auto shot.
  const solve = (a, G) => {
    const T = 0.85 * Math.sqrt(G.H / 560);
    return { vx: (G.rim.x - a.x) / T, vy: ((G.rim.y - a.y) - 0.5 * G.g * T * T) / T };
  };

  const celebrate = () => {
    if(board) board.classList.add('hit');
    if(rim) rim.classList.add('hit');
    if(net) net.classList.add('sway');
    if(flash) flash.classList.add('on');
    score++;
    if(opts.onScore) opts.onScore(score); else if(makesEl) makesEl.textContent = score;
    if(opts.onMake) opts.onMake(score);
    setTimeout(() => {
      if(board) board.classList.remove('hit');
      if(rim) rim.classList.remove('hit');
      if(net) net.classList.remove('sway');
      if(flash) flash.classList.remove('on');
    }, 950);
  };

  const fly = (p, v, G) => {
    mode = 'fly';
    let x = p.x, y = p.y, rot = 0, t = 0, prev = performance.now(), prevY = y;
    const step = now => {
      const dt = Math.min((now - prev) / 1000, 0.03);
      prev = now; t += dt;
      v.vy += G.g * dt;
      x += v.vx * dt; y += v.vy * dt;
      rot += (Math.hypot(v.vx, v.vy) * dt / ballR()) * 57.3 * (v.vx < 0 ? -1 : 1);
      const r = ballR();
      // No backboard carom: a bank shot that kicks back at the shooter reads as
      // a bug on a 1240px stage. Overshoot the rim and it is a miss.
      if(prevY <= G.rim.y && y >= G.rim.y && v.vy > 0){              // rim plane
        const off = Math.abs(x - G.rim.x);
        if(off < G.rimHalf * 1.15){                                  // through
          setBall({ x: G.rim.x, y: G.rim.y + 4 });
          mode = 'drop';
          celebrate();
          const t0 = performance.now();
          const drop = n => {
            // The net grabs the ball for a beat, then gravity takes it.
            const k = Math.min((n - t0) / 430, 1);
            const e = 0.18 * k + 0.82 * k * k;
            setBall({ x: G.rim.x, y: G.rim.y + 4 + 88 * e });
            ball.style.opacity = String(1 - k * k);
            if(k < 1) raf = requestAnimationFrame(drop); else setTimeout(reset, 620);
          };
          raf = requestAnimationFrame(drop);
          return;
        }
        if(off < G.rimHalf * 1.7){ v.vy = -Math.abs(v.vy) * 0.45; v.vx *= 0.6; y = G.rim.y - 1; } // clank
      }
      prevY = y;
      setBall({ x, y });
      if(inner) inner.style.transform = 'rotate(' + rot + 'deg)';
      if(y - r > G.H + 60 || x < -90 || x > G.W + 90 || t > 3.5){
        if(opts.onMiss) opts.onMiss();
        ball.style.opacity = '0';
        setTimeout(reset, 240);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };

  const updateAim = (pos, v, G) => {
    band.setAttribute('x1', drag.anchor.x); band.setAttribute('y1', drag.anchor.y);
    band.setAttribute('x2', pos.x); band.setAttribute('y2', pos.y);
    for(let i = 0; i < dots.length; i++){
      const t = 0.07 * (i + 1);
      dots[i].setAttribute('cx', pos.x + v.vx * t);
      dots[i].setAttribute('cy', pos.y + v.vy * t + 0.5 * G.g * t * t);
      dots[i].setAttribute('opacity', String(1 - i / dots.length));
    }
  };

  const onDown = e => {
    if(mode !== 'idle') return;
    const G = geo();
    const brect = ball.getBoundingClientRect();
    const anchor = { x: (brect.left + brect.width / 2 - G.cr.left) / G.sx, y: (brect.top + brect.height / 2 - G.cr.top) / G.sx };
    const ideal = solve(anchor, G);
    drag = { G, anchor, pos: { x: anchor.x, y: anchor.y }, k: Math.hypot(ideal.vx, ideal.vy) / (0.084 * G.H), max: 0.16 * G.H };
    freeBall();
    setBall(anchor);
    sling.setAttribute('viewBox', '0 0 ' + G.W + ' ' + G.H);
    sling.hidden = false;
    mode = 'aim';
    ball.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = e => {
    if(mode !== 'aim') return;
    const G = drag.G;
    const p = toLocal(e, G);
    let dx = p.x - drag.anchor.x, dy = p.y - drag.anchor.y;
    const len = Math.hypot(dx, dy);
    if(len > drag.max){ dx *= drag.max / len; dy *= drag.max / len; }
    drag.pos = { x: drag.anchor.x + dx, y: drag.anchor.y + dy };
    setBall(drag.pos);
    updateAim(drag.pos, { vx: -dx * drag.k, vy: -dy * drag.k }, G);
    e.preventDefault();
  };
  const onUp = e => {
    if(mode !== 'aim') return;
    sling.hidden = true;
    const dx = drag.pos.x - drag.anchor.x, dy = drag.pos.y - drag.anchor.y;
    if(Math.hypot(dx, dy) < 6){ reset(); return; }
    fly(drag.pos, { vx: -dx * drag.k, vy: -dy * drag.k }, drag.G);
    e.preventDefault();
  };
  const autoShot = () => {
    if(mode !== 'idle') return;
    if(reduced){ celebrate(); return; }
    const G = geo();
    const brect = ball.getBoundingClientRect();
    const anchor = { x: (brect.left + brect.width / 2 - G.cr.left) / G.sx, y: (brect.top + brect.height / 2 - G.cr.top) / G.sx };
    freeBall();
    setBall(anchor);
    fly(anchor, solve(anchor, G), G);
  };

  ball.addEventListener('pointerdown', onDown);
  ball.addEventListener('pointermove', onMove);
  ball.addEventListener('pointerup', onUp);
  ball.addEventListener('pointercancel', onUp);
  if(btn) btn.addEventListener('click', autoShot);

  return {
    destroy(){
      cancelAnimationFrame(raf);
      ball.removeEventListener('pointerdown', onDown);
      ball.removeEventListener('pointermove', onMove);
      ball.removeEventListener('pointerup', onUp);
      ball.removeEventListener('pointercancel', onUp);
      if(btn) btn.removeEventListener('click', autoShot);
      if(sling.parentNode) sling.parentNode.removeChild(sling);
    }
  };
}

/* Shipped-site boot: <div class="nite-stage" data-auto-nite> self-initialises;
   a make hands off to window.fbNiteMade (quick lockup cut -> contact card). */
if(typeof window !== 'undefined'){
  window.FBNightCourt = { init: initNightCourt };
  const boot = () => {
    const s = document.querySelector('.nite-stage[data-auto-nite]');
    if(s && !s.__nite) s.__nite = initNightCourt(s, { onMake(){ if(window.fbNiteMade) window.fbNiteMade(); } });
  };
  if(document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();
}
