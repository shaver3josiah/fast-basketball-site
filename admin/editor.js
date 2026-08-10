/* Canvas editor.
 *
 * Holds the document, drives the canvas iframe, and generates the inspector from the
 * element registry. It contains no renderer of its own: the canvas HTML and CSS come
 * from an endpoint that runs the same compiler the build runs, so what you drag is
 * what ships. The inspector is likewise generated from the registry's `fields`, so a
 * control can never exist for a prop the renderer ignores, and a prop can never exist
 * without a control.
 *
 * There is deliberately no Publish button. Every commit to GitHub triggers a Netlify
 * production deploy and the free tier pauses the site after twenty a month, so until
 * the draft/publish split is built, saving writes to disk locally and stops there.
 */
(function () {
  'use strict';

  var SCHEMA = window.FB_CANVAS;
  var HISTORY_MAX = 60;

  var state = {
    site: null,
    images: {},
    media: null,
    pageIndex: 0,
    sectionIndex: 0,
    selectedId: null,
    dirty: false,
    mode: 'canvas',
    legacyId: null,
    activeField: null,
    // Values of the open legacy section's hook keys, taken the moment it was opened —
    // not part of undo history, just a baseline "Revert section" restores to.
    legacySnapshot: null,
    content: { text: {}, images: {} },
    local: true,
    hasDraft: false,
    deploys: null,
    history: [],
    future: []
  };

  var frame = document.getElementById('canvasFrame');
  var frameWin = null;
  var renderTimer = null;
  // True while an inline canvas edit (typing directly into a [data-edit] leaf) is in
  // progress. The sidebar field's own 420ms debounce checks this so a mid-typing tick
  // cannot fire the full re-render that would destroy the caret it is typing into —
  // that re-render happens once instead, on the frame's fieldCommit.
  var inlineEditing = false;

  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------ plumbing

  function api(path, options) {
    options = options || {};
    options.credentials = 'same-origin';
    return fetch('/.netlify/functions/' + path, options);
  }

  function toast(message, tone) {
    var el = $('toast');
    el.textContent = message;
    el.dataset.tone = tone || '';
    el.classList.add('is-on');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('is-on'); }, tone === 'error' ? 6000 : 2800);
  }

  function setStatus(text, stateName) {
    var el = $('status');
    el.textContent = text;
    if (stateName) el.dataset.state = stateName; else el.removeAttribute('data-state');
  }

  function markDirty() {
    state.dirty = true;
    $('saveBtn').disabled = false;
    setStatus('Unsaved changes', 'dirty');
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function currentPage() { return state.site.pages[state.pageIndex]; }
  function currentSection() { return currentPage().sections[state.sectionIndex]; }

  function selectedElement() {
    if (!state.selectedId) return null;
    var els = currentSection().elements || [];
    for (var i = 0; i < els.length; i++) if (els[i].id === state.selectedId) return els[i];
    return null;
  }

  // ------------------------------------------------------------------ history

  // Snapshot before mutating, not after. Undo restores the state you were looking at
  // when you made the change, which is what a person means by undo.
  //
  // Snapshots BOTH documents. The canvas lives in site.json and the hand-built sections
  // live in content.json, and undo used to restore only the first — so pressing Ctrl+Z
  // while editing a hand-built section left the text untouched and silently reverted an
  // unrelated canvas change instead. Worse than not undoing.
  function snapshot() {
    return { site: clone(state.site), content: clone(state.content) };
  }

  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > HISTORY_MAX) state.history.shift();
    state.future.length = 0;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $('undoBtn').disabled = state.history.length === 0;
    $('redoBtn').disabled = state.future.length === 0;
  }

  function restore(snap) {
    state.site = snap.site;
    state.content = snap.content;
    state.images = snap.content.images || {};
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(snapshot());
    restore(state.history.pop());
    afterTimeTravel();
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(snapshot());
    restore(state.future.pop());
    afterTimeTravel();
  }

  function afterTimeTravel() {
    // The selection may point at an element that no longer exists after an undo.
    if (!selectedElement()) state.selectedId = null;
    updateHistoryButtons();
    markDirty();
    renderAll();
  }

  // ------------------------------------------------------------------ boot

  function boot() {
    api('admin-site').then(function (res) {
      if (res.status === 401) { showGate(); return null; }
      if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'could not load'); });
      return res.json();
    }).then(function (data) {
      if (!data) return;
      state.local = data.local;
      state.hasDraft = data.hasDraft;
      state.deploys = data.deploys;
      startEditor(data.site);
    }).catch(function (err) {
      showGate(err.message);
    });
  }

  // Publishing is the only action that spends a deploy, so it is the only one that
  // needs to say anything about cost. Locally there is nothing to spend.
  function renderPublishState() {
    var btn = $('publishBtn');
    var meter = $('deployMeter');
    if (state.local) {
      btn.hidden = true;
      meter.textContent = 'Local — saves are live immediately';
      meter.removeAttribute('data-warn');
      return;
    }
    btn.hidden = false;
    btn.disabled = !state.hasDraft;
    var d = state.deploys || { used: 0, limit: 20 };
    var left = Math.max(0, d.limit - d.used);
    meter.textContent = left + ' of ' + d.limit + ' publishes left this month';
    // Warn, never block. A hard stop would leave the owner unable to fix a typo on a
    // live page, and this count cannot see deploys triggered outside the editor, so it
    // is a floor rather than a fact.
    if (left <= 5) meter.setAttribute('data-warn', 'true');
    else meter.removeAttribute('data-warn');
  }

  function publish() {
    var btn = $('publishBtn');
    btn.disabled = true;
    setStatus('Publishing…');
    api('admin-publish', { method: 'POST' }).then(function (res) {
      return res.json().then(function (d) { return { ok: res.ok, data: d }; });
    }).then(function (r) {
      if (!r.ok) {
        setStatus('Not published', 'dirty');
        toast(r.data.error || 'Publish failed.', 'error');
        renderPublishState();
        return;
      }
      state.hasDraft = false;
      if (r.data.deploys) state.deploys = r.data.deploys;
      setStatus('Published', 'saved');
      toast(r.data.message || 'Published.');
      renderPublishState();
    }).catch(function () {
      setStatus('Not published', 'dirty');
      toast('Could not reach the server. Nothing was published.', 'error');
      renderPublishState();
    });
  }

  function showGate(message) {
    $('gate').hidden = false;
    $('app').hidden = true;
    if (message) $('gateError').textContent = message;
  }

  $('gateForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('gateError').textContent = '';
    api('admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('gatePassword').value })
    }).then(function (res) {
      if (!res.ok) { $('gateError').textContent = 'That password did not work.'; return; }
      boot();
    }).catch(function () {
      $('gateError').textContent = 'Could not reach the server. Is `npm run dev` running?';
    });
  });

  function startEditor(site) {
    state.site = site;
    $('gate').hidden = true;
    $('app').hidden = false;
    // Photo options for image elements come from the same content.json the site
    // renders from, so the picker can only offer photos that actually exist.
    api('admin-content').then(function (r) { return r.ok ? r.json() : null; }).then(function (content) {
      if (content) { state.images = content.images || {}; state.content = content; }
      renderPublishState();
      renderAll();
    }).catch(function () { renderPublishState(); renderAll(); });
    loadMedia();
  }

  // ------------------------------------------------------------------ rails

  function renderPages() {
    var list = $('pageList');
    list.innerHTML = '';
    state.site.pages.forEach(function (page, i) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.className = 'ed-item';
      btn.type = 'button';
      btn.setAttribute('aria-current', i === state.pageIndex ? 'true' : 'false');
      btn.textContent = page.title.split('|')[0].trim();
      if (page.draft) {
        var note = document.createElement('span');
        note.className = 'ed-item-note';
        note.textContent = 'draft';
        btn.appendChild(note);
      }
      btn.addEventListener('click', function () {
        state.pageIndex = i;
        state.sectionIndex = 0;
        state.selectedId = null;
        renderAll();
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function renderSections() {
    var list = $('sectionList');
    list.innerHTML = '';
    (currentPage().sections || []).forEach(function (section, i) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.className = 'ed-item';
      btn.type = 'button';
      var isLegacy = section.type === 'legacy';
      btn.setAttribute('aria-current', i === state.sectionIndex ? 'true' : 'false');
      btn.textContent = section.name || section.id;

      if (isLegacy) {
        btn.setAttribute('aria-disabled', 'true');
        btn.title = 'Hand-built section.';
      } else {
        btn.addEventListener('click', function () {
          state.mode = 'canvas';
          state.legacyId = null;
          state.sectionIndex = i;
          state.selectedId = null;
          renderAll();
        });
      }
      li.appendChild(btn);
      list.appendChild(li);
    });

    // The nine hand-built sections that make up the real site. They are NOT converted
    // into canvas documents — they already carry the data-edit / data-img hooks the
    // build substitutes through, so the fields are surfaced where they already exist.
    // That is a fraction of the work of redrawing them, and it cannot regress a design
    // nobody touched. Four of the nine carry no hooks and say so, because a section
    // that does nothing when clicked is worse than one that explains itself.
    var header = document.createElement('li');
    header.className = 'ed-sub';
    header.textContent = 'On the live site';
    list.appendChild(header);

    (SCHEMA.legacySections || []).forEach(function (sec) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.className = 'ed-item';
      btn.type = 'button';
      btn.textContent = sec.label;
      var note = document.createElement('span');
      note.className = 'ed-item-note';

      if (!sec.hooks.length) {
        note.textContent = 'no fields';
        btn.setAttribute('aria-disabled', 'true');
        btn.title = 'This section is hardcoded HTML with no editable fields yet. Adding them is a code change, not something the editor can do.';
        btn.addEventListener('click', function () { toast(btn.title); });
      } else {
        note.textContent = sec.hooks.length + (sec.hooks.length === 1 ? ' field' : ' fields');
        btn.setAttribute('aria-current', state.mode === 'legacy' && state.legacyId === sec.id ? 'true' : 'false');
        btn.addEventListener('click', function () {
          state.mode = 'legacy';
          state.legacyId = sec.id;
          state.selectedId = null;
          state.legacySnapshot = snapshotLegacySection(sec);
          renderAll();
        });
      }
      btn.appendChild(note);
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  // ------------------------------------------------------------------ layers

  // Paint order, top of the list = front of the canvas. z lives in the document, so the
  // panel is a view of the data rather than a second source of truth for stacking.
  function orderedElements() {
    var els = ((currentSection() && currentSection().elements) || []).slice();
    return els.sort(function (a, b) { return (b.z || 0) - (a.z || 0); });
  }

  // Rewrite z as a dense 1..n after any reorder. Sparse or duplicate z values make two
  // elements' paint order depend on document order, which is invisible in the UI and
  // therefore impossible to reason about.
  function normaliseZ(ordered) {
    ordered.forEach(function (el, i) { el.z = ordered.length - i; });
  }

  function moveLayer(el, delta) {
    var ordered = orderedElements();
    var i = ordered.indexOf(el);
    // Clamped, so front/back can pass an oversized delta and land at the end rather
    // than being rejected by a bounds check.
    var j = Math.max(0, Math.min(ordered.length - 1, i + delta));
    if (i < 0 || j === i) return;
    pushHistory();
    ordered.splice(j, 0, ordered.splice(i, 1)[0]);
    normaliseZ(ordered);
    markDirty();
    renderAll();
  }

  function renderLayers() {
    var list = $('layerList');
    var panel = $('layersPanel');
    if (!list) return;
    list.innerHTML = '';
    if (state.mode === 'legacy' || !currentSection() || currentSection().type === 'legacy') {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;

    var ordered = orderedElements();
    $('alignBar').hidden = ordered.length < 2;

    ordered.forEach(function (el, i) {
      var li = document.createElement('li');
      li.className = 'ed-layer' + (el.id === state.selectedId ? ' is-on' : '');

      var name = document.createElement('button');
      name.className = 'ed-layer-name';
      name.type = 'button';
      name.textContent = el.name || SCHEMA.types[el.type].label;
      name.title = 'Click to select, double-click to rename';
      name.addEventListener('click', function () {
        state.selectedId = el.id;
        if (frameWin && frameWin.CanvasFrame) frameWin.CanvasFrame.select(el.id, true);
        renderInspector();
        renderLayers();
      });
      name.addEventListener('dblclick', function () { renameLayer(el, name); });

      var kind = document.createElement('span');
      kind.className = 'ed-layer-kind';
      kind.textContent = SCHEMA.types[el.type].label;

      var tools = document.createElement('span');
      tools.className = 'ed-layer-tools';
      tools.appendChild(miniBtn('⤒', 'Bring to front', i === 0, function () { moveLayer(el, -ordered.length); }));
      tools.appendChild(miniBtn('▲', 'Bring forward', i === 0, function () { moveLayer(el, -1); }));
      tools.appendChild(miniBtn('▼', 'Send backward', i === ordered.length - 1, function () { moveLayer(el, 1); }));
      tools.appendChild(miniBtn('⤓', 'Send to back', i === ordered.length - 1, function () { moveLayer(el, ordered.length); }));
      tools.appendChild(miniBtn(el.hidden && el.hidden.desktop ? '◌' : '●', 'Show or hide', false, function () {
        pushHistory();
        el.hidden = el.hidden || {};
        el.hidden.desktop = !el.hidden.desktop;
        markDirty();
        renderAll();
      }));
      tools.appendChild(miniBtn(el.locked ? '🔒' : '🔓', 'Lock or unlock', false, function () {
        pushHistory();
        el.locked = !el.locked;
        markDirty();
        renderAll();
      }));

      li.appendChild(name);
      li.appendChild(kind);
      li.appendChild(tools);
      list.appendChild(li);
    });
  }

  function miniBtn(glyph, title, disabled, onClick) {
    var b = document.createElement('button');
    b.className = 'ed-mini';
    b.type = 'button';
    b.textContent = glyph;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.disabled = !!disabled;
    b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
    return b;
  }

  function renameLayer(el, node) {
    var input = document.createElement('input');
    input.className = 'ed-layer-rename';
    input.value = el.name || '';
    node.replaceWith(input);
    input.focus();
    input.select();
    var commitName = function () {
      pushHistory();
      el.name = input.value.trim() || SCHEMA.types[el.type].label;
      markDirty();
      renderAll();
    };
    input.addEventListener('blur', commitName);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); renderLayers(); }
    });
  }

  // ------------------------------------------------------------------ media

  // Elements and legacy fields reference photos by key, and only PUBLISHED keys live
  // in content.json (state.images) — a freshly staged upload is still sitting in blob
  // storage until Publish flushes it in. Fetched once at boot and re-fetched after any
  // upload or delete, rather than kept in lockstep with every local edit.
  function loadMedia() {
    return api('admin-media').then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (data) {
      state.media = (data && data.items) || [];
      renderMedia();
      // The inspector may already be open on an image element; without this the photo
      // just uploaded is missing from its picker until something else redraws it.
      renderInspector();
    }).catch(function () {
      state.media = state.media || [];
      renderMedia();
      renderInspector();
    });
  }

  // The set of photos a picker may offer: everything published, plus staged uploads
  // so a photo can be used the moment it lands rather than after the next Publish.
  function pickerImages() {
    var merged = {};
    Object.keys(state.images).forEach(function (key) { merged[key] = state.images[key]; });
    // Every library photo, not just the staged ones: state.images is read once at boot,
    // so a photo uploaded during this session is already in content.json and completely
    // absent from it. Filtering to staged here meant a fresh upload could not be used
    // until the editor was reloaded.
    (state.media || []).forEach(function (item) {
      merged[item.key] = {
        src: item.src, alt: item.alt, width: item.width, height: item.height,
        library: true, staged: !!item.staged
      };
    });
    return merged;
  }

  // Shared by the canvas image field and the legacy image swap: a grid of buttons
  // beats a <select> once the options are photos rather than strings. Same shape as
  // the colour swatches (role="group" of toggle buttons) — Tab visits each thumb,
  // Enter or Space picks it, no listbox machinery required.
  function thumbPicker(images, keys, selectedKey, onPick) {
    var row = document.createElement('div');
    row.className = 'ed-thumbgrid';
    row.setAttribute('role', 'group');
    var primaryPicked = false;
    keys.forEach(function (key) {
      var meta = images[key] || {};
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-thumb';
      var label = meta.alt || key;
      b.setAttribute('aria-label', label + (meta.staged ? ' — not published yet' : ''));
      b.setAttribute('aria-pressed', key === selectedKey ? 'true' : 'false');
      b.title = label;
      if (meta.src) {
        var img = document.createElement('img');
        img.src = meta.src;
        img.alt = '';
        b.appendChild(img);
      }
      if (meta.staged) {
        var badge = document.createElement('span');
        badge.className = 'ed-media-badge';
        badge.textContent = 'Not published yet';
        b.appendChild(badge);
      }
      // Double-clicking an image on the canvas focuses the primary control (see the
      // comment this replaced, on the old <select>'s dataset.primary); land that focus
      // on the selected thumb, or the first one if nothing is chosen yet, so Enter can
      // act immediately rather than tabbing through the grid first.
      if (selectedKey ? key === selectedKey : !primaryPicked) {
        b.dataset.primary = 'true';
        primaryPicked = true;
      }
      b.addEventListener('click', function () { onPick(key); });
      row.appendChild(b);
    });
    return row;
  }

  function renderMedia() {
    var grid = $('mediaGrid');
    if (!grid) return;
    grid.innerHTML = '';
    if (state.media === null) {
      var loading = document.createElement('p');
      loading.className = 'ed-field-help';
      loading.textContent = 'Loading photos…';
      grid.appendChild(loading);
      return;
    }
    if (!state.media.length) {
      var empty = document.createElement('p');
      empty.className = 'ed-field-help';
      empty.textContent = 'No photos yet. Add some below.';
      grid.appendChild(empty);
      return;
    }
    state.media.forEach(function (item) { grid.appendChild(mediaItemRow(item)); });
  }

  function mediaItemRow(item) {
    var li = document.createElement('li');
    li.className = 'ed-media-item';

    var thumb = document.createElement('div');
    thumb.className = 'ed-media-thumb';
    var img = document.createElement('img');
    img.src = item.src;
    img.alt = '';
    thumb.appendChild(img);
    if (item.staged) {
      var badge = document.createElement('span');
      badge.className = 'ed-media-badge';
      badge.textContent = 'Not published yet';
      thumb.appendChild(badge);
    }
    li.appendChild(thumb);

    var altWrap = document.createElement('div');
    altWrap.className = 'ed-field';
    var altId = 'media_alt_' + item.key.replace(/\W+/g, '_');
    var altLabel = document.createElement('label');
    altLabel.htmlFor = altId;
    altLabel.textContent = 'Alt text';
    altWrap.appendChild(altLabel);

    var input = document.createElement('input');
    input.type = 'text';
    input.id = altId;
    input.value = item.alt || '';
    input.addEventListener('change', function () { saveMediaAlt(item.key, input.value); });
    altWrap.appendChild(input);
    li.appendChild(altWrap);

    var actions = document.createElement('div');
    actions.className = 'ed-media-actions';
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'ed-btn ed-btn-danger';
    del.textContent = 'Delete';
    del.setAttribute('aria-label', 'Delete ' + (item.alt || item.key));
    del.addEventListener('click', function () { deleteMedia(item); });
    actions.appendChild(del);
    li.appendChild(actions);

    return li;
  }

  // Alt text goes to admin-media, not admin-content. admin-content commits and fires the
  // build hook on every POST, so saving a one-word fix through it would spend a deploy —
  // the exact cost the Photos panel exists to avoid. admin-media stages it instead, and
  // Publish writes it with everything else.
  function saveMediaAlt(key, alt) {
    api('admin-media', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key, alt: alt })
    }).then(function (res) {
      return res.json().then(function (d) { return { ok: res.ok, data: d }; });
    }).then(function (r) {
      if (!r.ok) { toast(r.data.error || 'Could not save that alt text.', 'error'); return; }
      if (state.content && state.content.images && state.content.images[key]) {
        state.content.images[key].alt = alt;
      }
      toast(r.data.staged ? 'Alt text saved. Publish to put it on the site.' : 'Alt text saved.');
      loadMedia();
    }).catch(function () {
      toast('Could not reach the server. Alt text was not saved.', 'error');
    });
  }

  function deleteMedia(item) {
    var label = item.alt || item.key;
    // window.confirm() rather than a hand-built dialog: it is keyboard-operable for
    // free (Tab never leaves it, Enter/Escape both work), which a custom modal would
    // have to earn.
    if (!window.confirm('Delete "' + label + '"? This cannot be undone.')) return;
    api('admin-media', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: item.key })
    }).then(function (res) {
      return res.json().then(function (d) { return { ok: res.ok, status: res.status, data: d }; });
    }).then(function (r) {
      if (r.status === 409) {
        var usedBy = (r.data.usedBy || []).join(', ');
        toast('Still in use by ' + (usedBy || 'something else') + '.', 'error');
        return;
      }
      if (!r.ok) { toast(r.data.error || 'Could not delete that photo.', 'error'); return; }
      loadMedia();
      toast('Deleted.');
    }).catch(function () {
      toast('Could not reach the server. Nothing was deleted.', 'error');
    });
  }

  // ------------------------------------------------------------------ upload & crop

  var ACCEPTED_MEDIA_MIME = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };
  var uploadQueue = [];
  var cropState = null;
  var cropDragging = null;
  var CROP_MIN = 24;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function queueUploads(fileList) {
    var files = Array.prototype.filter.call(fileList, function (f) { return ACCEPTED_MEDIA_MIME[f.type]; });
    if (!files.length) { toast('Choose a JPEG, PNG or WEBP photo.', 'error'); return; }
    uploadQueue = uploadQueue.concat(files);
    if (!cropState) startNextCrop();
  }

  function startNextCrop() {
    if (!uploadQueue.length) {
      $('mediaModal').hidden = true;
      cropState = null;
      return;
    }
    var file = uploadQueue.shift();
    openCropModal(file, URL.createObjectURL(file));
  }

  function openCropModal(file, url) {
    cropState = { file: file, url: url };
    $('mediaModal').hidden = false;

    var wrap = $('cropWrap');
    wrap.innerHTML = '';
    var display = document.createElement('img');
    display.alt = '';
    wrap.appendChild(display);
    var box = buildCropBoxEl();
    wrap.appendChild(box);

    display.onload = function () {
      cropState.natW = display.naturalWidth;
      cropState.natH = display.naturalHeight;
      initCropBox(display, box);
    };
    display.src = url;

    $('cropAlt').value = '';
    $('cropConfirm').disabled = true;
    $('cropAlt').focus();
  }

  function buildCropBoxEl() {
    var box = document.createElement('div');
    box.className = 'ed-crop-box';
    box.tabIndex = 0;
    box.setAttribute('aria-label', 'Crop area. Drag to move or resize. Arrow keys move it, Shift with an arrow key resizes it.');
    ['nw', 'ne', 'sw', 'se'].forEach(function (corner) {
      var h = document.createElement('span');
      h.className = 'ed-crop-handle ' + corner;
      box.appendChild(h);
    });
    return box;
  }

  // Starts covering the whole image — cropping is opt-in, not a default the owner has
  // to first discover and clear.
  function initCropBox(display, box) {
    cropState.display = display;
    cropState.box = box;
    cropState.rect = { x: 0, y: 0, w: display.clientWidth, h: display.clientHeight };
    paintCropBox();

    box.addEventListener('mousedown', function (e) {
      if (e.target === box) startCropDrag(e, 'move');
    });
    Array.prototype.forEach.call(box.querySelectorAll('.ed-crop-handle'), function (handle) {
      handle.addEventListener('mousedown', function (e) {
        e.stopPropagation();
        startCropDrag(e, handle.className.replace('ed-crop-handle ', ''));
      });
    });
    box.addEventListener('keydown', handleCropKey);
  }

  function paintCropBox() {
    var r = cropState.rect;
    cropState.box.style.left = r.x + 'px';
    cropState.box.style.top = r.y + 'px';
    cropState.box.style.width = r.w + 'px';
    cropState.box.style.height = r.h + 'px';
  }

  function startCropDrag(e, mode) {
    cropDragging = { mode: mode, startX: e.clientX, startY: e.clientY, rect: Object.assign({}, cropState.rect) };
    document.addEventListener('mousemove', onCropDragMove);
    document.addEventListener('mouseup', onCropDragEnd);
    e.preventDefault();
  }

  function onCropDragMove(e) {
    if (!cropDragging) return;
    var dx = e.clientX - cropDragging.startX;
    var dy = e.clientY - cropDragging.startY;
    var bounds = { w: cropState.display.clientWidth, h: cropState.display.clientHeight };
    var r = Object.assign({}, cropDragging.rect);
    if (cropDragging.mode === 'move') {
      r.x = clamp(r.x + dx, 0, bounds.w - r.w);
      r.y = clamp(r.y + dy, 0, bounds.h - r.h);
    } else {
      applyCropCornerResize(r, cropDragging.mode, dx, dy, bounds);
    }
    cropState.rect = r;
    paintCropBox();
  }

  function onCropDragEnd() {
    cropDragging = null;
    document.removeEventListener('mousemove', onCropDragMove);
    document.removeEventListener('mouseup', onCropDragEnd);
  }

  // Keeps the corner OPPOSITE the one being dragged fixed, recomputed from the
  // drag-start rect each move rather than accumulated — accumulating per-mousemove
  // deltas onto a mutated rect is how these drift a few px off from where the mouse
  // actually is after a long drag.
  function applyCropCornerResize(r, corner, dx, dy, bounds) {
    var left = r.x, top = r.y, right = r.x + r.w, bottom = r.y + r.h;
    if (corner === 'nw') { left += dx; top += dy; }
    else if (corner === 'ne') { right += dx; top += dy; }
    else if (corner === 'sw') { left += dx; bottom += dy; }
    else if (corner === 'se') { right += dx; bottom += dy; }
    left = clamp(left, 0, right - CROP_MIN);
    top = clamp(top, 0, bottom - CROP_MIN);
    right = clamp(right, left + CROP_MIN, bounds.w);
    bottom = clamp(bottom, top + CROP_MIN, bounds.h);
    r.x = left; r.y = top; r.w = right - left; r.h = bottom - top;
  }

  function handleCropKey(e) {
    var moveKeys = { ArrowLeft: true, ArrowRight: true, ArrowUp: true, ArrowDown: true };
    if (!moveKeys[e.key]) return;
    e.preventDefault();
    var bounds = { w: cropState.display.clientWidth, h: cropState.display.clientHeight };
    var r = Object.assign({}, cropState.rect);
    var step = 6;
    if (e.shiftKey) {
      if (e.key === 'ArrowRight') r.w = clamp(r.w + step, CROP_MIN, bounds.w - r.x);
      else if (e.key === 'ArrowLeft') r.w = Math.max(CROP_MIN, r.w - step);
      else if (e.key === 'ArrowDown') r.h = clamp(r.h + step, CROP_MIN, bounds.h - r.y);
      else if (e.key === 'ArrowUp') r.h = Math.max(CROP_MIN, r.h - step);
    } else {
      if (e.key === 'ArrowRight') r.x = clamp(r.x + step, 0, bounds.w - r.w);
      else if (e.key === 'ArrowLeft') r.x = clamp(r.x - step, 0, bounds.w - r.w);
      else if (e.key === 'ArrowDown') r.y = clamp(r.y + step, 0, bounds.h - r.h);
      else if (e.key === 'ArrowUp') r.y = clamp(r.y - step, 0, bounds.h - r.h);
    }
    cropState.rect = r;
    paintCropBox();
  }

  // ctx.drawImage reads the image's natural pixel data regardless of how large the
  // preview is on screen, so the crop box's on-screen rect first has to be scaled from
  // displayed px back to natural px before it means anything to the canvas.
  function renderCroppedImage() {
    var display = cropState.display;
    var scaleX = cropState.natW / display.clientWidth;
    var scaleY = cropState.natH / display.clientHeight;
    var r = cropState.rect;
    var sx = r.x * scaleX, sy = r.y * scaleY, sw = r.w * scaleX, sh = r.h * scaleY;

    // 2400px is 2x the build's largest responsive variant (1200px) — headroom without
    // shipping full phone-camera resolution into the repo. The factor never exceeds 1,
    // so a crop already smaller than that is left alone rather than blown up.
    var factor = Math.min(1, 2400 / Math.max(sw, sh));
    var dw = Math.max(1, Math.round(sw * factor));
    var dh = Math.max(1, Math.round(sh * factor));

    var canvas = document.createElement('canvas');
    canvas.width = dw;
    canvas.height = dh;
    canvas.getContext('2d').drawImage(display, sx, sy, sw, sh, 0, 0, dw, dh);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  // ------------------------------------------------------------------ align

  // Aligns against the SECTION, not against the selection, because there is one
  // selection at a time. Exact arithmetic on the stored percentages, so "centred" means
  // centred rather than nearly.
  function alignSelected(how) {
    var el = selectedElement();
    if (!el) { toast('Select something to align.'); return; }
    if (el.locked) { toast('That element is locked.'); return; }
    var b = el.box.desktop;

    // Text and buttons store h:null — they size to their content — so `b.h || 0` made
    // "align bottom" mean "put the TOP edge at 100%", parking the element entirely
    // below the band with no error. Ask the frame for the laid-out height instead;
    // every text and every button has a null height, so this was the common case.
    var measured = (frameWin && frameWin.CanvasFrame && frameWin.CanvasFrame.measure)
      ? frameWin.CanvasFrame.measure(el.id) : null;
    var h = (b.h === null || b.h === undefined) ? (measured ? measured.h : 0) : b.h;

    pushHistory();
    if (how === 'left') b.x = 0;
    else if (how === 'right') b.x = 100 - b.w;
    else if (how === 'centerX') b.x = (100 - b.w) / 2;
    else if (how === 'top') b.y = 0;
    else if (how === 'bottom') b.y = Math.max(0, 100 - h);
    else if (how === 'centerY') b.y = Math.max(0, (100 - h) / 2);
    b.x = Math.round(b.x * 1000) / 1000;
    b.y = Math.round(b.y * 1000) / 1000;
    markDirty();
    renderAll();
  }

  // Even GAPS, not even origins. Spacing the origins evenly is only correct when every
  // element is the same size — with mixed widths it produced overlapping elements and
  // pushed the widest one to 109% of the section, off-canvas, without an error.
  function distribute(axis) {
    var els = ((currentSection() && currentSection().elements) || []).filter(function (e) { return !e.locked; });
    if (els.length < 3) { toast('Distributing needs at least three unlocked elements.'); return; }

    var pos = axis === 'h' ? 'x' : 'y';
    var dim = axis === 'h' ? 'w' : 'h';
    var measureOf = function (el) {
      var v = el.box.desktop[dim];
      if (v !== null && v !== undefined) return v;
      // Text and buttons have no stored height; only the frame knows the laid-out size.
      var m = (frameWin && frameWin.CanvasFrame && frameWin.CanvasFrame.measure)
        ? frameWin.CanvasFrame.measure(el.id) : null;
      return m ? m[dim] : 0;
    };

    var sorted = els.slice().sort(function (a, b) { return a.box.desktop[pos] - b.box.desktop[pos]; });
    var sizes = sorted.map(measureOf);
    var startEdge = sorted[0].box.desktop[pos];
    var endEdge = sorted[sorted.length - 1].box.desktop[pos] + sizes[sizes.length - 1];
    var occupied = sizes.reduce(function (n, s) { return n + s; }, 0);
    var gap = (endEdge - startEdge - occupied) / (sorted.length - 1);

    if (gap < 0) { toast('Those elements are too large to space out along that axis.'); return; }

    pushHistory();
    var cursor = startEdge;
    sorted.forEach(function (el, i) {
      // Clamped so nothing can be pushed off the canvas by the operation itself.
      var v = Math.max(0, Math.min(100 - sizes[i], cursor));
      el.box.desktop[pos] = Math.round(v * 1000) / 1000;
      cursor += sizes[i] + gap;
    });
    markDirty();
    renderAll();
    toast('Spaced ' + sorted.length + ' elements evenly.');
  }

  function renderToolbox() {
    var box = $('toolbox');
    box.innerHTML = '';
    Object.keys(SCHEMA.types).forEach(function (type) {
      var btn = document.createElement('button');
      btn.className = 'ed-tool';
      btn.type = 'button';
      btn.textContent = SCHEMA.types[type].label;
      btn.addEventListener('click', function () { addElement(type); });
      box.appendChild(btn);
    });
  }

  // ------------------------------------------------------------------ elements

  function newId(type) {
    return 'el_' + type + '_' + Math.random().toString(36).slice(2, 8);
  }

  // One above the current highest, NOT elements.length + 1. Length collides the moment
  // anything has been deleted: remove one element from seven and the next add reuses a z
  // that is already taken, at which point paint order falls back to document order and
  // the layers panel is lying about which element is in front.
  function nextZ(sec) {
    return (sec.elements || []).reduce(function (max, e) { return Math.max(max, e.z || 0); }, 0) + 1;
  }

  function addElement(type) {
    var sec = currentSection();
    if (!sec || sec.type === 'legacy') {
      toast('Pick a canvas section first — hand-built sections cannot take new elements.', 'error');
      return;
    }
    if (!sec.elements) sec.elements = [];
    var def = SCHEMA.types[type];
    pushHistory();

    // Height comes from the type's own stackBehaviour, not a hardcoded list of two
    // types. icon and divider are both 'fixed-height' but were being born with h:null,
    // so their fixed-height stack path never ran and a fresh icon rendered as a
    // full-width square. Same test the geometry grid already uses for `needsHeight`.
    var needsHeight = def.stackBehaviour === 'fixed-height' || def.stackBehaviour === 'aspect';
    var h = needsHeight ? (type === 'divider' ? 0.4 : 12) : null;

    // Cascade, so adding six elements is six visible elements rather than one pile.
    var n = (sec.elements || []).length;
    var el = {
      id: newId(type),
      type: type,
      name: def.label,
      z: nextZ(sec),
      props: clone(def.defaults),
      box: {
        desktop: {
          x: Math.min(60, 20 + (n % 8) * 2),
          y: Math.min(70, 40 + (n % 8) * 2),
          w: 30,
          h: h,
          rot: 0
        },
        tablet: null,
        mobile: null
      }
    };
    // An image with no photo yet cannot pass validation, so give it the first real one
    // rather than creating an element that is born invalid.
    if (type === 'image') {
      var first = Object.keys(state.images)[0];
      if (first) { el.props.key = first; el.props.alt = state.images[first].alt || ''; }
    }
    sec.elements.push(el);
    state.selectedId = el.id;
    markDirty();
    renderAll();
  }

  // Offset by a few percent so the copy is visibly a copy rather than sitting exactly
  // on top of the original, which reads as "nothing happened".
  function duplicateElement() {
    var el = selectedElement();
    if (!el) { toast('Select something to duplicate.'); return; }
    var sec = currentSection();
    pushHistory();
    var copy = clone(el);
    copy.id = newId(el.type);
    copy.name = (el.name || SCHEMA.types[el.type].label) + ' copy';
    copy.box.desktop.x = Math.min(95, (copy.box.desktop.x || 0) + 3);
    copy.box.desktop.y = Math.min(95, (copy.box.desktop.y || 0) + 3);
    copy.z = nextZ(sec);
    copy.locked = false;
    sec.elements.push(copy);
    state.selectedId = copy.id;
    markDirty();
    renderAll();
    toast('Duplicated. Ctrl+Z undoes it.');
  }

  function deleteElement() {
    var el = selectedElement();
    if (!el) return;
    // Lock used to guard the mouse and nothing else: a locked element could still be
    // deleted from the inspector, moved from the geometry fields and restyled from the
    // props. One guard here covers both delete paths, since the canvas Delete key and
    // the inspector button both route through this function.
    if (el.locked) { toast('That element is locked. Unlock it in Layers first.'); return; }
    pushHistory();
    var els = currentSection().elements;
    els.splice(els.indexOf(el), 1);
    state.selectedId = null;
    markDirty();
    renderAll();
    toast('Deleted ' + (el.name || el.type) + '. Ctrl+Z puts it back.');
  }

  // ------------------------------------------------------------------ canvas

  function renderCanvas() {
    if (!frameWin || !frameWin.CanvasFrame) return;

    // A hand-built section renders through the SAME endpoint, which runs the same
    // templates and the same substitution the build runs. One renderer, still.
    if (state.mode === 'legacy') {
      api('admin-canvas-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legacy: state.legacyId, content: state.content })
      }).then(function (r) { return r.json(); }).then(function (out) {
        if (out.error) { toast(out.error, 'error'); return; }
        frameWin.CanvasFrame.onEvent = handleFrameEvent;
        frameWin.CanvasFrame.load({ html: out.html, css: '', section: null, legacy: true });
        updateStageNotice([]);
      }).catch(function (err) {
        console.error('[legacy render]', err);
        toast('Could not draw that section: ' + (err && err.message ? err.message : 'unknown error'), 'error');
      });
      return;
    }

    var section = currentSection();
    if (!section || section.type === 'legacy') {
      frameWin.CanvasFrame.load({ html: '', css: '', section: { id: 'none', elements: [] } });
      return;
    }
    api('admin-canvas-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: section })
    }).then(function (r) { return r.json(); }).then(function (out) {
      if (out.error) { toast(out.error, 'error'); return; }
      frameWin.CanvasFrame.onEvent = handleFrameEvent;
      frameWin.CanvasFrame.load({ html: out.html, css: out.css, section: section });
      // Always push the parent's selection, null included, and always silently. The
      // parent is authoritative; a silent push cannot echo back as a 'select' and so
      // cannot rebuild the inspector while the owner is typing in it.
      frameWin.CanvasFrame.select(state.selectedId, true);
      updateStageNotice(out.errors);
    }).catch(function (err) {
      // Log the real thing. This catch spans the whole chain, so a TypeError inside
      // the render path used to surface as "is the dev server still running?", which
      // sent anyone debugging it to the wrong place entirely.
      console.error('[canvas render]', err);
      toast('Could not draw the canvas: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    });
  }

  // Errors are the same checks that will FAIL THE BUILD. Surfacing them while the
  // element is still half-built is the difference between a warning you can act on and
  // a build error later with no context — but only if they are actually visible. They
  // used to be written into the inspector's field list, which is hidden whenever
  // nothing is selected, so a section-level error was shown only by accident.
  //
  // Absent an error, the footer gets an honest-limits note instead: its Training column
  // is not one of the section's hooks — B derives it from the real training pages — so
  // an owner clicking around the footer's fields should not have to guess why that
  // column never showed up as an editable one.
  function updateStageNotice(errors) {
    var bar = $('sectionAlert');
    if (errors && errors.length) {
      bar.dataset.tone = 'error';
      bar.textContent = errors.length === 1
        ? errors[0]
        : errors[0] + '  (+' + (errors.length - 1) + ' more)';
      bar.hidden = false;
      return;
    }
    if (state.mode === 'legacy' && state.legacyId === 'footer') {
      bar.dataset.tone = 'info';
      bar.textContent = 'The Training column lists the real training pages and follows them automatically — it is not edited here.';
      bar.hidden = false;
      return;
    }
    bar.hidden = true;
    bar.textContent = '';
  }

  var renderQueued = false;
  function queueCanvas() {
    renderQueued = true;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () { renderQueued = false; renderCanvas(); }, 220);
  }

  var lastCoalesceAt = 0;

  function handleFrameEvent(e) {
    if (e.type === 'select') {
      // Idempotence guard. Cheap, and it means a stray echo can never cost the owner
      // the field they are typing in.
      if (e.id === state.selectedId) return;
      state.selectedId = e.id;
      renderInspector();
      // The layers panel is a view of the selection, so it has to follow a canvas click
      // too. Without this, panel -> canvas worked and canvas -> panel did not, and the
      // panel sat there highlighting something that was no longer selected.
      renderLayers();
    } else if (e.type === 'change') {
      var el = null;
      var els = (currentSection() && currentSection().elements) || [];
      for (var i = 0; i < els.length; i++) if (els[i].id === e.id) el = els[i];
      if (!el) return;

      // A run of arrow-key nudges is one edit. Snapshotting each keypress filled the
      // 60-entry stack in a few seconds and threw away everything before it.
      var now = Date.now();
      if (!e.coalesce || now - lastCoalesceAt > 700) pushHistory();
      lastCoalesceAt = e.coalesce ? now : 0;

      el.box.desktop = Object.assign({}, el.box.desktop, e.box);
      markDirty();
      renderGeometry(el);
      // Only the geometry inputs are refreshed, not the whole inspector: a full
      // rebuild here would blow away focus for anyone mid-edit. And no canvas
      // re-render, because the frame already moved the node moveable is holding.
    } else if (e.type === 'field') {
      renderLegacyField(e.key, e.kind);
    } else if (e.type === 'fieldInput') {
      // Per keystroke: sync the model and the sidebar so nothing is lost if the owner
      // clicks away without ever blurring, but no re-render — the canvas node already
      // shows what was typed, and replacing it mid-edit would take the caret with it.
      inlineEditing = true;
      state.content.text[e.key] = e.value;
      markDirty();
      syncFieldRowValue(e.key, e.value);
    } else if (e.type === 'fieldCommit') {
      inlineEditing = false;
      state.content.text[e.key] = e.value;
      markDirty();
      syncFieldRowValue(e.key, e.value);
      renderCanvas();
    } else if (e.type === 'delete') {
      deleteElement();
    } else if (e.type === 'shortcut') {
      if (e.name === 'undo') undo();
      else if (e.name === 'redo') redo();
      else if (e.name === 'duplicate') duplicateElement();
      else if (e.name === 'save' && state.dirty) save();
    } else if (e.type === 'activate') {
      var target = document.querySelector('#inspFields [data-primary="true"]');
      if (target) { target.focus(); target.select && target.select(); }
    }
  }

  // ------------------------------------------------------------------ inspector

  // A hook's current value lives in state.content.images if it is a data-img key,
  // otherwise in state.content.text — the hooks array itself is just key strings, with
  // no kind attached, so whichever store actually has the key IS the kind.
  function snapshotLegacySection(sec) {
    var snap = {};
    (sec.hooks || []).forEach(function (key) {
      if (state.content.images && Object.prototype.hasOwnProperty.call(state.content.images, key)) {
        snap[key] = { store: 'images', value: clone(state.content.images[key]) };
      } else {
        snap[key] = { store: 'text', value: (state.content.text || {})[key] };
      }
    });
    return snap;
  }

  // Confirmed, like deleteMedia — window.confirm rather than a hand-built dialog, since
  // it is keyboard-operable for free and this discards every unsaved edit to the
  // section, not just one field.
  function revertSection() {
    if (!state.legacySnapshot) return;
    if (!window.confirm('Revert this section to how it was when you opened it? Unsaved edits to it will be lost.')) return;
    pushHistory();
    Object.keys(state.legacySnapshot).forEach(function (key) {
      var entry = state.legacySnapshot[key];
      if (entry.store === 'images') state.content.images[key] = clone(entry.value);
      else state.content.text[key] = entry.value;
    });
    markDirty();
    renderInspector();
    renderCanvas();
    toast('Section reverted. Ctrl+Z undoes it.');
  }

  // Editing a hand-built section edits content.json, which is what those templates have
  // always read from — the same store the existing content admin writes. No new data
  // model, no conversion, no risk to a design that took four review rounds to settle.
  function renderLegacyField(key, kind) {
    state.activeField = { key: key, kind: kind };
    $('inspectorEmpty').hidden = true;
    $('inspector').hidden = false;
    $('inspType').textContent = (SCHEMA.legacySections.find(function (s) { return s.id === state.legacyId; }) || {}).label || 'Section';
    $('deleteBtn').hidden = true;
    // Neither delete nor duplicate means anything for a hand-built section's fields.
    $('duplicateBtn').hidden = true;
    $('geoGrid').innerHTML = '';

    var box = $('inspFields');
    box.innerHTML = '';

    if (kind === 'image') {
      var img = (state.content.images || {})[key] || {};
      box.appendChild(fieldRow('Alt text', img.alt || '', function (v) {
        state.content.images[key].alt = v;
        markDirty();
      }, true));
      box.appendChild(fieldRow('Caption', img.caption || '', function (v) {
        state.content.images[key].caption = v || null;
        markDirty();
      }));

      var picWrap = document.createElement('div');
      picWrap.className = 'ed-field';
      var picLabel = document.createElement('span');
      picLabel.id = 'lbl_legacyPhoto';
      picLabel.textContent = 'Photo';
      picWrap.appendChild(picLabel);

      // Published photos only — this field writes straight into the fixed slot's
      // `src` on Save with no draft/publish gate, unlike a canvas element's props.key.
      // A staged upload's src is a temporary blob URL that stops resolving the moment
      // Publish clears the staging area, so it is not stable enough to point a fixed
      // slot at.
      var picGrid = thumbPicker(state.images, Object.keys(state.images), key, function (newKey) {
        var chosen = state.images[newKey];
        if (!chosen) return;
        state.content.images[key] = Object.assign({}, state.content.images[key], {
          src: chosen.src,
          width: chosen.width,
          height: chosen.height,
          alt: chosen.alt || ''
        });
        markDirty();
        renderLegacyField(key, kind);
        renderCanvas();
      });
      picGrid.setAttribute('aria-labelledby', 'lbl_legacyPhoto');
      picWrap.appendChild(picGrid);
      box.appendChild(picWrap);
      return;
    }

    var label = (window.FB_SCHEMA && window.FB_SCHEMA.textLabels[key]) || key;
    box.appendChild(fieldRow(label, (state.content.text || {})[key] || '', function (v) {
      state.content.text[key] = v;
      markDirty();
    }, true, true));
  }

  // Reflects an inline canvas edit into the sidebar field for the same key, if that
  // field is the one currently open — direct property assignment, not a rebuild, so it
  // never fires the input event that would restart this same field's own debounce.
  function syncFieldRowValue(key, value) {
    if (!state.activeField || state.activeField.key !== key) return;
    var input = $('inspFields').querySelector('textarea, input[type="text"]');
    if (input && document.activeElement !== input) input.value = value;
  }

  function fieldRow(label, value, onInput, primary, multiline) {
    var wrap = document.createElement('div');
    wrap.className = 'ed-field';
    var l = document.createElement('label');
    l.textContent = label;
    l.htmlFor = 'lf_' + label.replace(/\W+/g, '');
    var input = document.createElement(multiline || String(value).length > 60 ? 'textarea' : 'input');
    if (input.tagName === 'INPUT') input.type = 'text';
    input.id = l.htmlFor;
    input.value = value;
    if (primary) input.dataset.primary = 'true';
    // One snapshot per burst of typing, not one per keystroke — same coalescing the
    // canvas prop fields use, so a sentence is one undo rather than forty.
    var t = null;
    var pending = false;
    input.addEventListener('input', function () {
      if (!pending) { pushHistory(); pending = true; }
      onInput(input.value);
      clearTimeout(t);
      // Suppressed while an inline canvas edit owns this same tick — that edit's own
      // commit already queues the one re-render this field's change needs.
      t = setTimeout(function () { pending = false; if (!inlineEditing) renderCanvas(); }, 420);
    });
    wrap.appendChild(l);
    wrap.appendChild(input);
    return wrap;
  }

  function renderInspector() {
    // Section-level, so it shows whether or not a field within the section is selected.
    $('revertBar').hidden = !(state.mode === 'legacy' && state.legacySnapshot);
    if (state.mode === 'legacy') {
      if (!state.activeField) {
        $('inspectorEmpty').hidden = false;
        $('inspector').hidden = true;
      } else {
        // Re-read the field from state so an undo shows the restored text rather than
        // leaving the old value sitting in the input.
        renderLegacyField(state.activeField.key, state.activeField.kind);
      }
      return;
    }
    $('deleteBtn').hidden = false;
    var el = selectedElement();
    $('inspectorEmpty').hidden = !!el;
    $('inspector').hidden = !el;
    if (!el) return;

    var def = SCHEMA.types[el.type];
    $('inspType').textContent = def.label + (el.locked ? ' · locked' : '');

    var box = $('inspFields');
    box.innerHTML = '';
    def.fields.forEach(function (field, index) {
      box.appendChild(buildField(el, field, index === 0));
    });

    renderGeometry(el);

    // Lock has to mean locked everywhere, not just against the mouse. Disabling the
    // controls is what makes it legible: a greyed-out panel says "this is protected"
    // without needing a toast to explain a click that silently did nothing.
    $('duplicateBtn').disabled = false;
    $('deleteBtn').disabled = !!el.locked;
    if (el.locked) {
      Array.prototype.forEach.call(
        document.querySelectorAll('#inspFields input, #inspFields textarea, #inspFields select, #inspFields button, #geoGrid input'),
        function (node) { node.disabled = true; }
      );
      var note = document.createElement('p');
      note.className = 'ed-field-help';
      note.textContent = 'Locked. Unlock it in Layers to edit.';
      box.prepend(note);
    }
  }

  // Colour fields render a row of swatch buttons rather than one labellable control,
  // so a <label for> there pointed at an id that is never created. Those get a plain
  // caption plus a labelled group instead.
  var UNLABELLABLE = { color: true };

  function fieldShell(field) {
    var wrap = document.createElement('div');
    wrap.className = 'ed-field';
    var label = document.createElement(UNLABELLABLE[field.kind] ? 'span' : 'label');
    label.textContent = field.label + (field.required ? ' *' : '');
    if (!UNLABELLABLE[field.kind]) label.htmlFor = 'f_' + field.name;
    else label.id = 'lbl_' + field.name;
    wrap.appendChild(label);
    return wrap;
  }

  function commitProp(el, field, value) {
    pushHistory();
    el.props[field.name] = value;
    markDirty();
    queueCanvas();
  }

  function buildField(el, field, isPrimary) {
    var wrap = fieldShell(field);
    var value = el.props[field.name];
    var input;

    if (field.kind === 'richline' || (field.kind === 'text' && field.multiline)) {
      input = document.createElement('textarea');
      input.value = value == null ? '' : value;
      input.addEventListener('input', function () { commitPropDebounced(el, field, input.value); });
    } else if (field.kind === 'select') {
      input = document.createElement('select');
      field.options.forEach(function (opt) {
        var o = document.createElement('option');
        o.value = String(opt);
        o.textContent = labelForOption(field, opt);
        if (String(value) === String(opt)) o.selected = true;
        input.appendChild(o);
      });
      input.addEventListener('change', function () {
        var v = input.value;
        commitProp(el, field, isNaN(Number(v)) || v === '' ? v : Number(v));
      });
    } else if (field.kind === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      input.step = field.step || 1;
      input.value = value == null ? '' : value;
      // An empty field is "unset", not zero. Number('') is 0, so backspacing the last
      // digit out of Opacity set it to 0 and the shape vanished. null lets the
      // registry default (?? 1, || 24) apply instead.
      input.addEventListener('input', function () {
        commitPropDebounced(el, field, input.value === '' ? null : Number(input.value));
      });
    } else if (field.kind === 'toggle') {
      wrap.classList.add('ed-toggle');
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!value;
      input.addEventListener('change', function () { commitProp(el, field, input.checked); });
    } else if (field.kind === 'color') {
      return colorField(el, field, wrap, value);
    } else if (field.kind === 'image') {
      return imageField(el, field, wrap, value);
    } else {
      input = document.createElement('input');
      input.type = field.kind === 'link' ? 'text' : 'text';
      input.value = value == null ? '' : value;
      input.addEventListener('input', function () { commitPropDebounced(el, field, input.value); });
    }

    input.id = 'f_' + field.name;
    if (isPrimary) input.dataset.primary = 'true';
    if (field.required && !String(value || '').trim()) {
      input.setAttribute('aria-invalid', 'true');
    }
    wrap.appendChild(input);

    if (field.help) {
      var help = document.createElement('p');
      help.className = 'ed-field-help';
      help.textContent = field.help;
      wrap.appendChild(help);
    }
    if (field.required && !String(value || '').trim()) {
      var err = document.createElement('p');
      err.className = 'ed-field-error';
      err.textContent = field.label + ' is required — the build will not publish without it.';
      wrap.appendChild(err);
    }
    return wrap;
  }

  function labelForOption(field, opt) {
    if (field.name === 'family' && SCHEMA.fontFamilies[opt]) return SCHEMA.fontFamilies[opt].label;
    return String(opt);
  }

  // Typing should not fire a canvas render per keystroke, but it must not lose the last
  // keystroke either, so the debounce commits the value and defers only the redraw.
  var propTimer = null;
  var pendingHistory = false;
  function commitPropDebounced(el, field, value) {
    if (!pendingHistory) { pushHistory(); pendingHistory = true; }
    el.props[field.name] = value;
    markDirty();
    clearTimeout(propTimer);
    propTimer = setTimeout(function () { pendingHistory = false; queueCanvas(); }, 260);
  }

  function colorField(el, field, wrap, value) {
    var row = document.createElement('div');
    row.className = 'ed-swatches';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-labelledby', 'lbl_' + field.name);
    SCHEMA.themeColors.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-swatch';
      b.style.background = 'var(' + c.token + ')';
      b.title = c.label;
      b.setAttribute('aria-label', c.label);
      b.setAttribute('aria-pressed', value === c.token ? 'true' : 'false');
      b.addEventListener('click', function () {
        commitProp(el, field, c.token);
        renderInspector();
      });
      row.appendChild(b);
    });
    wrap.appendChild(row);
    var help = document.createElement('p');
    help.className = 'ed-field-help';
    help.textContent = 'These are brand colours. Change one in the brand kit and everything using it moves with it.';
    wrap.appendChild(help);
    return wrap;
  }

  function imageField(el, field, wrap, value) {
    var images = pickerImages();
    var keys = Object.keys(images);
    if (!keys.length) {
      var none = document.createElement('p');
      none.className = 'ed-field-help';
      none.textContent = 'No photos yet. Add one in the Photos panel.';
      wrap.appendChild(none);
      return wrap;
    }
    if (!value) {
      // A grid of toggle buttons has no equivalent of a <select> showing its first
      // option regardless — nothing reads as pressed until something is chosen — but
      // an unmarked grid still looks unfinished without a line saying so.
      var ph = document.createElement('p');
      ph.className = 'ed-field-help';
      ph.textContent = 'Choose a photo.';
      wrap.appendChild(ph);
    }
    var grid = thumbPicker(images, keys, value, function (key) {
      pushHistory();
      el.props.key = key;
      // Take the NEW photo's alt, not "keep the old one if present". Swapping a
      // net-cutting shot for a portrait used to leave the description of the net —
      // wrong for every screen reader and every search engine, and invisible on screen.
      // If the new photo has no alt of its own, blank it so the required-field error
      // fires rather than shipping a lie.
      el.props.alt = (images[key] && images[key].alt) || '';
      markDirty();
      renderInspector();
      queueCanvas();
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function renderGeometry(el) {
    var grid = $('geoGrid');
    grid.innerHTML = '';
    var box = el.box.desktop;
    [
      { key: 'x', label: 'Left %' },
      { key: 'y', label: 'Top %' },
      { key: 'w', label: 'Width %' },
      { key: 'h', label: 'Height %' },
      { key: 'rot', label: 'Rotation°' }
    ].forEach(function (spec) {
      var wrap = document.createElement('div');
      wrap.className = 'ed-field';
      var label = document.createElement('label');
      label.textContent = spec.label;
      label.htmlFor = 'geo_' + spec.key;
      var input = document.createElement('input');
      input.type = 'number';
      input.id = 'geo_' + spec.key;
      input.step = spec.key === 'rot' ? 1 : 0.5;
      input.value = box[spec.key] == null ? '' : box[spec.key];
      // Only types that size to their own content may have no height. A shape renders
      // nothing and an image has no box to fill, so clearing their height made them
      // vanish on tablet and phone — the stack has no height to fall back on.
      var needsHeight = SCHEMA.types[el.type].stackBehaviour === 'fixed-height'
        || SCHEMA.types[el.type].stackBehaviour === 'aspect';
      if (spec.key === 'h') input.placeholder = needsHeight ? 'required' : 'auto';
      input.addEventListener('change', function () {
        if (spec.key === 'h' && needsHeight && input.value === '') {
          input.value = box.h == null ? 10 : box.h;
          toast('A ' + el.type + ' needs a height, or it disappears on phones.', 'error');
          return;
        }
        pushHistory();
        box[spec.key] = input.value === '' ? null : Number(input.value);
        markDirty();
        renderCanvas();
      });
      wrap.appendChild(label);
      wrap.appendChild(input);
      grid.appendChild(wrap);
    });
  }

  // ------------------------------------------------------------------ save

  function save() {
    var btn = $('saveBtn');
    btn.disabled = true;
    setStatus('Saving…');

    // Hand-built sections live in content.json, so they save through the endpoint that
    // has always owned it rather than through the canvas document.
    if (state.mode === 'legacy') {
      return api('admin-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.content)
      }).then(function (res) {
        return res.json().then(function (d) { return { ok: res.ok, data: d }; });
      }).then(function (r) {
        if (!r.ok) {
          setStatus('Not saved', 'dirty');
          btn.disabled = false;
          toast((r.data.details && r.data.details[0]) || r.data.error || 'Save failed.', 'error');
          return;
        }
        state.dirty = false;
        setStatus('Saved — rebuilding', 'saved');
        toast('Saved. The site is rebuilding.');
      }).catch(function () {
        setStatus('Not saved', 'dirty');
        btn.disabled = false;
        toast('Could not reach the server. Nothing was saved.', 'error');
      });
    }

    api('admin-site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.site)
    }).then(function (res) {
      return res.json().then(function (d) { return { ok: res.ok, status: res.status, data: d }; });
    }).then(function (r) {
      if (!r.ok) {
        setStatus('Not saved', 'dirty');
        btn.disabled = false;
        var detail = r.data.details ? r.data.details[0] : r.data.error;
        toast(detail || 'Save failed.', 'error');
        return;
      }
      state.dirty = false;
      state.hasDraft = !!r.data.draft;
      if (r.data.draft) {
        setStatus('Saved as draft', 'saved');
        toast('Saved. Nothing is live until you press Publish.');
      } else {
        setStatus('Saved — rebuilding', 'saved');
        toast('Saved. The site is rebuilding; the page will show it in a moment.');
      }
      renderPublishState();
    }).catch(function () {
      setStatus('Not saved', 'dirty');
      btn.disabled = false;
      toast('Could not reach the server. Nothing was saved.', 'error');
    });
  }

  // ------------------------------------------------------------------ site

  // Mirrors the defaults render.mjs falls back to when content.json has no `motion`
  // object at all — same numbers, so a fresh site and an explicitly-default one look
  // identical in this panel.
  var MOTION_DEFAULTS = {
    enabled: true, speed: 1, intro: true, ticker: true, tickerSeconds: 38,
    reveals: true, countUp: true, nightAmbient: true
  };

  // Read-only view, defaults included — does NOT write state.content.motion, so opening
  // the panel and looking at it is not itself an edit. setMotion() is what materialises
  // the object, and only on an actual change.
  function motion() { return state.content.motion || MOTION_DEFAULTS; }

  function setMotion(key, value) {
    if (!state.content.motion) state.content.motion = clone(MOTION_DEFAULTS);
    state.content.motion[key] = value;
    markDirty();
    applyMotionPreview();
  }

  // The intro overlay and the scoreboard count-up are real page load events (an
  // overlay that plays once, a counter racing on scroll-into-view) that this canvas
  // never runs, so there is nothing for those two settings to preview here — everything
  // else (ticker, reveals, night ambience, speed) is CSS state on <html> and takes
  // effect the instant it is set, same as on the published page.
  function applyMotionPreview() {
    if (!frameWin || !frameWin.document) return;
    var docEl = frameWin.document.documentElement;
    var m = motion();
    var setOff = function (attr, off) { if (off) docEl.setAttribute(attr, 'off'); else docEl.removeAttribute(attr); };
    setOff('data-motion', m.enabled === false);
    setOff('data-intro', m.intro === false);
    setOff('data-ticker', m.ticker === false);
    setOff('data-reveals', m.reveals === false);
    setOff('data-night', m.nightAmbient === false);
    docEl.style.setProperty('--motion-speed', String(m.speed || 1));
    docEl.style.setProperty('--t-ticker', String(m.tickerSeconds || 38) + 's');
  }

  function renderSite() {
    var m = motion();

    // Skip an input currently focused, same reasoning as the legacy field rows: a
    // renderAll() triggered by something else entirely (undo, switching pages) must not
    // yank the caret out from under whoever is mid-keystroke here.
    var title = $('siteTitle');
    var desc = $('siteDesc');
    if (document.activeElement !== title) title.value = (state.content.text || {})['meta.title'] || '';
    if (document.activeElement !== desc) desc.value = (state.content.text || {})['meta.desc'] || '';

    $('motionEnabled').checked = m.enabled !== false;
    $('motionSpeed').value = m.speed || 1;
    $('motionSpeedVal').textContent = (m.speed || 1) + 'x';
    $('motionIntro').checked = m.intro !== false;
    $('motionTicker').checked = m.ticker !== false;
    if (document.activeElement !== $('motionTickerSeconds')) $('motionTickerSeconds').value = m.tickerSeconds || 38;
    $('motionReveals').checked = m.reveals !== false;
    $('motionCountUp').checked = m.countUp !== false;
    $('motionNight').checked = m.nightAmbient !== false;
  }

  // ------------------------------------------------------------------ wiring

  // The artboard stays at DESIGN_WIDTH and the view zooms, rather than the artboard
  // shrinking to the pane. A 1440px canvas squeezed into an 800px pane would render
  // below the 1000px auto-stack breakpoint, so the editor would silently be showing —
  // and letting you drag — the stacked layout under a label that says Desktop.
  function fitCanvas() {
    var wrap = $('frameWrap');
    var scaler = $('frameScaler');
    var section = currentSection();
    var designHeight = (section && section.designHeight) || 720;
    frame.style.height = designHeight + 'px';

    var available = wrap.clientWidth - 40;
    var scale = Math.min(1, available / SCHEMA.designWidth);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    scaler.style.transform = 'scale(' + scale + ')';
    // The scaled box still occupies its unscaled size in layout, so reserve the real
    // footprint or the pane scrolls to a height nothing is drawn in.
    scaler.style.width = SCHEMA.designWidth * scale + 'px';
    scaler.style.height = designHeight * scale + 'px';
    $('zoomLabel').textContent = Math.round(scale * 100) + '%';
  }

  var fitTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitCanvas, 100);
  });

  $('alignBar').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.align) alignSelected(btn.dataset.align);
    else if (btn.dataset.distribute) distribute(btn.dataset.distribute);
  });

  function renderAll() {
    renderPages();
    renderSections();
    renderLayers();
    renderMedia();
    renderSite();
    fitCanvas();
    $('crumb').textContent = currentPage().path + '  ·  ' + (currentSection() ? currentSection().name : 'no section');
    renderInspector();
    renderCanvas();
    applyMotionPreview();
  }

  $('saveBtn').addEventListener('click', save);
  $('publishBtn').addEventListener('click', publish);
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('deleteBtn').addEventListener('click', deleteElement);
  $('duplicateBtn').addEventListener('click', duplicateElement);
  $('revertSectionBtn').addEventListener('click', revertSection);

  $('siteTitle').addEventListener('input', function () {
    state.content.text['meta.title'] = $('siteTitle').value;
    markDirty();
  });
  $('siteDesc').addEventListener('input', function () {
    state.content.text['meta.desc'] = $('siteDesc').value;
    markDirty();
  });
  $('motionEnabled').addEventListener('change', function () { setMotion('enabled', $('motionEnabled').checked); });
  $('motionSpeed').addEventListener('input', function () {
    var v = Number($('motionSpeed').value);
    $('motionSpeedVal').textContent = v + 'x';
    setMotion('speed', v);
  });
  $('motionIntro').addEventListener('change', function () { setMotion('intro', $('motionIntro').checked); });
  $('motionTicker').addEventListener('change', function () { setMotion('ticker', $('motionTicker').checked); });
  $('motionTickerSeconds').addEventListener('change', function () {
    var v = clamp(Math.round(Number($('motionTickerSeconds').value) || 38), 10, 120);
    $('motionTickerSeconds').value = v;
    setMotion('tickerSeconds', v);
  });
  $('motionReveals').addEventListener('change', function () { setMotion('reveals', $('motionReveals').checked); });
  $('motionCountUp').addEventListener('change', function () { setMotion('countUp', $('motionCountUp').checked); });
  $('motionNight').addEventListener('change', function () { setMotion('nightAmbient', $('motionNight').checked); });

  $('mediaAddBtn').addEventListener('click', function () { $('mediaFile').click(); });
  $('mediaFile').addEventListener('change', function () {
    queueUploads(this.files);
    this.value = '';
  });

  (function () {
    var zone = $('mediaDrop');
    ['dragenter', 'dragover'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) queueUploads(e.dataTransfer.files);
    });
  })();

  $('cropAlt').addEventListener('input', function () {
    $('cropConfirm').disabled = !$('cropAlt').value.trim();
  });

  $('cropCancel').addEventListener('click', function () {
    if (cropState) URL.revokeObjectURL(cropState.url);
    startNextCrop();
  });

  $('cropConfirm').addEventListener('click', function () {
    var alt = $('cropAlt').value.trim();
    if (!alt) return;
    var dataUrl = renderCroppedImage();
    var filename = cropState.file.name;
    var url = cropState.url;
    $('cropConfirm').disabled = true;
    api('admin-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: filename, alt: alt, dataUrl: dataUrl })
    }).then(function (res) {
      return res.json().then(function (d) { return { ok: res.ok, data: d }; });
    }).then(function (r) {
      if (!r.ok) {
        toast(r.data.error || 'Could not upload that photo.', 'error');
        $('cropConfirm').disabled = false;
        return;
      }
      URL.revokeObjectURL(url);
      toast('Uploaded.');
      loadMedia();
      startNextCrop();
    }).catch(function () {
      toast('Could not reach the server. That photo was not uploaded.', 'error');
      $('cropConfirm').disabled = false;
    });
  });

  // The dialog has no other Escape handling of its own, and the document-level keydown
  // handler below is for editor shortcuts, not this modal — Escape has to be wired here
  // or closing it would need a mouse.
  $('mediaModal').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); $('cropCancel').click(); }
  });

  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey;
    // Delete/Backspace is NOT handled here. It lived here guarded only by "the focused
    // element is not a form field", and <body> passes that test — so when a rebuild
    // dropped focus to <body>, the next Backspace deleted the element instead of a
    // character. The frame owns that shortcut now, where canvas focus is a fact.
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (state.dirty) save(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateElement(); }
  });

  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  function onFrameReady() {
    frameWin = frame.contentWindow;
    if (frameWin.CanvasFrame) frameWin.CanvasFrame.onEvent = handleFrameEvent;
    if (state.site) { fitCanvas(); renderCanvas(); }
    // documentElement survives every load() (only #stage is replaced), so this is the
    // one place the preview attributes need setting outside of an actual motion change —
    // everywhere else they'd already be sitting on the same, still-live <html>.
    applyMotionPreview();
  }

  frame.addEventListener('load', onFrameReady);

  // editor.js is deferred and the iframe is small, so the frame can finish loading
  // before this script runs — in which case the load event has already fired and will
  // never fire again, leaving the canvas permanently blank. Check for a frame that is
  // already up rather than waiting for an event that has been and gone.
  if (frame.contentWindow && frame.contentWindow.CanvasFrame) onFrameReady();

  renderToolbox();
  boot();
})();
