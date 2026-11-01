import { env } from "../config/env.js";

let downUntil = 0;

/**
 * POST to the Python ML service. Throws if it is unreachable.
 * After a failure we skip the service for 30 s so one dead ML process can't slow every request.
 */
export async function mlPost(path, body, timeoutMs = 1500) {
  if (!env.mlUrl) throw new Error("ML_SERVICE_URL is not configured");
  if (Date.now() < downUntil) throw new Error("ML service temporarily skipped");
  try {
    const res = await fetch(`${env.mlUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ML ${path} returned ${res.status}`);
    return await res.json();
  } catch (e) {
    downUntil = Date.now() + 30_000;
    throw e;
  }
}

export async function mlHealth() {
  if (!env.mlUrl) return { ok: false, configured: false };
  try {
    const res = await fetch(`${env.mlUrl}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok ? await res.json() : { ok: false };
  } catch {
    return { ok: false };
  }
}
