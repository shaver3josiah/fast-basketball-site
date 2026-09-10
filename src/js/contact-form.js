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
  var btn = form.querySelector('button[type="submit"]');
  var btnLabel = btn ? btn.textContent : '';

  function say(msg, actions){ if(window.fbToast) window.fbToast(msg, actions); }

  /* Start with a call (owner's call, September 2026). The direct text and email options in
     the contact rows are shown but not clickable until the form has actually been sent, so
     the request is the front door rather than one option among three. This is done in
     script, not in the markup: with JavaScript off there is no form to send either, and a
     page that locks every route to a human is worse than one that locks none. */
  var direct = [];
  var rows = document.querySelector('.ct-rows');
  if(rows){
    Array.prototype.forEach.call(rows.querySelectorAll('a[href^="sms:"], a[href^="tel:"], a[href^="mailto:"]'), function(a){
      direct.push(a);
      a.classList.add('ct-locked');
      a.setAttribute('aria-disabled', 'true');
    });
  }

  function lockedClick(e){
    var a = e.target.closest && e.target.closest('.ct-locked');
    if(!a) return;
    e.preventDefault();
    say('Send the request first, then these open');
  }
  if(direct.length) document.addEventListener('click', lockedClick);

  function unlockDirect(){
    direct.forEach(function(a){
      a.classList.remove('ct-locked');
      a.removeAttribute('aria-disabled');
    });
    document.removeEventListener('click', lockedClick);
  }

  function hrefStarting(prefix){
    for(var i = 0; i < direct.length; i++){
      if(direct[i].getAttribute('href').indexOf(prefix) === 0) return direct[i].getAttribute('href');
    }
    return '';
  }

  /* Built from the rendered links rather than hard-coded, so an owner who edits the number
     or the address in the admin panel gets a contact card that matches the page. */
  function contactCard(){
    var tel = hrefStarting('sms:') || hrefStarting('tel:');
    var mail = hrefStarting('mailto:');
    var card = ['BEGIN:VCARD', 'VERSION:3.0', 'N:Kingsley;Blake;;;', 'FN:Blake Kingsley',
      'ORG:Fast Basketball', 'TITLE:Founder and Head Skills Coach'];
    if(tel) card.push('TEL;TYPE=CELL:' + tel.replace(/^(sms|tel):/, ''));
    if(mail) card.push('EMAIL;TYPE=INTERNET:' + mail.replace(/^mailto:/, ''));
    card.push('URL:https://fast-basketball.com', 'END:VCARD');
    // vCard lines are CRLF separated per RFC 6350, built from char codes so no escape
    // sequence has to survive a copy between tools.
    var CRLF = String.fromCharCode(13, 10);
    return 'data:text/vcard;charset=utf-8,' + encodeURIComponent(card.join(CRLF) + CRLF);
  }

  function sentToast(){
    var actions = [{ label: 'Save his contact', href: contactCard(), download: 'blake-kingsley.vcf' }];
    var tel = hrefStarting('sms:') || hrefStarting('tel:');
    var mail = hrefStarting('mailto:');
    if(tel) actions.push({ label: 'Text him', href: tel });
    if(mail) actions.push({ label: 'Email him', href: mail });
    say('Request sent. Coach Blake replies within one business day.', actions);
  }

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

  form.addEventListener('input', function(e){
    clearErr(e.target);
    showFormErr('');
  });

  form.addEventListener('submit', function(e){
    e.preventDefault();
    showFormErr('');

    var bad = null;
    if(!nameInput.value.trim()){
      setErr(nameInput, 'Tell us who to reply to.');
      bad = nameInput;
    } else { clearErr(nameInput); }
    if(!emailOk(emailInput.value.trim())){
      setErr(emailInput, 'That email looks off. Check the spelling and try again.');
      bad = bad || emailInput;
    } else { clearErr(emailInput); }
    /* Parent gate: a child must not be able to send their own details. */
    if(guardianInput && !guardianInput.checked){
      setErr(guardianInput, 'Tick this so we know an adult is sending it. Players, grab a parent.');
      bad = bad || guardianInput;
    } else if(guardianInput){ clearErr(guardianInput); }
    if(bad){
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
      try { sessionStorage.removeItem(KEY); } catch(err){}
      form.style.display = 'none';
      if(done){
        done.classList.add('show');
        done.focus();
      }
      unlockDirect();
      sentToast();
    }).catch(function(){
      /* ponytail: typed values stay in the DOM, so a retry costs the visitor nothing. */
      showFormErr('That did not send. Try once more, or email blake@fast-basketball.com and we will pick it up there.');
      say('Send failed. Try again or email us');
    }).finally(function(){
      if(btn){ btn.disabled = false; btn.textContent = btnLabel; }
    });
  });
})();
