(function(){
  'use strict';

  /* Program context: a CTA click on any [data-program] anchor is remembered so the
     contact form can say what the visitor is asking about without them retyping it. */
  var KEY = 'fb_program';
  var field = document.getElementById('cProgram');
  var line = document.getElementById('ctProgramLine');

  function applyProgram(){
    var name = '';
    try { name = sessionStorage.getItem(KEY) || ''; } catch(e){}
    if(field) field.value = name;
    if(!line) return;
    line.textContent = name ? 'Asking about: ' + name : '';
    line.style.display = name ? 'flex' : 'none';
  }

  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('[data-program]');
    if(!a) return;
    try { sessionStorage.setItem(KEY, a.getAttribute('data-program')); } catch(err){}
    applyProgram();
  });

  applyProgram();

  var form = document.getElementById('ctForm');
  if(!form) return;

  var nameInput = document.getElementById('cName');
  var emailInput = document.getElementById('cEmail');
  var guardianInput = document.getElementById('ctGuardian');
  var formErr = document.getElementById('ctErr');
  var done = document.getElementById('ctDone');
  var direct = document.getElementById('ctDirect');
  var btn = form.querySelector('button[type="submit"]');
  var btnLabel = btn ? btn.textContent : '';

  /* Load time, read back by contact.mjs: a post that never loaded this page, or that
     arrives seconds after it did, was not typed by a parent. */
  var ts = document.getElementById('ctTs');
  if(ts) ts.value = String(Date.now());

  function say(msg, actions){ if(window.fbToast) window.fbToast(msg, actions); }

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

  /* One check per gated field, shared by the step buttons and the final submit. Each
     returns the input when it is bad, so the caller can focus the first one. */
  function checkName(){
    if(nameInput.value.trim()){ clearErr(nameInput); return null; }
    setErr(nameInput, 'Tell us who to reply to.');
    return nameInput;
  }
  function checkEmail(){
    if(emailOk(emailInput.value.trim())){ clearErr(emailInput); return null; }
    setErr(emailInput, 'That email looks off. Check the spelling and try again.');
    return emailInput;
  }
  /* Parent gate: a child must not be able to send their own details. */
  function checkGuardian(){
    if(!guardianInput) return null;
    if(guardianInput.checked){ clearErr(guardianInput); return null; }
    setErr(guardianInput, 'Tick this so we know an adult is sending it. Players, grab a parent.');
    return guardianInput;
  }

  /* Steps. The markup is three plain fieldsets so the form works with scripting off; here
     they become one at a time with Back and Next, and the progress row is unhidden. Only
     step 1 and step 3 hold gated fields, so a step's own check is just those. */
  var steps = Array.prototype.slice.call(form.querySelectorAll('.step'));
  var stepsBar = document.getElementById('ctSteps');
  var stepN = document.getElementById('ctStepN');
  var at = 0;

  function stepOf(input){
    for(var i = 0; i < steps.length; i++){ if(steps[i].contains(input)) return i; }
    return 0;
  }

  function show(i, back){
    steps.forEach(function(s, k){
      s.hidden = k !== i;
      s.classList.toggle('back', !!back);
    });
    if(stepsBar){
      Array.prototype.forEach.call(stepsBar.querySelectorAll('span'), function(sp, k){ sp.classList.toggle('on', k <= i); });
    }
    if(stepN) stepN.textContent = 'Step ' + (i + 1) + ' of ' + steps.length;
    at = i;
  }

  function goTo(i, back){
    show(i, back);
    var first = steps[i].querySelector('input:not([type="hidden"]), select, textarea');
    if(first) first.focus();
  }

  function stepOk(i){
    var bad = null;
    if(steps[i].contains(nameInput)) bad = checkName() || bad;
    if(steps[i].contains(emailInput)) bad = bad || checkEmail();
    if(bad){ bad.focus(); say('Add a name and a valid email'); }
    return !bad;
  }

  function navButton(label, cls, onClick){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  if(steps.length > 1){
    form.classList.add('stepped');
    if(stepsBar){ stepsBar.hidden = false; stepsBar.removeAttribute('aria-hidden'); }
    steps.forEach(function(s, k){
      var nav = s.querySelector('.step-nav');
      if(!nav){ nav = document.createElement('div'); nav.className = 'step-nav'; s.appendChild(nav); }
      if(k > 0) nav.insertBefore(navButton('Back', 'btn-ghost', function(){ goTo(k - 1, true); }), nav.firstChild);
      if(k < steps.length - 1) nav.appendChild(navButton('Next', 'btn-primary', function(){ if(stepOk(k)) goTo(k + 1); }));
    });
    show(0);
    /* Enter in a text field advances the step instead of submitting a form the visitor
       has not seen the end of. The textarea keeps Enter for line breaks. */
    form.addEventListener('keydown', function(e){
      if(e.key !== 'Enter' || at >= steps.length - 1 || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      if(stepOk(at)) goTo(at + 1);
    });
  }

  /* Built from the /api/contact response, never from the page: since September 2026 the
     number and the address are in no public markup, and the only way to them is a sent
     request. The vCard is the same one the old contact rows fed. */
  function contactCard(out){
    var card = ['BEGIN:VCARD', 'VERSION:3.0', 'N:Kingsley;Blake;;;', 'FN:Blake Kingsley',
      'ORG:Fast Basketball', 'TITLE:Founder and Head Skills Coach'];
    if(out.tel) card.push('TEL;TYPE=CELL:' + out.tel);
    if(out.email) card.push('EMAIL;TYPE=INTERNET:' + out.email);
    card.push('URL:https://fast-basketball.com', 'END:VCARD');
    // vCard lines are CRLF separated per RFC 6350, built from char codes so no escape
    // sequence has to survive a copy between tools.
    var CRLF = String.fromCharCode(13, 10);
    return 'data:text/vcard;charset=utf-8,' + encodeURIComponent(card.join(CRLF) + CRLF);
  }

  function link(href, text){
    var a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    return a;
  }

  function reveal(out){
    if(!direct || !(out.tel || out.email)) return;
    direct.textContent = '';
    if(out.tel) direct.appendChild(link('sms:' + out.tel, 'Text ' + (out.phone || out.tel)));
    if(out.email) direct.appendChild(link('mailto:' + out.email, out.email));
    direct.hidden = false;
  }

  function sentToast(out){
    var actions = [];
    if(out.tel || out.email) actions.push({ label: 'Save his contact', href: contactCard(out), download: 'blake-kingsley.vcf' });
    if(out.tel) actions.push({ label: 'Text him', href: 'sms:' + out.tel });
    if(out.email) actions.push({ label: 'Email him', href: 'mailto:' + out.email });
    say('Request sent. Coach Blake replies within one business day.', actions);
  }

  form.addEventListener('input', function(e){
    clearErr(e.target);
    showFormErr('');
  });

  form.addEventListener('submit', function(e){
    e.preventDefault();
    showFormErr('');

    var bad = checkName();
    bad = bad || checkEmail();
    bad = bad || checkGuardian();
    if(bad){
      if(steps.length > 1) show(stepOf(bad));
      bad.focus();
      say(bad === guardianInput ? 'Confirm a parent or guardian is sending this' : 'Add a name and a valid email');
      return;
    }

    /* JSON to our own endpoint. Until September 2026 this was a urlencoded POST to "/",
       which is how Netlify Forms captured a submission without any server code. Firebase has
       no equivalent, so server/functions/contact.mjs takes it now, and the enquiry lands in
       the same leads store as an enrollment instead of in a dashboard on another company's
       site. The checkbox is sent as a real boolean, the way the enroll form sends its own. */
    var data = new FormData(form);
    var payload = {};
    data.forEach(function(value, key){ if(typeof value === 'string') payload[key] = value; });
    payload.guardianConfirmed = guardianInput ? guardianInput.checked === true : true;

    if(btn){ btn.disabled = true; btn.textContent = 'Sending...'; }

    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(res){
      if(!res.ok) throw new Error('send failed');
      return res.json().catch(function(){ return {}; });
    }).then(function(out){
      try { sessionStorage.removeItem(KEY); } catch(err){}
      form.style.display = 'none';
      reveal(out);
      if(done){
        done.classList.add('show');
        done.focus();
      }
      sentToast(out);
    }).catch(function(){
      /* ponytail: typed values stay in the DOM, so a retry costs the visitor nothing. */
      showFormErr('That did not send. Give it a moment and try once more.');
      say('Send failed. Try again in a moment');
    }).finally(function(){
      if(btn){ btn.disabled = false; btn.textContent = btnLabel; }
    });
  });
})();
