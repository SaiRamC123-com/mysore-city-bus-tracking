import rateLimit from "express-rate-limit";

const make = (windowMs, limit, message) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: message } });

export const apiLimiter = make(60_000, 240, "Too many requests, slow down.");
// Each chat message costs Groq quota, so keep this tight.
export const chatLimiter = make(60_000, 15, "You're sending messages too fast. Try again in a minute.");
// A driver app pings every ~4 s (15/min); leave room for several buses behind one network.
export const pingLimiter = make(60_000, 300, "Too many location updates.");
