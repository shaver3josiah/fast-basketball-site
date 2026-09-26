(function(){
  'use strict';
  var form = document.getElementById('enForm');
  if(!form) return;

  /* The markup keeps `required` so native validation still fires if this script fails to
     load. With JS the messages below take over, the way contact-form.js does with novalidate. */
  form.setAttribute('novalidate', '');

  var emailInput = document.getElementById('en_email');
  var hp = document.getElementById('enHp');
  var payBox = document.getElementById('enPay');
  var formErr = document.getElementById('enErr');
  var btn = form.querySelector('button[type="submit"]');
  var btnLabel = btn ? btn.textContent : '';
  /* No number here since September 2026: scrapers read script files too. */
  var RETRY = 'That did not go through. Try again, or send a note through the contact page and Coach Blake will take it from there.';
  var STORE = 'fb_enroll';
  /* Server error keys that are not registration fields, and the element each one marks. */
  var FIXED = { reviewed: 'enReviewed', terms: 'enTerms' };

  /* Flipped true the moment the form is on its way to Stripe (or saved when Stripe is not
     ready yet), so the leave beacon below does not ping Blake that a family "did not finish"
     when they did. */
  var submitted = false;

  function say(msg){ if(window.fbToast) window.fbToast(msg); }

  function showFormErr(msg){
    if(!formErr) return;
    formErr.textContent = msg || '';
    formErr.style.display = msg ? 'block' : 'none';
  }

  function clearErr(input){
    if(!input || !input.closest) return;
    var fld = input.closest('.fld');
    if(!fld) return;
    fld.classList.remove('err');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    var m = fld.querySelector('.f-err');
    if(m) fld.removeChild(m);
  }

  function setErr(input, msg){
    clearErr(input);
    var fld = input.closest('.fld');
    if(!fld) return;
    fld.classList.add('err');
    input.setAttribute('aria-invalid', 'true');
    var m = document.createElement('span');
    m.className = 'f-err';
    m.id = input.id + 'Err';
    m.textContent = msg;
    input.setAttribute('aria-describedby', m.id);
    fld.appendChild(m);
  }

  function emailOk(v){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }

  function checked(name){ return form.querySelector('input[name="' + name + '"]:checked'); }

  /* Plan -> pay. The card carries one amount line per pay option it actually prices
     (data-full / data-monthly, written by build.mjs from the catalog). Some plans price
     only one: evaluations, and the Unlimited memberships, which the September 2026 sheet
     gives a single figure. Those fold the pay step away and select the one option they do
     price. An option the card does not price is disabled, so a stale radio can never post a
     combination checkoutSpec() would throw on. */
  function syncPay(){
    var plan = checked('plan');
    var card = plan && plan.closest ? plan.closest('.en-card') : null;
    var pays = form.querySelectorAll('input[name="pay"]');
    var offered = 0;
    for(var i = 0; i < pays.length; i++){
      var line = card ? card.getAttribute('data-' + pays[i].value) : '';
      var span = pays[i].parentNode.querySelector('.en-pay-a');
      if(span) span.textContent = line || '';
      pays[i].disabled = !!card && !line;
      if(pays[i].disabled && pays[i].checked) pays[i].checked = false;
      if(line) offered++;
    }
    /* One priced option: select that one and fold the step away. Take whichever option the
       card actually prices rather than assuming it is 'full'. The loop skips disabled radios,
       so it picks the priced option by construction. */
    if(card && offered < 2){
      for(var j = 0; j < pays.length; j++){
        if(pays[j].disabled) continue;
        pays[j].checked = true;
        break;
      }
    }
    if(payBox) payBox.hidden = !!card && offered < 2;
  }

  /* ?plan= / ?pay= preselect by value. Compared in a loop rather than spliced into a
     selector so a crafted query string can never become a selector. */
  function pick(name, value){
    if(!value) return;
    var inputs = form.querySelectorAll('input[name="' + name + '"]');
    for(var i = 0; i < inputs.length; i++){
      if(inputs[i].value !== value) continue;
      inputs[i].checked = true;
      /* The 48-hour evaluation rate is linked, never listed: only its own link reveals it. */
      var card = inputs[i].closest ? inputs[i].closest('.en-card') : null;
      if(card) card.hidden = false;
      return;
    }
  }

  /* ---- The typed answers live for the tab. Stripe's cancel link lands back here, and
     thirty empty fields after one "back" is how a family gives up. The policy number is not
     kept: retyping one line is the right price for not parking an insurance number in the
     browser. Radios are not kept either; ?plan= handles those. */
  var SKIP = { 'en-hp': 1, insurancePolicy: 1, plan: 1, pay: 1 };
  function remember(){
    var data = {};
    for(var i = 0; i < form.elements.length; i++){
      var el = form.elements[i];
      if(!el.name || SKIP[el.name] || !/^(text|email|tel|date|select-one|textarea)$/.test(el.type)) continue;
      data[el.name] = el.value;
    }
    try { sessionStorage.setItem(STORE, JSON.stringify(data)); } catch(e){}
  }
  function restore(){
    var data = null;
    try { data = JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch(e){}
    if(!data || typeof data !== 'object') return;
    for(var k in data){
      if(!Object.prototype.hasOwnProperty.call(data, k) || SKIP[k] || typeof data[k] !== 'string') continue;
      var el = form.elements[k];
      if(el && el.tagName && !el.value) el.value = data[k];
    }
  }
  restore();

  var q = null;
  try { q = new URLSearchParams(window.location.search); } catch(e){}
  if(q){
    pick('plan', q.get('plan'));
    pick('pay', q.get('pay'));
    if(emailInput && q.get('email')) emailInput.value = q.get('email');
    if(q.get('err') === '1') showFormErr(RETRY);
  }

  /* The campaign tag off an approved tracked link. Kept for the tab because Stripe's cancel
     link comes back to /enroll?plan=..&pay=.. and drops everything else, so without this a
     family who reached Stripe and changed their mind would lose the tag on the try that
     counts. The URL wins when it has one; the stored value only fills a gap. Whether the tag
     means anything at all is decided server-side against the approved list, never here. */
  var campaign = '';
  try {
    campaign = (q && q.get('camp')) || sessionStorage.getItem(STORE + '_camp') || '';
    if(campaign) sessionStorage.setItem(STORE + '_camp', campaign);
  } catch(e){ campaign = (q && q.get('camp')) || ''; }
  syncPay();

  /* ---- A deal link (/enroll?deal=<id>): Blake's own price for one family. The catalog cards
     step aside and one card for the deal takes their place, built from /api/deal. It carries
     the same data-full / data-monthly lines as a catalog card, so syncPay and the pay radios
     work unchanged. The page only ever sends the deal's id back: checkout.mjs re-reads the deal
     from the server and prices it from there, so nothing written here can change the charge.
     No coupon on a deal (the deal IS the discount), and no published-rates fine print under it,
     which would contradict the price on the card. */
  var dealId = q ? q.get('deal') : '';
  if(dealId){
    var plansBox = form.querySelector('.en-plans');
    var cards = plansBox ? plansBox.querySelectorAll('.en-card') : [];
    for(var c = 0; c < cards.length; c++){
      cards[c].hidden = true;
      var r = cards[c].querySelector('input'); if(r){ r.checked = false; r.disabled = true; }
    }
    var couponFld = document.getElementById('en_coupon');
    if(couponFld && couponFld.closest) couponFld.closest('.fld').style.display = 'none';
    var fine = document.querySelector('.fine-print');
    if(fine) fine.style.display = 'none';
    var legend = plansBox && plansBox.parentNode.querySelector('.en-lg');
    if(legend && legend.lastChild) legend.lastChild.textContent = 'Your offer from Coach Blake';
    if(btn) btn.disabled = true;

    var money = function(cents){
      var s = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return '$' + s + (cents % 100 ? '.' + String(cents % 100).padStart(2, '0') : '');
    };
    var span = function(cls, text){ var s = document.createElement('span'); s.className = cls; if(text != null) s.textContent = text; return s; };

    fetch('/api/deal?id=' + encodeURIComponent(dealId)).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(r){ return { ok: res.ok, r: r }; });
    }).then(function(x){
      if(!x.ok || !x.r.deal) throw new Error(x.r.error || 'That offer link is not right. Ask Coach Blake to send it again.');
      var d = x.r.deal;
      var card = document.createElement('label');
      card.className = 'en-card';
      if(d.lines.full) card.setAttribute('data-full', d.lines.full);
      if(d.lines.monthly) card.setAttribute('data-monthly', d.lines.monthly);
      var radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'plan'; radio.value = 'deal'; radio.required = true; radio.checked = true;
      card.appendChild(radio);
      var b = span('en-card-b');
      b.appendChild(span('en-card-t', d.title));
      var price = span('prog-price', d.full ? money(d.full) : money(d.monthly.eachCents));
      var small = document.createElement('small');
      small.textContent = d.full ? 'paid in full' : 'a month for ' + d.monthly.payments + ' months';
      price.appendChild(small);
      b.appendChild(price);
      if(d.full && d.lines.monthly) b.appendChild(span('en-card-d', 'Or ' + d.lines.monthly + '.'));
      if(d.details) b.appendChild(span('en-card-d', d.details));
      b.appendChild(span('en-card-d', (d.forName ? 'Prepared for ' + d.forName + ' by Coach Blake.' : 'Prepared for your family by Coach Blake.') + ' This link is for your family only.'));
      card.appendChild(b);
      plansBox.appendChild(card);
      var idInput = document.createElement('input');
      idInput.type = 'hidden'; idInput.name = 'deal'; idInput.value = d.id;
      form.appendChild(idInput);
      if(btn) btn.disabled = false;
      syncPay();
    }).catch(function(err){
      var note = document.createElement('p');
      note.className = 'f-err';
      note.setAttribute('role', 'alert');
      note.textContent = err.message || 'That offer could not be loaded. Refresh the page, or ask Coach Blake to send the link again.';
      if(plansBox) plansBox.appendChild(note);
      if(payBox) payBox.hidden = true;
      if(btn) btn.textContent = 'This offer is not available';
    });
  }

  /* ---- Engagement beacon. Blake shares a private /enroll link per family, with a ?ref= tag
     the admin link builder adds. This tells him it was opened and for how long, and pings him
     if a tagged family looks and leaves without submitting. First-party, no cookies, no third
     party. A dropped beacon just misses a data point, so every branch is wrapped and quiet. */
  (function(){
    var vid = '';
    try { vid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ''; } catch(e){}
    if(!vid) vid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    var reff = q ? (q.get('ref') || '') : '';
    function send(event){
      var payload = JSON.stringify({ vid: vid, event: event, ref: reff, submitted: submitted });
      try {
        if(navigator.sendBeacon && navigator.sendBeacon('/api/enroll-visit', new Blob([payload], { type: 'application/json' }))) return;
      } catch(e){}
      try { fetch('/api/enroll-visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }); } catch(e){}
    }
    send('open');
    /* One leave per hidden transition; the flag resets if they come back, and the server
       takes the longest dwell it sees and emails at most once. */
    var leftSent = false;
    function leave(){ if(leftSent) return; leftSent = true; send('leave'); }
    document.addEventListener('visibilitychange', function(){
      if(document.visibilityState === 'hidden') leave(); else leftSent = false;
    });
    window.addEventListener('pagehide', leave);
  })();

  form.addEventListener('change', function(e){
    if(e.target.name === 'plan') syncPay();
  });
  form.addEventListener('input', function(e){
    clearErr(e.target);
    showFormErr('');
  });

  /* Every control in page order, so the first problem is the one that gets focus. The
     server checks all of this again (registration.mjs); this is the copy with manners. */
  function validate(){
    var bad = null;
    function flag(el, msg){ setErr(el, msg); if(!bad) bad = el; }
    var planSeen = false;
    var els = form.querySelectorAll('input, select, textarea');
    for(var i = 0; i < els.length; i++){
      var el = els[i];
      if(el === hp || el.name === 'pay' || el.type === 'hidden') continue;
      if(el.name === 'plan'){
        if(planSeen) continue;
        planSeen = true;
        if(!checked('plan')){
          showFormErr('Pick a plan. It is the one you settled on with Coach Blake.');
          if(!bad) bad = form.querySelector('.en-card:not([hidden]) input[name="plan"]') || el;
        }
        continue;
      }
      clearErr(el);
      if(el.type === 'checkbox'){
        if(el.required && !el.checked) flag(el, el.id === 'enTerms' ? 'Tick this once you have read the agreement.' : 'Tick this so we know a parent or guardian is enrolling. Players, grab a parent.');
        continue;
      }
      var v = (el.value || '').trim();
      if(!v){
        if(el.required) flag(el, 'Please fill this in.');
        continue;
      }
      if(el.type === 'email' && !emailOk(v)) flag(el, 'That email looks off. Check the spelling and try again.');
      else if(el.type === 'tel' && v.replace(/\D/g, '').length < 10) flag(el, 'Add the area code: ten digits.');
      else if(el.type === 'date' && !(/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z') < new Date())) flag(el, 'A date in the past, please.');
    }
    return bad;
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();
    showFormErr('');

    var bad = validate();
    if(bad){
      bad.focus();
      say('Check the highlighted fields');
      return;
    }
    remember();

    var plan = checked('plan');
    var pay = checked('pay');
    if(btn){ btn.disabled = true; btn.textContent = 'Saving your registration...'; }

    function fail(msg){
      /* ponytail: typed values stay in the DOM, so a retry costs the parent nothing. */
      showFormErr(msg);
      say('Registration did not go through');
      if(btn){ btn.disabled = false; btn.textContent = btnLabel; }
    }

    var data = {};
    new FormData(form).forEach(function(v, k){ if(typeof v === 'string') data[k] = v; });
    data.plan = plan.value;
    data.pay = pay ? pay.value : 'full';
    data.reviewed = document.getElementById('enReviewed').checked === true;
    data.terms = document.getElementById('enTerms').checked === true;
    data['en-hp'] = hp ? hp.value : '';
    if(campaign) data.campaign = campaign;
    /* The id from an earlier try in this tab, so a return from Stripe's cancel link rewrites
       the same pending registration instead of adding a second one. */
    try { data.registrationId = sessionStorage.getItem(STORE + '_id') || ''; } catch(err){}

    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(r){
        if(r.registrationId){ try { sessionStorage.setItem(STORE + '_id', r.registrationId); } catch(err){} }
        if(res.status === 200 && r.url){ submitted = true; window.location.assign(r.url); return; }
        if(res.status === 503){
          /* Saved, but Stripe cannot take this plan yet. Say so and leave the button down:
             a second click would only save the same registration again. Counts as submitted:
             Blake already got the registration email, so no "did not finish" ping. */
          submitted = true;
          showFormErr('Your registration is saved. Online payment opens soon, and Coach Blake will text you the payment link. Nothing more to do here.');
          say('Registration saved');
          if(btn) btn.textContent = 'Registration saved';
          return;
        }
        if(res.status === 429) return fail('Too many tries. Wait a few minutes.');
        if(res.status === 422){
          var first = null;
          for(var k in (r.errors || {})){
            var el = document.getElementById('en_' + k) || document.getElementById(FIXED[k] || '');
            if(!el) continue;
            setErr(el, r.errors[k]);
            if(!first) first = el;
          }
          if(first) first.focus();
          return fail(r.error || RETRY);
        }
        fail(RETRY);
      });
    }).catch(function(){ fail(RETRY); });
  });
})();
