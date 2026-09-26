(function(){
  'use strict';

  // Schema comes from /admin/schema.js, which build.mjs generates from
  // src/lib/content-schema.mjs. These used to be hand-typed duplicates and they
  // drifted out of sync with the server, which is the bug that made every save 422.
  var SCHEMA = window.FB_SCHEMA;
  if (!SCHEMA) {
    document.body.innerHTML = '<p style="padding:32px;font:16px/1.5 system-ui;">' +
      'The admin panel could not load its field list (/admin/schema.js). ' +
      'Run <code>npm run build</code> and reload.</p>';
    return;
  }
  var TEXT_GROUPS = SCHEMA.textGroups;
  var TEXT_LABELS = SCHEMA.textLabels;
  var IMAGE_LABELS = SCHEMA.imageLabels;

  var state = { content: null, dirty: false };

  var loginScreen = document.getElementById('loginScreen');
  var adminScreen = document.getElementById('adminScreen');
  var toast = document.getElementById('toast');

  function say(msg){
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(function(){ toast.classList.remove('show'); }, 2600);
  }

  // One line in the top bar carries the whole save story: amber while there is work
  // the site has not seen, green once it has.
  function setStatus(text, cls){
    var el = document.getElementById('saveStatus');
    el.textContent = text;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  // The Edit -> Save -> Publish strip above Content and Photos. One word per state, so the owner
  // never has to wonder whether the website has his change yet:
  //   live      nothing waiting, the website is what he saved last
  //   editing   typed but not saved
  //   saved     saved as a draft, NOT on the website until Publish
  //   published sent; the site rebuilds in about a minute
  var FLOW = {
    live: { at: -1, note: 'The website matches your last save. Edits stay private until you tap Publish.' },
    editing: { at: 0, note: 'Unsaved edits. Tap Save to keep them. Nobody sees them yet.' },
    saved: { at: 2, note: 'Saved, but NOT on the website yet. Tap Publish when you are ready.' },
    published: { at: 3, note: 'Published. fast-basketball.com shows it in about a minute.' }
  };
  function setFlow(state){
    var f = FLOW[state] || FLOW.live;
    document.querySelectorAll('#publishFlow li').forEach(function(li, i){
      li.className = i < f.at ? 'done' : (i === f.at ? 'now' : '');
    });
    document.getElementById('flowNote').textContent = f.note;
    if(state === 'editing') setStatus('Unsaved', 'dirty');
    else if(state === 'saved') setStatus('Not live yet', 'dirty');
    else if(state === 'published') setStatus('Publishing', 'ok');
    else setStatus('Live', 'ok');
  }

  var uid = 0;
  function cell(tag, text){
    var el = document.createElement(tag);
    el.textContent = text == null ? '' : String(text);
    return el;
  }

  function api(path, options){
    options = options || {};
    options.credentials = 'same-origin';
    return fetch('/api/' + path, options);
  }

  // ---- Sign-in is an emailed code now, not a password. A device that just entered a code is
  // the "recognized device": every session starts from one, so publishing always does too.
  var LOGOUT_KEY = 'fb_admin_until';   // persist sessions: expiry lives in localStorage
  var KNOWN_KEY = 'fb_admin_known';    // has this browser ever signed in (greeting only)
  var MODE_KEY = 'fb_admin_mode';      // 'persist' or 'visit'
  var LIVE_KEY = 'fb_admin_live';      // sessionStorage flag: this tab owns a visit session
  var logoutTimer = null;

  function ssGet(k){ try { return sessionStorage.getItem(k); } catch(e){ return null; } }
  function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }

  function el(id){ return document.getElementById(id); }
  function loginError(msg){ el('loginError').textContent = msg || ''; }

  // The greeting mirrors whether this browser has signed in before, which is what "recognized
  // device" versus "new device" means to the owner. It is a convenience only; the real check
  // is the emailed code, which every device must pass.
  (function(){
    var known = false;
    try { known = localStorage.getItem(KNOWN_KEY) === '1'; } catch(e){}
    el('deviceNote').textContent = known
      ? 'Welcome back. Pick how long to stay signed in, and we will email you a fresh code.'
      : 'New device. Pick how long to stay signed in, and we will email a setup code to recognize it.';
  })();

  function requestCode(which){
    loginError('');
    var b = el(which);
    var label = b.textContent;
    b.disabled = true; b.textContent = 'Sending...';
    api('admin-otp-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function(res){
        if(!res.ok) throw new Error();
        el('codeStep').hidden = false;
        el('sendCodeBtn').hidden = true;
        el('deviceNote').textContent = 'We emailed a 6-digit code. It expires in 10 minutes.';
        var c = el('loginCode'); if(c) c.focus();
      })
      .catch(function(){ loginError('Could not send the code. Check your connection and try again.'); })
      .finally(function(){ b.disabled = false; b.textContent = label; });
  }
  el('sendCodeBtn').addEventListener('click', function(){ requestCode('sendCodeBtn'); });
  el('resendBtn').addEventListener('click', function(){ requestCode('resendBtn'); });

  el('loginForm').addEventListener('submit', function(e){
    e.preventDefault();
    // Enter pressed before a code was sent just sends one.
    if(el('codeStep').hidden){ requestCode('sendCodeBtn'); return; }
    var code = (el('loginCode').value || '').trim();
    var ttl = el('loginDuration').value;
    if(!/^\d{6}$/.test(code)){ loginError('Enter the 6-digit code from your email.'); return; }
    var vb = el('verifyBtn');
    var vlabel = vb.textContent;
    vb.disabled = true; vb.textContent = 'Signing in...';
    api('admin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, ttl: ttl }) })
      .then(function(res){ return res.json().catch(function(){ return {}; }).then(function(data){ return { ok: res.ok, data: data }; }); })
      .then(function(r){
        if(!r.ok){ loginError(r.data.error || 'Wrong code. Try again.'); return; }
        try { localStorage.setItem(KNOWN_KEY, '1'); } catch(e){}
        // persist=false ("This visit") is scoped to this tab: its expiry lives in sessionStorage
        // and the tab is flagged live, so closing the tab ends it. The longer choices persist in
        // localStorage and survive a close, which is the whole reason to pick them.
        var persist = r.data.persist !== false;
        try {
          localStorage.setItem(MODE_KEY, persist ? 'persist' : 'visit');
          if(persist){
            if(r.data.until) localStorage.setItem(LOGOUT_KEY, String(r.data.until));
            sessionStorage.removeItem(LOGOUT_KEY); sessionStorage.removeItem(LIVE_KEY);
          } else {
            if(r.data.until) sessionStorage.setItem(LOGOUT_KEY, String(r.data.until));
            sessionStorage.setItem(LIVE_KEY, '1');
            localStorage.removeItem(LOGOUT_KEY);
          }
        } catch(e){}
        loginError('');
        el('loginCode').value = '';
        loadAdmin();
      })
      .catch(function(){ loginError('Could not reach the server. Check your connection.'); })
      .finally(function(){ vb.disabled = false; vb.textContent = vlabel; });
  });

  // Auto-logout at the chosen moment. The stored `until` survives a reload so the timer is
  // right even after refreshing, and the server enforces the same expiry independently: at
  // this instant the signed cookie has lapsed, so every request would 401 anyway.
  function scheduleAutoLogout(){
    if(logoutTimer){ clearTimeout(logoutTimer); logoutTimer = null; }
    // A visit session keeps its expiry per-tab (sessionStorage); a persistent one in localStorage.
    var until = Number(ssGet(LOGOUT_KEY)) || Number(lsGet(LOGOUT_KEY)) || 0;
    if(!until) return;
    var ms = until - Date.now();
    if(ms <= 0){ signedOut(); return; }
    // setTimeout tops out near 24.8 days; the 30-day option exceeds that, so cap each wait
    // and re-check rather than overflow to an immediate fire.
    logoutTimer = setTimeout(scheduleAutoLogout, Math.min(ms, 20 * 24 * 60 * 60 * 1000));
  }
  function signedOut(){
    if(logoutTimer){ clearTimeout(logoutTimer); logoutTimer = null; }
    try { localStorage.removeItem(LOGOUT_KEY); localStorage.removeItem(MODE_KEY); sessionStorage.removeItem(LOGOUT_KEY); sessionStorage.removeItem(LIVE_KEY); } catch(e){}
    // Best-effort: drop the cookie server-side too, so a lapsed session cannot be reused.
    try { api('admin-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch(e){}
    adminScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    el('codeStep').hidden = true;
    el('sendCodeBtn').hidden = false;
    loginError('You were signed out. Sign in again to continue.');
  }

  function loadAdmin(){
    var hasDraft = false;
    api('admin-content').then(function(res){
      if(!res.ok) throw new Error('not authenticated');
      // A saved draft that was never published is work the website does not have yet: say so
      // the moment the panel opens, not only after the next Save.
      hasDraft = res.headers.get('X-FB-Has-Draft') === '1';
      return res.json();
    }).then(function(data){
      state.content = data;
      loginScreen.classList.add('hidden');
      adminScreen.classList.remove('hidden');
      renderContentTab();
      renderPhotosTab();
      setFlow(hasDraft ? 'saved' : 'live');
      scheduleAutoLogout();
      maybeTour();
    }).catch(function(){
      // Not signed in (or the session lapsed). Show the login screen and drop any stale timer.
      if(logoutTimer){ clearTimeout(logoutTimer); logoutTimer = null; }
      loginScreen.classList.remove('hidden');
      adminScreen.classList.add('hidden');
    });
  }

  document.querySelectorAll('.tab').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.add('hidden'); });
      btn.classList.add('active');
      var name = btn.dataset.tab;
      document.getElementById('tab' + name.charAt(0).toUpperCase() + name.slice(1)).classList.remove('hidden');
      document.getElementById('tabTitle').textContent = btn.dataset.title || btn.textContent;
      // A new tab starts at its top, not wherever the last one was scrolled to.
      window.scrollTo(0, 0);
      // Save, Publish and the tools belong to Content and Photos. Leads and Pay have
      // nothing to save, so hiding them there gives the list the bottom of the screen
      // back. The class, not the hidden attribute: .actions sets its own display and
      // would win.
      // Deals has no Save or Publish either: a deal or a coupon is live the moment it is made.
      var editsSite = name === 'content' || name === 'photos';
      ['actionBar', 'tools', 'canvasLink', 'publishFlow', 'flowNote'].forEach(function(id){
        document.getElementById(id).classList.toggle('hidden', !editsSite);
      });
      if(name === 'leads') loadLeads();
      else if(name === 'pay') loadPay();
      else if(name === 'deals') loadDeals();
    });
  });

  function renderContentTab(){
    var root = document.getElementById('tabContent');
    root.innerHTML = '';
    // One <details> per section rather than a wall of boxes: on a phone the whole list
    // of sections fits on one screen and you open the one you came for. The first is
    // open so the tab never loads looking empty.
    Object.keys(TEXT_GROUPS).forEach(function(group, i){
      var section = document.createElement('details');
      section.className = 'field-group';
      section.open = i === 0;
      var summary = document.createElement('summary');
      summary.appendChild(document.createTextNode(group.charAt(0).toUpperCase() + group.slice(1)));
      var n = TEXT_GROUPS[group].length;
      var count = cell('span', n + (n === 1 ? ' field' : ' fields'));
      count.className = 'count';
      summary.appendChild(count);
      section.appendChild(summary);
      var body = document.createElement('div');
      body.className = 'group-body';
      section.appendChild(body);
      TEXT_GROUPS[group].forEach(function(key){
        var wrap = document.createElement('div');
        wrap.className = 'field';
        var label = document.createElement('label');
        label.textContent = TEXT_LABELS[key] || key;
        var value = state.content.text[key] || '';
        var input = document.createElement(value.length > 70 ? 'textarea' : 'input');
        if(input.tagName === 'INPUT') input.type = 'text';
        // Size the box to the paragraph. A fixed-height textarea on a phone is a
        // four-line peephole onto copy that has to be read whole to be edited.
        else input.rows = Math.min(10, Math.ceil(value.length / 34) + 1);
        input.id = 'f' + (++uid);
        label.htmlFor = input.id;
        input.value = value;
        input.addEventListener('input', function(){
          state.content.text[key] = input.value;
          state.dirty = true;
          setFlow('editing');
        });
        wrap.appendChild(label);
        wrap.appendChild(input);
        body.appendChild(wrap);
      });
      root.appendChild(section);
    });
    var pricing = renderPricing();
    if(pricing) root.appendChild(pricing);
  }

  // The price fields. Built from /admin/plans.js (window.FB_PLANS), which build.mjs
  // generates from src/lib/plans.mjs, so the panel never carries its own copy of the
  // catalog and cannot offer a pay option a plan does not price.
  //
  // These write content.json's top-level `prices` in CENTS. plans.mjs reads that back and
  // validates every entry before it overrides anything, so what is typed here can only
  // ever change a figure that already exists.
  function renderPricing(){
    var PLANS = window.FB_PLANS;
    if(!PLANS || !PLANS.plans) return null;
    if(!state.content.prices || typeof state.content.prices !== 'object') state.content.prices = {};

    var section = document.createElement('details');
    section.className = 'field-group';
    var summary = document.createElement('summary');
    summary.appendChild(document.createTextNode('Prices'));
    var count = cell('span', PLANS.plans.length + ' plans');
    count.className = 'count';
    summary.appendChild(count);
    section.appendChild(summary);
    var body = document.createElement('div');
    body.className = 'group-body';
    section.appendChild(body);

    // Said where the fields are, not in a guide nobody has open: the website changes when
    // you publish, the card reader does not change until the catalog is pushed.
    var warn = document.createElement('p');
    warn.className = 'price-warn';
    warn.textContent = 'Changing a price here updates the pricing table, the pricing card and the '
      + 'checkout page when you Publish. Two things it does NOT do, so tell your developer whenever '
      + 'you change one: a card is still charged whatever Stripe has on file until they run the '
      + 'catalog sync, and the sentences that talk about a price in words (the per-session line, the '
      + 'published rates on the terms page, the group training page) are written by hand.';
    body.appendChild(warn);

    PLANS.plans.forEach(function(plan){
      plan.payOptions.forEach(function(opt){
        var wrap = document.createElement('div');
        wrap.className = 'field';
        var input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.id = 'price' + (++uid);
        var label = document.createElement('label');
        // Both evaluations carry the same label, because it is the product name Stripe
        // shows the parent. The link builder tells them apart the same way.
        var name = plan.key === 'eval-call' ? plan.label + ' (48-hour rate)' : plan.label;
        label.textContent = name + (plan.payOptions.length > 1 ? ' · ' + opt.label : '');
        label.htmlFor = input.id;

        var saved = state.content.prices[plan.key] && state.content.prices[plan.key][opt.pay];
        input.value = centsToInput(typeof saved === 'number' ? saved : opt.amountCents);

        var note = document.createElement('p');
        note.className = 'price-note';
        note.textContent = opt.mode === 'subscription'
          ? 'Charged ' + opt.amount + ' a month, ' + opt.iterations + ' times.'
          : 'Charged once.';

        input.addEventListener('input', function(){
          var cents = inputToCents(input.value);
          if(cents === null){
            note.textContent = 'Type a dollar amount, like 450 or 183.33.';
            wrap.classList.add('bad');
            return;
          }
          wrap.classList.remove('bad');
          note.textContent = 'Saves as ' + dollarsFromCents(cents) + '.';
          if(!state.content.prices[plan.key]) state.content.prices[plan.key] = {};
          state.content.prices[plan.key][opt.pay] = cents;
          state.dirty = true;
          setFlow('editing');
        });

        wrap.appendChild(label);
        wrap.appendChild(input);
        wrap.appendChild(note);
        body.appendChild(wrap);
      });
    });
    return section;
  }

  // Dollars in the box, cents in the file. Stripe takes integers and so does plans.mjs;
  // the panel is the only place a human should ever see a decimal point.
  function centsToInput(cents){
    return (cents % 100) ? (cents / 100).toFixed(2) : String(cents / 100);
  }
  function inputToCents(raw){
    var text = String(raw).replace(/[$,\s]/g, '');
    if(!/^\d+(\.\d{1,2})?$/.test(text)) return null;
    var cents = Math.round(parseFloat(text) * 100);
    return (cents >= 100 && cents <= 2000000) ? cents : null;
  }
  function dollarsFromCents(cents){
    var whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var frac = cents % 100;
    return '$' + whole + (frac ? '.' + String(frac).padStart(2, '0') : '');
  }

  function fileToDataUrl(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){ resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderPhotoCard(key, image, isExtra){
    var card = document.createElement('div');
    card.className = 'photo-card';

    // No <img> at all when there is nothing to show: an empty src re-requests the page
    // and draws a broken-image glyph.
    if(image && image.src){
      var img = document.createElement('img');
      img.src = image.src;
      img.alt = '';
      card.appendChild(img);
    }

    var h3 = document.createElement('h3');
    h3.textContent = IMAGE_LABELS[key] || (isExtra ? 'Additional resume card' : key);
    card.appendChild(h3);

    // Labels, not placeholders: a placeholder disappears the moment you type, which on a
    // phone is exactly when you look up to check which box you are in.
    function textField(labelText, value, placeholder){
      var wrap = document.createElement('div');
      wrap.className = 'field';
      var input = document.createElement('input');
      input.type = 'text';
      input.id = 'p' + (++uid);
      input.value = value || '';
      input.placeholder = placeholder;
      var label = document.createElement('label');
      label.textContent = labelText;
      label.htmlFor = input.id;
      wrap.appendChild(label);
      wrap.appendChild(input);
      card.appendChild(wrap);
      return input;
    }
    var altInput = textField('Alt text (required)', image && image.alt, 'One sentence saying what is in the photo');
    var captionInput = textField('Caption', image && image.caption, 'Optional');
    var sourceInput = textField('Source or date', image && image.source, 'Optional');

    // The native file button is a 20px target with no room for the file name. A label
    // wrapping a hidden input is the same control at full width, and it can say which
    // file is chosen.
    var fileLabel = document.createElement('label');
    fileLabel.className = 'file';
    var fileName = cell('span', 'Choose a photo');
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.addEventListener('change', function(){
      var chosen = fileInput.files[0];
      fileLabel.classList.toggle('has', !!chosen);
      fileName.textContent = chosen ? chosen.name : 'Choose a photo';
    });
    fileLabel.appendChild(fileName);
    fileLabel.appendChild(fileInput);
    card.appendChild(fileLabel);

    var errorLine = document.createElement('div');
    errorLine.className = 'upload-error';
    card.appendChild(errorLine);

    var uploadBtn = document.createElement('button');
    uploadBtn.textContent = isExtra ? 'Add This Photo' : 'Upload New Photo';
    uploadBtn.addEventListener('click', function(){
      if(!fileInput.files[0]){ errorLine.textContent = 'Choose a photo first.'; return; }
      if(!altInput.value.trim()){ errorLine.textContent = 'Alt text is required before uploading.'; return; }
      errorLine.textContent = '';
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading...';
      fileToDataUrl(fileInput.files[0]).then(function(dataUrl){
        return api('admin-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: isExtra ? 'resume-extra' : key,
            isNewResumeCard: isExtra,
            alt: altInput.value,
            caption: captionInput.value,
            source: sourceInput.value,
            dataUrl: dataUrl
          })
        });
      }).then(function(res){
        return res.json().then(function(data){ return { ok: res.ok, data: data }; });
      }).then(function(result){
        if(!result.ok){
          errorLine.textContent = result.data.error || 'Upload rejected.';
          return;
        }
        // A fixed-slot upload stages like everything else; only Publish puts it live.
        // The resume-card path still commits directly, so it says so honestly.
        say(isExtra ? 'Resume card added and publishing.' : 'Photo uploaded. Tap Publish to put it on the website.');
        loadAdmin();
      }).catch(function(){
        errorLine.textContent = 'Upload failed. Check your connection and try again.';
      }).finally(function(){
        uploadBtn.disabled = false;
        uploadBtn.textContent = isExtra ? 'Add This Photo' : 'Upload New Photo';
      });
    });
    card.appendChild(uploadBtn);

    return card;
  }

  function renderPhotosTab(){
    var root = document.getElementById('tabPhotos');
    root.innerHTML = '';
    var grid = document.createElement('div');
    grid.className = 'photo-grid';
    Object.keys(IMAGE_LABELS).forEach(function(key){
      grid.appendChild(renderPhotoCard(key, state.content.images[key], false));
    });
    (state.content.resumeExtra || []).forEach(function(image){
      grid.appendChild(renderPhotoCard(image.id, image, false));
    });
    root.appendChild(grid);

    var addBtn = document.createElement('button');
    addBtn.id = 'addResumeCard';
    addBtn.textContent = '+ Add a New Resume Card';
    addBtn.addEventListener('click', function(){
      grid.appendChild(renderPhotoCard('resume-extra', null, true));
    });
    root.appendChild(addBtn);
  }

  // Every lead field was typed by a stranger: a contact-form name, or the parent name a
  // parent types into Stripe's custom field. Rows are built with textContent only, so a
  // name like <img onerror=...> is displayed, not run, in the owner's browser.
  // Mirrors PAY_LABELS in src/lib/plans.mjs, where 'split' was retired with the September
  // 2026 price sheet. A lead stored under a retired option still renders: the lookup below
  // falls back to the raw value rather than showing a blank.
  // Mirrors PAY_LABELS in src/lib/plans.mjs. m2..m5 are the tool-purchase payment plans.
  var PAY_LABELS = { full: 'Pay in full', monthly: 'Monthly', m2: '2 months', m3: '3 months', m4: '4 months', m5: '5 months' };
  var SEP = ' \u00b7 ';
  // A registration is an enrollment row before Stripe has confirmed anything. 'paid' and
  // 'unpaid' are Stripe's own words for a completed session; the rest are ours, set by
  // checkout.mjs and the webhook.
  var STATUS = { pending: 'PENDING PAYMENT', abandoned: 'NO PAYMENT', superseded: 'REPLACED', unpaid: 'UNPAID' };
  // The registration's typed answers, in form order, for the CSV. Mirrors FIELDS in
  // src/lib/registration.mjs.
  var REG_KEYS = ['athleteFirst', 'athleteLast', 'dob', 'gender', 'grade', 'school', 'studentEmail', 'studentPhone',
    'experience', 'team', 'position', 'goals', 'parentFirst', 'parentLast', 'relationship', 'homeCity', 'contactMethod',
    'program', 'frequency', 'day', 'tshirt', 'insuranceProvider', 'insurancePolicy', 'notes', 'hearAbout', 'hearAboutOther', 'paymentStatus', 'agreeName',
    // /appbuy tool orders. Mirrors FIELDS in src/lib/apporder.mjs plus what the webhook adds.
    'firstName', 'lastName', 'role', 'athleteName', 'product', 'productLabel', 'accessUrl'];

  // "3 hours ago" answers the only question a glance asks. Intl does the words; the exact
  // timestamp stays on the element's title for when it matters.
  var RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  var UNITS = [['year', 31536e6], ['month', 2592e6], ['week', 6048e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]];
  function ago(ts){
    var d = new Date(ts);
    if(isNaN(d.getTime())) return '';
    var ms = d.getTime() - Date.now();
    if(Math.abs(ms) < 6e4) return 'just now';
    for(var i = 0; i < UNITS.length; i++){
      if(Math.abs(ms) >= UNITS[i][1] || i === UNITS.length - 1){
        return RTF.format(Math.round(ms / UNITS[i][1]), UNITS[i][0]);
      }
    }
  }

  // "6m 12s" from a millisecond dwell, for a visit card and its CSV cell.
  function humanDwell(ms){
    if(typeof ms !== 'number' || ms < 0) return '';
    var s = Math.round(ms / 1000);
    if(s < 60) return s + 's';
    return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }

  function detailsText(l){
    if(l.type === 'visit') return (l.ref || 'untagged') + SEP + (l.submitted ? 'submitted' : 'left without submitting') + (l.dwellMs ? SEP + humanDwell(l.dwellMs) : '');
    if(l.type === 'playbook') return (l.position || '') + ' / ' + (l.focus || '');
    if(l.type === 'enrollment'){
      // A monthly enrollment's amount is the first invoice, not the term: say "a month" so
      // the row cannot read as the $183.33 Blake sold for $550.
      var s = (l.planLabel || l.plan || '') + SEP + (PAY_LABELS[l.pay] || l.pay || '') + SEP +
        (l.amount || '') + (l.amount && l.pay === 'monthly' ? ' a month' : '');
      if(STATUS[l.paymentStatus]) s = STATUS[l.paymentStatus] + SEP + s;
      if(l.cancelNoticeBy) s += SEP + 'notice by ' + l.cancelNoticeBy;
      if(l.playerName) s += SEP + 'player ' + l.playerName + (l.grade ? ', ' + l.grade : '');
      if(l.program) s += SEP + l.program;
      return s;
    }
    if(l.type === 'apporder'){
      var a = (l.productLabel || l.product || '') + SEP + (PAY_LABELS[l.pay] || l.pay || '') + SEP +
        (l.amount || '') + (l.amount && l.months ? ' a month' : '');
      if(STATUS[l.paymentStatus]) a = STATUS[l.paymentStatus] + SEP + a;
      return a;
    }
    if(l.type === 'contact') return [l.area, l.hearAbout].filter(Boolean).join(SEP);
    return l.area || '';
  }

  // RFC 4180: quote a cell that holds a quote, comma or line break, doubling inner quotes.
  // A cell starting with = + - @ would run as a formula when the file opens in Excel or
  // Sheets; a leading apostrophe makes it text. That also catches phone numbers written
  // as +1..., which is the price of not executing a stranger's spreadsheet macro. Tab and
  // carriage return are in the set because spreadsheets skip them and evaluate what follows,
  // so a name typed as "<tab>=HYPERLINK(...)" would otherwise sail through.
  function csvCell(v){
    var s = v == null ? '' : String(v);
    if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function leadsCsv(rows){
    var lines = ['date,name,email,phone,type,plan,pay,amount,cancelNoticeBy,details,' + REG_KEYS.join(',')];
    rows.forEach(function(l){
      var cells = [l.timestamp, l.name, l.email, l.phone, l.type, l.plan, l.pay, l.amount, l.cancelNoticeBy,
        detailsText(l) + (l.livemode === false ? ' (test)' : '')];
      REG_KEYS.forEach(function(k){ cells.push(l[k]); });
      lines.push(cells.map(csvCell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  // The link Blake pastes into the enrollment email. Reads /admin/plans.js (window.FB_PLANS,
  // generated by build.mjs from src/lib/plans.mjs) so the panel never carries its own copy
  // of the catalog. No plans.js means an older build: the builder simply does not appear.
  function renderLinkBuilder(){
    var PLANS = window.FB_PLANS;
    if(!PLANS || !PLANS.plans) return null;

    // Closed by default: the list of leads is what the tab is for, and this is a tool you
    // reach for once a call is done.
    var box = document.createElement('details');
    box.className = 'field-group link-builder';
    var summary = cell('summary', 'Enrollment link');
    box.appendChild(summary);
    var body = document.createElement('div');
    body.className = 'group-body';
    box.appendChild(body);
    var fields = document.createElement('div');
    fields.className = 'fields';
    body.appendChild(fields);

    function field(labelText, control){
      var wrap = document.createElement('div');
      wrap.className = 'field';
      var label = document.createElement('label');
      label.textContent = labelText;
      wrap.appendChild(label);
      wrap.appendChild(control);
      fields.appendChild(wrap);
      return control;
    }
    function option(select, value, text){
      var o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      select.appendChild(o);
    }

    var planSel = field('Plan', document.createElement('select'));
    PLANS.plans.forEach(function(p){
      // Both evaluations share one label on purpose (it is the product name Stripe shows
      // the parent), so the panel tells them apart here.
      var label = p.key === 'eval-call' ? p.label + ' (48-hour rate)' : p.label;
      option(planSel, p.key, p.kind === 'once' ? label + ', ' + p.payOptions[0].amount : label);
    });
    var paySel = field('Payment', document.createElement('select'));
    var emailIn = field('Parent email (optional)', document.createElement('input'));
    emailIn.type = 'email';
    emailIn.placeholder = 'parent@example.com';
    // The family tag rides in the link as ?ref=. It ties every open of this link to a family
    // in the Leads tab, and it is what an "opened, did not finish" email names.
    var refIn = field('Family tag (optional)', document.createElement('input'));
    refIn.placeholder = 'Smith family';

    var row = document.createElement('div');
    row.className = 'link-row';
    body.appendChild(row);
    var out = document.createElement('input');
    out.className = 'link-out';
    out.readOnly = true;
    row.appendChild(out);
    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    row.appendChild(copyBtn);
    var help = document.createElement('p');
    help.className = 'help';
    help.textContent = "Paste this in the enrollment email. It never expires; Stripe's checkout opens when the parent clicks it. For the 48-hour evaluation rate pick Evaluation Session (48-hour rate). Add a family tag and the Leads tab shows when they open it and how long they stay, and emails you if they look but do not finish.";
    body.appendChild(help);

    function update(){
      var email = emailIn.value.trim();
      var refv = refIn.value.trim();
      out.value = PLANS.siteUrl.replace(/\/$/, '') + '/enroll?plan=' + planSel.value + '&pay=' + paySel.value +
        (email ? '&email=' + encodeURIComponent(email) : '') +
        (refv ? '&ref=' + encodeURIComponent(refv) : '');
    }
    function fillPay(){
      paySel.textContent = '';
      PLANS.plans.filter(function(p){ return p.key === planSel.value; })[0].payOptions.forEach(function(o){
        option(paySel, o.pay, o.label + ', ' + o.amount + (o.iterations ? ' x ' + o.iterations : ''));
      });
      update();
    }
    planSel.addEventListener('change', fillPay);
    paySel.addEventListener('change', update);
    emailIn.addEventListener('input', update);
    refIn.addEventListener('input', update);
    copyBtn.addEventListener('click', function(){ copyText(out.value, out); });
    fillPay();
    return box;
  }

  var leadsCache = [];
  function loadLeads(){
    var root = document.getElementById('tabLeads');
    root.textContent = '';
    var builder = renderLinkBuilder();
    if(builder) root.appendChild(builder);
    var status = document.createElement('p');
    status.textContent = 'Loading leads...';
    root.appendChild(status);
    api('leads-list').then(function(res){ return res.json(); }).then(function(data){
      leadsCache = data.leads || [];
      status.remove();
      renderLeads(leadsCache);
    }).catch(function(){
      status.textContent = 'Could not load leads.';
    });
  }

  // One card per lead instead of a five-column table. A table on a 375px screen either
  // scrolls sideways or crushes every column, and the column that lost most was Details,
  // which is where the message a parent actually typed lives.
  function leadCard(l){
    var card = document.createElement('div');
    card.className = 'lead';

    var top = document.createElement('div');
    top.className = 'lead-top';
    var chip = cell('span', l.type || 'lead');
    chip.className = 'chip ' + (l.type || '');
    top.appendChild(chip);
    if(l.livemode === false){
      var test = cell('span', 'Test');
      test.className = 'chip flag';
      test.title = 'Came from Stripe test mode, not real money.';
      top.appendChild(test);
    }
    if(l.spam){
      var flagged = cell('span', 'Filtered');
      flagged.className = 'chip flag';
      flagged.title = 'The contact form filter flagged this (' + l.spam + '). It was stored but not emailed.';
      top.appendChild(flagged);
    }
    var when = cell('span', ago(l.timestamp));
    when.className = 'lead-when';
    if(l.timestamp) when.title = new Date(l.timestamp).toLocaleString();
    top.appendChild(when);
    card.appendChild(top);

    var name = cell('h3', l.name || '(no name given)');
    name.className = 'lead-name';
    card.appendChild(name);

    function meta(label, value){
      if(!value) return;
      var p = document.createElement('p');
      p.className = 'lead-meta';
      p.appendChild(cell('b', label + ': '));
      p.appendChild(document.createTextNode(String(value)));
      card.appendChild(p);
    }

    if(l.type === 'enrollment'){
      if(STATUS[l.paymentStatus]){
        var st = cell('p', STATUS[l.paymentStatus]);
        st.className = 'lead-status';
        card.appendChild(st);
      }
      // Same wording as the CSV: a monthly amount is the first invoice, not the term.
      meta('Plan', [l.planLabel || l.plan, PAY_LABELS[l.pay] || l.pay,
        l.amount ? l.amount + (l.pay === 'monthly' ? ' a month' : '') : ''].filter(Boolean).join(SEP));
      meta('Player', l.playerName ? l.playerName + (l.grade ? ', ' + l.grade : '') : '');
      meta('Program', l.program);
      meta('Notice by', l.cancelNoticeBy);
    } else if(l.type === 'apporder'){
      if(STATUS[l.paymentStatus]){
        var ast = cell('p', STATUS[l.paymentStatus]);
        ast.className = 'lead-status';
        card.appendChild(ast);
      }
      // A payment-plan amount is one instalment, not the price, so the row says "a month"
      // for the same reason a monthly enrollment does.
      meta('Tool', [l.productLabel || l.product, PAY_LABELS[l.pay] || l.pay,
        l.amount ? l.amount + (l.months ? ' a month for ' + l.months + ' months' : '') : ''].filter(Boolean).join(SEP));
      meta('For', [l.role, l.athleteName].filter(Boolean).join(SEP));
      meta('Access link', l.accessUrl);
      if(l.notes){
        var anote = cell('div', l.notes);
        anote.className = 'lead-msg';
        card.appendChild(anote);
      }
    } else if(l.type === 'contact'){
      meta('Area', l.area);
      meta('Program', l.program);
      meta('How they heard', l.hearAbout);
      if(l.message){
        var msg = cell('div', l.message);
        msg.className = 'lead-msg';
        card.appendChild(msg);
      }
    } else if(l.type === 'playbook'){
      meta('Position', l.position);
      meta('Focus', l.focus);
      meta('Grade', l.grade);
    } else if(l.type === 'visit'){
      meta('Opened', l.timestamp ? new Date(l.timestamp).toLocaleString() : '');
      meta('Time on page', typeof l.dwellMs === 'number' ? (l.dwellMs ? humanDwell(l.dwellMs) : 'left right away, or still open') : '');
      meta('Outcome', l.submitted ? 'Submitted the form' : 'Left without submitting');
    } else {
      meta('Details', detailsText(l));
    }

    // Built here at runtime, and only ever the parent's own address or number, so the
    // rule that keeps mailto:/sms: out of the site's HTML (bots scrape them) is untouched.
    var links = document.createElement('div');
    links.className = 'lead-links';
    function link(href, text){
      var a = document.createElement('a');
      a.href = href;
      a.textContent = text;
      links.appendChild(a);
    }
    if(l.email) link('mailto:' + l.email, l.email);
    if(l.phone) link('tel:' + String(l.phone).replace(/[^\d+]/g, ''), l.phone);
    if(links.children.length) card.appendChild(links);

    return card;
  }

  function renderLeads(leads){
    var root = document.getElementById('tabLeads');
    var shown = leads;

    var bar = document.createElement('div');
    bar.className = 'leads-toolbar';
    var filter = document.createElement('input');
    filter.className = 'leads-filter';
    filter.placeholder = 'Filter by suburb, name, or email';
    bar.appendChild(filter);
    var typeSel = document.createElement('select');
    [['', 'All types'], ['contact', 'contact'], ['playbook', 'playbook'], ['enrollment', 'enrollment'], ['apporder', 'tool orders'], ['visit', 'link opens']].forEach(function(pair){
      var o = document.createElement('option');
      o.value = pair[0];
      o.textContent = pair[1];
      typeSel.appendChild(o);
    });
    bar.appendChild(typeSel);
    var exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.textContent = 'Export CSV';
    bar.appendChild(exportBtn);
    root.appendChild(bar);

    var listWrap = document.createElement('div');
    listWrap.id = 'leadsList';
    root.appendChild(listWrap);

    function applyFilters(){
      var q = filter.value.toLowerCase();
      var type = typeSel.value;
      shown = leads.filter(function(l){
        return (!type || l.type === type) && (!q || JSON.stringify(l).toLowerCase().indexOf(q) !== -1);
      });
      buildList(shown);
    }
    filter.addEventListener('input', applyFilters);
    typeSel.addEventListener('change', applyFilters);
    exportBtn.addEventListener('click', function(){
      var blob = new Blob([leadsCsv(shown)], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'leads.csv';
      a.click();
    });

    function buildList(rows){
      listWrap.textContent = '';
      var count = cell('p', rows.length + (rows.length === 1 ? ' lead' : ' leads'));
      count.className = 'leads-count';
      listWrap.appendChild(count);
      if(!rows.length){
        var empty = cell('p', leads.length ? 'Nothing matches that filter.' : 'No leads yet.');
        empty.className = 'lead-meta';
        listWrap.appendChild(empty);
        return;
      }
      rows.forEach(function(l){ listWrap.appendChild(leadCard(l)); });
    }
    buildList(leads);
  }

  // --- pay ----------------------------------------------------------------
  // Developer-commission totals per fortnightly pay period, from the dev-payments
  // endpoint. This tab only reads and downloads; the endpoint owns every figure.
  function payMoney(cents){
    var n = typeof cents === 'number' && !isNaN(cents) ? cents : 0;
    var neg = n < 0;
    return (neg ? '-$' : '$') + (Math.abs(n) / 100).toFixed(2);
  }
  // Dates arrive as full ISO instants (period start/end) or a bare YYYY-MM-DD (pay
  // date). Slicing to the date part and building the Date at local noon dodges a
  // UTC/local day-shift a straight `new Date(iso)` would risk on either shape.
  function payDate(iso){
    var d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function downloadPayFile(periodKey, format, btn){
    var label = btn.textContent;
    btn.disabled = true;
    api('dev-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ download: format, period: periodKey })
    }).then(function(res){
      if(!res.ok) throw new Error();
      return res.blob();
    }).then(function(blob){
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dev-payments-' + periodKey + '.' + format;
      a.click();
    }).catch(function(){
      say('Download failed. Check your connection and try again.');
    }).finally(function(){
      btn.disabled = false;
      btn.textContent = label;
    });
  }

  // One card per period, styled like a lead card (.lead, .lead-top, .lead-name,
  // .lead-meta, .chip) so Pay looks like it belongs beside Leads rather than
  // inventing a second visual language.
  function payPeriodCard(period){
    var card = document.createElement('div');
    card.className = 'lead';

    var top = document.createElement('div');
    top.className = 'lead-top';
    var dates = cell('h3', payDate(period.startISO) + ' to ' + payDate(period.endISO));
    dates.className = 'lead-name';
    top.appendChild(dates);
    if(period.current){
      var openChip = cell('span', 'Not yet payable');
      openChip.className = 'chip flag';
      top.appendChild(openChip);
    }
    card.appendChild(top);

    var net = cell('p', payMoney(period.netCents));
    net.className = 'pay-net' + (period.netCents > 0 ? ' pos' : period.netCents < 0 ? ' neg' : '');
    card.appendChild(net);
    var netLabel = cell('p', 'Net commission');
    netLabel.className = 'pay-net-label';
    card.appendChild(netLabel);

    function meta(label, value){
      var p = document.createElement('p');
      p.className = 'lead-meta';
      p.appendChild(cell('b', label + ': '));
      p.appendChild(document.createTextNode(value));
      card.appendChild(p);
    }
    meta('Gross paid', payMoney(period.grossPaidCents));
    meta('Accrued', payMoney(period.accrualCents));
    meta('Reversed', payMoney(period.reversalCents));
    // The net settles two deals at once: 2.5% or 8% of training revenue, and 50% of a tool
    // sale. Shown only when there is a tool sale in the month, so a training-only period reads
    // exactly as it always did.
    if(period.appCount){
      meta('Training part', payMoney(period.trainingNetCents));
      meta('Tool sales, 50/50', payMoney(period.appNetCents));
    }
    meta('Entries', String(period.entryCount || 0));
    meta('Pay date', payDate(period.payDateISO));

    // A refund the server could not match to its own accrual gets reversed at the
    // base rate instead, which is worth flagging rather than burying in the total.
    if(period.unmatchedCount > 0){
      var warn = cell('p', period.unmatchedCount + (period.unmatchedCount === 1
        ? ' refund could not be matched to its accrual and was reversed at the base rate.'
        : ' refunds could not be matched to their accruals and were reversed at the base rate.'));
      warn.className = 'price-warn';
      card.appendChild(warn);
    }

    var actions = document.createElement('div');
    actions.className = 'pay-actions';
    ['csv', 'xlsx'].forEach(function(format){
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = format.toUpperCase();
      btn.addEventListener('click', function(){ downloadPayFile(period.key, format, btn); });
      actions.appendChild(btn);
    });
    card.appendChild(actions);

    return card;
  }

  function renderPay(periods, data){
    var root = document.getElementById('tabPay');
    // A ledger row that will not parse is a payment MISSING from every total below. The server
    // counts them rather than logging and moving on, so the panel has to say so: a silent gap
    // behind a green-looking figure is the one failure this report must never have.
    if(data && data.unreadable){
      var warn = cell('p', data.unreadable + ' commission record(s) could not be read and are '
        + 'missing from these totals. Tell your developer before paying from this.');
      warn.className = 'price-warn';
      root.appendChild(warn);
    }
    if(!periods.length){
      root.appendChild(cell('p', 'No pay periods yet.'));
      return;
    }
    periods.forEach(function(period){ root.appendChild(payPeriodCard(period)); });
  }

  function loadPay(){
    var root = document.getElementById('tabPay');
    root.textContent = '';
    var status = document.createElement('p');
    status.textContent = 'Loading pay periods...';
    root.appendChild(status);
    api('dev-payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function(res){
        if(!res.ok) throw new Error();
        return res.json();
      }).then(function(data){
        status.remove();
        renderPay(data.periods || [], data);
      }).catch(function(){
        status.textContent = 'Could not load pay periods.';
      });
  }

  // --- copy and share ------------------------------------------------------
  // One copy routine for every link and code in the panel. The clipboard API first; the old
  // select-and-execCommand path for the browsers that refuse it outside a secure gesture.
  function copyText(text, input){
    function fallback(){
      var ok = false;
      if(input){ input.select(); try { ok = document.execCommand('copy'); } catch(e){} }
      say(ok ? 'Copied' : 'Copy failed. Press and hold the text to copy it.');
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ say('Copied'); }, fallback);
    } else fallback();
  }
  // The phone's own share sheet (Messages, WhatsApp, Mail) where there is one, which is how a
  // link actually reaches a parent from a phone. Copy everywhere else.
  function shareText(title, text, url, input){
    if(navigator.share){
      navigator.share({ title: title, text: text, url: url }).catch(function(){});
    } else copyText(url || text, input);
  }

  // A destructive button that needs a second tap, and forgets the first after four seconds.
  // Cheaper than a confirm() dialog on a phone and impossible to trigger by one stray thumb.
  function twoTap(btn, armedLabel, action){
    var label = btn.textContent;
    var timer = null;
    btn.addEventListener('click', function(){
      if(!btn.classList.contains('armed')){
        btn.classList.add('armed');
        btn.textContent = armedLabel;
        timer = setTimeout(function(){ btn.classList.remove('armed'); btn.textContent = label; }, 4000);
        return;
      }
      clearTimeout(timer);
      btn.classList.remove('armed');
      btn.disabled = true;
      action(function(){ btn.disabled = false; btn.textContent = label; });
    });
  }

  // A labelled control, the same .field shape as every other form in the panel.
  function fieldEl(labelText, control, hint){
    var wrap = document.createElement('div');
    wrap.className = 'field';
    control.id = control.id || 'd' + (++uid);
    var label = document.createElement('label');
    label.textContent = labelText;
    label.htmlFor = control.id;
    wrap.appendChild(label);
    wrap.appendChild(control);
    if(hint){
      var h = cell('p', hint);
      h.className = 'price-note';
      wrap.appendChild(h);
    }
    return wrap;
  }
  function inputEl(type, placeholder){
    var i = document.createElement('input');
    i.type = type || 'text';
    if(placeholder) i.placeholder = placeholder;
    return i;
  }
  function selectEl(pairs, value){
    var s = document.createElement('select');
    pairs.forEach(function(p){
      var o = document.createElement('option');
      o.value = String(p[0]);
      o.textContent = p[1];
      s.appendChild(o);
    });
    if(value != null) s.value = String(value);
    return s;
  }
  function moneyInput(placeholder){
    var i = inputEl('text', placeholder);
    i.inputMode = 'decimal';
    i.autocomplete = 'off';
    return i;
  }
  function postJson(path, body){
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function(res){ return res.json().catch(function(){ return {}; }).then(function(data){ return { ok: res.ok, status: res.status, data: data }; }); });
  }

  // Mirrors EXPIRY_HOURS in server/functions/lib/deals.mjs, which refuses anything else.
  var EXPIRY = [[24, '24 hours'], [48, '48 hours'], [72, '3 days'], [96, '4 days'], [120, '5 days'],
    [144, '6 days'], [168, '1 week'], [336, '2 weeks'], [504, '3 weeks'], [720, '30 days']];
  function whenText(iso){
    var d = new Date(iso);
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // --- the Deals tab ------------------------------------------------------
  // Two jobs, one tab: Cut a Deal (a private price and link for one family) and Coupon Codes
  // (a code any family types at checkout). A segmented switch picks which one fills the screen,
  // so on a phone neither is a scroll away from the other.
  var dealsPane = 'deal';
  function loadDeals(which){
    if(which) dealsPane = which;
    var root = document.getElementById('tabDeals');
    root.textContent = '';

    var live = document.createElement('p');
    live.className = 'live-note';
    live.appendChild(cell('b', 'Live instantly. '));
    live.appendChild(document.createTextNode('No Save or Publish on this tab: a deal or coupon works the moment you create it, and stops the moment you close it.'));
    root.appendChild(live);

    var seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'tablist');
    [['deal', 'Cut a Deal'], ['coupon', 'Coupon Codes']].forEach(function(p){
      var b = cell('button', p[1]);
      b.type = 'button';
      b.id = 'seg-' + p[0];
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(dealsPane === p[0]));
      b.addEventListener('click', function(){ loadDeals(p[0]); });
      seg.appendChild(b);
    });
    root.appendChild(seg);

    var pane = document.createElement('div');
    root.appendChild(pane);
    if(dealsPane === 'coupon') renderCouponPane(pane); else renderDealPane(pane);
  }

  function renderDealPane(pane){
    var form = document.createElement('form');
    form.className = 'field-group deal-form';
    form.id = 'dealForm';
    form.noValidate = true;
    var head = cell('h2', 'New deal');
    head.className = 'pane-h';
    form.appendChild(head);
    var intro = cell('p', 'A private price for one family. You get a link; they open it, fill in the normal enrollment form, and pay exactly this on Stripe.');
    intro.className = 'pane-intro';
    form.appendChild(intro);
    var body = document.createElement('div');
    body.className = 'group-body';
    form.appendChild(body);

    var title = inputEl('text', '4 weeks of group training');
    title.setAttribute('list', 'dealTitles');
    title.maxLength = 80;
    var titles = document.createElement('datalist');
    titles.id = 'dealTitles';
    ['4 weeks of group training', '8 weeks of group training', 'Evaluation session', 'Private 1-on-1 sessions',
      '3 months of group training', '6 months of group training'].forEach(function(t){
      var o = document.createElement('option'); o.value = t; titles.appendChild(o);
    });
    body.appendChild(fieldEl('What they get', title, 'This is the name the parent sees on the page and on Stripe.'));
    body.appendChild(titles);

    var forName = inputEl('text', 'The Smith family');
    forName.maxLength = 80;
    body.appendChild(fieldEl('Who it is for (optional)', forName, 'Shown to the parent as "Prepared for ...". Also how you find it in your list.'));

    var details = document.createElement('textarea');
    details.rows = 2;
    details.maxLength = 400;
    details.placeholder = 'Thursdays 6 to 7 PM, starting October 2.';
    body.appendChild(fieldEl('Details they see (optional)', details));

    // How they pay: either or both. Each option reveals its own boxes.
    var payHead = cell('p', 'How they can pay');
    payHead.className = 'sub-label';
    body.appendChild(payHead);

    function option(labelText, on){
      var box = document.createElement('div');
      box.className = 'opt' + (on ? ' on' : '');
      var lab = document.createElement('label');
      lab.className = 'opt-h';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!on;
      lab.appendChild(cb);
      lab.appendChild(cell('span', labelText));
      box.appendChild(lab);
      var inner = document.createElement('div');
      inner.className = 'opt-b';
      box.appendChild(inner);
      cb.addEventListener('change', function(){ box.classList.toggle('on', cb.checked); preview(); });
      body.appendChild(box);
      return { cb: cb, inner: inner };
    }
    var full = option('All at once', true);
    var fullPrice = moneyInput('750');
    full.inner.appendChild(fieldEl('Price, paid today', fullPrice));

    var plan = option('A payment plan', false);
    var planTotal = moneyInput('900');
    var paymentsPairs = [];
    for(var n = 2; n <= 12; n++) paymentsPairs.push([n, n + ' monthly payments']);
    var payments = selectEl(paymentsPairs, 3);
    var planRow = document.createElement('div');
    planRow.className = 'two';
    planRow.appendChild(fieldEl('Total over the plan', planTotal));
    planRow.appendChild(fieldEl('Split into', payments));
    plan.inner.appendChild(planRow);
    var planNote = cell('p', '');
    planNote.className = 'price-note';
    plan.inner.appendChild(planNote);

    var expires = selectEl([[0, 'Until I close it']].concat(EXPIRY), 0);
    body.appendChild(fieldEl('Link works for', expires));

    var pv = document.createElement('div');
    pv.className = 'preview';
    body.appendChild(pv);

    var err = cell('p', '');
    err.className = 'error';
    err.setAttribute('role', 'alert');
    body.appendChild(err);
    var create = cell('button', 'Create deal and get the link');
    create.type = 'submit';
    create.className = 'btn primary wide';
    body.appendChild(create);

    // What the parent will see, recomputed on every keystroke, in the same words the page uses.
    // Figures here are a preview only: the server recomputes and Stripe charges its own price.
    function values(){
      var v = { full: null, total: null, n: Number(payments.value), each: null };
      if(full.cb.checked) v.full = inputToCents(fullPrice.value);
      if(plan.cb.checked){
        v.total = inputToCents(planTotal.value);
        if(v.total) v.each = Math.floor(v.total / v.n);
      }
      return v;
    }
    function preview(){
      var v = values();
      planNote.textContent = v.each
        ? dollarsFromCents(v.each) + ' a month, ' + v.n + ' times' + (v.each * v.n !== v.total ? ' (' + dollarsFromCents(v.each * v.n) + ' in total: it cannot split to the cent)' : '') + '. Stops by itself after the last one.'
        : 'Each payment is the total split evenly. It stops by itself after the last one.';
      pv.textContent = '';
      var lines = [];
      if(full.cb.checked && v.full) lines.push(dollarsFromCents(v.full) + ' today');
      if(plan.cb.checked && v.each) lines.push(dollarsFromCents(v.each) + ' a month for ' + v.n + ' months');
      pv.appendChild(cell('span', 'The parent sees'));
      pv.appendChild(cell('b', (title.value.trim() || 'What they get') + (lines.length ? ': ' + lines.join(', or ') : '')));
    }
    [title, fullPrice, planTotal, payments].forEach(function(i){ i.addEventListener('input', preview); i.addEventListener('change', preview); });
    preview();

    var result = document.createElement('div');
    pane.appendChild(result);
    pane.appendChild(form);
    var list = document.createElement('div');
    pane.appendChild(list);

    form.addEventListener('submit', function(e){
      e.preventDefault();
      err.textContent = '';
      var v = values();
      if(!title.value.trim()){ err.textContent = 'Say what they get.'; title.focus(); return; }
      if(!full.cb.checked && !plan.cb.checked){ err.textContent = 'Tick at least one way to pay.'; return; }
      if(full.cb.checked && !v.full){ err.textContent = 'Type the price as dollars, like 750.'; fullPrice.focus(); return; }
      if(plan.cb.checked && !v.total){ err.textContent = 'Type the payment plan total as dollars, like 900.'; planTotal.focus(); return; }
      create.disabled = true;
      create.textContent = 'Creating...';
      postJson('admin-deals', {
        action: 'create', title: title.value, forName: forName.value, details: details.value,
        fullCents: full.cb.checked ? v.full : null,
        monthlyTotalCents: plan.cb.checked ? v.total : null,
        payments: v.n, expiresHours: Number(expires.value)
      }).then(function(r){
        if(!r.ok){ err.textContent = r.data.error || 'That did not work. Try again.'; return; }
        form.reset();
        full.cb.checked = true; full.cb.dispatchEvent(new Event('change'));
        plan.cb.checked = false; plan.cb.dispatchEvent(new Event('change'));
        result.textContent = '';
        result.appendChild(dealCard(r.data.deal, true, r.data.warning));
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
        refresh();
      }).catch(function(){ err.textContent = 'Could not reach the server. Nothing was created.'; })
        .finally(function(){ create.disabled = false; create.textContent = 'Create deal and get the link'; });
    });

    function refresh(){
      list.textContent = '';
      var status = cell('p', 'Loading your deals...');
      status.className = 'leads-count';
      list.appendChild(status);
      api('admin-deals').then(function(res){ return res.json(); }).then(function(data){
        var deals = data.deals || [];
        status.textContent = deals.length ? 'Your deals · ' + deals.length : 'No deals yet. Your first one will show here.';
        deals.forEach(function(d){ list.appendChild(dealCard(d, false)); });
      }).catch(function(){ status.textContent = 'Could not load your deals.'; });
    }
    refresh();
  }

  var STATE_CHIP = { open: ['Open', 'ok'], paid: ['Paid', 'paid'], closed: ['Closed', ''], expired: ['Expired', 'flag'] };
  function dealCard(d, fresh, warning){
    var card = document.createElement('div');
    card.className = 'lead deal' + (fresh ? ' fresh' : '');
    var top = document.createElement('div');
    top.className = 'lead-top';
    var chipInfo = STATE_CHIP[d.state] || [d.state, ''];
    var chip = cell('span', fresh ? 'Link ready' : chipInfo[0]);
    chip.className = 'chip ' + (fresh ? 'ok' : chipInfo[1]);
    top.appendChild(chip);
    var when = cell('span', ago(d.createdAt));
    when.className = 'lead-when';
    top.appendChild(when);
    card.appendChild(top);
    card.appendChild(Object.assign(cell('h3', d.title), { className: 'lead-name' }));

    function meta(label, value){
      if(!value) return;
      var p = document.createElement('p');
      p.className = 'lead-meta';
      p.appendChild(cell('b', label + ': '));
      p.appendChild(document.createTextNode(value));
      card.appendChild(p);
    }
    meta('For', d.forName);
    var prices = [];
    if(d.full) prices.push(dollarsFromCents(d.full) + ' all at once');
    if(d.monthly) prices.push(dollarsFromCents(d.monthly.eachCents) + ' a month x ' + d.monthly.payments);
    meta('Price', prices.join(', or '));
    meta('Details', d.details);
    if(d.state === 'open') meta('Link works', d.expiresAt ? 'until ' + whenText(d.expiresAt) : 'until you close it');
    if(d.state === 'paid') meta('Paid', (d.paidBy || 'yes') + (d.paidAt ? ', ' + ago(d.paidAt) : ''));
    if(d.state === 'expired') meta('Expired', whenText(d.expiresAt));
    if(warning){
      var w = cell('p', warning);
      w.className = 'price-warn';
      card.appendChild(w);
    }

    if(d.state === 'open'){
      var help = cell('p', fresh ? 'Send this link to the parent. It works right now, and only for one family: once they pay, it closes itself.' : '');
      if(fresh){ help.className = 'lead-meta'; card.appendChild(help); }
      var out = inputEl('text');
      out.readOnly = true;
      out.value = d.link;
      out.className = 'link-out';
      out.setAttribute('aria-label', 'Deal link');
      card.appendChild(out);
      var row = document.createElement('div');
      row.className = 'card-actions';
      var copy = cell('button', 'Copy link');
      copy.type = 'button'; copy.className = 'btn primary';
      copy.addEventListener('click', function(){ copyText(d.link, out); });
      var share = cell('button', 'Send');
      share.type = 'button'; share.className = 'btn';
      share.addEventListener('click', function(){
        shareText(d.title, 'Here is your enrollment link from Coach Blake: ' + d.title + '.', d.link, out);
      });
      var view = document.createElement('a');
      view.className = 'btn'; view.textContent = 'View'; view.href = d.link; view.target = '_blank'; view.rel = 'noopener';
      row.appendChild(copy); row.appendChild(share); row.appendChild(view);
      card.appendChild(row);
      var close = cell('button', 'Close this deal');
      close.type = 'button'; close.className = 'btn ghost danger wide';
      twoTap(close, 'Tap again: the link stops working', function(done){
        postJson('admin-deals', { action: 'close', id: d.id }).then(function(r){
          if(!r.ok){ say(r.data.error || 'Could not close it.'); done(); return; }
          say('Deal closed. The link no longer works.');
          loadDeals('deal');
        }).catch(function(){ say('Could not reach the server.'); done(); });
      });
      card.appendChild(close);
    }
    return card;
  }

  // Coupon codes. Every code lives in Stripe itself, so the /enroll coupon box honours it the
  // moment it exists, and the Stripe dashboard can see and stop it too.
  var SCOPES = [['all', 'Any training plan'], ['eval', 'Evaluation sessions only'], ['membership', 'Group memberships only']];
  function renderCouponPane(pane){
    var form = document.createElement('form');
    form.className = 'field-group deal-form';
    form.id = 'couponForm';
    form.noValidate = true;
    form.appendChild(Object.assign(cell('h2', 'New coupon code'), { className: 'pane-h' }));
    form.appendChild(Object.assign(cell('p', 'A code families type into the Coupon code box on the enrollment page. It comes off the price on Stripe.'), { className: 'pane-intro' }));
    var body = document.createElement('div');
    body.className = 'group-body';
    form.appendChild(body);

    var code = inputEl('text', 'FALL50');
    code.maxLength = 30;
    code.autocapitalize = 'characters';
    code.autocomplete = 'off';
    code.spellcheck = false;
    code.className = 'code-in';
    code.addEventListener('input', function(){
      var clean = code.value.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '');
      if(clean !== code.value) code.value = clean;
    });
    body.appendChild(fieldEl('Code name', code, 'Letters, numbers and dashes. Families can type it in lower case.'));

    // Dollars or percent, as two big buttons rather than a dropdown.
    var kind = 'amount';
    var kindRow = document.createElement('div');
    kindRow.className = 'seg small';
    var amt = moneyInput('50');
    var valueField = fieldEl('Dollars off', amt);
    [['amount', '$ off'], ['percent', '% off']].forEach(function(p){
      var b = cell('button', p[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(p[0] === kind));
      b.addEventListener('click', function(){
        kind = p[0];
        kindRow.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed', String(x === b)); });
        valueField.querySelector('label').textContent = kind === 'amount' ? 'Dollars off' : 'Percent off';
        amt.placeholder = kind === 'amount' ? '50' : '10';
        preview();
      });
      kindRow.appendChild(b);
    });
    var kindWrap = fieldEl('Value', kindRow);
    kindWrap.querySelector('label').removeAttribute('for');
    body.appendChild(kindWrap);
    body.appendChild(valueField);

    var scope = selectEl(SCOPES, 'all');
    body.appendChild(fieldEl('Works on', scope, 'Never on the phone tools, and not on a Cut a Deal link: a deal is already the price.'));
    var hours = selectEl(EXPIRY, 168);
    body.appendChild(fieldEl('Stops working after', hours));

    var pv = document.createElement('div');
    pv.className = 'preview';
    body.appendChild(pv);
    var once = cell('p', 'On a monthly plan it comes off the first payment only.');
    once.className = 'price-note';
    body.appendChild(once);

    var err = cell('p', '');
    err.className = 'error';
    err.setAttribute('role', 'alert');
    body.appendChild(err);
    var create = cell('button', 'Create coupon code');
    create.type = 'submit';
    create.className = 'btn primary wide';
    body.appendChild(create);

    function valueCents(){
      if(kind === 'percent'){
        var p = Number(String(amt.value).replace(/[%\s]/g, ''));
        return Number.isInteger(p) && p >= 1 && p <= 100 ? p : null;
      }
      var c = inputToCents(amt.value);
      return c && c <= 200000 ? c : null;
    }
    function preview(){
      var v = valueCents();
      var off = v == null ? '...' : (kind === 'percent' ? v + '% off' : dollarsFromCents(v) + ' off');
      var until = new Date(Date.now() + Number(hours.value) * 3600e3).toISOString();
      pv.textContent = '';
      pv.appendChild(cell('span', 'Families get'));
      pv.appendChild(cell('b', (code.value || 'YOURCODE') + ' takes ' + off + ', ' + scope.options[scope.selectedIndex].text.toLowerCase() + '. Stops working ' + whenText(until) + '.'));
    }
    [code, amt, scope, hours].forEach(function(i){ i.addEventListener('input', preview); i.addEventListener('change', preview); });
    preview();

    var result = document.createElement('div');
    pane.appendChild(result);
    pane.appendChild(form);
    var list = document.createElement('div');
    pane.appendChild(list);

    form.addEventListener('submit', function(e){
      e.preventDefault();
      err.textContent = '';
      var v = valueCents();
      if(code.value.length < 3){ err.textContent = 'Give the code a name, at least 3 characters.'; code.focus(); return; }
      if(v == null){ err.textContent = kind === 'percent' ? 'Type a percent from 1 to 100.' : 'Type dollars off, from 1 to 2000.'; amt.focus(); return; }
      create.disabled = true;
      create.textContent = 'Creating...';
      postJson('admin-coupons', { action: 'create', code: code.value, kind: kind, value: v, scope: scope.value, hours: Number(hours.value) })
        .then(function(r){
          if(!r.ok){ err.textContent = r.data.error || 'That did not work. Try again.'; return; }
          code.value = ''; amt.value = '';
          preview();
          result.textContent = '';
          result.appendChild(couponCard(r.data.coupon, true));
          result.scrollIntoView({ behavior: 'smooth', block: 'start' });
          refresh();
        }).catch(function(){ err.textContent = 'Could not reach the server. Nothing was created.'; })
        .finally(function(){ create.disabled = false; create.textContent = 'Create coupon code'; });
    });

    function refresh(){
      list.textContent = '';
      var status = cell('p', 'Loading your codes...');
      status.className = 'leads-count';
      list.appendChild(status);
      api('admin-coupons').then(function(res){
        return res.json().then(function(data){ return { ok: res.ok, data: data }; });
      }).then(function(r){
        if(!r.ok){ status.textContent = r.data.error || 'Could not load your codes.'; return; }
        var codes = r.data.coupons || [];
        status.textContent = codes.length ? 'Live codes · ' + codes.length : 'No live codes. Your first one will show here.';
        codes.forEach(function(c){ list.appendChild(couponCard(c, false)); });
      }).catch(function(){ status.textContent = 'Could not load your codes.'; });
    }
    refresh();
  }

  function couponCard(c, fresh){
    var card = document.createElement('div');
    card.className = 'lead deal' + (fresh ? ' fresh' : '');
    var expired = c.expiresAt && Date.parse(c.expiresAt) <= Date.now();
    var top = document.createElement('div');
    top.className = 'lead-top';
    var chip = cell('span', fresh ? 'Code ready' : (!c.active ? 'Off' : expired ? 'Expired' : 'Live'));
    chip.className = 'chip ' + (fresh || (c.active && !expired) ? 'ok' : 'flag');
    top.appendChild(chip);
    if(c.created){
      var when = cell('span', ago(c.created));
      when.className = 'lead-when';
      top.appendChild(when);
    }
    card.appendChild(top);
    card.appendChild(Object.assign(cell('h3', c.code), { className: 'lead-name code' }));
    function meta(label, value){
      if(!value) return;
      var p = document.createElement('p');
      p.className = 'lead-meta';
      p.appendChild(cell('b', label + ': '));
      p.appendChild(document.createTextNode(value));
      card.appendChild(p);
    }
    meta('Takes off', c.percentOff ? c.percentOff + '%' : c.amountOff ? dollarsFromCents(c.amountOff) : '');
    meta('Works on', c.worksOn);
    meta(expired ? 'Stopped' : 'Stops working', c.expiresAt ? whenText(c.expiresAt) : 'never');
    meta('Used', c.timesRedeemed + (c.timesRedeemed === 1 ? ' time' : ' times'));
    if(fresh){
      var help = cell('p', 'Tell families to type ' + c.code + ' in the Coupon code box on the enrollment page. It works right now.');
      help.className = 'lead-meta';
      card.appendChild(help);
    }
    if(c.active){
      var row = document.createElement('div');
      row.className = 'card-actions';
      var copy = cell('button', 'Copy code');
      copy.type = 'button'; copy.className = 'btn';
      copy.addEventListener('click', function(){ copyText(c.code); });
      row.appendChild(copy);
      var off = cell('button', 'Turn off');
      off.type = 'button'; off.className = 'btn ghost danger';
      twoTap(off, 'Tap again to turn off', function(done){
        postJson('admin-coupons', { action: 'off', id: c.id }).then(function(r){
          if(!r.ok){ say(r.data.error || 'Could not turn it off.'); done(); return; }
          say(c.code + ' is off. It no longer works.');
          loadDeals('coupon');
        }).catch(function(){ say('Could not reach the server.'); done(); });
      });
      row.appendChild(off);
      card.appendChild(row);
    }
    return card;
  }

  // --- the tour -----------------------------------------------------------
  // Shown on the owner's next three visits to the panel, on this device, and skippable every
  // time. "More > Show the tour again" replays it whenever. A spotlight cut out of a dimmed
  // screen points at the real control rather than describing where it is.
  var TOUR_KEY = 'fb_admin_tour_deals';
  var TOUR_VISITS = 3;
  var tourShownThisLoad = false;
  function maybeTour(){
    if(tourShownThisLoad) return;
    tourShownThisLoad = true;
    var seen = Number(lsGet(TOUR_KEY)) || 0;
    if(seen >= TOUR_VISITS) return;
    try { localStorage.setItem(TOUR_KEY, String(seen + 1)); } catch(e){}
    startTour(seen + 1);
  }
  function goTab(name){
    var b = document.querySelector('.tab[data-tab="' + name + '"]');
    if(b && !b.classList.contains('active')) b.click();
  }
  var TOUR = [
    { title: 'New: deals and coupon codes', body: 'A one-minute tour of what changed. It shows your next three visits. Tap Skip whenever you like.' },
    { tab: 'deals', target: '.tab[data-tab="deals"]', title: 'The Deals tab', body: 'Special prices live here, in two parts: Cut a Deal, and Coupon Codes.' },
    { tab: 'deals', pane: 'deal', target: '#seg-deal', title: 'Cut a Deal', body: 'Say what they get and the price: all at once, a payment plan, or both. Tap Create. You get a private link to text the parent. They fill in the normal form and pay exactly that price.' },
    { tab: 'deals', pane: 'deal', target: '.live-note', title: 'Live the moment you tap Create', body: 'No Publish on this tab. Each link is for one family: once they pay, it closes itself. Close it sooner from its card.' },
    { tab: 'deals', pane: 'coupon', target: '#seg-coupon', title: 'Coupon Codes', body: 'Name a code, like FALL50. Pick dollars or percent off, what it works on, and how long it lasts: 24 hours up to 30 days. Families type it in the Coupon code box.' },
    { tab: 'content', target: '#publishFlow', title: 'Website words and photos', body: 'These are different. Edits on Content and Photos stay private until you Publish. This strip always shows which step you are on.' },
    { tab: 'content', target: '#actionBar', title: 'Save, then Publish', body: 'Save keeps your work, privately. Publish puts it on fast-basketball.com, about a minute later. The word in the top corner says Live, Unsaved or Not live yet.' },
    { title: 'That is everything', body: 'Replay this any time from More > Show the tour again, at the bottom of the Content tab.' }
  ];
  function startTour(visit){
    var old = document.getElementById('tour');
    if(old) old.remove();
    var i = 0;
    var ov = document.createElement('div');
    ov.id = 'tour';
    ov.className = 'tour';
    var spot = document.createElement('div');
    spot.className = 'tour-spot';
    var card = document.createElement('div');
    card.className = 'tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'tourTitle');
    ov.appendChild(spot);
    ov.appendChild(card);
    document.body.appendChild(ov);

    function end(){
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('keydown', onKey);
      ov.remove();
    }
    function onKey(e){ if(e.key === 'Escape') end(); }
    document.addEventListener('keydown', onKey);

    function place(){
      var step = TOUR[i];
      var t = step.target ? document.querySelector(step.target) : null;
      if(!t || !t.getClientRects().length){
        spot.hidden = true;
        ov.classList.add('dim');
        card.className = 'tour-card mid';
        return;
      }
      ov.classList.remove('dim');
      spot.hidden = false;
      var r = t.getBoundingClientRect();
      var pad = 6;
      spot.style.top = (r.top - pad) + 'px';
      spot.style.left = (r.left - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';
      // The card goes on whichever half of the screen the spotlight is not on.
      card.className = 'tour-card ' + (r.top + r.height / 2 > window.innerHeight / 2 ? 'top' : 'bottom');
    }
    function show(){
      var step = TOUR[i];
      if(step.tab) goTab(step.tab);
      if(step.pane && dealsPane !== step.pane) loadDeals(step.pane);
      card.textContent = '';
      var count = cell('p', 'Step ' + (i + 1) + ' of ' + TOUR.length + (visit ? ' · visit ' + visit + ' of ' + TOUR_VISITS : ''));
      count.className = 'tour-count';
      var h = cell('h2', step.title);
      h.id = 'tourTitle';
      card.appendChild(count);
      card.appendChild(h);
      card.appendChild(cell('p', step.body));
      var row = document.createElement('div');
      row.className = 'tour-actions';
      var skip = cell('button', 'Skip');
      skip.type = 'button'; skip.className = 'btn ghost';
      skip.addEventListener('click', end);
      row.appendChild(skip);
      if(i > 0){
        var back = cell('button', 'Back');
        back.type = 'button'; back.className = 'btn';
        back.addEventListener('click', function(){ i--; show(); });
        row.appendChild(back);
      }
      var last = i === TOUR.length - 1;
      var next = cell('button', last ? 'Done' : 'Next');
      next.type = 'button'; next.className = 'btn primary';
      next.addEventListener('click', function(){ if(last) end(); else { i++; show(); } });
      row.appendChild(next);
      card.appendChild(row);
      var t = step.target ? document.querySelector(step.target) : null;
      if(t && t.scrollIntoView) t.scrollIntoView({ block: 'center' });
      // The tab switch and the scroll settle before the spotlight measures.
      setTimeout(place, 60);
      next.focus();
    }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    show();
  }

  // Save and Publish are two buttons because they are two different things now. A save
  // writes a draft and costs nothing; only Publish commits, and a commit is one of the
  // twenty production deploys the free Netlify tier allows in a month. This panel used to
  // have a single button labelled "Publish Changes" that only saved — harmless while
  // saving committed, a lie the moment it stopped.
  document.getElementById('saveBtn').addEventListener('click', function(){
    var btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    api('admin-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.content)
    }).then(function(res){
      return res.json().then(function(data){ return { ok: res.ok, data: data }; });
    }).then(function(result){
      if(!result.ok){
        say('Save failed: ' + (result.data.error || 'unknown error'));
        return;
      }
      state.dirty = false;
      if(result.data.draft){
        setFlow('saved');
        say('Saved. Not on the website yet: tap Publish when you are ready.');
      } else {
        setFlow('published');
        say('Saved. The site is rebuilding.');
      }
    }).catch(function(){
      say('Could not reach the server. Nothing was saved.');
    }).finally(function(){
      btn.disabled = false;
      btn.textContent = 'Save';
    });
  });

  document.getElementById('publishBtn').addEventListener('click', function(){
    var btn = document.getElementById('publishBtn');
    if(state.dirty && !window.confirm('Some edits are not saved yet, and only SAVED work goes live. Tap Cancel, then Save, then Publish. Tap OK to publish only what was saved before.')) return;
    btn.disabled = true;
    btn.textContent = 'Publishing...';
    api('admin-publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function(res){
        return res.json().then(function(data){ return { ok: res.ok, data: data }; });
      }).then(function(result){
        if(!result.ok){
          say(result.data.error || 'Publish failed.');
          return;
        }
        setFlow(result.data.local ? 'live' : 'published');
        say(result.data.local ? result.data.message : 'Published. fast-basketball.com updates in about a minute.');
      }).catch(function(){
        say('Could not reach the server. Nothing was published.');
      }).finally(function(){
        btn.disabled = false;
        btn.textContent = 'Publish';
      });
  });

  document.getElementById('backupBtn').addEventListener('click', function(){
    var blob = new Blob([JSON.stringify(state.content, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fast-basketball-content-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
  });

  // Two previews since September 2026: the Locker and the Playbook left the homepage for /locker,
  // so a pb.* or lkr.* edit has no homepage to show on.
  function openPreview(page){
    api('preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: page, text: state.content.text })
    }).then(function(res){ return res.text(); }).then(function(html){
      var blob = new Blob([html], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    }).catch(function(){
      say('Preview failed to load.');
    });
  }
  document.getElementById('previewBtn').addEventListener('click', function(){ openPreview('home'); });
  document.getElementById('previewLockerBtn').addEventListener('click', function(){ openPreview('locker'); });
  document.getElementById('signOutBtn').addEventListener('click', function(){ signedOut(); });
  document.getElementById('tourBtn').addEventListener('click', function(){ startTour(); });

  window.addEventListener('beforeunload', function(e){
    if(state.dirty){ e.preventDefault(); e.returnValue = ''; }
  });

  // On load, decide whether to resume. A "This visit" session belongs to the tab that made it:
  // a fresh or reopened tab (no LIVE flag in this tab's sessionStorage) must not inherit it, so
  // its cookie is dropped and the login screen is shown. That is what makes closing the tab a
  // real logout. Persistent sessions resume normally, which is what picking a longer time means.
  function resumeOrLogin(){
    if(lsGet(MODE_KEY) === 'visit' && ssGet(LIVE_KEY) !== '1'){
      api('admin-logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .catch(function(){})
        .finally(function(){
          loginScreen.classList.remove('hidden');
          adminScreen.classList.add('hidden');
        });
      return;
    }
    loadAdmin();
  }
  resumeOrLogin();
})();
