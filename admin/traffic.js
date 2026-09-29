/* The Traffic tab: how people find the site, which of them became leads, whose efforts brought
   them in, and the tracked-link maker. Reads and writes /api/admin-traffic.

   Its own file on purpose. admin.js already switches tabs generically (a .tab button shows the
   <main> named after it), so this only listens for its own button being pressed and renders
   into #tabTraffic. Everything a visitor typed reaches the page through textContent, never
   innerHTML: lead names and link notes are other people's words. */
(function(){
  var root = document.getElementById('tabTraffic');
  var tabBtn = document.querySelector('.tab[data-tab="traffic"]');
  if(!root || !tabBtn) return;

  /* This device belongs to whoever runs the panel. Its own visits to the site are not traffic;
     js/track.js reads this flag and counts nothing from here. */
  try { localStorage.setItem('fb_notrack', '1'); } catch(e){}

  var state = { days: 30, report: null, loading: false, error: '', dests: {}, made: null };

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

  var num = function(n){ return (Number(n) || 0).toLocaleString('en-US'); };
  var plural = function(n, one, many){ return n === 1 ? one : many; };
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
    });
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

  function copy(text, btn){
    function done(ok){
      var was = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Press and hold to copy';
      setTimeout(function(){ btn.textContent = was; }, 1600);
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
      h('button.btn.tr-refresh', { type: 'button', on: { click: load }, 'aria-label': 'Refresh' }, 'Refresh')
    );
  }

  function tiles(t){
    var list = [
      ['Visitors', num(t.visitors), t.newVisitors ? num(t.newVisitors) + ' new' : ''],
      ['Visits', num(t.sessions), t.sessions ? dur(t.avgEngagedMs) + ' on average' : ''],
      ['Pages viewed', num(t.pageviews), t.sessions ? (t.pageviews / t.sessions).toFixed(1) + ' per visit' : ''],
      ['Leads', num(t.leads), t.visitors ? pct(t.conversion) + ' of visitors' : ''],
      ['Registrations', num(t.registrations), num(t.enquiries) + ' enquiries'],
      ['Paid', num(t.enrolled), 'enrollments paid']
    ];
    return h('div.tr-tiles', list.map(function(x){
      return h('div.tr-tile', h('p.tr-tile-l', x[0]), h('p.tr-tile-n', x[1]), x[2] ? h('p.tr-tile-s', x[2]) : null);
    }));
  }

  function chart(daily){
    var max = 0;
    daily.forEach(function(d){ if(d.sessions > max) max = d.sessions; });
    var top = Math.max(4, Math.ceil(max / 4) * 4);
    var tip = h('div.tr-tip', { role: 'status', 'aria-live': 'polite' });
    var cols = daily.map(function(d){
      var col = h('div.tr-col',
        h('div.tr-bar', { style: 'height:' + (d.sessions ? Math.max(2, d.sessions / top * 100) : 0) + '%' }),
        d.leads ? h('span.tr-lead-dot', { 'aria-hidden': 'true' }) : null
      );
      function show(){
        tip.textContent = '';
        tip.appendChild(h('b', dayLabel(d.day, true)));
        tip.appendChild(h('span', num(d.sessions) + (d.sessions === 1 ? ' visit' : ' visits') + ', ' + num(d.visitors) + (d.visitors === 1 ? ' visitor' : ' visitors')));
        if(d.leads) tip.appendChild(h('span.tr-tip-lead', num(d.leads) + (d.leads === 1 ? ' lead' : ' leads')));
        var box = col.getBoundingClientRect(), wrap = plot.getBoundingClientRect();
        var x = box.left - wrap.left + box.width / 2;
        tip.style.left = Math.min(Math.max(x, 70), wrap.width - 70) + 'px';
        tip.classList.add('on');
        col.classList.add('hot');
      }
      function hide(){ tip.classList.remove('on'); col.classList.remove('hot'); }
      col.addEventListener('pointerenter', show);
      col.addEventListener('pointerleave', hide);
      return col;
    });
    var total = daily.reduce(function(s, d){ return s + d.sessions; }, 0);
    var plot = h('div.tr-plot', { role: 'img', 'aria-label': num(total) + ' visits over ' + daily.length + ' days, busiest day ' + num(max) + '.' },
      h('div.tr-grid', [1, 0.5, 0].map(function(f){ return h('span', { style: 'bottom:' + f * 100 + '%' }, h('em', num(top * f))); })),
      h('div.tr-cols', { style: 'gap:' + (daily.length > 40 ? 1 : 2) + 'px' }, cols),
      tip
    );
    var mid = daily[Math.floor(daily.length / 2)];
    var axis = h('div.tr-axis', h('span', dayLabel(daily[0].day)), h('span', dayLabel(mid.day)), h('span', dayLabel(daily[daily.length - 1].day)));
    var table = h('details.tr-more', h('summary', 'Show day by day'),
      h('table.tr-table', h('thead', h('tr', h('th', 'Day'), h('th', 'Visits'), h('th', 'Visitors'), h('th', 'Leads'))),
        h('tbody', daily.slice().reverse().map(function(d){
          return h('tr', h('td', dayLabel(d.day, true)), h('td', num(d.sessions)), h('td', num(d.visitors)), h('td', num(d.leads)));
        }))));
    return h('div', plot, axis,
      h('p.tr-key', h('span.tr-lead-dot.static', { 'aria-hidden': 'true' }), 'A dot marks a day a lead came in.'),
      table);
  }

  /* A ranked list with a bar behind each value: one hue, the length is the number. */
  function ranked(rows, field, cols, empty){
    if(!rows.length) return h('p.tr-empty', empty || 'Nothing yet.');
    var max = 0;
    rows.forEach(function(r){ if(r[field] > max) max = r[field]; });
    return h('div.tr-rank',
      h('div.tr-rank-row.head', h('span', ''), cols.map(function(c){ return h('span.n', c[1]); })),
      rows.map(function(r){
        return h('div.tr-rank-row',
          h('span.tr-rank-name', h('i', { style: 'width:' + (max ? r[field] / max * 100 : 0) + '%' }), h('b', r.name)),
          cols.map(function(c){ return h('span.n', num(r[c[0]])); })
        );
      })
    );
  }

  function whose(credit){
    function list(rows, cls){
      if(!rows.length) return null;
      return h('ul.tr-who-list', rows.map(function(r){
        return h('li', h('b', r.name), r.player ? ' (' + r.player + ')' : '', ' · ', r.typeLabel,
          r.paid ? h('span.tr-paid', 'paid') : null, h('span.tr-why ' + cls, r.credit.why));
      }));
    }
    var n = credit.link.length + credit.answer.length;
    return card('Whose efforts brought them',
      'Under the website agreement, a family counts as Josiah’s when they came through one of his links or answered “Google or online search”. Everything else is yours. Only paid registrations earn anyone anything.',
      h('div.tr-who',
        h('div.tr-who-n', h('p.tr-tile-n', num(n)), h('p.tr-tile-l', 'Josiah’s leads')),
        h('div.tr-who-n', h('p.tr-tile-n', num(credit.link.length)), h('p.tr-tile-l', 'through his links')),
        h('div.tr-who-n', h('p.tr-tile-n', num(credit.answer.length)), h('p.tr-tile-l', 'answered Google')),
        h('div.tr-who-n.warn', h('p.tr-tile-n', num(credit.search.length)), h('p.tr-tile-l', 'to talk over'))
      ),
      list(credit.link, 'link'),
      list(credit.answer, 'answer'),
      credit.search.length ? h('div',
        h('p.tr-note', 'These first found the site from a search engine but gave a different answer. Google hides what they searched for, so this cannot tell a search for “Fast Basketball” (yours) from one for “basketball training near me” (his). The agreement says you two talk it over; Search Console shows the search words.'),
        list(credit.search, 'search')) : null,
      !n && !credit.search.length ? h('p.tr-empty', 'No leads in this range were Josiah’s.') : null
    );
  }

  /* ---- the link maker */
  function linkMaker(links){
    var nameIn = h('input', { id: 'trName', type: 'text', maxLength: 60, placeholder: 'The Rivera family, or Spring flyer', autocomplete: 'off' });
    var destIn = h('select', { id: 'trDest' }, Object.keys(state.dests).map(function(k){ return h('option', { value: k }, state.dests[k]); }));
    var devIn = h('input', { id: 'trDev', type: 'checkbox' });
    var noteIn = h('input', { id: 'trNote', type: 'text', maxLength: 200, placeholder: 'Optional: where you met them, what you promised', autocomplete: 'off' });
    var err = h('p.tr-err', { role: 'alert' });
    var go = h('button.btn.primary', { type: 'submit' }, 'Make the link');
    var form = h('form.tr-form', { on: { submit: function(e){
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
      h('div.field', h('label', { htmlFor: 'trNote' }, 'Note'), noteIn),
      err, go
    );

    var made = state.made ? h('div.tr-made', { id: 'trMade' },
      h('p.tr-tile-l', state.made.developer ? 'Josiah’s link is ready' : 'Your link is ready'),
      h('p.link-out', state.made.url),
      state.made.developer ? h('p.tr-made-note', 'Blake has been emailed about this link, so he can revoke it if he did not agree to it.') : null,
      h('div.tr-made-btns',
        h('button.btn.primary', { type: 'button', on: { click: function(e){ copy(state.made.url, e.currentTarget); } } }, 'Copy link'),
        navigator.share ? h('button.btn', { type: 'button', on: { click: function(){
          navigator.share({ title: 'Fast Basketball', url: state.made.url }).catch(function(){});
        } } }, 'Share') : null
      )) : null;

    var list = links.length ? h('div.tr-links', links.map(linkRow)) : h('p.tr-empty', 'No links yet. Make one for a flyer, your Instagram bio, your Google Business Profile, or one family.');

    return card('Tracked links',
      'Every link you hand out can say where a family came from. Give one to a flyer, your Instagram bio or your Google Business Profile website button, and the numbers below split out by link.',
      form, made, h('h3.tr-h3', 'Your links'), list);
  }

  function linkRow(l){
    var revoked = !!l.revokedAt;
    var row = h('div.tr-link' + (revoked ? '.off' : ''),
      h('div.tr-link-top',
        h('b.tr-link-name', l.name),
        l.developer ? h('span.chip.tr-chip-dev', 'Josiah') : h('span.chip', 'FAST'),
        revoked ? h('span.chip.flag', 'Revoked') : null
      ),
      h('p.tr-link-meta', (l.destLabel || l.dest) + ' · made ' + ago(l.createdAt) + (l.note ? ' · ' + l.note : '')),
      h('p.tr-link-stats', h('span', h('b', num(l.sessions)), plural(l.sessions, ' visit', ' visits')), h('span', h('b', num(l.leads)), plural(l.leads, ' lead', ' leads')), h('span', h('b', num(l.enrolled)), ' paid')),
      h('p.link-out', l.url),
      h('div.tr-link-btns',
        h('button.btn', { type: 'button', on: { click: function(e){ copy(l.url, e.currentTarget); } } }, 'Copy'),
        !revoked ? h('button.btn.tr-revoke', { type: 'button', on: { click: function(e){
          var b = e.currentTarget;
          if(b.dataset.armed !== '1'){
            b.dataset.armed = '1'; b.textContent = 'Tap again to revoke';
            setTimeout(function(){ if(b.isConnected){ b.dataset.armed = ''; b.textContent = 'Revoke'; } }, 4000);
            return;
          }
          b.disabled = true;
          api('POST', { action: 'revoke', id: l.id }).then(function(out){
            l.revokedAt = out.link.revokedAt; render();
          }).catch(function(e2){ b.disabled = false; b.textContent = e2.message; });
        } } }, 'Revoke') : null
      ),
      revoked && l.developer ? h('p.tr-note', 'New families through this link are no longer counted as Josiah’s. Families who came through it before it was revoked still are.') : null
    );
    return row;
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
    if(!rows.length) return h('p.tr-empty', 'No leads in this range yet.');
    return h('div', rows.map(function(r){
      var chipCls = r.type === 'enrollment' ? 'enrollment' : r.type === 'contact' ? 'contact' : r.type === 'playbook' ? 'playbook' : '';
      var whoCls = { link: 'link', answer: 'answer', search: 'search' }[r.credit.who] || '';
      return h('article.lead.tr-lead',
        h('div.lead-top', h('span.chip ' + chipCls, r.typeLabel), r.paid ? h('span.chip.tr-chip-paid', 'Paid') : null, h('span.lead-when', ago(r.at))),
        h('p.lead-name', r.name),
        h('p.lead-meta', h('b', 'Found the site: '), r.channel === 'Unknown' ? 'before tracking started' : r.channel + (r.source && r.source !== '(direct)' ? ', ' + r.source : '') + (r.landing ? ', landing on ' + r.landing : '')),
        r.hearAbout ? h('p.lead-meta', h('b', 'Told us: '), r.hearAbout) : null,
        h('p.tr-why ' + whoCls, verdict(r.credit))
      );
    }));
  }

  /* ---- the tab */
  function render(){
    root.textContent = '';
    root.appendChild(rangeBar());
    if(state.error){ root.appendChild(h('p.error', { role: 'alert' }, state.error)); }
    var r = state.report;
    if(!r){
      root.appendChild(h('p.tr-empty', state.loading ? 'Loading traffic...' : ''));
      return;
    }
    root.classList.toggle('tr-busy', state.loading);
    var t = r.totals;
    root.appendChild(h('p.tr-range-note', dayLabel(r.from) + ' to ' + dayLabel(r.to) + '. Your own visits from this device are not counted.'));
    root.appendChild(tiles(t));
    root.appendChild(card('Visits per day', null, chart(r.daily)));
    root.appendChild(whose(r.credit));
    root.appendChild(card('How people find you',
      'Leads are credited to how that family FIRST found the site, even if they came back later another way.',
      ranked(r.channels, 'sessions', [['sessions', 'Visits'], ['leads', 'Leads'], ['enrolled', 'Paid']], 'No visits in this range yet.')));
    root.appendChild(linkMaker(r.links));
    root.appendChild(card('Every lead and how they found you', null, leadsList(r.recent)));
    root.appendChild(h('details.field-group.tr-detail',
      h('summary', 'More detail', h('span.count', 'sources, pages, devices')),
      h('div.group-body',
        h('h3.tr-h3', 'Top sources'), ranked(r.sources, 'sessions', [['sessions', 'Visits'], ['leads', 'Leads']]),
        h('h3.tr-h3', 'Where visits start'), ranked(r.landing, 'sessions', [['sessions', 'Visits']]),
        h('h3.tr-h3', 'Most viewed pages'), ranked(r.pages, 'views', [['views', 'Views']]),
        h('h3.tr-h3', 'Other sites that sent people'), ranked(r.referrers, 'sessions', [['sessions', 'Visits']], 'No other sites yet.'),
        h('h3.tr-h3', 'Devices'), ranked(r.devices, 'sessions', [['sessions', 'Visits']])
      )));
    root.appendChild(h('p.tr-foot', 'Counted on this site’s own server: no Google Analytics script, no cookies, and search engines and bots are left out. A visitor who blocks scripts is not counted.'));
  }
})();
