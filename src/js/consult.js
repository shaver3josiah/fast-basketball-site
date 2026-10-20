(function(){
  'use strict';
  /* /enroll: the consultation Coach Blake fills in on the call. It saves through /api/consult and
     then shows this family's next links (the evaluation payment and the two agreements), each
     carrying the consultation's id so the payment is tied to these answers. */
  var form = document.getElementById('csForm');
  if(!form) return;
  var err = document.getElementById('csErr');
  var done = document.getElementById('csDone');
  var box = document.getElementById('csLinks');
  var btn = form.querySelector('button[type="submit"]');
  var label = btn ? btn.textContent : '';

  /* Links Blake sent before October 2026 pointed here with a plan or a deal, and tracked links (?via=)
     still name /enroll as their page. Families pay on /pay now, so all of those carry on there. */
  if(/[?&](plan|deal|via)=/.test(location.search)){ location.replace('/pay' + location.search + location.hash); return; }

  function showErr(msg){ err.textContent = msg || ''; err.style.display = msg ? 'block' : 'none'; }
  function mark(el, msg){
    var fld = el.closest('.fld'); if(!fld) return;
    fld.classList.add('err'); el.setAttribute('aria-invalid', 'true');
    var m = document.createElement('span'); m.className = 'f-err'; m.textContent = msg; fld.appendChild(m);
  }
  function clearMarks(){
    var bad = form.querySelectorAll('.fld.err');
    for(var i = 0; i < bad.length; i++){
      bad[i].classList.remove('err');
      var m = bad[i].querySelector('.f-err'); if(m) bad[i].removeChild(m);
      var c = bad[i].querySelector('[aria-invalid]'); if(c) c.removeAttribute('aria-invalid');
    }
  }

  var LINKS = [
    ['Evaluation payment', '/pay?plan=eval'],
    ['Agreement: Monthly Training', '/agreement?plan=individual-1x'],
    ['Agreement: Six-Month Commitment', '/agreement?plan=individual-6m']
  ];
  function showLinks(id){
    box.textContent = '';
    LINKS.forEach(function(l){
      var row = document.createElement('div'); row.className = 'cs-link';
      var b = document.createElement('b'); b.textContent = l[0]; row.appendChild(b);
      var span = document.createElement('span');
      var input = document.createElement('input'); input.readOnly = true;
      input.value = location.origin + l[1] + '&c=' + id;
      var copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn btn-ghost'; copy.textContent = 'Copy';
      copy.addEventListener('click', function(){
        input.select();
        var ok = function(){ copy.textContent = 'Copied'; setTimeout(function(){ copy.textContent = 'Copy'; }, 1600); };
        if(navigator.clipboard) navigator.clipboard.writeText(input.value).then(ok, function(){ document.execCommand('copy'); ok(); });
        else { document.execCommand('copy'); ok(); }
      });
      span.appendChild(input); span.appendChild(copy); row.appendChild(span);
      box.appendChild(row);
    });
  }

  form.addEventListener('input', function(){ showErr(''); });
  form.addEventListener('submit', function(e){
    e.preventDefault();
    clearMarks(); showErr('');
    var first = null;
    var els = form.querySelectorAll('input, select, textarea');
    for(var i = 0; i < els.length; i++){
      var el = els[i], v = (el.value || '').trim();
      if(el.id === 'csHp') continue;
      var msg = !v ? (el.required ? 'Please fill this in.' : '')
        : el.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? 'That email looks off.'
        : el.type === 'tel' && v.replace(/\D/g, '').length < 10 ? 'Add the area code: ten digits.' : '';
      if(msg){ mark(el, msg); if(!first) first = el; }
    }
    if(first){ first.focus(); showErr('Check the highlighted fields.'); return; }

    var data = {};
    new FormData(form).forEach(function(v, k){ if(typeof v === 'string') data[k] = v; });
    if(btn){ btn.disabled = true; btn.textContent = 'Saving...'; }
    fetch('/api/consult', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function(res){ return res.json().catch(function(){ return {}; }).then(function(r){ return { status: res.status, r: r }; }); })
      .then(function(x){
        if(btn){ btn.disabled = false; btn.textContent = label; }
        if(x.status === 200 && x.r.id){
          form.style.display = 'none'; showLinks(x.r.id); done.hidden = false;
          done.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        var errs = x.r.errors || {}, f = null;
        for(var k in errs){
          var el = document.getElementById('cs_' + k);
          if(el){ mark(el, errs[k]); if(!f) f = el; }
        }
        if(f) f.focus();
        showErr(x.status === 429 ? 'Too many tries. Wait a few minutes.' : (x.r.error || 'That did not save. Try again.'));
      })
      .catch(function(){
        if(btn){ btn.disabled = false; btn.textContent = label; }
        showErr('That did not save. Check the connection and try again.');
      });
  });

  document.getElementById('csNew').addEventListener('click', function(){
    form.reset(); form.style.display = ''; done.hidden = true; box.textContent = '';
    window.scrollTo(0, 0);
  });
})();
