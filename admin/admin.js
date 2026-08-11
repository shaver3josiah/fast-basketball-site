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
