import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http.js";

export function driverAuth(req, _res, next) {
  if (!env.driverSecret) return next(new HttpError(503, "Driver endpoint is disabled (DRIVER_SECRET not set)."));
  const given = Buffer.from(String(req.get("x-driver-secret") ?? ""));
  const want = Buffer.from(env.driverSecret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return next(new HttpError(401, "Wrong driver secret."));
  next();
}
