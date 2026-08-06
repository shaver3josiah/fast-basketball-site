(function(){
  'use strict';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Intro: the lockup build is pure CSS (.alogo choreography in base.css).
     JS only owns dismissal — timeout, Skip, Escape, reduced-motion, and
     sessionStorage so it plays once per browser session, not every load. */
  var intro = document.getElementById('intro');
  var introSeen = false;
  try { introSeen = sessionStorage.getItem('fb_intro_seen') === '1'; } catch(e){}
  function endIntro(){
    if(!intro || intro.dataset.done) return;
    intro.dataset.done = '1';
    intro.classList.add('done');
    document.body.classList.remove('intro-locked');
    try { sessionStorage.setItem('fb_intro_seen', '1'); } catch(e){}
    setTimeout(function(){ intro.style.display = 'none'; }, 700); /* kept in the DOM for the swish replay */
  }
  if(intro){
    var introMs = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t-intro')) || 2.5) * 1000;
    if(reduced || introSeen){ endIntro(); } else { setTimeout(endIntro, introMs); }
    var skip = document.getElementById('skipIntro');
    if(skip) skip.addEventListener('click', endIntro);
  }

  /* Slingshot make (js/night-court.js) -> quick 1.25s lockup cut -> contact card. */
  window.fbNiteMade = function(){
    var dest = function(){
      var t = document.querySelector('#contact');
      if(t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 90, behavior: 'auto' });
      else location.hash = '#contact';
    };
    if(reduced || !intro || !document.body.contains(intro)){ setTimeout(dest, 900); return; }
    setTimeout(function(){
      intro.style.display = '';
      delete intro.dataset.done;
      intro.classList.remove('done');
      var mark = intro.querySelector('.alogo');
      if(mark){ mark.classList.remove('play'); void mark.offsetWidth; mark.classList.add('play'); }
      document.body.classList.add('intro-locked');
      setTimeout(function(){
        dest();
        intro.classList.add('done');
        document.body.classList.remove('intro-locked');
        setTimeout(function(){ intro.classList.remove('done'); intro.dataset.done = '1'; intro.style.display = 'none'; }, 700);
      }, 1250);
    }, 1000);
  };

  /* Double-click the nav brand to replay the full intro. */
  var brandEl = document.querySelector('.nav .brand');
  if(brandEl && intro){
    brandEl.setAttribute('title', 'Double-click to replay the intro');
    brandEl.addEventListener('dblclick', function(e){
      e.preventDefault();
      if(reduced) return;
      intro.style.display = '';
      delete intro.dataset.done;
      intro.classList.remove('done');
      var mk = intro.querySelector('.alogo');
      if(mk){ mk.classList.remove('play'); void mk.offsetWidth; mk.classList.add('play'); }
      document.body.classList.add('intro-locked');
      setTimeout(function(){
        intro.classList.add('done');
        document.body.classList.remove('intro-locked');
        setTimeout(function(){ intro.classList.remove('done'); intro.dataset.done = '1'; intro.style.display = 'none'; }, 700);
      }, introMs);
    });
  }

  var nav = document.getElementById('nav');
  var navLinks = document.getElementById('navLinks');
  var navToggle = document.getElementById('navToggle');
  function closeMenu(){
    if(!navLinks || !navToggle) return;
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open menu');
    document.body.style.overflow = '';
  }
  if(nav && navLinks && navToggle){
    window.addEventListener('scroll', function(){
      nav.classList.toggle('stuck', window.scrollY > 40);
    }, {passive:true});
    navToggle.addEventListener('click', function(){
      var open = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      document.body.style.overflow = open ? 'hidden' : '';
      if(open){
        var firstLink = navLinks.querySelector('a');
        if(firstLink) firstLink.focus();
      }
    });
    navLinks.addEventListener('click', function(e){
      if(e.target.tagName === 'A'){ closeMenu(); }
    });
  }

  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    endIntro();
    closeMenu();
  });

  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, {threshold:0.14, rootMargin:'0px 0px -60px 0px'});
  document.querySelectorAll('.zr, .rise').forEach(function(el){ io.observe(el); });
  /* Safety net: if the observer never fires (blocked API, odd layout), force reveal anyway. */
  setTimeout(function(){
    document.querySelectorAll('.zr:not(.in), .rise:not(.in)').forEach(function(el){ el.classList.add('in'); });
  }, 3000);

  /* Scoreboard counters: DOM ships the real resting number (works with no JS /
     reduced motion). On intersect we read that number, drop to 0, then count
     back up — staggered 160ms in document order, stamp on land. */
  var counters = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));
  var cio = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(!en.isIntersecting) return;
      var el = en.target;
      var target = parseInt(el.textContent, 10);
      if(isNaN(target)) target = parseInt(el.dataset.count, 10) || 0;
      cio.unobserve(el);
      if(reduced) return;
      el.textContent = '0';
      var delay = counters.indexOf(el) * 160, start = null, dur = 1400;
      function step(ts){
        if(!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.floor(eased * target);
        if(p < 1){ requestAnimationFrame(step); }
        else { el.textContent = target; el.classList.add('stamp'); }
      }
      setTimeout(function(){ requestAnimationFrame(step); }, delay);
    });
  }, {threshold:0.4});
  counters.forEach(function(el){ cio.observe(el); });

  /* Active nav state: mark the nav link whose path matches the current page.
     Nav links are same-page section anchors (e.g. /#coach) everywhere on this
     site, so a link carrying a hash is a homepage jump, not a distinct page —
     skip those rather than falsely marking every link "current". Script is
     `defer`, so the DOM is already parsed here (same timing DOMContentLoaded gives). */
  var here = location.pathname.replace(/\/+$/, '') || '/';
  document.querySelectorAll('.nav-links a[href]').forEach(function(a){
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch(e){ return; }
    if(url.hash) return;
    var linkPath = url.pathname.replace(/\/+$/, '') || '/';
    if(linkPath === here) a.setAttribute('aria-current', 'page');
  });

  document.querySelectorAll('.faq-q').forEach(function(btn, idx){
    var ans = btn.nextElementSibling;
    if(ans && !ans.id) ans.id = 'faqA' + idx;
    btn.setAttribute('aria-expanded', 'false');
    if(ans) btn.setAttribute('aria-controls', ans.id);
    btn.addEventListener('click', function(){
      var item = btn.parentElement;
      var wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-i').forEach(function(i){
        i.classList.remove('open');
        var q = i.querySelector('.faq-q');
        if(q) q.setAttribute('aria-expanded', 'false');
      });
      if(!wasOpen){
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* Sticky mobile CTA bar: hidden over the hero, the contact band and the footer. */
  var mobBar = document.getElementById('mobBar');
  if(mobBar){
    var barState = {hero:true, contact:false, foot:false};
    function setBar(){ mobBar.classList.toggle('on', !barState.hero && !barState.contact && !barState.foot); }
    function watch(el, key){
      if(!el) return;
      new IntersectionObserver(function(entries){
        barState[key] = entries[0].isIntersecting;
        setBar();
      }, {threshold:0.05}).observe(el);
    }
    watch(document.getElementById('home'), 'hero');
    watch(document.getElementById('contact'), 'contact');
    watch(document.querySelector('.ft'), 'foot');
    setBar();
  }

  var toast = document.getElementById('toast');
  window.fbToast = function(msg){
    if(!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(function(){ toast.classList.remove('show'); }, 2400);
  };
})();
