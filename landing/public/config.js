// Landing runtime config. Resolves the early-access API base:
//   1. an explicit window.LEONTIEF.API_BASE set before this script wins;
//   2. on GitHub Codespaces (<name>-<port>.app.github.dev) the API port (8787)
//      is derived from the page's own forwarded host automatically;
//   3. localhost/127.0.0.1 → local API on :8787;
//   4. any other host (the deployed site) → the managed Render API.
// If the form's backend is unreachable, the modal falls back to localStorage so
// the page still works (no lost signups, no dead button).
window.LEONTIEF = window.LEONTIEF || {};
(function () {
  if (window.LEONTIEF.API_BASE) return;
  var host = location.hostname;
  var m = host.match(/^(.*)-(\d+)\.app\.github\.dev$/);
  if (m) {
    window.LEONTIEF.API_BASE = location.protocol + "//" + m[1] + "-8787.app.github.dev";
  } else if (host === "localhost" || host === "127.0.0.1") {
    window.LEONTIEF.API_BASE = "http://localhost:8787";
  } else {
    // Deployed: the Render web service from render.yaml (update if the URL differs).
    window.LEONTIEF.API_BASE = "https://leontief-api.onrender.com";
  }
})();
