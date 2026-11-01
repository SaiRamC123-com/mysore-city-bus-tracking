import { Router } from "express";
import { getStatic, findStop } from "../services/dataService.js";
import { arrivalsAtStop } from "../services/scheduleService.js";
import { forecastDay } from "../services/crowdService.js";
import { orient } from "../utils/route.js";
import { ah, HttpError } from "../utils/http.js";
import { dayStartTs } from "../utils/time.js";

const r = Router();

r.get("/stops", ah(async (_req, res) => {
  const { stops } = await getStatic();
  res.json({ stops: Object.values(stops).map(({ id, name, nameKn, aliases, lat, lng, radiusM, verified }) => ({ id, name, nameKn, aliases: aliases || [], lat, lng, radiusM, verified })) });
}));

async function stopOr404(idOrName) {
  const { stop } = await findStop(idOrName);
  if (!stop) throw new HttpError(404, "Unknown stop");
  return stop;
}

// Scheduled / predicted arrival times of the next buses at a stop.
r.get("/stops/:id/arrivals", ah(async (req, res) => {
  const stop = await stopOr404(req.params.id);
  const limit = Math.min(12, Number(req.query.limit) || 6);
  res.json({ stop: { id: stop.id, name: stop.name, nameKn: stop.nameKn }, now: Date.now(), arrivals: await arrivalsAtStop(stop.id, limit) });
}));

// "When is this stop busy?" hourly crowd forecast for every route serving the stop.
r.get("/stops/:id/forecast", ah(async (req, res) => {
  const stop = await stopOr404(req.params.id);
  const { routeList } = await getStatic();
  const dayStart = dayStartTs(Date.now());
  const series = [];
  for (const route of routeList) {
    for (const direction of [0, 1]) {
      const o = orient(route, direction);
      const idx = o.stops.findIndex((s) => s.id === stop.id);
      if (idx < 0 || idx === o.stops.length - 1) continue;
      const f = await forecastDay(o, idx, dayStart);
      series.push({ routeNumber: route.number, towards: o.towards, direction, hours: f.hours, values: f.values, source: f.source, modelData: f.modelData });
    }
  }
  res.json({ stop: { id: stop.id, name: stop.name }, series });
}));

export default r;
