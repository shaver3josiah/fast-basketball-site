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
    if (selectedId && !document.getElementById(selectedId)) selectedId = null;
    setupMoveable();
    if (selectedId) select(selectedId);
    wireHitTesting();
  }

  function refresh() { if (moveable) moveable.updateRect(); }

  function applyLockClasses() {
    if (!section) return;
    section.elements.forEach(function (el) {
      var node = document.getElementById(el.id);
      if (node && el.locked) node.classList.add('is-locked');
    });
  }

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
  }

  // ------------------------------------------------------------------ selection

  function select(id) {
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
    emit('select', { id: id });
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
  function commit(node) {
    var data = elementData(node.id);
    if (!data) return;
    var pct = readPct(node);
    var box = { x: r(pct.x), y: r(pct.y), w: r(pct.w) };
    box.h = (data.box.desktop.h === null || data.box.desktop.h === undefined) ? null : r(pct.h);
    var m = /rotate\((-?[\d.]+)deg\)/.exec(node.style.transform || '');
    box.rot = m ? Number(m[1]) : (data.box.desktop.rot || 0);
    emit('change', { id: node.id, box: box });
  }

  // Nudging with the keyboard is how you fix the last two pixels, and it is the one
  // thing a mouse is genuinely bad at.
  document.addEventListener('keydown', function (e) {
    if (!selectedId) return;
    var step = e.shiftKey ? 1 : 0.2;
    var dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else if (e.key === 'Escape') { select(null); return; }
    else return;
    e.preventDefault();
    var node = document.getElementById(selectedId);
    if (!node || node.classList.contains('is-locked')) return;
    var pct = readPct(node);
    node.style.left = r(pct.x + dx) + '%';
    node.style.top = r(pct.y + dy) + '%';
    if (moveable) moveable.updateRect();
    commit(node);
  });

  window.addEventListener('resize', function () { if (moveable) moveable.updateRect(); });

  emit('ready', {});
})();
