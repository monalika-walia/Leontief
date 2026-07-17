// Landing runtime config. Resolves the early-access API base:
//   1. an explicit window.LEONTIEF.API_BASE set before this script wins;
//   2. on GitHub Codespaces (<name>-<port>.app.github.dev) the API port (8787)
//      is derived from the page's own forwarded host automatically;
//   3. otherwise it falls back to localhost:8787.
// Empty string keeps the form in local-only mode (localStorage) so the page
// still works opened as a static file with no backend.
window.LEONTIEF = window.LEONTIEF || {};
(function () {
  if (window.LEONTIEF.API_BASE) return;
  var host = location.hostname;
  var m = host.match(/^(.*)-(\d+)\.app\.github\.dev$/);
  if (m) {
    window.LEONTIEF.API_BASE = location.protocol + "//" + m[1] + "-8787.app.github.dev";
  } else {
    window.LEONTIEF.API_BASE = "http://localhost:8787";
  }
})();
