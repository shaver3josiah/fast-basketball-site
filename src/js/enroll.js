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
  var PHONE = '(503) 686-8371';
  var RETRY = 'That did not go through. Try again, or text Coach Blake at ' + PHONE + ' and he will take it from there.';
  var STORE = 'fb_enroll';
  /* Server error keys that are not registration fields, and the element each one marks. */
  var FIXED = { reviewed: 'enReviewed', terms: 'enTerms' };

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
  syncPay();

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
        if(res.status === 200 && r.url){ window.location.assign(r.url); return; }
        if(res.status === 503){
          /* Saved, but Stripe cannot take this plan yet. Say so and leave the button down:
             a second click would only save the same registration again. */
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
