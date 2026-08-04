(function(){
  'use strict';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Intro: the lockup build is pure CSS (.alogo choreography in base.css).
     JS only owns dismissal — timeout, Skip, Escape, reduced-motion. */
  var intro = document.getElementById('intro');
  function endIntro(){
    if(!intro || intro.dataset.done) return;
    intro.dataset.done = '1';
    intro.classList.add('done');
    document.body.classList.remove('intro-locked');
    setTimeout(function(){ if(intro.parentNode) intro.parentNode.removeChild(intro); }, 700);
  }
  if(intro){
    if(reduced){ endIntro(); } else { setTimeout(endIntro, 3100); }
    var skip = document.getElementById('skipIntro');
    if(skip) skip.addEventListener('click', endIntro);
  }

  var nav = document.getElementById('nav');
  var navLinks = document.getElementById('navLinks');
  var navToggle = document.getElementById('navToggle');
  function closeMenu(){
    if(!navLinks || !navToggle) return;
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  }
  if(nav && navLinks && navToggle){
    window.addEventListener('scroll', function(){
      nav.classList.toggle('stuck', window.scrollY > 40);
    }, {passive:true});
    navToggle.addEventListener('click', function(){
      var open = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
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

  /* Scoreboard counters: staggered 160ms in document order, stamp on land. */
  var counters = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));
  var cio = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(!en.isIntersecting) return;
      var el = en.target, target = parseInt(el.dataset.count, 10);
      cio.unobserve(el);
      if(reduced){ el.textContent = target; return; }
      var delay = counters.indexOf(el) * 160, start = null, dur = 1400;
      function step(ts){
        if(!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.floor(eased * target);
        if(p < 1){ requestAnimationFrame(step); }
        else { el.classList.add('stamp'); }
      }
      setTimeout(function(){ requestAnimationFrame(step); }, delay);
    });
  }, {threshold:0.4});
  counters.forEach(function(el){ cio.observe(el); });

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
