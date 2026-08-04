(function(){
  'use strict';
  var form = document.getElementById('pbForm');
  if(!form) return;

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var honeypot = document.getElementById('pbHp');
    if(honeypot && honeypot.value){ return; }

    var name = document.getElementById('pbName').value.trim();
    var email = document.getElementById('pbEmail').value.trim();
    var grade = document.getElementById('pbGrade').value;
    var position = document.getElementById('pbPos').value;
    var focus = document.getElementById('pbFocus').value;

    if(!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
      if(window.fbToast) window.fbToast('Add a name and a valid email');
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
