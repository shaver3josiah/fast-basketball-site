(function(){
  'use strict';
  var form = document.getElementById('enForm');
  if(!form) return;

  /* Native validation is the no-JS fallback's only check, so the markup keeps `required`.
     With JS the messages below take over, the way contact-form.js does with novalidate. */
  form.setAttribute('novalidate', '');

  var emailInput = document.getElementById('enEmail');
  var guardianInput = document.getElementById('enGuardian');
  var hp = document.getElementById('enHp');
  var payBox = document.getElementById('enPay');
  var formErr = document.getElementById('enErr');
  var btn = form.querySelector('button[type="submit"]');
  var btnLabel = btn ? btn.textContent : '';
  var PHONE = '(503) 686-8371';
  var RETRY = 'That did not go through. Try again, or text Coach Blake at ' + PHONE + ' and he will send your link.';

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
       card actually prices rather than assuming it is 'full' — every plan today that sells a
       single option sells pay in full, but a monthly-only one would otherwise arrive at
       checkout with a pay the catalog refuses. The loop skips disabled radios, so it picks
       the priced option by construction. */
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

  form.addEventListener('submit', function(e){
    e.preventDefault();
    showFormErr('');

    var plan = checked('plan');
    var bad = null;
    if(!plan){
      showFormErr('Pick a plan first. It is the one you settled on with Coach Blake.');
      bad = form.querySelector('.en-card:not([hidden]) input[name="plan"]');
    }
    if(!emailOk(emailInput.value.trim())){
      setErr(emailInput, 'That email looks off. Check the spelling and try again.');
      bad = bad || emailInput;
    } else { clearErr(emailInput); }
    /* Parent gate: a child must not be able to hand over a card. */
    if(guardianInput && !guardianInput.checked){
      setErr(guardianInput, 'Tick this so we know an adult is enrolling. Players, grab a parent.');
      bad = bad || guardianInput;
    } else if(guardianInput){ clearErr(guardianInput); }
    if(bad){
      bad.focus();
      say(bad === guardianInput ? 'Confirm a parent or guardian is enrolling' : 'Pick a plan and add a valid email');
      return;
    }

    var pay = checked('pay');
    if(btn){ btn.disabled = true; btn.textContent = 'Opening checkout...'; }

    function fail(msg){
      /* ponytail: typed values stay in the DOM, so a retry costs the parent nothing. */
      showFormErr(msg);
      say('Checkout did not open');
      if(btn){ btn.disabled = false; btn.textContent = btnLabel; }
    }

    fetch('/.netlify/functions/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: plan.value,
        pay: pay ? pay.value : 'full',
        email: emailInput.value.trim(),
        guardianConfirmed: true,
        'en-hp': hp ? hp.value : ''
      })
    }).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(data){
        if(res.status === 200 && data.url){ window.location.assign(data.url); return; }
        if(res.status === 503) return fail('Online enrollment opens soon. Text Coach Blake at ' + PHONE + ' and he will send your link.');
        if(res.status === 429) return fail('Too many tries. Wait a few minutes.');
        if((res.status === 422 || res.status === 400) && data.error) return fail(data.error);
        fail(RETRY);
      });
    }).catch(function(){ fail(RETRY); });
  });
})();
