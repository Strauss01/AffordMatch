// Shared API client for the AffordMatch buyer / provider / admin dashboards.
// Configure the API base URL once here; everything else calls window.AM.api().
window.AM = (function () {
  const BASE_URL = window.AFFORDMATCH_API_BASE || "http://localhost:4000";
  const TOKEN_KEY = "affordmatch_token";
  const ROLE_KEY = "affordmatch_role";

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function getRole() { return localStorage.getItem(ROLE_KEY); }
  function setSession(token, role) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ROLE_KEY, role);
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
  }

  async function api(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(BASE_URL + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || (res.status + " " + res.statusText));
      err.status = res.status;
      err.details = data.details;
      throw err;
    }
    return data;
  }

  function money(n) {
    n = Math.round(Number(n) || 0);
    const neg = n < 0; n = Math.abs(n);
    const s = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (neg ? "-" : "") + "R " + s;
  }

  function requireAuth(expectedRole) {
    const token = getToken();
    const role = getRole();
    if (!token || (expectedRole && role !== expectedRole)) {
      window.location.href = "index.html";
      return false;
    }
    return true;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  return { api, money, getToken, getRole, setSession, clearSession, requireAuth, escapeHtml, BASE_URL };
})();
