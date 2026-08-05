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

    /* Netlify static forms: urlencoded POST to any path on the site, form-name included. */
    var data = new FormData(form);
    if(!data.get('form-name')) data.set('form-name', 'contact');

    if(btn){ btn.disabled = true; btn.textContent = 'Sending...'; }

    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString()
    }).then(function(res){
      if(!res.ok) throw new Error('send failed');
      try { sessionStorage.removeItem(KEY); } catch(err){}
      form.style.display = 'none';
      if(done){
        done.classList.add('show');
        done.focus();
      }
      say('Message sent. Talk soon.');
    }).catch(function(){
      /* ponytail: typed values stay in the DOM, so a retry costs the visitor nothing. */
      showFormErr('That did not send. Try once more, or email coach@kingfastbasketball.com and we will pick it up there.');
      say('Send failed. Try again or email us');
    }).finally(function(){
      if(btn){ btn.disabled = false; btn.textContent = btnLabel; }
    });
  });
})();
