// Thin wrapper over fetch for the Node server (no extra dependency).
const BASE = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

async function request(path, { method = "GET", body, headers } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Is it running on " + BASE + "?");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const q = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ""));
  return s.toString() ? `?${s}` : "";
};

// Routes and stops almost never change, so cache them for the session.
let routesCache;
let stopsCache;

export const api = {
  health: () => request("/health"),
  routes: () => (routesCache ??= request("/routes").catch((e) => ((routesCache = undefined), Promise.reject(e)))),
  stops: () => (stopsCache ??= request("/stops").catch((e) => ((stopsCache = undefined), Promise.reject(e)))),
  buses: (route) => request(`/buses${q({ route })}`),
  events: (busId, limit = 50) => request(`/events${q({ busId, limit })}`),
  arrivals: (stopId, limit = 6) => request(`/stops/${encodeURIComponent(stopId)}/arrivals${q({ limit })}`),
  forecast: (stopId) => request(`/stops/${encodeURIComponent(stopId)}/forecast`),
  today: (routeId) => request(`/routes/${encodeURIComponent(routeId)}/today`),
  trips: (routeId, direction) => request(`/routes/${encodeURIComponent(routeId)}/trips${q({ direction })}`),
    routePlan: (routeId, direction) => request(`/routes/${encodeURIComponent(routeId)}/plan${q({ direction })}`),
  recommend: (from, to) => request(`/recommend${q({ from, to })}`),
  chat: (payload) => request("/chat", { method: "POST", body: payload }),
  ping: (secret, payload) =>
    request("/driver/ping", { method: "POST", body: payload, headers: { "x-driver-secret": secret } }),
};