// First-visit loader controller. A file (not inline) so it runs under the production CSP (script-src 'self').
(function () {
  var start = performance.now();
  try {
    if (location.pathname.indexOf('/exam/') === 0) return; // never delay a candidate reloading a running exam
    if (sessionStorage.getItem('ex_splash')) return; // later loads keep the small inline loader
    sessionStorage.setItem('ex_splash', '1');
  } catch (e) {}
  document.documentElement.classList.add('splash-on');
  window.__hideSplash = function () {
    var root = document.documentElement;
    if (!root.classList.contains('splash-on') || root.classList.contains('splash-out')) return;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var wait = Math.max(0, (reduce ? 500 : 1900) - (performance.now() - start));
    setTimeout(function () {
      root.classList.add('splash-done');
      setTimeout(function () {
        root.classList.add('splash-out');
        setTimeout(function () {
          var el = document.getElementById('splash');
          if (el) el.remove();
          root.classList.remove('splash-on', 'splash-out', 'splash-done');
        }, 800);
      }, 260);
    }, wait);
  };
  setTimeout(function () { window.__hideSplash && window.__hideSplash(); }, 6000); // safety net if the app never reports in
})();
