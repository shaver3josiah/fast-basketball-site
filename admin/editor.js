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
    pageIndex: 0,
    sectionIndex: 0,
    selectedId: null,
    dirty: false,
    history: [],
    future: []
  };

  var frame = document.getElementById('canvasFrame');
  var frameWin = null;
  var renderTimer = null;

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
  function pushHistory() {
    state.history.push(clone(state.site));
    if (state.history.length > HISTORY_MAX) state.history.shift();
    state.future.length = 0;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $('undoBtn').disabled = state.history.length === 0;
    $('redoBtn').disabled = state.future.length === 0;
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(clone(state.site));
    state.site = state.history.pop();
    afterTimeTravel();
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(clone(state.site));
    state.site = state.future.pop();
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
    }).then(function (site) {
      if (!site) return;
      startEditor(site);
    }).catch(function (err) {
      showGate(err.message);
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
      if (content) state.images = content.images || {};
      renderAll();
    }).catch(function () { renderAll(); });
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
        // A locked section with no unlock button is the honest state. Converting one of
        // the nine hand-built sections into canvas elements is undefined work; a button
        // that did something undefined would be worse than no button. Say why.
        btn.setAttribute('aria-disabled', 'true');
        btn.title = 'Hand-built section. Converting it to a canvas is not built yet, so it stays locked rather than being changed unpredictably.';
        var note = document.createElement('span');
        note.className = 'ed-item-note';
        note.textContent = 'locked';
        btn.appendChild(note);
      } else {
        btn.addEventListener('click', function () {
          state.sectionIndex = i;
          state.selectedId = null;
          renderAll();
        });
      }
      li.appendChild(btn);
      list.appendChild(li);
    });
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

  function addElement(type) {
    var def = SCHEMA.types[type];
    pushHistory();
    var el = {
      id: newId(type),
      type: type,
      name: def.label,
      z: (currentSection().elements || []).length + 1,
      props: clone(def.defaults),
      box: { desktop: { x: 20, y: 40, w: 30, h: type === 'shape' || type === 'image' ? 12 : null, rot: 0 }, tablet: null, mobile: null }
    };
    // An image with no photo yet cannot pass validation, so give it the first real one
    // rather than creating an element that is born invalid.
    if (type === 'image') {
      var first = Object.keys(state.images)[0];
      if (first) { el.props.key = first; el.props.alt = state.images[first].alt || ''; }
    }
    currentSection().elements.push(el);
    state.selectedId = el.id;
    markDirty();
    renderAll();
  }

  function deleteElement() {
    var el = selectedElement();
    if (!el) return;
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
      if (state.selectedId) frameWin.CanvasFrame.select(state.selectedId);
      showBlockingErrors(out.errors);
    }).catch(function () {
      toast('Could not draw the canvas. Is the dev server still running?', 'error');
    });
  }

  // These are the same checks that will FAIL THE BUILD. Surfacing them here, while the
  // element is still half-built, is the difference between a warning you can act on and
  // a build error later with no context.
  function showBlockingErrors(errors) {
    var box = $('inspFields');
    var existing = box.querySelector('.ed-field-error[data-global]');
    if (existing) existing.remove();
    if (!errors || !errors.length) return;
    var p = document.createElement('p');
    p.className = 'ed-field-error';
    p.dataset.global = 'true';
    p.textContent = errors[0];
    box.prepend(p);
  }

  var renderQueued = false;
  function queueCanvas() {
    renderQueued = true;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () { renderQueued = false; renderCanvas(); }, 220);
  }

  function handleFrameEvent(e) {
    if (e.type === 'select') {
      state.selectedId = e.id;
      renderInspector();
    } else if (e.type === 'change') {
      var el = selectedElement();
      if (!el || el.id !== e.id) {
        var els = currentSection().elements;
        for (var i = 0; i < els.length; i++) if (els[i].id === e.id) el = els[i];
      }
      if (!el) return;
      pushHistory();
      el.box.desktop = Object.assign({}, el.box.desktop, e.box);
      markDirty();
      renderInspector();
      // No canvas re-render here: the frame already moved the element, and redrawing
      // would replace the node moveable is holding mid-gesture.
    } else if (e.type === 'activate') {
      var target = document.querySelector('#inspFields [data-primary="true"]');
      if (target) { target.focus(); target.select && target.select(); }
    }
  }

  // ------------------------------------------------------------------ inspector

  function renderInspector() {
    var el = selectedElement();
    $('inspectorEmpty').hidden = !!el;
    $('inspector').hidden = !el;
    if (!el) return;

    var def = SCHEMA.types[el.type];
    $('inspType').textContent = def.label;

    var box = $('inspFields');
    box.innerHTML = '';
    def.fields.forEach(function (field, index) {
      box.appendChild(buildField(el, field, index === 0));
    });

    renderGeometry(el);
  }

  function fieldShell(field) {
    var wrap = document.createElement('div');
    wrap.className = 'ed-field';
    var label = document.createElement('label');
    label.textContent = field.label + (field.required ? ' *' : '');
    label.htmlFor = 'f_' + field.name;
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
      input.addEventListener('input', function () { commitPropDebounced(el, field, Number(input.value)); });
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
    var select = document.createElement('select');
    select.id = 'f_' + field.name;
    Object.keys(state.images).forEach(function (key) {
      var o = document.createElement('option');
      o.value = key;
      o.textContent = key;
      if (key === value) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', function () {
      pushHistory();
      el.props.key = select.value;
      if (!el.props.alt && state.images[select.value]) el.props.alt = state.images[select.value].alt || '';
      markDirty();
      renderInspector();
      queueCanvas();
    });
    wrap.appendChild(select);
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
      if (spec.key === 'h') input.placeholder = 'auto';
      input.addEventListener('change', function () {
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
      setStatus('Saved — rebuilding', 'saved');
      toast('Saved. The site is rebuilding; the page will show it in a moment.');
    }).catch(function () {
      setStatus('Not saved', 'dirty');
      btn.disabled = false;
      toast('Could not reach the server. Nothing was saved.', 'error');
    });
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

  function renderAll() {
    renderPages();
    renderSections();
    fitCanvas();
    $('crumb').textContent = currentPage().path + '  ·  ' + (currentSection() ? currentSection().name : 'no section');
    renderInspector();
    renderCanvas();
  }

  $('saveBtn').addEventListener('click', save);
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('deleteBtn').addEventListener('click', deleteElement);

  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (state.dirty) save(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId
      && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault(); deleteElement();
    }
  });

  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  frame.addEventListener('load', function () {
    frameWin = frame.contentWindow;
    if (frameWin.CanvasFrame) frameWin.CanvasFrame.onEvent = handleFrameEvent;
    if (state.site) { fitCanvas(); renderCanvas(); }
  });

  renderToolbox();
  boot();
})();
