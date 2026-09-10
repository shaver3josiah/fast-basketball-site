(function(){
  /* Light by default (owner's call, 9 September 2026); a stored choice always wins.
     render.mjs ships fb-light in the markup so a page with JavaScript off is light too,
     which is why this removes the class for dark rather than adding it for light. */
  var t = 'light';
  try { t = localStorage.getItem('fb_theme') || 'light'; } catch(e) {}
  if(t === 'dark') document.documentElement.classList.remove('fb-light');
  function ready(fn){ if(document.readyState === 'loading') addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){
    var b = document.getElementById('themeBtn');
    if(!b) return;
    function paint(){
      var on = document.documentElement.classList.contains('fb-light');
      b.setAttribute('aria-label', on ? 'Switch to dark mode' : 'Switch to light mode');
    }
    b.addEventListener('click', function(){
      var on = document.documentElement.classList.toggle('fb-light');
      try { localStorage.setItem('fb_theme', on ? 'light' : 'dark'); } catch(e) {}
      paint();
    });
    paint();
  });
})();
