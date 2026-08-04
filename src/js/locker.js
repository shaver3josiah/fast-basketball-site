(function(){
  'use strict';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =====================================================
     MIAMI NIGHTS — night shot scene
     ===================================================== */
  var stage = document.getElementById('niteStage');
  if(stage){
    var makesEl = document.getElementById('niteMakesCount');
    var idleBall = document.getElementById('niteIdleBall');
    var board = stage.querySelector('.board');
    var rim = stage.querySelector('.rim');
    var net = stage.querySelector('.net');
    var flash = document.getElementById('niteSwishFlash');
    var copyBlock = stage.querySelector('.nite-copy');
    var shotBtn = document.getElementById('niteShotBtn');
    var shooting = false;

    function getMakes(){
      var n = parseInt(localStorage.getItem('fb_makes'), 10);
      return isNaN(n) ? 0 : n;
    }
    function logMake(){
      var n = getMakes() + 1;
      try { localStorage.setItem('fb_makes', String(n)); } catch(e){}
      if(makesEl) makesEl.textContent = n;
    }
    function setSwish(on){
      if(board) board.classList.toggle('hit', on);
      if(rim) rim.classList.toggle('hit', on);
      if(net) net.classList.toggle('sway', on);
      if(flash) flash.classList.toggle('on', on);
    }
    function spawnBalls(){
      var delays = [0, 70, 140], opacities = [1, .26, .12], balls = [];
      for(var i = 0; i < delays.length; i++){
        var b = document.createElement('span');
        b.className = 'nball';
        b.style.animationDelay = delays[i] + 'ms';
        b.style.opacity = opacities[i];
        b.setAttribute('aria-hidden', 'true');
        b.innerHTML = '<i></i>';
        stage.appendChild(b);
        balls.push(b);
      }
      return balls;
    }
    function shoot(){
      if(shooting) return;
      if(reduced){
        logMake();
        setSwish(true);
        setTimeout(function(){ setSwish(false); }, 900);
        return;
      }
      shooting = true;
      if(idleBall) idleBall.style.display = 'none';
      var balls = spawnBalls();
      setTimeout(function(){ setSwish(true); logMake(); }, 1050);
      setTimeout(function(){
        setSwish(false);
        shooting = false;
        balls.forEach(function(b){ if(b.parentNode) b.parentNode.removeChild(b); });
        if(idleBall) idleBall.style.display = '';
      }, 1950);
    }

    if(makesEl) makesEl.textContent = getMakes();
    stage.addEventListener('click', shoot);
    if(copyBlock) copyBlock.addEventListener('click', function(e){ e.stopPropagation(); });
    if(shotBtn) shotBtn.addEventListener('click', function(e){ e.stopPropagation(); shoot(); });
  }

  /* =====================================================
     THE LOCKER — resource cards + email unlock + downloads
     ===================================================== */
  var resSection = document.getElementById('resources');
  if(!resSection) return;

  var cards = Array.prototype.slice.call(resSection.querySelectorAll('.res-c'));
  var noteEl = document.getElementById('lockerNote');
  var overlay = document.getElementById('lockerOverlay');
  var modal = document.getElementById('lockerModal');
  var closeBtn = document.getElementById('lockerModalClose');
  var loginForm = document.getElementById('lockerLoginForm');
  var emailInput = document.getElementById('lockerEmail');
  var userEmailEl = document.getElementById('lockerUserEmail');
  var logoutBtn = document.getElementById('lockerLogoutBtn');
  var gotoBtn = document.getElementById('lockerGotoBtn');
  var loginLink = document.getElementById('lockerLoginLink');

  var pendingDownloadCard = null;
  var lastFocused = null;

  function getLockerEmail(){
    try { return localStorage.getItem('fb_locker_email') || ''; } catch(e){ return ''; }
  }
  function setLockerEmail(email){
    try { localStorage.setItem('fb_locker_email', email); } catch(e){}
  }
  function clearLockerEmail(){
    try { localStorage.removeItem('fb_locker_email'); } catch(e){}
  }

  function refreshCard(card, unlocked){
    if(card.dataset.comingsoon === 'true') return;
    var locked = card.dataset.locked === 'true';
    var open = !locked || unlocked;
    card.classList.toggle('openres', open);
    var top = card.querySelector('.res-top');
    var chip = top.querySelector('.res-lock, .res-open');
    var btn = card.querySelector('.res-get');
    if(open){
      chip.outerHTML = '<span class="res-open">Unlocked</span>';
      btn.textContent = 'Download';
      btn.dataset.action = 'download';
    } else {
      chip.outerHTML = '<span class="res-lock"><i class="lk"></i>Locked</span>';
      btn.textContent = 'Unlock with email';
      btn.dataset.action = 'unlock';
    }
  }

  function refreshAllCards(unlocked){
    cards.forEach(function(c){ refreshCard(c, unlocked); });
    if(noteEl) noteEl.hidden = !!unlocked;
  }

  function showPanel(name){
    modal.querySelectorAll('[data-panel]').forEach(function(p){
      p.hidden = p.getAttribute('data-panel') !== name;
    });
  }

  function openModal(){
    lastFocused = document.activeElement;
    var email = getLockerEmail();
    if(email){
      if(userEmailEl) userEmailEl.textContent = email;
      showPanel('in');
    } else {
      showPanel('form');
      if(loginForm) loginForm.reset();
    }
    overlay.hidden = false;
    if(closeBtn) closeBtn.focus();
    document.addEventListener('keydown', onKeydown);
  }
  function closeModal(){
    overlay.hidden = true;
    pendingDownloadCard = null;
    document.removeEventListener('keydown', onKeydown);
    if(lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }
  function onKeydown(e){
    if(e.key === 'Escape') closeModal();
  }

  if(closeBtn) closeBtn.addEventListener('click', closeModal);
  if(overlay) overlay.addEventListener('click', function(e){
    if(e.target === overlay) closeModal();
  });
  if(loginLink) loginLink.addEventListener('click', function(e){
    e.preventDefault();
    pendingDownloadCard = null;
    openModal();
  });
  if(gotoBtn) gotoBtn.addEventListener('click', closeModal);
  if(logoutBtn) logoutBtn.addEventListener('click', function(){
    clearLockerEmail();
    refreshAllCards(false);
    showPanel('form');
    if(window.fbToast) window.fbToast('Logged out on this device');
  });

  function requestPlaybook(opts){
    return fetch('/playbook/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: opts.name || 'Player',
        email: opts.email,
        grade: opts.grade || '',
        position: opts.position || '',
        focus: opts.focus || '',
        referrer: document.referrer || window.location.href
      })
    }).then(function(res){
      return res.json().then(function(data){ return { ok: res.ok, data: data }; });
    });
  }

  function triggerDownload(html, title){
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    var a = document.createElement('a');
    a.href = url;
    a.download = 'fast-basketball-' + slug + '.html';
    document.body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  }

  function downloadResource(card){
    var email = getLockerEmail();
    if(!email){
      pendingDownloadCard = card;
      openModal();
      return;
    }
    var btn = card.querySelector('.res-get');
    var title = card.querySelector('h3').textContent;
    var prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending...';
    requestPlaybook({
      email: email,
      position: card.dataset.position,
      focus: card.dataset.focus
    }).then(function(result){
      if(!result.ok || !result.data || !result.data.html) throw new Error('generation failed');
      triggerDownload(result.data.html, title);
      if(window.fbToast) window.fbToast(result.data.emailSent ? 'Sent to your inbox — ' + title : title + ' downloaded');
    }).catch(function(){
      if(window.fbToast) window.fbToast('Something went wrong, try again in a moment');
    }).finally(function(){
      btn.disabled = false;
      btn.textContent = prevText;
    });
  }

  resSection.querySelector('.res').addEventListener('click', function(e){
    var btn = e.target.closest('.res-get');
    if(!btn || btn.disabled) return;
    var card = btn.closest('.res-c');
    if(btn.dataset.action === 'unlock'){
      pendingDownloadCard = null;
      openModal();
    } else {
      downloadResource(card);
    }
  });

  if(loginForm){
    loginForm.addEventListener('submit', function(e){
      e.preventDefault();
      var email = emailInput.value.trim();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
        if(window.fbToast) window.fbToast('Add a valid email');
        return;
      }
      var submitBtn = loginForm.querySelector('button[type="submit"]');
      var prevText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Unlocking...';
      requestPlaybook({ email: email }).then(function(result){
        if(!result.ok) throw new Error('login failed');
        showPanel('sent');
        setTimeout(function(){
          setLockerEmail(email);
          if(userEmailEl) userEmailEl.textContent = email;
          showPanel('in');
          refreshAllCards(true);
          if(window.fbToast) window.fbToast('Locker unlocked');
          if(pendingDownloadCard){
            var card = pendingDownloadCard;
            pendingDownloadCard = null;
            downloadResource(card);
          }
        }, 900);
      }).catch(function(){
        if(window.fbToast) window.fbToast('Something went wrong, try again in a moment');
      }).finally(function(){
        submitBtn.disabled = false;
        submitBtn.textContent = prevText;
      });
    });
  }

  refreshAllCards(!!getLockerEmail());
})();
