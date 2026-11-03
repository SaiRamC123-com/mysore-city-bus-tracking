import { Router } from "express";
import { getStatic, getPracticeStatic, getLiveBuses, getRecentEvents, findRoute } from "../services/dataService.js";
import { getTodaySchedule, tripsAround } from "../services/scheduleService.js";
import { orient } from "../utils/route.js";
import { ah, HttpError } from "../utils/http.js";

const r = Router();

// Live buses (the client normally reads these straight from Firebase; this is the polling fallback).
r.get("/buses", ah(async (req, res) => {
  const buses = await getLiveBuses({ routeNumber: req.query.route });
  res.json({ count: buses.length, buses });
}));

// Recent ARRIVED / DEPARTED / SKIPPED events, handy for debugging and for the demo.
r.get("/events", ah(async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  res.json({ events: await getRecentEvents({ limit, busId: req.query.busId }) });
}));

// Routes with geometry for the map.
r.get("/routes", ah(async (_req, res) => {
  const { routeList, metadata } = _req.query.practice === "true" ? await getPracticeStatic() : await getStatic();
  res.json({
    source: metadata?.source ?? (routeList.some((route) => route.demo) ? "practice-data" : null),
    sourceLabel: metadata?.sourceLabel ?? (routeList.some((route) => route.demo) ? "Practice Mode demo data" : "No imported route feed"),
    verified: metadata?.verified ?? false,
    serviceCalendarAvailable: metadata?.serviceCalendarAvailable ?? false,
    routes: routeList.map((rt) => ({
      id: rt.id,
      number: rt.number,
      name: rt.name,
      nameKn: rt.nameKn,
      demo: rt.demo,
      source: rt.source,
      verified: rt.verified,
      shapeApprox: rt.shapeApprox,
      serviceCalendarAvailable: rt.serviceCalendarAvailable,
      availableDirections: rt.availableDirections,
      polyline: rt.polyline,
      timetable: rt.timetable,
      stops: rt.stops.map((s) => ({ id: s.id, name: s.name, nameKn: s.nameKn, lat: s.lat, lng: s.lng, radiusM: s.radiusM })),
    })),
  });
}));
// One route in one direction with the scheduled time (minutes after the trip starts) of every stop.
// The "scheduled bus" page uses this to show where the timetable says the bus is, before any GPS exists.
r.get("/routes/:id/plan", ah(async (req, res) => {
  const route = await findRoute(req.params.id);
  if (!route) throw new HttpError(404, "Unknown route");
  const direction = Number(req.query.direction) === 1 ? 1 : 0;
  if (!route.availableDirections.includes(direction)) throw new HttpError(400, "That direction is not available for this route.");
  const o = orient(route, direction);
  const tripStartTs = req.query.tripStartTs == null ? null : Number(req.query.tripStartTs);
  const trip = tripStartTs != null && Number.isFinite(tripStartTs) && route.gtfsTrips?.length
    ? tripsAround(route, tripStartTs).find((candidate) => Math.abs(candidate.departTs - tripStartTs) < 1000)
    : null;
  if (route.gtfsTrips?.length && tripStartTs != null && !trip) {
    throw new HttpError(404, "The selected GTFS trip is not active for this service date.");
  }
  const stopTimes = new Map((trip?.stopTimes ?? []).map((item) => [item.stopId, item]));
  res.json({
    routeId: route.id,
    number: route.number,
    name: route.name,
    nameKn: route.nameKn,
    demo: route.demo,
    source: route.source,
    verified: route.verified,
    availableDirections: route.availableDirections,
    direction,
    towards: o.towards,
    towardsKn: o.towardsKn,
    headwayMin: route.timetable?.headwayMin ?? 20,
    stops: o.stops.map((s) => {
      const scheduled = stopTimes.get(s.id);
      return {
        id: s.id,
        name: s.name,
        nameKn: s.nameKn,
        lat: s.lat,
        lng: s.lng,
        offsetMin: scheduled ? (scheduled.arrivalTs - trip.departTs) / 60_000 : s.offsetMin,
        departOffsetMin: scheduled ? (scheduled.departureTs - trip.departTs) / 60_000 : s.departOffsetMin,
      };
    }),
  });
}));

r.get("/routes/:id/today", ah(async (req, res) => {
  const out = await getTodaySchedule(req.params.id);
  if (out.error) throw new HttpError(404, out.error);
  res.json(out);
}));

// Scheduled departures around now: the driver app uses this to pick the trip being driven.
r.get("/routes/:id/trips", ah(async (req, res) => {
  const route = await findRoute(req.params.id);
  if (!route) throw new HttpError(404, "Unknown route");
  const direction = Number(req.query.direction) === 1 ? 1 : 0;
  if (!route.availableDirections.includes(direction)) throw new HttpError(400, "That direction is not available for this route.");
  const now = Date.now();
  const o = orient(route, direction);
  const trips = tripsAround(route, now)
    .filter((t) => t.direction === direction && Math.abs(t.departTs - now) <= 90 * 60_000)
    .map((t) => ({ ...t, from: o.stops[0].name, towards: o.towards }));
  res.json({ trips });
}));

export default r;
