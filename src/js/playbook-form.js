(function(){
  'use strict';
  var form = document.getElementById('pbForm');
  if(!form) return;

  var nameInput = document.getElementById('pbName');
  var emailInput = document.getElementById('pbEmail');

  function clearFieldErr(input){
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    var fld = input.closest('.fld');
    if(!fld) return;
    fld.classList.remove('err');
    var m = fld.querySelector('.f-err');
    if(m) m.parentNode.removeChild(m);
  }
  function setFieldErr(input, msg){
    clearFieldErr(input);
    input.setAttribute('aria-invalid', 'true');
    var fld = input.closest('.fld');
    if(!fld) return;
    fld.classList.add('err');
    var m = document.createElement('span');
    m.className = 'f-err';
    m.id = input.id + 'Err';
    m.textContent = msg;
    input.setAttribute('aria-describedby', m.id);
    fld.appendChild(m);
  }
  [nameInput, emailInput].forEach(function(inp){
    if(inp) inp.addEventListener('input', function(){ clearFieldErr(inp); });
  });

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var honeypot = document.getElementById('pbHp');
    if(honeypot && honeypot.value){ return; }

    var name = nameInput.value.trim();
    var email = emailInput.value.trim();
    var grade = document.getElementById('pbGrade').value;
    var position = document.getElementById('pbPos').value;
    var focus = document.getElementById('pbFocus').value;

    var ok = true;
    if(!name){ setFieldErr(nameInput, "Add the player's first name so the plan has a name on it."); ok = false; } else { clearFieldErr(nameInput); }
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ setFieldErr(emailInput, 'That email looks off. Check the spelling and try again.'); ok = false; } else { clearFieldErr(emailInput); }
    if(!ok){
      var firstBad = form.querySelector('.fld.err input');
      if(firstBad) firstBad.focus();
      return;
    }

    var submitBtn = form.querySelector('button[type="submit"]');
    if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Building your playbook...'; }

    fetch('/playbook/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name, email: email, grade: grade, position: position, focus: focus,
        referrer: document.referrer || window.location.href
      })
    }).then(function(res){
      return res.json().then(function(data){ return { ok: res.ok, data: data }; });
    }).then(function(result){
      if(!result.ok || !result.data || !result.data.html){
        throw new Error('generation failed');
      }
      var blob = new Blob([result.data.html], { type: 'text/html' });
      var url = URL.createObjectURL(blob);
      var filename = 'fast-basketball-playbook-' + name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.html';

      document.getElementById('pbTitle').textContent = name + "'s playbook is ready";
      var emailNote = result.data.emailSent ? 'A copy is on its way to ' + email + '.' : 'Email delivery is delayed, but your download works right now.';
      document.getElementById('pbMsg').textContent = 'Built for a ' + grade + ' grade player working on ' + focus.toLowerCase() + '. ' + emailNote;

      var list = document.getElementById('pbList');
      list.innerHTML = '';
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.innerHTML = '<span>Download the HTML playbook</span><span>&rarr;</span>';
      var li = document.createElement('li');
      li.appendChild(a);
      list.appendChild(li);
      document.getElementById('pbOut').classList.add('show');
      if(window.fbToast) window.fbToast('Playbook generated');
    }).catch(function(){
      if(window.fbToast) window.fbToast('Something went wrong, try again in a moment');
    }).finally(function(){
      if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = 'Build My Playbook'; }
    });
  });
})();
