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
    mode: 'canvas',
    legacyId: null,
    activeField: null,
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
        showBlockingErrors([]);
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
      showBlockingErrors(out.errors);
    }).catch(function (err) {
      // Log the real thing. This catch spans the whole chain, so a TypeError inside
      // the render path used to surface as "is the dev server still running?", which
      // sent anyone debugging it to the wrong place entirely.
      console.error('[canvas render]', err);
      toast('Could not draw the canvas: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    });
  }

  // These are the same checks that will FAIL THE BUILD. Surfacing them while the
  // element is still half-built is the difference between a warning you can act on and
  // a build error later with no context — but only if they are actually visible. They
  // used to be written into the inspector's field list, which is hidden whenever
  // nothing is selected, so a section-level error was shown only by accident.
  function showBlockingErrors(errors) {
    var bar = $('sectionAlert');
    if (!errors || !errors.length) { bar.hidden = true; bar.textContent = ''; return; }
    bar.textContent = errors.length === 1
      ? errors[0]
      : errors[0] + '  (+' + (errors.length - 1) + ' more)';
    bar.hidden = false;
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
      var hint = document.createElement('p');
      hint.className = 'ed-field-help';
      hint.textContent = 'Swap the photo itself in the content admin at /admin/ — this panel edits its wording.';
      box.appendChild(hint);
      return;
    }

    var label = (window.FB_SCHEMA && window.FB_SCHEMA.textLabels[key]) || key;
    box.appendChild(fieldRow(label, (state.content.text || {})[key] || '', function (v) {
      state.content.text[key] = v;
      markDirty();
    }, true, true));
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
      t = setTimeout(function () { pending = false; renderCanvas(); }, 420);
    });
    wrap.appendChild(l);
    wrap.appendChild(input);
    return wrap;
  }

  function renderInspector() {
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
    var keys = Object.keys(state.images);
    if (!keys.length) {
      var none = document.createElement('p');
      none.className = 'ed-field-help';
      none.textContent = 'No photos available. Upload one in the content admin first.';
      wrap.appendChild(none);
      return wrap;
    }
    var select = document.createElement('select');
    select.id = 'f_' + field.name;
    // Double-clicking an image on the canvas focuses the primary control; without this
    // the image type had none, so the gesture did nothing at all.
    select.dataset.primary = 'true';
    if (!value) {
      // A <select> shows its first option regardless, so an element with no photo
      // looked as though it had one — and the owner had no way to tell.
      var ph = document.createElement('option');
      ph.value = '';
      ph.disabled = true;
      ph.selected = true;
      ph.textContent = 'Choose a photo';
      select.appendChild(ph);
    }
    keys.forEach(function (key) {
      var o = document.createElement('option');
      o.value = key;
      o.textContent = key;
      if (key === value) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', function () {
      pushHistory();
      el.props.key = select.value;
      // Take the NEW photo's alt, not "keep the old one if present". Swapping a
      // net-cutting shot for a portrait used to leave the description of the net —
      // wrong for every screen reader and every search engine, and invisible on screen.
      // If the new photo has no alt of its own, blank it so the required-field error
      // fires rather than shipping a lie.
      el.props.alt = (state.images[select.value] && state.images[select.value].alt) || '';
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
    fitCanvas();
    $('crumb').textContent = currentPage().path + '  ·  ' + (currentSection() ? currentSection().name : 'no section');
    renderInspector();
    renderCanvas();
  }

  $('saveBtn').addEventListener('click', save);
  $('publishBtn').addEventListener('click', publish);
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('deleteBtn').addEventListener('click', deleteElement);
  $('duplicateBtn').addEventListener('click', duplicateElement);

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
