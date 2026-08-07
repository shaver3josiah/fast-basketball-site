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
    document.body.classList.add('is-editing');
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

  // Once, at init. #stage outlives every load, so the listeners bound to it do too.
  wireHitTesting();

  emit('ready', {});
})();
