(function(){
  'use strict';

  var TEXT_GROUPS = {
    hero: ['hero.eyebrow', 'hero.lede', 'hero.stat1n', 'hero.stat1l', 'hero.stat2n', 'hero.stat2l', 'hero.stat3n', 'hero.stat3l'],
    audience: ['aud.1', 'aud.2', 'aud.3'],
    programs: ['prog.1', 'prog.2', 'prog.3', 'prog.4'],
    coach: ['coach.name', 'coach.title', 'coach.p1', 'coach.p2', 'coach.p3'],
    playbook: ['pb.lede'],
    testimonials: ['tst.1', 'tst.2', 'tst.3'],
    contact: ['ct.lede', 'ct.phone', 'ct.email', 'ct.ig', 'ct.area']
  };

  var TEXT_LABELS = {
    'hero.eyebrow': 'Hero eyebrow line', 'hero.lede': 'Hero opening paragraph',
    'hero.stat1n': 'Hero stat 1 number', 'hero.stat1l': 'Hero stat 1 label',
    'hero.stat2n': 'Hero stat 2 number', 'hero.stat2l': 'Hero stat 2 label',
    'hero.stat3n': 'Hero stat 3 number', 'hero.stat3l': 'Hero stat 3 label',
    'aud.1': 'Middle school audience paragraph', 'aud.2': 'High school audience paragraph', 'aud.3': 'College track audience paragraph',
    'prog.1': 'First Look program description', 'prog.2': 'Private training program description',
    'prog.3': 'Small group program description', 'prog.4': 'College Track program description',
    'coach.name': 'Coach name', 'coach.title': 'Coach title',
    'coach.p1': 'Coach bio paragraph 1', 'coach.p2': 'Coach bio paragraph 2', 'coach.p3': 'Coach bio paragraph 3',
    'pb.lede': 'Playbook section intro',
    'tst.1': 'Testimonial 1', 'tst.2': 'Testimonial 2', 'tst.3': 'Testimonial 3',
    'ct.lede': 'Contact section intro', 'ct.phone': 'Phone number', 'ct.email': 'Email address',
    'ct.ig': 'Instagram handle', 'ct.area': 'Service area line'
  };

  var IMAGE_LABELS = {
    'hero.nets': 'Hero photo (net-cutting championship photo)',
    'rcp.trophy': 'Resume card 1: Horizon League trophy',
    'rcp.team': 'Resume card 2: team celebration',
    'rcp.juco': 'Resume card 3: NJCAA Region 16',
    'rcp.work': 'Resume card 4: working with players',
    'coach.portrait': 'Coach bio portrait'
  };

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
    return fetch('/.netlify/functions/' + path, options);
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
        say('Photo uploaded and publishing');
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

  var leadsCache = [];
  function loadLeads(){
    var root = document.getElementById('tabLeads');
    root.innerHTML = '<p>Loading leads...</p>';
    api('leads-list').then(function(res){ return res.json(); }).then(function(data){
      leadsCache = data.leads || [];
      renderLeadsTable(leadsCache);
    }).catch(function(){
      root.innerHTML = '<p>Could not load leads.</p>';
    });
  }

  function renderLeadsTable(leads){
    var root = document.getElementById('tabLeads');
    root.innerHTML = '';
    var filter = document.createElement('input');
    filter.className = 'leads-filter';
    filter.placeholder = 'Filter by suburb, name, or email';
    filter.addEventListener('input', function(){
      var q = filter.value.toLowerCase();
      var filtered = leadsCache.filter(function(l){
        return JSON.stringify(l).toLowerCase().indexOf(q) !== -1;
      });
      buildTable(filtered);
    });
    root.appendChild(filter);

    var tableWrap = document.createElement('div');
    tableWrap.id = 'leadsTableWrap';
    root.appendChild(tableWrap);

    function buildTable(rows){
      tableWrap.innerHTML = '';
      var table = document.createElement('table');
      table.className = 'leads';
      var thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>Date</th><th>Name</th><th>Email</th><th>Type</th><th>Details</th></tr>';
      table.appendChild(thead);
      var tbody = document.createElement('tbody');
      rows.forEach(function(l){
        var tr = document.createElement('tr');
        var date = l.timestamp ? new Date(l.timestamp).toLocaleString() : '';
        var details = l.type === 'playbook' ? (l.position + ' / ' + l.focus) : (l.area || '');
        tr.innerHTML = '<td>' + date + '</td><td>' + (l.name || '') + '</td><td>' + (l.email || '') + '</td><td>' + (l.type || '') + '</td><td>' + details + '</td>';
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
    }
    buildTable(leads);
  }

  document.getElementById('saveBtn').addEventListener('click', function(){
    var btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Publishing...';
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
      document.getElementById('saveStatus').textContent = 'Publishing, live in about a minute';
      say('Saved. Your changes are publishing now.');
    }).catch(function(){
      say('Could not reach the server. Nothing was saved.');
    }).finally(function(){
      btn.disabled = false;
      btn.textContent = 'Publish Changes';
    });
  });

  document.getElementById('backupBtn').addEventListener('click', function(){
    var blob = new Blob([JSON.stringify(state.content, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fast-basketball-content-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
  });

  document.getElementById('previewBtn').addEventListener('click', function(){
    api('preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 'home', text: state.content.text })
    }).then(function(res){ return res.text(); }).then(function(html){
      var blob = new Blob([html], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    }).catch(function(){
      say('Preview failed to load.');
    });
  });

  window.addEventListener('beforeunload', function(e){
    if(state.dirty){ e.preventDefault(); e.returnValue = ''; }
  });

  loadAdmin();
})();
