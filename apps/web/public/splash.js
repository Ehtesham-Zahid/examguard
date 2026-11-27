// Landing-page splash controller. A file (not inline) so it runs under the production CSP (script-src 'self').
// The full-screen splash shows whenever the landing page ("/") is loaded; every other page keeps the app's
// small, fast loader (sign-in, dashboards, settings, exams…).
(function () {
  var start = performance.now();
  if (location.pathname !== '/') return;
  document.documentElement.classList.add('splash-on');
  window.__hideSplash = function () {
    var root = document.documentElement;
    if (!root.classList.contains('splash-on') || root.classList.contains('splash-out')) return;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var wait = Math.max(0, (reduce ? 600 : 4400) - (performance.now() - start));
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
  setTimeout(function () { window.__hideSplash && window.__hideSplash(); }, 9000); // safety net if the app never reports in
})();
