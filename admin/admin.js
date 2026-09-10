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

  function api(path, options){
    options = options || {};
    options.credentials = 'same-origin';
    return fetch('/api/' + path, options);
  }

  document.getElementById('loginForm').addEventListener('submit', function(e){
    e.preventDefault();
    var password = document.getElementById('loginPassword').value;
    api('admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password })
    }).then(function(res){
      if(!res.ok){
        document.getElementById('loginError').textContent = 'Wrong password. Try again.';
        return;
      }
      document.getElementById('loginError').textContent = '';
      loadAdmin();
    }).catch(function(){
      document.getElementById('loginError').textContent = 'Could not reach the server. Check your connection.';
    });
  });

  function loadAdmin(){
    api('admin-content').then(function(res){
      if(!res.ok) throw new Error('not authenticated');
      return res.json();
    }).then(function(data){
      state.content = data;
      loginScreen.classList.add('hidden');
      adminScreen.classList.remove('hidden');
      renderContentTab();
      renderPhotosTab();
    }).catch(function(){
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
      if(name === 'leads') loadLeads();
    });
  });

  function renderContentTab(){
    var root = document.getElementById('tabContent');
    root.innerHTML = '';
    Object.keys(TEXT_GROUPS).forEach(function(group){
      var section = document.createElement('div');
      section.className = 'field-group';
      var h2 = document.createElement('h2');
      h2.textContent = group;
      section.appendChild(h2);
      TEXT_GROUPS[group].forEach(function(key){
        var wrap = document.createElement('div');
        wrap.className = 'field';
        var label = document.createElement('label');
        label.textContent = TEXT_LABELS[key] || key;
        var value = state.content.text[key] || '';
        var input = document.createElement(value.length > 70 ? 'textarea' : 'input');
        if(input.tagName === 'INPUT') input.type = 'text';
        input.value = value;
        input.addEventListener('input', function(){
          state.content.text[key] = input.value;
          state.dirty = true;
          document.getElementById('saveStatus').textContent = 'Unsaved changes';
        });
        wrap.appendChild(label);
        wrap.appendChild(input);
        section.appendChild(wrap);
      });
      root.appendChild(section);
    });
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

    var img = document.createElement('img');
    img.src = image ? image.src : '';
    card.appendChild(img);

    var h3 = document.createElement('h3');
    h3.textContent = IMAGE_LABELS[key] || (isExtra ? 'Additional resume card' : key);
    card.appendChild(h3);

    var altInput = document.createElement('input');
    altInput.placeholder = 'Alt text (required, describes the photo for screen readers and search)';
    altInput.value = image ? image.alt : '';
    card.appendChild(altInput);

    var captionInput = document.createElement('input');
    captionInput.placeholder = 'Caption (optional)';
    captionInput.value = image && image.caption ? image.caption : '';
    card.appendChild(captionInput);

    var sourceInput = document.createElement('input');
    sourceInput.placeholder = 'Source or date (optional)';
    sourceInput.value = image && image.source ? image.source : '';
    card.appendChild(sourceInput);

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    card.appendChild(fileInput);

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
        say(isExtra ? 'Resume card added and publishing.' : 'Photo uploaded. Press Publish to put it on the site.');
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
  var PAY_LABELS = { full: 'Pay in full', monthly: 'Monthly' };
  var SEP = ' \u00b7 ';
  // A registration is an enrollment row before Stripe has confirmed anything. 'paid' and
  // 'unpaid' are Stripe's own words for a completed session; the rest are ours, set by
  // checkout.mjs and the webhook.
  var STATUS = { pending: 'PENDING PAYMENT', abandoned: 'NO PAYMENT', superseded: 'REPLACED', unpaid: 'UNPAID' };
  // The registration's typed answers, in form order, for the CSV. Mirrors FIELDS in
  // src/lib/registration.mjs.
  var REG_KEYS = ['athleteFirst', 'athleteLast', 'dob', 'gender', 'grade', 'school', 'studentEmail', 'studentPhone',
    'experience', 'team', 'position', 'goals', 'parentFirst', 'parentLast', 'relationship', 'homeCity', 'contactMethod',
    'program', 'frequency', 'day', 'tshirt', 'insuranceProvider', 'insurancePolicy', 'notes', 'paymentStatus', 'agreeName'];

  function detailsText(l){
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

    var box = document.createElement('div');
    box.className = 'field-group link-builder';
    var h2 = document.createElement('h2');
    h2.textContent = 'Enrollment link';
    box.appendChild(h2);
    var fields = document.createElement('div');
    fields.className = 'fields';
    box.appendChild(fields);

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

    var row = document.createElement('div');
    row.className = 'link-row';
    box.appendChild(row);
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
    help.textContent = "Paste this in the enrollment email. It never expires; Stripe's checkout opens when the parent clicks it. For the 48-hour evaluation rate pick Evaluation Session (48-hour rate).";
    box.appendChild(help);

    function update(){
      var email = emailIn.value.trim();
      out.value = PLANS.siteUrl.replace(/\/$/, '') + '/enroll?plan=' + planSel.value + '&pay=' + paySel.value +
        (email ? '&email=' + encodeURIComponent(email) : '');
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
    copyBtn.addEventListener('click', function(){
      function fallback(){
        out.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch(e){}
        say(ok ? 'Copied' : 'Copy failed. Select the link and copy it by hand.');
      }
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(out.value).then(function(){ say('Copied'); }, fallback);
      } else {
        fallback();
      }
    });
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
      renderLeadsTable(leadsCache);
    }).catch(function(){
      status.textContent = 'Could not load leads.';
    });
  }

  function renderLeadsTable(leads){
    var root = document.getElementById('tabLeads');
    var shown = leads;

    var bar = document.createElement('div');
    bar.className = 'leads-toolbar';
    var filter = document.createElement('input');
    filter.className = 'leads-filter';
    filter.placeholder = 'Filter by suburb, name, or email';
    bar.appendChild(filter);
    var typeSel = document.createElement('select');
    [['', 'All types'], ['contact', 'contact'], ['playbook', 'playbook'], ['enrollment', 'enrollment']].forEach(function(pair){
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

    var tableWrap = document.createElement('div');
    tableWrap.id = 'leadsTableWrap';
    root.appendChild(tableWrap);

    function applyFilters(){
      var q = filter.value.toLowerCase();
      var type = typeSel.value;
      shown = leads.filter(function(l){
        return (!type || l.type === type) && (!q || JSON.stringify(l).toLowerCase().indexOf(q) !== -1);
      });
      buildTable(shown);
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

    function cell(tag, text){
      var el = document.createElement(tag);
      el.textContent = text == null ? '' : String(text);
      return el;
    }
    function buildTable(rows){
      tableWrap.textContent = '';
      var table = document.createElement('table');
      table.className = 'leads';
      var thead = document.createElement('thead');
      var hr = document.createElement('tr');
      ['Date', 'Name', 'Email', 'Type', 'Details'].forEach(function(h){ hr.appendChild(cell('th', h)); });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = document.createElement('tbody');
      rows.forEach(function(l){
        var tr = document.createElement('tr');
        tr.appendChild(cell('td', l.timestamp ? new Date(l.timestamp).toLocaleString() : ''));
        tr.appendChild(cell('td', l.name));
        tr.appendChild(cell('td', l.email));
        tr.appendChild(cell('td', l.type));
        var details = cell('td', detailsText(l));
        if(l.livemode === false){
          var badge = cell('span', 'TEST');
          badge.className = 'badge-test';
          details.appendChild(badge);
        }
        tr.appendChild(details);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
    }
    buildTable(leads);
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
        document.getElementById('saveStatus').textContent = 'Saved as draft';
        say('Saved. Press Publish to put it on the site.');
      } else {
        document.getElementById('saveStatus').textContent = 'Saved, rebuilding';
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
    if(state.dirty && !window.confirm('You have unsaved changes. Publish anyway? Only saved work goes live.')) return;
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
        document.getElementById('saveStatus').textContent = result.data.local ? 'Live' : 'Published, rebuilding';
        say(result.data.message || 'Published.');
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

  window.addEventListener('beforeunload', function(e){
    if(state.dirty){ e.preventDefault(); e.returnValue = ''; }
  });

  loadAdmin();
})();
