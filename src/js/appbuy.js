/* /appbuy: the tool shop's form. The same job as enroll.js and deliberately not the same file:
   that one carries an athlete registration's 26 fields, a plan matrix where each card prices a
   different subset of pay options, a per-family engagement beacon and a campaign tag, none of
   which exist here. Sharing it would mean generalising a live money path to serve two callers,
   which is a bigger change to the thing that takes payments than writing this.

   With JavaScript off the form still posts itself and checkout.mjs answers 303, to Stripe on
   success and back to /appbuy?err=1#enErr otherwise. Everything below is the upgrade. */
(function(){
  'use strict';
  var form = document.getElementById('abForm');
  if(!form) return;

  /* The markup keeps `required` so native validation still fires if this script fails to
     load. With JS the messages below take over, the way enroll.js does. */
  form.setAttribute('novalidate', '');

  var hp = document.getElementById('abHp');
  var formErr = document.getElementById('enErr');
  var btn = form.querySelector('button[type="submit"]');
  var btnLabel = btn ? btn.textContent : '';
  var RETRY = 'That did not go through. Try again, or send a note through the contact page and Coach Blake will take it from there.';
  var STORE = 'fb_appbuy';
  /* Server error keys that are not typed fields, and the element each one marks. */
  var FIXED = { terms: 'abTerms', norefund: 'abNoRefund' };

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

  /* Product -> pay. Each card carries one amount line per pay option (data-full, data-m2..m5,
     written by build.mjs from the catalog). Every tool prices every option, so unlike /enroll
     nothing is ever disabled and no step folds away; this only fills in the figures. */
  function syncPay(){
    var picked = checked('plan');
    var card = picked && picked.closest ? picked.closest('.en-card') : null;
    var pays = form.querySelectorAll('input[name="pay"]');
    for(var i = 0; i < pays.length; i++){
      var span = pays[i].parentNode.querySelector('.en-pay-a');
      if(span) span.textContent = card ? (card.getAttribute('data-' + pays[i].value) || '') : '';
    }
  }

  /* ?plan= / ?pay= preselect by value, which is how Stripe's cancel link brings a buyer back
     with their choice still made. Compared in a loop rather than spliced into a selector so a
     crafted query string can never become one. */
  function pick(name, value){
    if(!value) return;
    var inputs = form.querySelectorAll('input[name="' + name + '"]');
    for(var i = 0; i < inputs.length; i++){
      if(inputs[i].value !== value) continue;
      inputs[i].checked = true;
      return;
    }
  }

  /* The typed answers live for the tab, so a trip to Stripe and back does not empty the form.
     Radios are not kept; ?plan= and ?pay= handle those. */
  var SKIP = { 'en-hp': 1, plan: 1, pay: 1 };
  function remember(){
    var data = {};
    for(var i = 0; i < form.elements.length; i++){
      var el = form.elements[i];
      if(!el.name || SKIP[el.name] || !/^(text|email|tel|select-one|textarea)$/.test(el.type)) continue;
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

  /* Every control in page order, so the first problem is the one that gets focus. The server
     checks all of this again (apporder.mjs); this is the copy with manners. */
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
          showFormErr('Pick which tool you want.');
          if(!bad) bad = el;
        }
        continue;
      }
      clearErr(el);
      if(el.type === 'checkbox'){
        if(el.required && !el.checked){
          flag(el, el.id === 'abNoRefund'
            ? 'Tick this so we know the no-refund rule is understood before you pay.'
            : 'Tick this once you have read what is on this page.');
        }
        continue;
      }
      var v = (el.value || '').trim();
      if(!v){
        if(el.required) flag(el, 'Please fill this in.');
        continue;
      }
      if(el.type === 'email' && !emailOk(v)) flag(el, 'That email looks off. Check the spelling: it is where your link is sent.');
      else if(el.type === 'tel' && v.replace(/\D/g, '').length < 10) flag(el, 'Add the area code: ten digits.');
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
    if(btn){ btn.disabled = true; btn.textContent = 'Saving your order...'; }

    function fail(msg){
      /* Typed values stay in the DOM, so a retry costs the buyer nothing. */
      showFormErr(msg);
      say('Order did not go through');
      if(btn){ btn.disabled = false; btn.textContent = btnLabel; }
    }

    var data = {};
    new FormData(form).forEach(function(v, k){ if(typeof v === 'string') data[k] = v; });
    data.plan = plan.value;
    data.pay = pay ? pay.value : 'full';
    data.terms = document.getElementById('abTerms').checked === true;
    data.norefund = document.getElementById('abNoRefund').checked === true;
    data['en-hp'] = hp ? hp.value : '';
    /* The id from an earlier try in this tab, so a return from Stripe's cancel link rewrites
       the same pending order instead of adding a second one. */
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
          /* Saved, but Stripe cannot take this product yet. Say so and leave the button down:
             a second click would only save the same order again. */
          showFormErr('Your order is saved. Online payment for this one opens shortly, and Coach Blake will email you the payment link. Nothing more to do here.');
          say('Order saved');
          if(btn) btn.textContent = 'Order saved';
          return;
        }
        if(res.status === 429) return fail('Too many tries. Wait a few minutes.');
        if(res.status === 422){
          var first = null;
          for(var k in (r.errors || {})){
            var el = document.getElementById('ab_' + k) || document.getElementById(FIXED[k] || '');
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
