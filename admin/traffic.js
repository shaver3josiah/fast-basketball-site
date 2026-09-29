/* The Traffic tab: how people find the site, which of them became leads, whose efforts brought
   them in, and the tracked-link maker. Reads and writes /api/admin-traffic.

   Its own file on purpose. admin.js already switches tabs generically (a .tab button shows the
   <main> named after it), so this only listens for its own button being pressed and renders
   into #tabTraffic. Everything a visitor typed reaches the page through textContent, never
   innerHTML: lead names and link notes are other people's words.

   Written for Blake reading it on his phone, so the words are his, not an analytics tool's:
   "Google and other search", never "organic"; "Homepage", never "/". The server keeps the
   technical names (lib/traffic.mjs CHANNELS); only this file translates them. */
(function(){
  var root = document.getElementById('tabTraffic');
  var tabBtn = document.querySelector('.tab[data-tab="traffic"]');
  if(!root || !tabBtn) return;

  /* This device belongs to whoever runs the panel. Its own visits to the site are not traffic;
     js/track.js reads this flag and counts nothing from here. */
  try { localStorage.setItem('fb_notrack', '1'); } catch(e){}

  var state = { days: 30, report: null, loading: false, error: '', dests: {}, made: null, whoseOpen: false, allLeads: false, hideTip: null };
  var LEADS_SHOWN = 8;

  /* ---- tiny DOM helper: h('div.cls', {attrs}, children...) */
  function h(tag, attrs){
    var parts = tag.split('.');
    var el = document.createElement(parts[0] || 'div');
    if(parts.length > 1) el.className = parts.slice(1).join(' ');
    var kids = [].slice.call(arguments, 2);
    if(attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))){ kids.unshift(attrs); attrs = null; }
    if(attrs) Object.keys(attrs).forEach(function(k){
      var v = attrs[k];
      if(v == null || v === false) return;
      if(k === 'on') Object.keys(v).forEach(function(ev){ el.addEventListener(ev, v[ev]); });
      else if(k === 'style') el.style.cssText = v;
      else if(k in el && k !== 'list' && k !== 'role') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    (function add(list){
      list.forEach(function(c){
        if(c == null || c === false) return;
        if(Array.isArray(c)) return add(c);
        el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
      });
    })(kids);
    return el;
  }
  /* A small inline SVG icon, drawn in currentColor so it takes the text colour it sits in. */
  function icon(d, size){
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', size || 12); svg.setAttribute('height', size || 12);
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'tr-ico');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }
  var UP = 'M8 13V3M3.5 7.5L8 3l4.5 4.5', DOWN = 'M8 3v10M3.5 8.5L8 13l4.5-4.5', CHEVRON = 'M4 6l4 4 4-4';

  var num = function(n){ return (Number(n) || 0).toLocaleString('en-US'); };
  var plural = function(n, one, many){ return (Number(n) || 0) === 1 ? one : many; };
  var pct = function(x){ return (x * 100 >= 10 ? Math.round(x * 100) : Math.round(x * 1000) / 10) + '%'; };
  function dur(ms){
    var s = Math.round((ms || 0) / 1000);
    if(s < 60) return s + 's';
    return Math.floor(s / 60) + 'm ' + (s % 60 < 10 ? '0' : '') + (s % 60) + 's';
  }
  var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;
  function ago(iso){
    var t = Date.parse(iso);
    if(!isFinite(t)) return '';
    var d = (t - Date.now()) / 1000;
    var units = [['day', 86400], ['hour', 3600], ['minute', 60]];
    for(var i = 0; i < units.length; i++){
      if(Math.abs(d) >= units[i][1] || i === units.length - 1){
        var n = Math.round(d / units[i][1]);
        return rtf ? rtf.format(n, units[i][0]) : Math.abs(n) + ' ' + units[i][0] + 's ago';
      }
    }
  }
  function dayLabel(day, long){
    var d = new Date(day + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', long ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  /* ---- Blake's words for the server's names */
  var CHANNEL = {
    'Tracked link': 'Your tracked links',
    'Organic search': 'Google and other search',
    'Paid search': 'Google ads',
    'Social': 'Social media',
    'Email': 'Email',
    'Referral': 'Other websites',
    'Campaign': 'Tagged campaigns',
    'Direct': 'Typed in or bookmarked',
    'Unknown': 'Before counting started'
  };
  var channel = function(c){ return CHANNEL[c] || c; };
  var PAGE = {
    '/': 'Homepage', '/enroll': 'Enroll page', '/enroll/thanks': 'Enroll thank-you page', '/contact': 'Contact page',
    '/locker': 'The Locker', '/playbook': 'Free playbook', '/privacy': 'Privacy page', '/terms': 'Terms page',
    '/appbuy': 'Tools shop', '/appbuy/thanks': 'Tools thank-you page', '/shotform': 'Shot Form Watcher', '/dribble': 'Dribble Listener',
    '/coach-blake-kingsley': 'Coach page', '/blog/': 'Blog'
  };
  function page(p){
    if(!p) return '';
    var clean = p.length > 1 ? p.replace(/\/$/, '') : p;
    if(PAGE[clean] || PAGE[p]) return PAGE[clean] || PAGE[p];
    var last = clean.split('/').filter(Boolean).pop() || clean;
    return last.replace(/-/g, ' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); }) + ' page';
  }
  /* A source is a link name, a utm tag or a referring host. Hosts get their everyday name. */
  var HOSTS = [[/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
    [/(^|\.)yahoo\.com$/, 'Yahoo'], [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)facebook\.com$/, 'Facebook'],
    [/(^|\.)tiktok\.com$/, 'TikTok'], [/^t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, 'X (Twitter)'], [/(^|\.)youtube\.com$|^youtu\.be$/, 'YouTube'],
    [/(^|\.)nextdoor\.com$/, 'Nextdoor'], [/(^|\.)linkedin\.com$/, 'LinkedIn']];
  function source(s){
    if(!s || s === '(direct)') return 'Typed in or bookmarked';
    for(var i = 0; i < HOSTS.length; i++) if(HOSTS[i][0].test(s)) return HOSTS[i][1];
    return s;
  }
  var DEVICE = { phone: 'Phones', tablet: 'Tablets', desktop: 'Computers', unknown: 'Unknown' };

  /* ---- data */
  function api(method, body){
    var url = '/api/admin-traffic' + (method === 'GET' ? '?days=' + state.days : '');
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if(body){ opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(out){
        if(res.status === 401) throw new Error('Your sign-in has ended. Reload the page and sign in again.');
        if(!res.ok) throw new Error(out.error || 'That did not work. Try again.');
        return out;
      });
    }, function(){ throw new Error('Could not reach the site. Check your connection and try again.'); });
  }
  function load(){
    state.loading = true; state.error = '';
    render();
    api('GET').then(function(out){
      state.report = out.report; state.dests = out.destinations || {};
    }).catch(function(err){ state.error = err.message; })
      .then(function(){ state.loading = false; render(); });
  }
  tabBtn.addEventListener('click', load);
  /* One listener for the life of the page: a tap anywhere outside the chart closes its tooltip. */
  document.addEventListener('click', function(e){
    if(state.hideTip && !(e.target.closest && e.target.closest('.tr-plot'))) state.hideTip();
  });

  function copy(text, btn){
    function done(ok){
      var was = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Press and hold the link to copy';
      setTimeout(function(){ if(btn.isConnected) btn.textContent = was; }, 1600);
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ done(true); }, function(){ done(false); });
    } else done(false);
  }

  /* ---- pieces */
  function card(title, sub){
    var kids = [].slice.call(arguments, 2);
    return h('section.tr-card', h('h2.tr-h', title), sub ? h('p.tr-sub', sub) : null, kids);
  }

  function rangeBar(){
    return h('div.tr-top',
      h('div.tr-range', { role: 'group', 'aria-label': 'Time range' },
        [7, 30, 90].map(function(d){
          return h('button', {
            type: 'button', 'aria-pressed': String(state.days === d),
            on: { click: function(){ if(state.days !== d){ state.days = d; load(); } } }
          }, d + ' days');
        })
      ),
      h('button.btn.tr-refresh', { type: 'button', on: { click: load }, disabled: state.loading }, state.loading ? 'Loading' : 'Refresh')
    );
  }

  /* The change against the previous window of the same length. Small numbers move in whole
     units ("+3"), because "+300%" on a jump from one to four says more than it means. */
  function delta(cur, prev){
    if(prev == null) return null;
    cur = Number(cur) || 0; prev = Number(prev) || 0;
    var span = 'the previous ' + state.days + ' days';
    if(cur === prev) return h('span.tr-delta', { title: 'Same as ' + span }, 'Same as before');
    var up = cur > prev;
    var text = prev < 10 ? (up ? '+' : '−') + num(Math.abs(cur - prev)) : (up ? '+' : '−') + Math.round(Math.abs(cur - prev) / prev * 100) + '%';
    return h('span.tr-delta' + (up ? '.up' : '.down'), { 'aria-label': (up ? 'Up ' : 'Down ') + text.slice(1) + ' on ' + span },
      icon(up ? UP : DOWN, 11), text);
  }

  function tiles(t, p){
    var list = [
      ['Visitors', t.visitors, t.newVisitors ? num(t.newVisitors) + ' new to the site' : 'People, counted once each', p && p.visitors],
      ['Visits', t.sessions, t.sessions ? (t.pageviews / t.sessions).toFixed(1) + ' pages, ' + dur(t.avgEngagedMs) + ' each' : 'Each time someone comes by', p && p.sessions],
      ['Leads', t.leads, t.visitors ? pct(t.conversion) + ' of visitors sent a form' : 'Forms sent to you', p && p.leads],
      ['Paid enrollments', t.enrolled, t.registrations ? 'from ' + num(t.registrations) + ' ' + plural(t.registrations, 'registration', 'registrations') : 'Registrations that paid', p && p.enrolled]
    ];
    return h('div.tr-tiles', list.map(function(x){
      return h('div.tr-tile',
        h('p.tr-tile-l', x[0]),
        h('p.tr-tile-n', num(x[1])),
        h('p.tr-tile-s', x[2]),
        p ? delta(x[1], x[3]) : null);
    }));
  }

  function chart(daily, since){
    var max = 0;
    daily.forEach(function(d){ if(d.sessions > max) max = d.sessions; });
    var top = Math.max(4, Math.ceil(max / 4) * 4);
    var tip = h('div.tr-tip', { role: 'status', 'aria-live': 'polite' });
    var hot = null;
    function hide(){ tip.classList.remove('on'); if(hot) hot.classList.remove('hot'); hot = null; }
    state.hideTip = hide;
    var anyPre = false;
    var cols = daily.map(function(d){
      var pre = since && d.day < since;
      if(pre) anyPre = true;
      var col = h('div.tr-col' + (pre ? '.pre' : ''),
        pre ? null : h('div.tr-bar', { style: 'height:' + (d.sessions ? Math.max(2, d.sessions / top * 100) : 0) + '%' }),
        d.leads ? h('span.tr-lead-dot', { 'aria-hidden': 'true' }) : null
      );
      function show(){
        if(hot) hot.classList.remove('hot');
        tip.textContent = '';
        tip.appendChild(h('b', dayLabel(d.day, true)));
        if(pre) tip.appendChild(h('span', 'Not counted yet'));
        else {
          tip.appendChild(h('span', num(d.sessions) + plural(d.sessions, ' visit', ' visits') + ', ' + num(d.visitors) + plural(d.visitors, ' visitor', ' visitors')));
          if(d.leads) tip.appendChild(h('span.tr-tip-lead', num(d.leads) + plural(d.leads, ' lead', ' leads')));
        }
        var box = col.getBoundingClientRect(), wrap = plot.getBoundingClientRect();
        var x = box.left - wrap.left + box.width / 2;
        tip.style.left = Math.min(Math.max(x, 76), wrap.width - 76) + 'px';
        tip.classList.add('on');
        col.classList.add('hot');
        hot = col;
      }
      /* A mouse previews on hover; a finger taps to open and taps again (or elsewhere) to close.
         Touch fires pointerleave the instant the finger lifts, so hover alone flashes and vanishes. */
      col.addEventListener('pointerenter', function(e){ if(e.pointerType === 'mouse') show(); });
      col.addEventListener('pointerleave', function(e){ if(e.pointerType === 'mouse') hide(); });
      col.addEventListener('click', function(){ if(hot === col) hide(); else show(); });
      return col;
    });
    var total = daily.reduce(function(s, d){ return s + d.sessions; }, 0);
    var plot = h('div.tr-plot', { role: 'img', 'aria-label': num(total) + ' visits over ' + daily.length + ' days, busiest day ' + num(max) + '. The table below lists every day.' },
      h('div.tr-grid', [1, 0.5, 0].map(function(f){ return h('span', { style: 'bottom:' + f * 100 + '%' }, h('em', num(top * f))); })),
      h('div.tr-cols', { style: 'gap:' + (daily.length > 40 ? 1 : 2) + 'px' }, cols),
      tip
    );
    var mid = daily[Math.floor(daily.length / 2)];
    var axis = h('div.tr-axis', h('span', dayLabel(daily[0].day)), h('span', dayLabel(mid.day)), h('span', dayLabel(daily[daily.length - 1].day)));
    var table = h('details.tr-more', h('summary', 'Show day by day'),
      h('table.tr-table', h('thead', h('tr', h('th', 'Day'), h('th', 'Visits'), h('th', 'Visitors'), h('th', 'Leads'))),
        h('tbody', daily.slice().reverse().map(function(d){
          var pre = since && d.day < since;
          return h('tr' + (pre ? '.pre' : ''), h('td', dayLabel(d.day, true)),
            pre ? h('td', { colSpan: 3 }, 'Not counted yet') : [h('td', num(d.sessions)), h('td', num(d.visitors)), h('td', num(d.leads))]);
        }))));
    return h('div', plot, axis,
      h('p.tr-key', h('span.tr-lead-dot.static', { 'aria-hidden': 'true' }), 'A dot marks a day a lead came in.',
        anyPre ? h('span.tr-key-pre', 'Faded days came before counting started on ' + dayLabel(since) + '.') : null),
      table);
  }

  /* A ranked list with a bar behind each value: one hue, the length is the number. */
  function ranked(rows, field, cols, empty, label){
    if(!rows.length) return h('p.tr-empty', empty || 'Nothing yet.');
    var max = 0;
    rows.forEach(function(r){ if(r[field] > max) max = r[field]; });
    return h('div.tr-rank',
      h('div.tr-rank-row.head', h('span', ''), cols.map(function(c){ return h('span.n', c[1]); })),
      rows.map(function(r){
        var name = label ? label(r.name) : r.name;
        return h('div.tr-rank-row',
          h('span.tr-rank-name', { title: name }, h('i', { style: 'width:' + (max ? r[field] / max * 100 : 0) + '%' }), h('b', name)),
          cols.map(function(c){ return h('span.n', num(r[c[0]])); })
        );
      })
    );
  }

  /* "Whose efforts brought them", folded behind a button under the daily chart. The summary
     carries the counts, so it answers the question closed and opens for the names. */
  function whose(credit){
    function list(rows, cls){
      if(!rows.length) return null;
      return h('ul.tr-who-list', rows.map(function(r){
        return h('li', h('b', r.name), r.player ? ' (' + r.player + ')' : '', ' · ', r.typeLabel,
          r.paid ? h('span.tr-paid', 'Paid') : null, h('span.tr-why ' + cls, r.credit.why));
      }));
    }
    var n = credit.link.length + credit.answer.length;
    var meta = n || credit.search.length
      ? num(n) + ' Josiah’s' + (credit.search.length ? ' · ' + num(credit.search.length) + ' to talk over' : '')
      : 'None this period';
    var box = h('details.tr-whose', { open: state.whoseOpen, on: { toggle: function(){ state.whoseOpen = box.open; } } },
      h('summary.tr-whose-btn',
        h('span.tr-whose-t', 'Whose efforts brought them'),
        h('span.tr-whose-m', meta),
        icon(CHEVRON, 14)),
      h('div.tr-whose-body',
        h('p.tr-sub', 'Under the website agreement, a family counts as Josiah’s when they came through one of his links or answered “Google or online search”. Everything else is yours. Only paid registrations earn anyone anything.'),
        h('div.tr-who',
          h('div.tr-who-n.main', h('p.tr-tile-n', num(n)), h('p.tr-tile-l', 'Josiah’s leads')),
          h('div.tr-who-n', h('p.tr-tile-n', num(credit.link.length)), h('p.tr-tile-l', 'Through his links')),
          h('div.tr-who-n', h('p.tr-tile-n', num(credit.answer.length)), h('p.tr-tile-l', 'Answered Google')),
          h('div.tr-who-n.warn', h('p.tr-tile-n', num(credit.search.length)), h('p.tr-tile-l', 'To talk over'))
        ),
        list(credit.link, 'link'),
        list(credit.answer, 'answer'),
        credit.search.length ? h('div',
          h('p.tr-note', 'These first found the site through a search engine but gave a different answer. Google hides what they searched for, so this cannot tell a search for “Fast Basketball” (yours) from one for “basketball training near me” (his). The agreement says you two talk it over; Search Console shows the search words.'),
          list(credit.search, 'search')) : null,
        !n && !credit.search.length ? h('p.tr-empty', 'No leads in this period were Josiah’s.') : null
      ));
    return box;
  }

  /* ---- the link maker */
  function linkForm(){
    var nameIn = h('input', { id: 'trName', type: 'text', maxLength: 60, placeholder: 'The Rivera family, or Spring flyer', autocomplete: 'off', required: true });
    var destIn = h('select', { id: 'trDest' }, Object.keys(state.dests).map(function(k){ return h('option', { value: k }, state.dests[k]); }));
    var devIn = h('input', { id: 'trDev', type: 'checkbox' });
    var noteIn = h('input', { id: 'trNote', type: 'text', maxLength: 200, placeholder: 'Where you met them, what you promised', autocomplete: 'off' });
    var err = h('p.tr-err', { role: 'alert' });
    var go = h('button.btn.primary', { type: 'submit' }, 'Make the link');
    return h('form.tr-form', { on: { submit: function(e){
      e.preventDefault();
      err.textContent = '';
      go.disabled = true; go.textContent = 'Making it...';
      api('POST', { action: 'create', name: nameIn.value, dest: destIn.value, developer: devIn.checked, note: noteIn.value })
        .then(function(out){
          state.made = out.link;
          state.report.links.unshift(Object.assign({ sessions: 0, leads: 0, enrolled: 0 }, out.link));
          render();
          var res = document.getElementById('trMade');
          if(res) res.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        })
        .catch(function(e2){ err.textContent = e2.message; go.disabled = false; go.textContent = 'Make the link'; });
    } } },
      h('div.field', h('label', { htmlFor: 'trName' }, 'Who or what it is for'), nameIn),
      h('div.field', h('label', { htmlFor: 'trDest' }, 'Where it opens'), destIn),
      h('label.tr-check', { htmlFor: 'trDev' }, devIn,
        h('span', h('b', 'Josiah brought this person in'),
          h('small', 'They count as his customer (8% for their first 12 months, Section 7) and the form will not ask them how they heard about you. Blake gets an email every time one of these is made, and can revoke it.'))),
      h('div.field', h('label', { htmlFor: 'trNote' }, 'Note (optional)'), noteIn),
      err, go
    );
  }

  function links(list){
    var made = state.made ? h('div.tr-made', { id: 'trMade' },
      h('p.tr-made-t', state.made.developer ? 'Josiah’s link is ready' : 'Your link is ready'),
      h('p.link-out', state.made.url),
      state.made.developer ? h('p.tr-made-note', 'Blake has been emailed about this link, so he can revoke it if he did not agree to it.') : null,
      h('div.tr-made-btns',
        h('button.btn.primary', { type: 'button', on: { click: function(e){ copy(state.made.url, e.currentTarget); } } }, 'Copy link'),
        navigator.share ? h('button.btn', { type: 'button', on: { click: function(){
          navigator.share({ title: 'Fast Basketball', url: state.made.url }).catch(function(){});
        } } }, 'Share') : null
      )) : null;

    /* No links yet: the form IS the section. Once there are some, the list leads and the form
       folds behind one button, so the links Blake already hands out are what he sees first. */
    var maker = list.length
      ? h('details.tr-newlink', h('summary.btn', 'Make a new link'), linkForm())
      : linkForm();

    return card('Your tracked links',
      'Give each thing you hand out its own link: a flyer, your Instagram bio, the website button on your Google Business Profile, or one family. Each link counts its own visits, leads and paid enrollments.',
      made,
      list.length ? h('div.tr-links', list.map(linkRow)) : null,
      maker);
  }

  function linkRow(l){
    var revoked = !!l.revokedAt;
    var err = h('p.tr-err', { role: 'alert' });
    return h('div.tr-link' + (revoked ? '.off' : ''),
      h('div.tr-link-top',
        h('b.tr-link-name', l.name),
        l.developer ? h('span.chip.tr-chip-dev', 'Josiah') : h('span.chip', 'FAST'),
        revoked ? h('span.chip.flag', 'Revoked') : null
      ),
      h('p.tr-link-meta', (l.destLabel || page(l.dest)) + ' · made ' + ago(l.createdAt) + (l.note ? ' · ' + l.note : '')),
      h('p.tr-link-stats',
        h('span', h('b', num(l.sessions)), plural(l.sessions, ' visit', ' visits')),
        h('span', h('b', num(l.leads)), plural(l.leads, ' lead', ' leads')),
        h('span', h('b', num(l.enrolled)), ' paid')),
      h('p.link-out', l.url),
      h('div.tr-link-btns',
        h('button.btn', { type: 'button', on: { click: function(e){ copy(l.url, e.currentTarget); } } }, 'Copy'),
        !revoked ? h('button.btn.tr-revoke', { type: 'button', on: { click: function(e){
          var b = e.currentTarget;
          if(b.dataset.armed !== '1'){
            b.dataset.armed = '1'; b.textContent = 'Tap again to revoke';
            setTimeout(function(){ if(b.isConnected && !b.disabled){ b.dataset.armed = ''; b.textContent = 'Revoke'; } }, 4000);
            return;
          }
          b.disabled = true; b.textContent = 'Revoking...'; err.textContent = '';
          api('POST', { action: 'revoke', id: l.id }).then(function(out){
            l.revokedAt = out.link.revokedAt; render();
          }).catch(function(e2){ b.disabled = false; b.dataset.armed = ''; b.textContent = 'Revoke'; err.textContent = e2.message; });
        } } }, 'Revoke') : null
      ),
      err,
      revoked && l.developer ? h('p.tr-note', 'New families through this link are no longer counted as Josiah’s. Families who came through it before it was revoked still are.') : null
    );
  }

  /* One line saying whose lead it is. "Told us" above already quotes the answer, so this says
     what the answer MEANS rather than repeating it. */
  function verdict(c){
    if(c.who === 'link' || c.who === 'answer') return 'Josiah’s: ' + c.why;
    if(c.who === 'search') return 'Talk it over: ' + c.why;
    if(c.who === 'app') return c.why;
    return 'Yours: your own effort, a referral, or someone who came straight to the site.';
  }

  function leadsList(rows){
    if(!rows.length) return h('p.tr-empty', 'No leads in this period yet.');
    var shown = state.allLeads ? rows : rows.slice(0, LEADS_SHOWN);
    return h('div',
      shown.map(function(r){
        var chipCls = r.type === 'enrollment' ? 'enrollment' : r.type === 'contact' ? 'contact' : r.type === 'playbook' ? 'playbook' : '';
        var whoCls = { link: 'link', answer: 'answer', search: 'search' }[r.credit.who] || '';
        var how = r.channel === 'Unknown' ? 'before counting started'
          : channel(r.channel) + (r.source && r.channel !== 'Direct' && source(r.source) !== channel(r.channel) ? ' (' + source(r.source) + ')' : '');
        return h('article.lead.tr-lead',
          h('div.lead-top', h('span.chip ' + chipCls, r.typeLabel), r.paid ? h('span.chip.tr-chip-paid', 'Paid') : null, h('span.lead-when', ago(r.at))),
          h('p.lead-name', r.name),
          h('p.lead-meta', h('b', 'Found the site: '), how),
          r.landing ? h('p.lead-meta', h('b', 'First page: '), page(r.landing)) : null,
          r.hearAbout ? h('p.lead-meta', h('b', 'Told us: '), r.hearAbout) : null,
          h('p.tr-why ' + whoCls, verdict(r.credit))
        );
      }),
      rows.length > LEADS_SHOWN ? h('button.btn.tr-showall', { type: 'button', on: { click: function(){ state.allLeads = !state.allLeads; render(); } } },
        state.allLeads ? 'Show fewer' : 'Show all ' + num(rows.length) + ' leads') : null
    );
  }

  /* ---- the tab */
  function render(){
    state.hideTip = null;
    root.textContent = '';
    root.classList.toggle('tr-busy', state.loading && !!state.report);
    root.setAttribute('aria-busy', String(state.loading));
    root.appendChild(rangeBar());
    var r = state.report;

    if(!r){
      if(state.error){
        root.appendChild(h('section.tr-card.tr-failed',
          h('h2.tr-h', 'Traffic did not load'),
          h('p.tr-sub', state.error),
          h('button.btn.primary', { type: 'button', on: { click: load } }, 'Try again')));
      } else {
        root.appendChild(h('div.tr-tiles.tr-skel', { 'aria-label': 'Loading traffic' }, [0, 1, 2, 3].map(function(){ return h('div.tr-tile'); })));
      }
      return;
    }
    if(state.error) root.appendChild(h('p.error.tr-inline-err', { role: 'alert' }, state.error));

    var t = r.totals;
    var since = r.trackingSince || '';
    var counting = !since || r.to >= since;
    var empty = !t.sessions && !t.leads;
    var partial = since && r.from < since;
    root.appendChild(h('p.tr-range-note',
      dayLabel(r.from) + ' to ' + dayLabel(r.to) +
      (r.previous ? ', compared with the ' + state.days + ' days before.' : partial ? '. Counting started ' + dayLabel(since) + '.' : '.')));

    if(empty && counting && !r.recent.length){
      /* First days: a page of zeros reads as "broken". Say what is happening and put the one
         useful action, making a link, right under it. */
      root.appendChild(h('section.tr-card.tr-welcome',
        h('h2.tr-h', 'Counting has started'),
        h('p.tr-sub', 'The site began counting visits on ' + dayLabel(since || r.to) + '. From now on every visit shows up here within seconds: how people found the site, what they looked at, and which of them sent you a form.'),
        h('p.tr-sub', 'Make a link below for your next flyer or post, and you will see exactly what it brings in.')));
      root.appendChild(links(r.links));
    } else {
      root.appendChild(tiles(t, r.previous));
      root.appendChild(card('Visits per day', null, chart(r.daily, since)));
      root.appendChild(whose(r.credit));
      root.appendChild(card('How people find you',
        'A family is counted under the way they FIRST found the site, even if they came back later another way.',
        ranked(r.channels, 'sessions', [['sessions', 'Visits'], ['leads', 'Leads'], ['enrolled', 'Paid']], 'No visits in this period yet.', channel)));
      root.appendChild(links(r.links));
      root.appendChild(card('Every lead and how they found you', null, leadsList(r.recent)));
      root.appendChild(h('details.field-group.tr-detail',
        h('summary', 'More detail', h('span.count', 'Sources, pages, devices')),
        h('div.group-body',
          h('h3.tr-h3', 'Where visits came from'), ranked(r.sources, 'sessions', [['sessions', 'Visits'], ['leads', 'Leads']], null, source),
          h('h3.tr-h3', 'First page people saw'), ranked(r.landing, 'sessions', [['sessions', 'Visits']], null, page),
          h('h3.tr-h3', 'Most viewed pages'), ranked(r.pages, 'views', [['views', 'Views']], null, page),
          h('h3.tr-h3', 'Other websites that sent people'), ranked(r.referrers, 'sessions', [['sessions', 'Visits']], 'No other websites yet.', source),
          h('h3.tr-h3', 'Devices'), ranked(r.devices, 'sessions', [['sessions', 'Visits']], null, function(d){ return DEVICE[d] || d; })
        )));
    }
    root.appendChild(h('p.tr-foot', 'Counted on the site’s own server: no Google Analytics, no cookies, and search engines and bots are left out. Your own visits from this device are not counted.'));
  }
})();
