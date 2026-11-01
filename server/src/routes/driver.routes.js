import { Router } from "express";
import { z } from "zod";
import { processPing } from "../services/pingService.js";
import { driverAuth } from "../middleware/driverAuth.js";
import { pingLimiter } from "../middleware/rateLimit.js";
import { ah, HttpError } from "../utils/http.js";

const r = Router();

// Mysuru bounding box: rejects junk coordinates and keeps the app Mysuru-only.
const MYSURU = { latMin: 12.15, latMax: 12.5, lngMin: 76.45, lngMax: 76.85 };

const pingSchema = z.object({
  busId: z.string().regex(/^[A-Za-z0-9_-]{2,32}$/, "busId must be 2-32 letters, digits, - or _"),
  routeId: z.string().min(1),
  direction: z.union([z.literal(0), z.literal(1)]),
  tripStartTs: z.number().int().positive(),
  lat: z.number().min(MYSURU.latMin).max(MYSURU.latMax),
  lng: z.number().min(MYSURU.lngMin).max(MYSURU.lngMax),
  speedKmh: z.number().min(0).max(120).default(0),
  accuracyM: z.number().min(0).max(5000).default(10),
  occupancy: z.number().int().min(0).max(200).nullable().optional(),
  capacity: z.number().int().min(10).max(200).optional(),
  seatCapacity: z.number().int().min(10).max(200).optional(),
  standingPassengers: z.number().int().min(0).max(200).nullable().optional(),
  practice: z.boolean().optional(), // the driver page's "Practice mode": a pretend bus, stored as a demo bus
}).superRefine((data, ctx) => {
  if (data.seatCapacity != null && data.seatCapacity > (data.capacity ?? 60)) {
    ctx.addIssue({ code: "custom", path: ["seatCapacity"], message: "seatCapacity cannot exceed capacity" });
  }
  if (data.occupancy != null && data.occupancy > (data.capacity ?? 60)) {
    ctx.addIssue({ code: "custom", path: ["occupancy"], message: "occupancy cannot exceed capacity" });
  }
  if (data.standingPassengers != null && data.occupancy == null) {
    ctx.addIssue({ code: "custom", path: ["standingPassengers"], message: "occupancy is required when standingPassengers is provided" });
  }
  if (data.occupancy != null && data.standingPassengers != null && data.standingPassengers > data.occupancy) {
    ctx.addIssue({ code: "custom", path: ["standingPassengers"], message: "standingPassengers cannot exceed occupancy" });
  }
  if (
    data.occupancy != null &&
    data.seatCapacity != null &&
    data.standingPassengers != null &&
    data.occupancy - data.standingPassengers > data.seatCapacity
  ) {
    ctx.addIssue({ code: "custom", path: ["standingPassengers"], message: "standingPassengers is too low for the passenger count and seat capacity" });
  }
});

// POST /api/driver/ping : sent every ~4 s by the driver / conductor page.
r.post("/driver/ping", pingLimiter, driverAuth, ah(async (req, res) => {
  const parsed = pingSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  // The server clock is authoritative: we never trust a timestamp from the phone.
  const practice = parsed.data.practice === true;
  const out = await processPing({
    ...parsed.data,
    source: practice ? "simulator" : "driver", // simulator = labelled "Demo bus" everywhere, including the chatbot
    occupancySource: practice || parsed.data.occupancy == null ? undefined : "conductor",
  });
  res.json({ ok: true, ignored: out.ignored ?? null, status: out.status, nextStop: out.nextStopName, delayMin: out.delayMin });
}));

export default r;