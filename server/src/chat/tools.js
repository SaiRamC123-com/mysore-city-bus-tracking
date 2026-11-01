import { findStop, getLiveBuses } from "../services/dataService.js";
import { arrivalsAtStop, getRouteInfo, getTodaySchedule, routesAtStop } from "../services/scheduleService.js";
import { recommend } from "../services/recommendService.js";
import { fmtClock } from "../utils/time.js";

// Tool definitions the model can call. Names/arguments here must match runTool() below.
export const tools = [
  {
    type: "function",
    function: {
      name: "get_live_buses",
      description: "Live GPS-tracked buses right now: position status, next stop, delay, crowd level. Optionally filter by route number.",
      // Optional values accept null too: some models send null for "no filter", and Groq rejects the call otherwise.
      parameters: { type: "object", properties: { route_number: { type: ["string", "null"], description: "e.g. 201. Leave out or null for all routes." } } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_next_buses",
      description: "Upcoming buses at a stop with scheduled time, predicted time (+/- margin) and crowd level.",
      parameters: {
        type: "object",
        properties: {
          stop_name: { type: "string", description: "Stop name in English or Kannada, e.g. 'Zoo'" },
          limit: { type: ["integer", "null"], description: "How many buses (default 4)" },
        },
        required: ["stop_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_bus",
      description: "Best bus to take between two stops right now, balancing arrival time against crowding.",
      parameters: {
        type: "object",
        properties: { from_stop: { type: "string" }, to_stop: { type: "string" } },
        required: ["from_stop", "to_stop"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_route_info",
      description: "Stops, travel time, first/last departure and frequency of a route by number.",
      parameters: { type: "object", properties: { route_number: { type: "string" } }, required: ["route_number"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_today_schedule",
      description: "Today's trips for a route: how many run, which are running now (and late?), and the next departures.",
      parameters: { type: "object", properties: { route_number: { type: "string" } }, required: ["route_number"] },
    },
  },
  {
    type: "function",
    function: {
      name: "find_routes_for_stop",
      description: "Which bus routes pass a given stop or place.",
      parameters: { type: "object", properties: { stop_name: { type: "string" } }, required: ["stop_name"] },
    },
  },
];

// ---- compact, LLM-friendly shapes (times pre-formatted in IST so the model can't mis-convert) ----
const dataTag = (src) => (src === "simulator" ? "DEMO SIMULATION" : "live GPS");

const liveBus = (b) => ({
  bus: b.busId,
  route: b.routeNumber,
  routeName: b.routeName,
  towards: b.towards,
  status: b.status === "AT_STOP" ? `standing at ${b.currentStopName}` : "moving",
  nextStop: b.nextStopName,
  delayMin: b.delayMin,
  crowd: `${b.occupancyPct}% (${b.crowdLevel})`,
  crowdSource: b.occupancySource,
  dataSource: dataTag(b.source),
  upcoming: b.nextStops.slice(0, 3).map((s) => ({
    stop: s.name,
    scheduled: fmtClock(s.scheduledTs),
    predicted: fmtClock(s.predictedTs),
    plusMinusMin: s.marginMin,
  })),
  lastEvent: b.lastEvent ? `${b.lastEvent.type} ${b.lastEvent.stopName} at ${fmtClock(b.lastEvent.ts)}` : null,
});

const arrival = (a) => ({
  route: a.routeNumber,
  routeName: a.routeName,
  towards: a.towards,
  type: a.kind === "live" ? "live-tracked" : "scheduled only (no GPS yet)",
  bus: a.busId ?? null,
  scheduled: fmtClock(a.scheduledTs),
  predicted: a.predictedTs ? fmtClock(a.predictedTs) : null,
  inMin: a.etaMin,
  plusMinusMin: a.marginMin ?? null,
  delayMin: a.delayMin ?? null,
  stopsAway: a.stopsAway ?? null,
  endsHere: a.endsHere ?? false,
  crowd: `${a.crowdPct}% (${a.crowdLevel})`,
  crowdSource: a.crowdSource,
  dataSource: a.source ? dataTag(a.source) : "timetable + crowd forecast",
});

export async function runTool(name, rawArgs = {}) {
  // Treat null the same as "not given".
  const args = Object.fromEntries(Object.entries(rawArgs ?? {}).filter(([, v]) => v != null));
  switch (name) {
    case "get_live_buses": {
      const buses = await getLiveBuses({ routeNumber: args.route_number });
      return { now: fmtClock(Date.now()), count: buses.length, buses: buses.slice(0, 8).map(liveBus) };
    }
    case "get_next_buses": {
      const r = await findStop(args.stop_name);
      if (!r.stop) return { error: `No stop matching "${args.stop_name}"`, didYouMean: r.alternatives.map((s) => s.name) };
      const limit = Math.min(8, Math.max(1, Number(args.limit) || 4));
      const list = await arrivalsAtStop(r.stop.id, limit);
      return { stop: r.stop.name, now: fmtClock(Date.now()), arrivals: list.map(arrival) };
    }
    case "recommend_bus": {
      const r = await recommend(args.from_stop, args.to_stop);
      if (r.error) return r;
      return {
        from: r.from,
        to: r.to,
        now: fmtClock(Date.now()),
        advice: r.advice,
        lateNight: r.lateNight,
        liveOptions: r.options.map((o) => ({
          bus: o.busId,
          route: o.routeNumber,
          towards: o.towards,
          boardsAt: fmtClock(o.boardAtTs),
          waitMin: o.waitMin,
          plusMinusMin: o.marginMin,
          rideMin: o.rideMin,
          arrivesAt: fmtClock(o.arriveTs),
          crowd: `${o.crowdPct}% (${o.crowdLevel})`,
          dataSource: dataTag(o.source),
        })),
        scheduledOptions: r.scheduledOptions.map((o) => ({
          route: o.routeNumber,
          towards: o.towards,
          departs: fmtClock(o.departsTs),
          waitMin: o.waitMin,
          rideMin: o.rideMin,
          expectedCrowd: `${o.crowdPct}% (${o.crowdLevel})`,
        })),
        transfers: r.transfers,
      };
    }
    case "get_route_info":
      return getRouteInfo(args.route_number);
    case "get_today_schedule": {
      const s = await getTodaySchedule(args.route_number);
      if (s.error) return s;
      const running = s.trips.filter((t) => t.status === "running");
      const upcoming = s.trips.filter((t) => t.status === "upcoming");
      return {
        route: s.route.number,
        name: s.route.name,
        firstDeparture: s.timetable?.firstDeparture,
        lastDeparture: s.timetable?.lastDeparture,
        everyMin: s.timetable?.headwayMin,
        totalTripsToday: s.trips.length,
        pastTrips: s.trips.filter((t) => t.status === "past").length,
        runningNow: running.map((t) => ({ departed: t.hhmm, towards: t.towards, bus: t.busId, delayMin: t.delayMin })),
        notTrackedNow: s.trips.filter((t) => t.status === "not_tracked").length,
        nextDepartures: upcoming.slice(0, 6).map((t) => ({ departs: t.hhmm, towards: t.towards })),
      };
    }
    case "find_routes_for_stop": {
      const r = await findStop(args.stop_name);
      if (!r.stop) return { error: `No stop matching "${args.stop_name}"`, didYouMean: r.alternatives.map((s) => s.name) };
      return { stop: r.stop.name, routes: await routesAtStop(r.stop.id) };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}