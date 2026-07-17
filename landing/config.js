// Landing runtime config. Override API_BASE at deploy time (Vercel/Netlify env
// injection or a build step) to point the early-access form at the backend.
// Empty string keeps the form in local-only mode (localStorage), so the page
// still works when opened as a static file with no backend running.
window.LEONTIEF = window.LEONTIEF || {};
window.LEONTIEF.API_BASE = window.LEONTIEF.API_BASE || "http://localhost:8787";
