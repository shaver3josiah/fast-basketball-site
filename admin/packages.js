/* The Prices tab: every training package Blake sells, with its price, and a way to change a price,
   hide a package, or add a new one. Reads and writes /api/admin-packages.

   Live instantly, like Cut a Deal: no Save, no Publish. The server writes Stripe first and only
   then the site, so a change either fully happens or does not happen and says why.

   Its own file on purpose. admin.js already switches tabs generically (a .tab button shows the
   <main> named after it), so this only listens for its own button and renders into #tabPackages.
   Every name on the page reaches it through textContent, never innerHTML: package names are words
   somebody typed. */
(function(){
  var root = document.getElementById('tabPackages');
  var tabBtn = document.querySelector('.tab[data-tab="packages"]');
  if(!root || !tabBtn) return;

  var PROGRAM = { evaluation: 'Evaluation', individual: 'Individual training', group: 'Group training' };
  var PAY = { full: 'Pay in full', monthly: 'Monthly' };
  var state = { data: null, error: '', note: '', adding: false, busy: false, flash: '' };
  var uid = 0;

  function h(tag, cls, text){
    var el = document.createElement(tag);
    if(cls) el.className = cls;
    if(text != null) el.textContent = text;
    return el;
  }
  function money(cents){
    var whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '$' + whole + (cents % 100 ? '.' + String(cents % 100).padStart(2, '0') : '');
  }
  function toInput(cents){ return (cents % 100) ? (cents / 100).toFixed(2) : String(cents / 100); }
  function toCents(raw){
    var t = String(raw).replace(/[$,\s]/g, '');
    if(!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    var c = Math.round(parseFloat(t) * 100);
    return (c >= 100 && c <= 2000000) ? c : null;
  }
  function shortLabel(p){
    if(p.key === 'eval-call') return 'Evaluation, 48-hour rate (from your call)';
    if(p.key === 'eval') return 'Evaluation session';
    var i = p.label.indexOf(', ');
    var name = i > -1 ? p.label.slice(i + 2) : p.label;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  function field(label, control, hint){
    var wrap = h('div', 'field');
    control.id = control.id || 'pk' + (++uid);
    var l = h('label', null, label);
    l.htmlFor = control.id;
    wrap.appendChild(l);
    wrap.appendChild(control);
    if(hint) wrap.appendChild(h('p', 'price-note', hint));
    return wrap;
  }
  function select(pairs, value){
    var s = document.createElement('select');
    pairs.forEach(function(p){ var o = h('option', null, p[1]); o.value = String(p[0]); s.appendChild(o); });
    if(value != null) s.value = String(value);
    return s;
  }
  function input(type, placeholder){
    var i = document.createElement('input');
    i.type = type || 'text';
    if(placeholder) i.placeholder = placeholder;
    return i;
  }

  function call(method, body){
    var opts = { method: method, credentials: 'same-origin' };
    if(body){ opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    return fetch('/api/admin-packages', opts).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(r){
        if(res.status === 401) throw new Error('Your sign-in ended. Reload this page and sign in again.');
        if(!res.ok) throw new Error(r.error || 'That did not go through. Try again.');
        return r;
      });
    });
  }

  function load(){
    state.error = '';
    call('GET').then(function(r){ state.data = r; sharePlans(r); render(); })
      .catch(function(err){ state.error = err.message; render(); });
  }

  /* The link maker and the coupon scopes read window.FB_PLANS, generated at build time. Hand them
     the live catalog so a package added today is offered there today. */
  function sharePlans(r){
    if(window.FB_PLANS && r && r.plans) window.FB_PLANS.plans = r.plans;
  }

  function act(body, doneText){
    if(state.busy) return Promise.resolve();
    state.busy = true; state.error = ''; state.note = ''; render();
    return call('POST', body).then(function(r){
      state.data = r; sharePlans(r);
      state.note = (doneText || 'Done.') + ' It is live now.' + (r.warning ? ' ' + r.warning : '');
      state.flash = (r.changed && r.changed[0]) || body.key || '';
      state.adding = false;
    }).catch(function(err){ state.error = err.message; })
      .then(function(){ state.busy = false; render(); });
  }

  /* ---- one package */
  function card(p){
    var live = !p.retired;
    var c = h('div', 'lead pk-card' + (state.flash === p.key ? ' fresh' : ''));
    var top = h('div', 'lead-top');
    top.appendChild(h('span', 'chip ' + (live ? 'ok' : 'flag'), live ? 'Live' : 'Hidden'));
    if(p.custom) top.appendChild(h('span', 'chip', 'Added by you'));
    c.appendChild(top);
    c.appendChild(h('div', 'lead-name', shortLabel(p)));

    var inputs = {};
    var changedAny = false;
    p.payOptions.forEach(function(o){
      var box = input('text');
      box.inputMode = 'decimal';
      box.value = toInput(o.totalCents);
      inputs[o.pay] = box;
      var label = p.kind === 'recurring' ? 'Price per month'
        : p.payOptions.length > 1 ? (o.pay === 'full' ? 'Pay in full' : 'Pay monthly, total over the term')
        : 'Price';
      var hint = o.mode === 'subscription' && o.iterations
        ? 'Charged ' + o.amount + ' a month, ' + o.iterations + ' times.'
        : o.mode === 'subscription' ? 'Charged ' + o.amount + ' every month until they cancel.'
        : 'Charged once.';
      if(o.publishedTotalCents !== o.totalCents) { hint += ' Published price was ' + money(o.publishedTotalCents) + '.'; changedAny = true; }
      var f = field(label, box, hint);
      box.addEventListener('input', function(){
        var cents = toCents(box.value);
        f.classList.toggle('bad', cents === null);
        save.disabled = state.busy || Object.keys(inputs).every(function(k){
          var v = toCents(inputs[k].value);
          var cur = p.payOptions.filter(function(q){ return q.pay === k; })[0];
          return v === null || v === cur.totalCents;
        });
      });
      c.appendChild(f);
    });

    var actions = h('div', 'card-actions');
    var save = h('button', 'btn primary', 'Save price');
    save.type = 'button';
    save.disabled = true;
    save.addEventListener('click', function(){
      var prices = {};
      for(var pay in inputs){
        var cents = toCents(inputs[pay].value);
        if(cents === null){ state.error = 'Type a price in dollars, like 450 or 183.33. Between $1 and $20,000.'; render(); return; }
        var cur = p.payOptions.filter(function(q){ return q.pay === pay; })[0];
        if(cents !== cur.totalCents) prices[pay] = cents;
      }
      if(!Object.keys(prices).length) return;
      if(!window.confirm('Change "' + shortLabel(p) + '" on the website and on Stripe now?')) return;
      act({ action: 'price', key: p.key, prices: prices }, 'Price saved.');
    });
    actions.appendChild(save);
    if(changedAny){
      var back = h('button', 'btn', 'Back to published');
      back.type = 'button';
      back.addEventListener('click', function(){
        if(window.confirm('Put "' + shortLabel(p) + '" back to its published price?')) act({ action: 'reset', key: p.key }, 'Back to the published price.');
      });
      actions.appendChild(back);
    }
    c.appendChild(actions);

    var vis = h('button', 'btn wide ' + (live ? 'danger' : ''), live ? 'Hide from the website' : 'Show on the website again');
    vis.type = 'button';
    vis.addEventListener('click', function(){
      if(live && !window.confirm('Hide "' + shortLabel(p) + '"? Nobody will be able to pick or buy it. Families who already bought it are not affected, and you can show it again any time.')) return;
      act({ action: live ? 'retire' : 'restore', key: p.key }, live ? 'Hidden.' : 'Showing again.');
    });
    c.appendChild(vis);
    return c;
  }

  /* ---- adding one */
  function addForm(opts){
    var form = h('form', 'field-group deal-form');
    form.noValidate = true;
    form.appendChild(h('h2', 'pane-h', 'Add a package'));
    form.appendChild(h('p', 'pane-intro', 'It appears on the enroll page and the pricing card as soon as you add it, and a family can pay for it straight away.'));
    var body = h('div', 'group-body');
    form.appendChild(body);

    var program = select([['individual', 'Individual training'], ['group', 'Group training']], 'individual');
    var kind = select([['term', 'A fixed term, paid in full'], ['recurring', 'Monthly, until they cancel'], ['once', 'One session or clinic']], 'term');
    var months = select([], 3);
    for(var m = 1; m <= opts.maxTermMonths; m++){ var o = h('option', null, m + (m === 1 ? ' month' : ' months')); o.value = String(m); months.appendChild(o); }
    months.value = '9';
    var freq = select(opts.frequencies.map(function(f){ return [f, f.charAt(0).toUpperCase() + f.slice(1)]; }), 'once a week');
    var name = input('text', 'Optional, like "Summer intensive"');
    name.maxLength = 60;
    var desc = input('text', 'One line a parent will read');
    desc.maxLength = 160;
    var price = input('text', '900');
    price.inputMode = 'decimal';

    var fProgram = field('Which program', program);
    var fKind = field('How it is paid', kind);
    var fMonths = field('How long', months);
    var fFreq = field('Sessions a week', freq);
    var fName = field('Name', name, 'Leave blank and it is named for you, like "9 months, once a week".');
    var fDesc = field('Description (optional)', desc);
    var fPrice = field('Price, in dollars', price);
    [fProgram, fKind, fMonths, fFreq, fName, fDesc, fPrice].forEach(function(f){ body.appendChild(f); });

    var preview = h('div', 'preview');
    preview.appendChild(h('span', null, 'Families will see'));
    var seen = h('b', null, '');
    preview.appendChild(seen);
    body.appendChild(preview);
    var err = h('p', 'error');
    err.setAttribute('role', 'alert');
    body.appendChild(err);

    function sync(){
      var k = kind.value;
      fMonths.style.display = k === 'term' ? '' : 'none';
      fFreq.style.display = k === 'once' ? 'none' : '';
      fDesc.style.display = k === 'once' ? '' : 'none';
      fName.querySelector('label').textContent = k === 'once' ? 'Name' : 'Name (optional)';
      var cents = toCents(price.value);
      var base = k === 'term' ? months.value + (months.value === '1' ? ' month, ' : ' months, ') + freq.value : k === 'recurring' ? freq.value : '';
      var title = name.value.trim() || base || 'Your package';
      seen.textContent = (PROGRAM[program.value]) + ': ' + title + ', ' + (cents === null ? '$?' : money(cents)) +
        (k === 'recurring' ? ' a month until they cancel' : k === 'term' ? ' paid in full' : ' one payment');
    }
    [program, kind, months, freq, name, desc, price].forEach(function(el){ el.addEventListener('input', sync); el.addEventListener('change', sync); });
    sync();

    var go = h('button', 'btn primary wide', 'Add it and put it live');
    go.type = 'submit';
    var cancel = h('button', 'btn ghost wide', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', function(){ state.adding = false; render(); });
    body.appendChild(go);
    body.appendChild(cancel);

    form.addEventListener('submit', function(e){
      e.preventDefault();
      err.textContent = '';
      var cents = toCents(price.value);
      if(cents === null){ err.textContent = 'Type a price in dollars, like 900. Between $1 and $20,000.'; price.focus(); return; }
      if(kind.value === 'once' && name.value.trim().length < 2){ err.textContent = 'Give a one-session package a name.'; name.focus(); return; }
      if(!window.confirm('Put "' + seen.textContent + '" on the website now? This also creates a live price in Stripe.')) return;
      act({
        action: 'add', program: program.value, kind: kind.value, cents: cents,
        termMonths: kind.value === 'term' ? Number(months.value) : undefined,
        frequency: kind.value === 'once' ? undefined : freq.value,
        name: name.value.trim(), description: kind.value === 'once' ? desc.value.trim() : undefined
      }, 'Package added.');
    });
    return form;
  }

  function render(){
    root.textContent = '';
    var live = h('p', 'live-note');
    live.appendChild(h('b', null, 'Live instantly. '));
    live.appendChild(document.createTextNode('No Save or Publish on this tab: a price you change, a package you hide or one you add is on the website and takes payments the moment you confirm.'));
    root.appendChild(live);

    if(state.note){ var n = h('p', 'live-note'); n.appendChild(h('b', null, state.note)); root.appendChild(n); }
    if(state.error){ var e = h('p', 'error', state.error); e.setAttribute('role', 'alert'); root.appendChild(e); }
    if(!state.data){
      if(!state.error) root.appendChild(h('p', 'price-note', 'Loading your packages...'));
      else { var retry = h('button', 'btn', 'Try again'); retry.type = 'button'; retry.addEventListener('click', load); root.appendChild(retry); }
      return;
    }

    if(state.adding) root.appendChild(addForm(state.data.options));
    else {
      var add = h('button', 'btn primary wide', 'Add a package');
      add.type = 'button';
      add.addEventListener('click', function(){ state.adding = true; state.note = ''; render(); window.scrollTo(0, 0); });
      root.appendChild(add);
    }

    var warn = h('p', 'price-warn', 'This changes the price a family sees AND the price Stripe charges. Sentences that say a price in words (the Terms page, the training pages) are written by hand and need your developer.');
    root.appendChild(warn);

    ['evaluation', 'individual', 'group'].forEach(function(program){
      var list = state.data.plans.filter(function(p){ return p.program === program; });
      if(!list.length) return;
      root.appendChild(h('h3', 'price-h', PROGRAM[program]));
      list.forEach(function(p){ root.appendChild(card(p)); });
    });
    state.flash = '';
  }

  tabBtn.addEventListener('click', function(){ if(!state.data || !state.busy) load(); });

  /* Even before this tab is opened, the link maker should know the live catalog. The public
     endpoint answers without a session, so it works at any point after the page loads. */
  try {
    fetch('/api/packages', { headers: { Accept: 'application/json' } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(v){ if(v && v.plans) sharePlans({ plans: v.plans }); })
      .catch(function(){});
  } catch(e){}
})();
