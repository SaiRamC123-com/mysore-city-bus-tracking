import { getStatic, findRoute, getLiveBuses } from "./dataService.js";
import { orient } from "../utils/route.js";
import { dayStartTs, parseHHMM, fmtClock } from "../utils/time.js";
import { predictCrowd } from "./crowdService.js";

const calendarDate = (timestamp, timezone) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}${values.month}${values.day}`;
};

function serviceTimeToTimestamp(date, seconds, timezone) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const wallTime = Date.UTC(year, month - 1, day) + seconds * 1000;
  let timestamp = wallTime;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(timestamp);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
    const localAsUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
    timestamp += wallTime - localAsUtc;
  }
  return timestamp;
}

function isServiceActive(service, date) {
  if (!service) return false;
  if (Object.hasOwn(service.exceptions ?? {}, date)) return service.exceptions[date];
  if (!service.weekdays || date < service.startDate || date > service.endDate) return false;
  const weekday = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)))).getUTCDay();
  return service.weekdays[(weekday + 6) % 7] === true;
}

/** Every scheduled departure for the date containing timestamp, respecting GTFS calendars. */
export function tripsForDay(route, timestamp) {
  if (route.gtfsTrips?.length) {
    if (!route.serviceCalendarAvailable) return [];
    const date = calendarDate(timestamp, route.timezone);
    return route.gtfsTrips
      .filter((trip) => isServiceActive(trip.service, date))
      .map((trip) => {
        const stopTimes = trip.stopTimes.map((item) => ({
          ...item,
          arrivalTs: serviceTimeToTimestamp(date, item.arrivalSeconds, route.timezone),
          departureTs: serviceTimeToTimestamp(date, item.departureSeconds, route.timezone),
        }));
        return {
          routeId: route.id,
          direction: 0,
          departTs: stopTimes[0].departureTs,
          hhmm: fmtClock(stopTimes[0].departureTs),
          gtfs: true,
          tripId: trip.gtfsTripId ?? trip.id,
          stopTimes,
        };
      });
  }
  const tt = route.timetable;
  if (!tt) return [];
  const dayStart = dayStartTs(timestamp);
  const first = parseHHMM(tt.firstDeparture);
  const last = parseHHMM(tt.lastDeparture);
  const step = tt.headwayMin * 60_000;
  const out = [];
  for (let t = first; t <= last; t += step) {
    for (const direction of route.availableDirections) {
      out.push({ routeId: route.id, direction, departTs: dayStart + t, hhmm: fmtClock(dayStart + t) });
    }
  }
  return out;
}

export function tripsAround(route, timestamp) {
  if (!route.gtfsTrips?.length) return tripsForDay(route, timestamp);
  const serviceDate = calendarDate(timestamp, route.timezone);
  const dayStart = serviceTimeToTimestamp(serviceDate, 0, route.timezone);
  const previousServiceDate = tripsForDay(route, timestamp - 24 * 60 * 60_000)
    .filter((trip) => trip.stopTimes.at(-1)?.arrivalTs >= dayStart);
  const currentServiceDate = tripsForDay(route, timestamp);
  return [...previousServiceDate, ...currentServiceDate];
}

const liveMatch = (trip, live, headwayMin) =>
  live.find(
    (b) => b.routeId === trip.routeId && b.direction === trip.direction && Math.abs(b.tripStartTs - trip.departTs) <= (headwayMin * 60_000) / 2
  );

/** Today's trips for a route with a status for each: running / upcoming / past / not_tracked. */
export async function getTodaySchedule(routeQuery, now = Date.now()) {
  const route = await findRoute(routeQuery);
  if (!route) return { error: `No route matching "${routeQuery}"` };
  const live = await getLiveBuses({ routeId: route.id });
  const headway = route.timetable?.headwayMin ?? 20;

  const trips = tripsAround(route, now).map((t) => {
    const o = orient(route, t.direction);
    const base = { ...t, towards: o.towards, endTs: t.stopTimes?.at(-1)?.arrivalTs ?? t.departTs + o.runMin * 60_000 };
    const bus = liveMatch(t, live, headway);
    if (bus) return { ...base, status: "running", busId: bus.busId, delayMin: bus.delayMin };
    if (t.departTs > now) return { ...base, status: "upcoming" };
    if (base.endTs < now) return { ...base, status: "past" };
    return { ...base, status: "not_tracked" };
  });

  return {
    route: { id: route.id, number: route.number, name: route.name, demo: route.demo },
    timetable: route.timetable,
    trips,
  };
}

/** Upcoming buses at a stop: live (GPS-tracked) first-class, plus scheduled-only ones for the next 90 min. */
export async function arrivalsAtStop(stopId, limit = 5, now = Date.now()) {
  const { routeList } = await getStatic();
  const live = await getLiveBuses();
  const out = [];

  for (const b of live) {
    const ne = b.nextStops.find((s) => s.stopId === stopId);
    if (!ne) continue;
    out.push({
      kind: "live",
      busId: b.busId,
      routeId: b.routeId,
      routeNumber: b.routeNumber,
      routeName: b.routeName,
      towards: b.towards,
      direction: b.direction,
      scheduledTs: ne.scheduledTs,
      predictedTs: ne.predictedTs,
      etaMin: Math.max(0, Math.round((ne.predictedTs - now) / 60_000)),
      marginMin: ne.marginMin,
      delayMin: Math.round((ne.predictedTs - ne.scheduledTs) / 60_000),
      stopsAway: ne.stopsAway,
      atStop: ne.atStop,
      endsHere: ne.seq === b.nextStops[b.nextStops.length - 1]?.seq,
      crowdPct: b.occupancyPct,
      crowdLevel: b.crowdLevel,
      crowdSource: b.occupancySource,
      source: b.source,
    });
  }

  const sched = [];
  for (const route of routeList) {
    const headway = route.timetable?.headwayMin ?? 20;
    for (const direction of route.availableDirections) {
      const o = orient(route, direction);
      const idx = o.stops.findIndex((s) => s.id === stopId);
      if (idx < 0 || idx === o.stops.length - 1) continue;
      for (const t of tripsAround(route, now).filter((x) => x.direction === direction)) {
        const matchedTime = t.stopTimes?.find((item) => item.stopId === stopId);
        const arr = matchedTime?.arrivalTs ?? t.departTs + o.stops[idx].offsetMin * 60_000;
        if (arr < now - 60_000 || arr > now + 90 * 60_000) continue;
        if (liveMatch(t, live, headway)) continue; // that trip is already tracked live
        sched.push({ route, o, idx, arr, trip: t });
      }
    }
  }
  if (sched.length) {
    const crowd = await predictCrowd(sched.map((s) => ({ mlId: s.route.mlId, routeId: s.route.id, seq: s.idx, ts: s.arr })));
    sched.forEach((s, i) =>
      out.push({
        kind: "scheduled",
        routeId: s.route.id,
        routeNumber: s.route.number,
        routeName: s.route.name,
        towards: s.o.towards,
        direction: s.o.direction,
        scheduledTs: Math.round(s.arr),
        predictedTs: null,
        etaMin: Math.max(0, Math.round((s.arr - now) / 60_000)),
        crowdPct: crowd[i].pct,
        crowdLevel: crowd[i].level,
        crowdSource: "forecast",
        tripId: s.trip.gtfs ? s.trip.tripId : undefined,
        tripStartTs: s.trip.departTs,
        stopTimes: s.trip.stopTimes,
        serviceCalendarAvailable: s.route.serviceCalendarAvailable,
      })
    );
  }

  out.sort((a, b) => (a.predictedTs ?? a.scheduledTs) - (b.predictedTs ?? b.scheduledTs));
  return out.slice(0, limit);
}

/** Which routes (and directions) serve a stop. */
export async function routesAtStop(stopId) {
  const { routeList } = await getStatic();
  const out = [];
  for (const route of routeList) {
    for (const direction of route.availableDirections) {
      const o = orient(route, direction);
      const idx = o.stops.findIndex((s) => s.id === stopId);
      if (idx >= 0 && idx < o.stops.length - 1) {
        out.push({ number: route.number, name: route.name, towards: o.towards, direction, minutesFromStart: o.stops[idx].offsetMin });
      }
    }
  }
  return out;
}

export async function getRouteInfo(routeQuery) {
  const route = await findRoute(routeQuery);
  if (!route) return { error: `No route matching "${routeQuery}"` };
  const o = orient(route, 0);
  return {
    number: route.number,
    name: route.name,
    demo: route.demo,
    firstDeparture: route.timetable?.firstDeparture,
    lastDeparture: route.timetable?.lastDeparture,
    headwayMin: route.timetable?.headwayMin,
    runMinutes: Math.round(o.runMin),
    stops: o.stops.map((s) => ({ id: s.id, name: s.name, minutesFromStart: Math.round(s.offsetMin) })),
  };
}
