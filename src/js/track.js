/* The site's own visit counter. Tells server/functions/track.mjs which page was viewed, how
   this visit arrived (a search engine, Instagram, one of Coach Blake's tracked links, typed in),
   and roughly how long the page was looked at. It also puts that source on every form as a
   hidden `trk` field, so an enquiry or a registration says how the family found the site.

   First-party only: no cookie and no third party. Two random ids live in this browser, one
   for the browser (localStorage, so a returning visitor counts once) and one for the visit
   (sessionStorage, rolling over after 30 idle minutes). Nothing typed into a page is sent.

   A tracked link marked as the developer's (?via=<id>) also answers the intake question for
   the family: once the server confirms the link, the "How did you hear about us?" field steps
   aside and the form carries the link id instead. The server re-checks that id at checkout;
   nothing here is trusted with money. */
(function(){
  if(window.top !== window.self) return;              /* the admin preview and canvas frames */
  var path = location.pathname;
  if(/^\/(admin|api)(\/|$)/.test(path)) return;

  function get(store, k){ try { return window[store].getItem(k); } catch(e){ return null; } }
  function set(store, k, v){ try { window[store].setItem(k, v); } catch(e){} }
  function del(store, k){ try { window[store].removeItem(k); } catch(e){} }
  function rid(){
    var a = new Uint8Array(12), s = '';
    try { crypto.getRandomValues(a); } catch(e){ for(var j = 0; j < 12; j++) a[j] = Math.random() * 256; }
    for(var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36);
    return s + Date.now().toString(36);
  }
  function read(store, k){ try { return JSON.parse(get(store, k) || 'null'); } catch(e){ return null; } }

  /* Coach Blake's own visits are not traffic: the admin panel sets this on his device. They
     still ask about a claim, so a link he is testing behaves exactly as a family sees it. */
  var noTrack = get('localStorage', 'fb_notrack') === '1';

  var vid = get('localStorage', 'fb_vid');
  var nv = false;
  if(!vid){ vid = rid(); nv = true; set('localStorage', 'fb_vid', vid); }

  var q;
  try { q = new URLSearchParams(location.search); } catch(e){ q = { get: function(){ return null; } }; }
  var ref = '';
  try {
    var r = document.referrer ? new URL(document.referrer) : null;
    /* Stripe's checkout sending a family back is the same visit, not a new source. Only the host
       is kept: a social site's referrer can be a long redirect URL carrying anything. */
    if(r && r.host !== location.host && !/(^|\.)stripe\.com$/.test(r.hostname)) ref = r.hostname;
  } catch(e){}
  var tagged = q.get('via') || q.get('utm_source') || q.get('gclid') || q.get('wbraid') || q.get('gbraid') || q.get('fbclid');

  /* A visit ends after 30 quiet minutes, or when a new tag or an outside referrer brings the
     visitor back, which is how Google Analytics draws the same line. */
  var now = Date.now();
  var sid = get('sessionStorage', 'fb_sid');
  var last = Number(get('sessionStorage', 'fb_seen')) || 0;
  var arrival = read('sessionStorage', 'fb_ss');
  /* A reload keeps its address and its referrer, and is the same visit: only a DIFFERENT tag or
     referrer starts a new one. */
  var newTag = !!tagged && (!arrival || (arrival.tag || '') !== tagged);
  var newRef = !!ref && (!arrival || arrival.ref !== ref);
  var fresh = !sid || now - last > 30 * 60 * 1000 || newTag || newRef;
  if(fresh){
    sid = rid();
    arrival = {
      via: q.get('via') || '',
      src: q.get('utm_source') || (q.get('fbclid') ? 'facebook' : ''),
      med: q.get('utm_medium') || '',
      camp: q.get('utm_campaign') || '',
      paid: !!(q.get('gclid') || q.get('wbraid') || q.get('gbraid')),
      ref: ref,
      landing: path,
      tag: tagged || '',
      at: new Date(now).toISOString()
    };
    set('sessionStorage', 'fb_sid', sid);
    set('sessionStorage', 'fb_ss', JSON.stringify(arrival));
  }
  set('sessionStorage', 'fb_seen', String(now));
  /* The FIRST time this browser ever found the site. Section 7 of the website agreement counts
     "first recorded contact", so a later visit never overwrites it. */
  var first = read('localStorage', 'fb_ft');
  if(!first && arrival){ first = arrival; set('localStorage', 'fb_ft', JSON.stringify(first)); }

  /* A personal-link claim lasts CLAIM_DAYS from the link being opened, then this browser is an
     ordinary visitor again, so a family who tapped a link long ago and signed up for some other
     reason is asked like everyone else. The admin's own device (noTrack) never keeps one at all:
     otherwise a link Blake or Josiah opened to check would claim every registration typed on
     that phone afterwards. */
  var CLAIM_DAYS = 90;
  var claim = get('localStorage', 'fb_claim') || '';
  if(claim && (noTrack || now - (Number(get('localStorage', 'fb_claim_at')) || 0) > CLAIM_DAYS * 864e5)){
    claim = ''; del('localStorage', 'fb_claim'); del('localStorage', 'fb_claim_at');
  }
  function keepClaim(id){
    claim = id;
    if(noTrack) return;
    if(get('localStorage', 'fb_claim') !== id) set('localStorage', 'fb_claim_at', String(Date.now()));
    set('localStorage', 'fb_claim', id);
  }
  var hasIntake = false;

  function send(body, beacon){
    body.vid = vid; body.sid = sid;
    if(noTrack) body.nt = true;
    var json = JSON.stringify(body);
    if(beacon && navigator.sendBeacon){
      try { if(navigator.sendBeacon('/api/track', new Blob([json], { type: 'application/json' }))) return null; } catch(e){}
    }
    try {
      return fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true, credentials: 'omit' });
    } catch(e){ return null; }
  }

  /* ---- forms: the hidden source field, and the intake question on a developer link */
  function stamp(form){
    var t = form.querySelector('input[name="trk"]');
    if(!t){ t = document.createElement('input'); t.type = 'hidden'; t.name = 'trk'; form.appendChild(t); }
    t.value = JSON.stringify({ vid: vid, ft: first, ss: arrival });
    var c = form.querySelector('input[name="claim"]');
    if(claim){
      if(!c){ c = document.createElement('input'); c.type = 'hidden'; c.name = 'claim'; form.appendChild(c); }
      c.value = claim;
    } else if(c){ c.parentNode.removeChild(c); }
  }
  function stampAll(){ for(var i = 0; i < document.forms.length; i++) stamp(document.forms[i]); }
  /* Capture phase, so the fields are current before any form's own submit handler reads them. */
  document.addEventListener('submit', function(e){ if(e.target && e.target.tagName === 'FORM') stamp(e.target); }, true);

  function intake(on){
    var sel = document.querySelectorAll('select[name="hearAbout"]');
    for(var i = 0; i < sel.length; i++){
      var box = sel[i].closest('.fld') || sel[i].parentNode;
      var other = sel[i].form && sel[i].form.querySelector('[name="hearAboutOther"]');
      var otherBox = other && (other.closest('.fld') || other.parentNode);
      /* style.display, not the hidden attribute: .fld sets its own display and would win. */
      box.style.display = on ? 'none' : '';
      if(otherBox) otherBox.style.display = on ? 'none' : '';
      if(on){ sel[i].dataset.wasRequired = sel[i].required ? '1' : ''; sel[i].required = false; }
      else if(sel[i].dataset.wasRequired === '1') sel[i].required = true;
      var note = box.parentNode.querySelector('.fld-claim');
      if(on && !note){
        note = document.createElement('p');
        note.className = 'fld-claim';
        note.style.cssText = 'margin:0 0 16px;font-size:.92rem;line-height:1.5;opacity:.85;';
        note.textContent = 'You came here through a personal link, so we already know how you found us. No need to answer how you heard about us.';
        box.parentNode.insertBefore(note, box);
      } else if(!on && note){ note.parentNode.removeChild(note); }
    }
  }

  /* enroll.js fires this when checkout asks for the intake answer after all. */
  document.addEventListener('fb:unclaim', function(){
    claim = '';
    del('localStorage', 'fb_claim'); del('localStorage', 'fb_claim_at');
    intake(false);
    stampAll();
  });

  function ready(fn){ if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){
    hasIntake = !!document.querySelector('select[name="hearAbout"]');
    stampAll();
    var body = { t: 'pv', p: path, nv: nv, w: window.innerWidth || 0 };
    if(fresh) body.s = arrival;
    /* Ask about a stored claim only where it changes something on this page. The question only
       steps aside once the server has confirmed a claim ON THIS PAGE: if the answer never
       comes, the family simply answers it, which checkout accepts either way. */
    if(claim && hasIntake) body.c = claim;
    var asked = (fresh && arrival.via) || body.c;
    var req = send(body, false);
    if(!req || !asked) return;
    req.then(function(res){ return res.status === 200 ? res.json() : null; }).then(function(out){
      if(!out) return;
      if(out.claim && out.id) keepClaim(out.id);
      else if(body.c){ claim = ''; del('localStorage', 'fb_claim'); del('localStorage', 'fb_claim_at'); }
      intake(!!(out.claim && out.id));
      stampAll();
    }).catch(function(){});
  });

  /* ---- time on page: only while the tab is actually visible */
  var shownAt = document.visibilityState === 'visible' ? Date.now() : 0;
  function flush(){
    if(!shownAt) return;
    var ms = Date.now() - shownAt;
    shownAt = 0;
    if(ms > 500) send({ t: 'lv', ms: ms }, true);
  }
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden') flush();
    else { shownAt = Date.now(); set('sessionStorage', 'fb_seen', String(Date.now())); }
  });
  window.addEventListener('pagehide', flush);
})();
