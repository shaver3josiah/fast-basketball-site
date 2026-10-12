/* The catalog as it is NOW. The pages are built from plans.mjs, but Blake changes prices, hides
   packages and adds new ones in the admin's Prices tab without a deploy, so this reads
   /api/packages on the homepage and /enroll and brings the page up to date:

     - every figure that carries data-price is rewritten from the live catalog;
     - a hidden package disappears (its table row, its enroll card);
     - /enroll cards are refreshed in place and the packages added since the build are inserted;
     - the homepage lists the added packages under the program they belong to.

   The static page is the baseline. With JavaScript off, or if the request fails, nothing here runs
   and the visitor sees the published prices, which is correct for a catalog nobody has touched.
   Nothing this fetches is trusted back: checkout prices from Stripe by lookup key. */
(function(){
  'use strict';

  var enForm = document.getElementById('enForm');

  function hide(el){ if(el) el.style.display = 'none'; }
  function money(cents){
    var s = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '$' + s + (cents % 100 ? '.' + String(cents % 100).padStart(2, '0') : '');
  }
  function shortLabel(label){ var i = label.indexOf(', '); return i > -1 ? label.slice(i + 2) : label; }

  /* Figures. innerHTML on purpose: the server sends "$450&ndash;$1,000" with the entity, and
     the string is built from numbers only, never from anything a person typed. */
  function figures(v){
    var els = document.querySelectorAll('[data-price]');
    for(var i = 0; i < els.length; i++){
      var f = v.figures[els[i].getAttribute('data-price')];
      if(typeof f === 'string') els[i].innerHTML = f;
    }
  }

  /* A hidden package leaves the page's tables. */
  function hideRetired(v){
    for(var r = 0; r < v.retired.length; r++){
      var key = v.retired[r];
      var els = document.querySelectorAll('[data-price]');
      for(var i = 0; i < els.length; i++){
        if((els[i].getAttribute('data-price') || '').split(':')[0] !== key) continue;
        hide(els[i].closest ? els[i].closest('tr') : null);
      }
    }
  }

  /* Homepage: the packages Blake added, listed under their program. */
  function extras(v){
    var boxes = document.querySelectorAll('.pk-extra[data-program]');
    for(var b = 0; b < boxes.length; b++){
      var box = boxes[b];
      box.innerHTML = '';
      var program = box.getAttribute('data-program');
      var n = 0;
      for(var i = 0; i < v.plans.length; i++){
        var p = v.plans[i];
        if(!p.custom || p.retired || p.program !== program) continue;
        var opt = p.payOptions[0];
        if(!opt) continue;
        var li = document.createElement('li');
        var b2 = document.createElement('b');
        b2.textContent = opt.amount;
        li.appendChild(b2);
        li.appendChild(document.createTextNode(' ' + shortLabel(p.label) + ', ' +
          (p.kind === 'recurring' ? 'a month until you cancel' : p.kind === 'term' ? 'paid in full' : 'one payment')));
        box.appendChild(li);
        n++;
      }
      box.hidden = n === 0;
    }
  }

  /* /enroll. */
  function radioFor(key){
    var radios = enForm.querySelectorAll('input[name="plan"]');
    for(var i = 0; i < radios.length; i++) if(radios[i].value === key) return radios[i];
    return null;
  }
  function parse(html){
    var t = document.createElement('template');
    t.innerHTML = html;
    return t.content.firstElementChild;
  }
  function setLines(card, attrs){
    ['full', 'monthly'].forEach(function(pay){
      if(typeof attrs[pay] === 'string') card.setAttribute('data-' + pay, attrs[pay]);
      else card.removeAttribute('data-' + pay);
    });
  }

  function enroll(v){
    var i, key, radio, card;

    /* Hidden packages: out of sight and out of the form, so a stale tick cannot post one. */
    for(i = 0; i < v.retired.length; i++){
      radio = radioFor(v.retired[i]);
      card = radio && radio.closest ? radio.closest('.en-card') : null;
      if(!card) continue;
      radio.checked = false; radio.disabled = true;
      hide(card);
    }

    /* Every live package: refresh a card that exists, insert one that does not. */
    for(key in v.cards){
      if(!Object.prototype.hasOwnProperty.call(v.cards, key)) continue;
      var c = v.cards[key];
      radio = radioFor(key);
      card = radio && radio.closest ? radio.closest('.en-card') : null;
      var fresh = parse(c.inner);
      if(!fresh) continue;
      if(card){
        var old = card.querySelector('.en-card-b');
        if(old) card.replaceChild(fresh, old);
        setLines(card, c.attrs);
        continue;
      }
      var panel = document.getElementById('enTrack_' + c.program);
      var list = panel ? panel.querySelector('.en-plans') : null;
      if(!list) continue;
      card = document.createElement('label');
      card.className = 'en-card';
      setLines(card, c.attrs);
      var input = document.createElement('input');
      input.type = 'radio'; input.name = 'plan'; input.value = key; input.required = true;
      card.appendChild(input);
      card.appendChild(fresh);
      list.appendChild(card);
    }

    /* Page order, so a new package sits where the catalog puts it. appendChild moves a node
       without losing which radio is ticked. */
    ['individual', 'group'].forEach(function(program){
      var panel = document.getElementById('enTrack_' + program);
      var list = panel ? panel.querySelector('.en-plans') : null;
      if(!list || !v.order[program]) return;
      v.order[program].forEach(function(k){
        var r = radioFor(k);
        var cd = r && r.closest ? r.closest('.en-card') : null;
        if(cd && cd.parentNode === list) list.appendChild(cd);
      });
    });

    /* The program tiles' one-line summaries. */
    v.tiles.forEach(function(t){
      var tile = enForm.querySelector('.en-track[data-track="' + t.id + '"] .en-track-d');
      if(tile) tile.textContent = t.line;
    });

    /* A ?plan= link to a package that was not in the built page: enroll.js ran before the card
       existed, so pick it now. Compared by value in a loop, never spliced into a selector. */
    var want = null;
    try { want = new URLSearchParams(window.location.search).get('plan'); } catch(e){}
    if(want && !enForm.querySelector('input[name="plan"]:checked')){
      var wanted = radioFor(want);
      if(wanted && !wanted.disabled) wanted.checked = true;
    }
    /* Let enroll.js re-read the card it is looking at (the pay lines, which panel is open). */
    var on = enForm.querySelector('input[name="plan"]:checked');
    if(on) on.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function run(v){
    if(!v || !v.figures || !v.cards) return;
    figures(v);
    hideRetired(v);
    extras(v);
    if(enForm) enroll(v);
  }

  /* An unreachable endpoint leaves the page exactly as it was built. */
  try {
    fetch('/api/packages', { headers: { Accept: 'application/json' } })
      .then(function(res){ return res.ok ? res.json() : null; })
      .then(run)
      .catch(function(){});
  } catch(e){}
})();
