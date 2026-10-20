(function(){
  'use strict';
  /* /agreement: a family signs with their typed full name and today's date. ?plan= preselects the
     package Coach Blake recommended and ?c= ties the signature to his consultation, so the
     "Continue to Payment" link that follows is that family's own /pay link. */
  var form = document.getElementById('agForm');
  if(!form) return;
  var err = document.getElementById('agErr');
  var btn = form.querySelector('button[type="submit"]');
  var label = btn ? btn.textContent : '';
  var q = new URLSearchParams(location.search);
  var consult = /^[0-9a-f-]{36}$/.test(q.get('c') || '') ? q.get('c') : '';

  var radios = form.querySelectorAll('input[name="plan"]');
  for(var i = 0; i < radios.length; i++) if(radios[i].value === q.get('plan')) radios[i].checked = true;
  var date = document.getElementById('ag_signedDate');
  /* Today on the parent's own clock, as YYYY-MM-DD; the server checks it against New York's. */
  var d = new Date();
  if(date && !date.value) date.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  function showErr(msg){ err.textContent = msg || ''; err.style.display = msg ? 'block' : 'none'; }
  form.addEventListener('input', function(){ showErr(''); });
  form.addEventListener('change', function(){ showErr(''); });

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var plan = form.querySelector('input[name="plan"]:checked');
    var data = {
      plan: plan ? plan.value : '',
      playerName: document.getElementById('ag_playerName').value,
      signature: document.getElementById('ag_signature').value,
      signedDate: date.value,
      email: document.getElementById('ag_email').value,
      agree: document.getElementById('agAgree').checked === true,
      consult: consult,
      'ag-hp': document.getElementById('agHp').value
    };
    if(!data.plan) return showErr('Choose your training package at the top.');
    if(!/\S+\s+\S+/.test(data.signature.trim())) return showErr('Type your full name, first and last, to sign.');
    if(!data.agree) return showErr('Tick the box to agree.');
    if(btn){ btn.disabled = true; btn.textContent = 'Signing...'; }
    fetch('/api/agreement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function(res){ return res.json().catch(function(){ return {}; }).then(function(r){ return { status: res.status, r: r }; }); })
      .then(function(x){
        if(btn){ btn.disabled = false; btn.textContent = label; }
        if(x.status === 200 && x.r.ok){
          form.style.display = 'none';
          if(x.r.payUrl) document.getElementById('agPay').href = x.r.payUrl;
          if(x.r.emailed === false) document.getElementById('agDoneMsg').textContent = 'Thank you. Your signed agreement is saved. The email copy did not send, so Coach Blake will send it to you.';
          var doneBox = document.getElementById('agDone');
          doneBox.hidden = false;
          doneBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        showErr(x.status === 429 ? 'Too many tries. Wait a few minutes.' : (x.r.error || 'That did not go through. Try again.'));
      })
      .catch(function(){
        if(btn){ btn.disabled = false; btn.textContent = label; }
        showErr('That did not go through. Check your connection and try again.');
      });
  });
})();
