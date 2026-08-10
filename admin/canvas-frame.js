/* The canvas surface. Runs inside the editor's iframe, alongside the real site CSS.
 *
 * Its whole job is to turn pointer gestures into PERCENTAGES. Every drag, resize and
 * rotate is converted against the section's current box before it leaves this file, so
 * nothing downstream ever sees a pixel. That is what makes a hand-placed layout scale
 * instead of shattering at a width nobody tested — and doing the conversion here, at
 * the point of input, means there is no later stage that could forget to.
 *
 * The parent talks to this through window.CanvasFrame (same origin, so no postMessage
 * ceremony) and listens on CanvasFrame.onEvent.
 */
(function () {
  'use strict';

  var stage = document.getElementById('stage');
  var sectionCss = document.getElementById('sectionCss');
  var moveable = null;
  var section = null;
  var selectedId = null;
  var startPct = null;
  // The one [data-edit] leaf currently in inline-edit mode (legacy mode only), or null.
  // Kept outside the DOM so Escape can restore exactly the text editing began with.
  var inlineState = null;

  var api = {
    onEvent: function () {},
    load: load,
    select: select,
    refresh: refresh
  };
  window.CanvasFrame = api;

  function emit(type, payload) {
    try { api.onEvent(Object.assign({ type: type }, payload || {})); } catch (err) { console.error(err); }
  }

  function sectionEl() { return stage.querySelector('.cv-sec'); }

  function secRect() {
    var el = sectionEl();
    return el ? el.getBoundingClientRect() : { width: 1, height: 1, left: 0, top: 0 };
  }

  function elementData(id) {
    if (!section) return null;
    for (var i = 0; i < section.elements.length; i++) {
      if (section.elements[i].id === id) return section.elements[i];
    }
    return null;
  }

  // Round to 3 decimals. Percentages carrying full float precision make every save a
  // huge diff of meaningless digits, which buries the real change in a git history
  // that is supposed to be the owner's undo.
  function r(n) { return Math.round(n * 1000) / 1000; }

  function readPct(el) {
    var s = secRect();
    var r0 = el.getBoundingClientRect();
    return {
      x: (r0.left - s.left) / s.width * 100,
      y: (r0.top - s.top) / s.height * 100,
      w: r0.width / s.width * 100,
      h: r0.height / s.height * 100
    };
  }

  // ------------------------------------------------------------------ loading

  function load(payload) {
    section = payload.section;
    sectionCss.textContent = payload.css || '';
    stage.innerHTML = payload.html || '';
    // Lazy images below the fold never fire their network request while the section
    // sits inside a clipped, scaled-down iframe the browser never considers "on
    // screen" — eager forces the fetch immediately so the owner actually sees them
    // (confirmed live: naturalWidth 0, complete false, until this ran).
    Array.prototype.forEach.call(stage.querySelectorAll('img[loading="lazy"]'), function (img) {
      img.loading = 'eager';
    });
    document.body.classList.add('is-editing');
    document.body.classList.toggle('is-legacy', !!payload.legacy);
    // Also on <html>: overflow:clip on the OUTER box still clips a tall child even if
    // the inner one is allowed to scroll, and the class only ever lived on body.
    document.documentElement.classList.toggle('is-legacy', !!payload.legacy);

    // A hand-built section is real page markup, not a canvas: there are no boxes to
    // drag, only the fields the templates already expose. So moveable stays out of it
    // and the editable hooks become the click targets instead.
    if (payload.legacy) {
      if (moveable) { moveable.destroy(); moveable = null; }
      markLegacyFields();
      return;
    }

    applyLockClasses();
    makeFocusable();
    // Deliberately does NOT re-select here. The frame's copy of selectedId is stale by
    // definition after a reload — the parent owns selection and pushes it immediately
    // after this call. Re-selecting from stale state both fought the parent and fired
    // a 'select' echo that rebuilt the inspector out from under whatever the owner was
    // typing into.
    if (selectedId && !document.getElementById(selectedId)) selectedId = null;
    setupMoveable();
  }

  function refresh() { if (moveable) moveable.updateRect(); }

  // The rendered height of an element as a percentage of its section. Text and buttons
  // store h:null because they size to their own content, so the parent has no number to
  // align against — only the frame, which has the laid-out node, can supply one.
  function measure(id) {
    var node = document.getElementById(id);
    if (!node) return null;
    var s = secRect();
    var r0 = node.getBoundingClientRect();
    return { w: (r0.width / s.width) * 100, h: (r0.height / s.height) * 100 };
  }
  api.measure = measure;

  // The four legacy groupings the contract deliberately leaves out of the reorder
  // registry (numbered steps, an escalating badge size, hardcoded week labels, a
  // marquee that hand-duplicates its items) carry no data-group marker at all — P's
  // marking pass only touches the registry's own groups — so they are told apart here
  // by the item class their own templates already use, purely to explain why in one
  // clause instead of showing the generic "not reorderable" line.
  var EXCLUDED_GROUP_CLASSES = [
    { cls: 'mth-s',    reason: 'Method steps are numbered, so their order is fixed.' },
    { cls: 'aud-c',    reason: 'These tiles get a bigger badge by position, so their order is fixed.' },
    { cls: 'pbs-row',  reason: 'These sample rows are labelled Week 1 through 4, so their order is fixed.' },
    { cls: 'ticker-i', reason: 'The ticker repeats every item to loop, so it is not reordered here.' }
  ];

  // Walks up from the clicked/activated node (inclusive) to the nearest element P's
  // render pass marked with data-group/data-gi, or to one of the four excluded item
  // classes above. Returns null for a field that belongs to neither — most fields,
  // most sections — so the parent shows the plain "not reorderable" sentence.
  function groupInfoFor(node) {
    var n = node;
    while (n && n !== stage) {
      if (n.hasAttribute && n.hasAttribute('data-group')) {
        return { groupId: n.getAttribute('data-group'), gi: Number(n.getAttribute('data-gi')) };
      }
      if (n.classList) {
        for (var i = 0; i < EXCLUDED_GROUP_CLASSES.length; i++) {
          if (n.classList.contains(EXCLUDED_GROUP_CLASSES[i].cls)) {
            return { excludedReason: EXCLUDED_GROUP_CLASSES[i].reason };
          }
        }
      }
      n = n.parentNode;
    }
    return null;
  }

  // data-edit / data-img are hooks the site's own templates have always carried and the
  // build already substitutes through. Nothing is added to the markup here beyond a
  // class and a tabindex, both of which live only in this frame.
  //
  // data-edit leaves additionally go into inline-edit mode on click/Enter — typing
  // directly on the canvas rather than only in a sidebar field. data-img stays
  // inspector-only: there is no "edit an image inline", only "swap it".
  function markLegacyFields() {
    Array.prototype.forEach.call(stage.querySelectorAll('[data-edit],[data-img]'), function (node) {
      var key = node.getAttribute('data-edit') || node.getAttribute('data-img');
      var kind = node.hasAttribute('data-img') ? 'image' : 'text';
      node.classList.add('is-field', kind === 'text' ? 'is-field-text' : 'is-field-img');
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', (kind === 'text' ? 'Edit ' : 'Change photo: ') + key);

      node.addEventListener('click', function (e) {
        // A click on the node ALREADY being inline-edited is the owner placing the
        // caret somewhere else in the same field, not a fresh activation — let the
        // browser's own click-to-place-caret behaviour run instead of restarting.
        if (inlineState && inlineState.node === node) return;
        e.preventDefault();
        e.stopPropagation();
        emit('field', Object.assign({ key: key, kind: kind }, groupInfoFor(node)));
        if (kind === 'text') startInlineEdit(node, e);
      });

      // Bound ONCE here rather than added/removed per edit session: attaching a
      // keydown listener to a node from inside that same node's keydown handler risks
      // the new listener firing for the event still being dispatched (engines disagree
      // on this), so isContentEditable is checked live instead of swapping which
      // listeners exist.
      node.addEventListener('keydown', function (e) {
        if (kind === 'text' && node.isContentEditable) {
          if (e.key === 'Enter') { e.preventDefault(); node.blur(); }
          else if (e.key === 'Escape') {
            e.preventDefault();
            var restored = inlineState.original;
            node.textContent = restored;
            endInlineEdit(node);
            emit('fieldCommit', { key: key, value: restored });
            node.blur();
          }
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          emit('field', Object.assign({ key: key, kind: kind }, groupInfoFor(node)));
          if (kind === 'text') startInlineEdit(node, null);
        }
      });

      if (kind === 'image') {
        // dragover must preventDefault or the browser treats the drop as "open this
        // file", navigating the iframe away from the editor entirely.
        node.addEventListener('dragover', function (e) {
          e.preventDefault();
          node.classList.add('is-drop-target');
        });
        node.addEventListener('dragleave', function () { node.classList.remove('is-drop-target'); });
        node.addEventListener('drop', function (e) {
          e.preventDefault();
          node.classList.remove('is-drop-target');
          var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (file) emit('dropImage', { key: key, file: file });
        });
      }

      if (kind === 'text') {
        node.addEventListener('input', function () {
          if (!node.isContentEditable) return;
          emit('fieldInput', { key: key, value: node.textContent });
        });
        // Blur commits AND removes contenteditable, so this is also where Enter lands
        // (Enter just calls node.blur() above) — one commit path, not two.
        node.addEventListener('blur', function () {
          if (!node.isContentEditable) return;
          var value = node.textContent;
          endInlineEdit(node);
          emit('fieldCommit', { key: key, value: value });
        });
      }
    });

    // data-edit-attr hooks a form placeholder, not a text node — there is nothing to
    // place a caret into, so these open the inspector like an image does rather than
    // going inline.
    Array.prototype.forEach.call(stage.querySelectorAll('[data-edit-attr]'), function (node) {
      var raw = node.getAttribute('data-edit-attr') || '';
      var key = raw.slice(raw.indexOf(':') + 1) || raw;
      node.classList.add('is-field', 'is-field-attr');
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', 'Edit ' + key);
      node.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        emit('field', { key: key, kind: 'text' });
      });
      node.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); emit('field', { key: key, kind: 'text' }); }
      });
    });
  }

  // contenteditable=plaintext-only strips pasted formatting and keeps rich markup out
  // of a data-edit leaf; not every engine implements it, so fall back to the plain
  // 'true' mode rather than leaving the node dead where it is unsupported.
  function setEditable(node, on) {
    if (!on) { node.removeAttribute('contenteditable'); return; }
    node.contentEditable = 'plaintext-only';
    if (!node.isContentEditable) node.contentEditable = 'true';
  }

  // Lands the caret where the owner actually clicked rather than always at the end —
  // caretRangeFromPoint (Blink/WebKit) and caretPositionFromPoint (Firefox) cover the
  // click case; a keyboard-triggered edit (Enter, no coordinates) falls back to the end.
  function placeCaret(node, clickEvent) {
    var range = null;
    if (clickEvent && document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
    } else if (clickEvent && document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(clickEvent.clientX, clickEvent.clientY);
      if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
    }
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function startInlineEdit(node, clickEvent) {
    inlineState = { node: node, original: node.textContent };
    node.classList.add('is-active');
    setEditable(node, true);
    node.focus();
    placeCaret(node, clickEvent);
  }

  function endInlineEdit(node) {
    node.classList.remove('is-active');
    setEditable(node, false);
    inlineState = null;
  }

  // Which cursor a hook shows, and whether hovering tints its background, depends on
  // kind — the static styling in canvas-frame.html treats every [data-edit]/[data-img]
  // alike. Added here instead of there, since kind-specific and edit-state styling is
  // this script's job, and appending once at init beats re-appending a fresh <style>
  // on every markLegacyFields() call (once per legacy render).
  function injectFieldStyles() {
    var style = document.createElement('style');
    style.textContent =
      '.is-legacy .is-field-text { cursor: text; }' +
      '.is-legacy .is-field-img, .is-legacy .is-field-attr { cursor: pointer; }' +
      '.is-legacy .is-field-img:hover, .is-legacy .is-field-img:focus-visible,' +
      '.is-legacy .is-field-attr:hover, .is-legacy .is-field-attr:focus-visible { background: transparent; }' +
      '.is-legacy [contenteditable] { cursor: text; outline: 2px solid var(--fast-red); outline-offset: 3px; background: rgba(212, 13, 31, 0.06); }';
    document.head.appendChild(style);
  }

  function applyLockClasses() {
    if (!section) return;
    section.elements.forEach(function (el) {
      var node = document.getElementById(el.id);
      if (node && el.locked) node.classList.add('is-locked');
    });
  }

  // Without this the canvas is mouse-only: nothing in it is focusable, so a keyboard
  // user can neither select an element nor reach the arrow-key nudging that already
  // exists. tabindex is applied HERE rather than in the compiler, so it never reaches
  // the published page — a visitor must not be able to tab through decorative boxes.
  function makeFocusable() {
    var sec = sectionEl();
    if (sec) sec.classList.toggle('is-empty', !stage.querySelector('.cv-el'));
    Array.prototype.forEach.call(stage.querySelectorAll('.cv-el'), function (node) {
      if (node.classList.contains('is-locked')) return;
      node.tabIndex = 0;
      var data = elementData(node.id);
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', (data && data.name ? data.name : node.id) + ' — press arrow keys to move, Delete to remove');
    });
  }

  // Bound ONCE against #stage, which survives every load. It used to be called from
  // load(), so each re-render stacked another pair of listeners on the same node and a
  // single click eventually fired the handler a dozen times.
  function wireHitTesting() {
    stage.addEventListener('mousedown', function (e) {
      var node = e.target.closest ? e.target.closest('.cv-el') : null;
      if (!node) { select(null); return; }
      if (node.classList.contains('is-locked')) return;
      if (node.id !== selectedId) select(node.id);
    });
    stage.addEventListener('dblclick', function (e) {
      var node = e.target.closest ? e.target.closest('.cv-el') : null;
      if (node) emit('activate', { id: node.id });
    });
    // Tabbing onto an element selects it, so the keyboard path and the mouse path end
    // in the same state and the inspector follows either one.
    stage.addEventListener('focusin', function (e) {
      var node = e.target.closest ? e.target.closest('.cv-el') : null;
      if (node && node.id !== selectedId && !node.classList.contains('is-locked')) select(node.id);
    });
  }

  // ------------------------------------------------------------------ selection

  // `silent` is set when the PARENT is telling the frame what is selected, rather than
  // the user clicking. Emitting in that case sends a 'select' straight back to the
  // parent, which rebuilds the inspector — destroying the input the owner is typing in.
  function select(id, silent) {
    if (selectedId) {
      var prev = document.getElementById(selectedId);
      if (prev) prev.classList.remove('is-selected');
    }
    selectedId = id;
    var node = id ? document.getElementById(id) : null;
    if (node) node.classList.add('is-selected');
    if (moveable) {
      moveable.target = node || null;
      // Snap this element against its siblings and against the section edges, which is
      // what makes hand placement land on alignments instead of near them.
      moveable.elementGuidelines = node
        ? Array.prototype.filter.call(stage.querySelectorAll('.cv-el'), function (n) { return n !== node; })
        : [];
      moveable.updateRect();
    }
    if (!silent) emit('select', { id: id });
  }

  // ------------------------------------------------------------------ moveable

  function setupMoveable() {
    if (moveable) { moveable.destroy(); moveable = null; }
    var sec = sectionEl();
    if (!sec) return;

    moveable = new Moveable(document.body, {
      target: null,
      draggable: true,
      resizable: true,
      rotatable: true,
      snappable: true,
      origin: false,
      keepRatio: false,
      throttleDrag: 0,
      throttleResize: 0,
      throttleRotate: 0,
      snapThreshold: 6,
      snapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      elementSnapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      verticalGuidelines: [],
      horizontalGuidelines: [],
      isDisplaySnapDigit: false,
      rotationPosition: 'top'
    });

    moveable.on('dragStart', function (e) { startPct = readPct(e.target); })
      .on('drag', function (e) {
        var s = secRect();
        e.target.style.left = r(startPct.x + e.beforeTranslate[0] / s.width * 100) + '%';
        e.target.style.top = r(startPct.y + e.beforeTranslate[1] / s.height * 100) + '%';
      })
      .on('dragEnd', function (e) { commit(e.target); });

    moveable.on('resizeStart', function (e) {
      startPct = readPct(e.target);
      if (e.dragStart) e.dragStart.set([0, 0]);
    })
      .on('resize', function (e) {
        var s = secRect();
        var data = elementData(e.target.id);
        e.target.style.width = r(e.width / s.width * 100) + '%';
        // Only elements that were given an explicit height keep one. Text sized to its
        // own content must stay that way, or a resize handle silently clips descenders.
        if (data && data.box.desktop.h !== null && data.box.desktop.h !== undefined) {
          e.target.style.height = r(e.height / s.height * 100) + '%';
        }
        var d = e.drag.beforeTranslate;
        e.target.style.left = r(startPct.x + d[0] / s.width * 100) + '%';
        e.target.style.top = r(startPct.y + d[1] / s.height * 100) + '%';
      })
      .on('resizeEnd', function (e) { commit(e.target); });

    moveable.on('rotate', function (e) {
      e.target.style.transform = 'rotate(' + r(e.rotation) + 'deg)';
    })
      .on('rotateEnd', function (e) { commit(e.target); });
  }

  // Read the truth back off the DOM rather than trusting the arithmetic that put it
  // there. If a CSS rule, a min-width or a flex quirk moved the element somewhere other
  // than where the drag math said, the saved box matches what the owner is looking at.
  function commit(node, coalesce) {
    var data = elementData(node.id);
    if (!data) return;
    var pct = readPct(node);
    var box = { x: r(pct.x), y: r(pct.y), w: r(pct.w) };
    box.h = (data.box.desktop.h === null || data.box.desktop.h === undefined) ? null : r(pct.h);
    var m = /rotate\((-?[\d.]+)deg\)/.exec(node.style.transform || '');
    box.rot = m ? Number(m[1]) : (data.box.desktop.rot || 0);
    emit('change', { id: node.id, box: box, coalesce: !!coalesce });
  }

  // Keyboard lives here, in the frame, because a keydown never crosses an iframe
  // boundary. Once you click the canvas the frame owns focus, so every shortcut bound
  // in the parent was dead from that moment on — including the Ctrl+Z the delete toast
  // tells you to press. Delete belongs here for the same reason: this is the one
  // document where "the canvas has focus" is a fact rather than something inferred
  // from the absence of a focused form field.
  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod) {
      var k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); emit('shortcut', { name: e.shiftKey ? 'redo' : 'undo' }); return; }
      if (k === 's') { e.preventDefault(); emit('shortcut', { name: 'save' }); return; }
      // Ctrl+D was bound in the parent only, so it was dead the moment the canvas had
      // focus — which is exactly when you want to duplicate the thing you just clicked.
      if (k === 'd') { e.preventDefault(); emit('shortcut', { name: 'duplicate' }); return; }
      return;
    }

    if (!selectedId) return;

    if (e.key === 'Escape') { select(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      emit('delete', { id: selectedId });
      return;
    }

    // Nudging is how you fix the last two pixels, and it is the one thing a mouse is
    // genuinely bad at.
    var step = e.shiftKey ? 1 : 0.2;
    var dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();
    var node = document.getElementById(selectedId);
    if (!node || node.classList.contains('is-locked')) return;
    var pct = readPct(node);
    node.style.left = r(pct.x + dx) + '%';
    node.style.top = r(pct.y + dy) + '%';
    if (moveable) moveable.updateRect();
    // coalesce: a run of arrow presses is one edit, not twelve. Without this a few
    // seconds of nudging flushes the entire undo stack.
    commit(node, true);
  });

  window.addEventListener('resize', function () { if (moveable) moveable.updateRect(); });

  // Belt and suspenders beyond the per-node dragover/drop handlers in markLegacyFields:
  // a drop that lands anywhere else in the document (a gap between fields, an
  // unmarked element) would otherwise still trigger the browser's default "open this
  // file", navigating the iframe away from the editor entirely.
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); });

  // Once, at init. #stage outlives every load, so the listeners bound to it do too.
  wireHitTesting();
  injectFieldStyles();

  emit('ready', {});
})();
