import { getStatic, findStop, getLiveBuses } from "./dataService.js";
import { arrivalsAtStop, tripsAround } from "./scheduleService.js";
import { orient } from "../utils/route.js";
import { fmtClock, isLateNight } from "../utils/time.js";

// Minutes of "pain" added to a bus's wait when it is crowded. Transparent on purpose, easy to tune.
const CROWD_PENALTY = { low: 0, medium: 2, high: 8 };
const gtfsClock = (seconds) => `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;

/**
 * "Which bus should I take from A to B right now?"
 * Considers every direct route, ranks live buses by (minutes until it reaches you + crowd penalty).
 */
export async function recommend(fromQuery, toQuery, now = Date.now()) {
  const from = await findStop(fromQuery);
  const to = await findStop(toQuery);
  if (!from.stop) return { error: `I couldn't find a stop matching "${fromQuery}".`, didYouMean: from.alternatives.map((s) => s.name) };
  if (!to.stop) return { error: `I couldn't find a stop matching "${toQuery}".`, didYouMean: to.alternatives.map((s) => s.name) };
  if (from.stop.id === to.stop.id) return { error: "Start and destination are the same stop." };

  const { routeList } = await getStatic();
  const live = await getLiveBuses();

  const direct = []; // { route, o, iF, iT }
  for (const route of routeList) {
    for (const direction of route.availableDirections) {
      const o = orient(route, direction);
      const iF = o.stops.findIndex((s) => s.id === from.stop.id);
      const iT = o.stops.findIndex((s) => s.id === to.stop.id);
      if (iF >= 0 && iT > iF) direct.push({ route, o, iF, iT });
    }
  }

  const result = { from: from.stop.name, to: to.stop.name, lateNight: isLateNight(now), options: [], scheduledOptions: [], routeOptions: [] };

  if (!direct.length) {
    // No direct bus: look for a stop where one route from A meets one route to B.
    const via = [];
    for (const a of routeList.filter((r) => r.stops.some((s) => s.id === from.stop.id))) {
      for (const b of routeList.filter((r) => r.stops.some((s) => s.id === to.stop.id))) {
        const common = a.stops.find((s) => b.stops.some((x) => x.id === s.id) && s.id !== from.stop.id && s.id !== to.stop.id);
        if (common) via.push({ changeAt: common.name, takeFirst: a.number, thenTake: b.number });
      }
    }
    result.advice = via.length
      ? `There is no direct bus. Take route ${via[0].takeFirst} to ${via[0].changeAt}, then route ${via[0].thenTake}.`
      : "There is no direct bus between these stops on the routes currently in the system.";
    result.transfers = via.slice(0, 3);
    return result;
  }

  result.routeOptions = direct
    .filter(({ route }) => route.source === "gtfs-upload")
    .map(({ route, o, iF, iT }) => {
      const currentDayTrips = route.serviceCalendarAvailable ? tripsAround(route, now) : [];
      const times = currentDayTrips.length
        ? currentDayTrips
          .map((trip) => ({
            from: trip.stopTimes.find((item) => item.stopId === from.stop.id),
            to: trip.stopTimes.find((item) => item.stopId === to.stop.id),
          }))
          .filter(({ from: first, to: last }) => first && last && first.departureTs >= now - 60_000)
          .sort((a, b) => a.from.departureTs - b.from.departureTs)
          .slice(0, 3)
          .map(({ from: first, to: last }) => ({
            departure: fmtClock(first.departureTs),
            arrival: fmtClock(last.arrivalTs),
            scheduledForToday: true,
          }))
        : route.gtfsTrips
          .map((trip) => ({
            from: trip.stopTimes.find((item) => item.stopId === from.stop.id),
            to: trip.stopTimes.find((item) => item.stopId === to.stop.id),
          }))
          .filter(({ from: first, to: last }) => first && last)
          .sort((a, b) => a.from.departureSeconds - b.from.departureSeconds)
          .slice(0, 3)
          .map(({ from: first, to: last }) => ({
            departure: gtfsClock(first.departureSeconds),
            arrival: gtfsClock(last.arrivalSeconds),
            scheduledForToday: false,
          }));
      return {
        routeId: route.id,
        routeNumber: route.number,
        routeName: route.name,
        destination: o.towards,
        from: from.stop.name,
        to: to.stop.name,
        intermediateStops: o.stops.slice(iF + 1, iT).map((stop) => stop.name),
        sourceLabel: "Unverified GTFS upload",
        verified: false,
        serviceCalendarAvailable: route.serviceCalendarAvailable,
        times,
      };
    });

  for (const { route, o, iF, iT } of direct) {
    for (const b of live) {
      if (b.routeId !== route.id || b.direction !== o.direction) continue;
      const f = b.nextStops.find((s) => s.stopId === from.stop.id);
      const t = b.nextStops.find((s) => s.stopId === to.stop.id);
      if (!f || !t) continue; // bus already passed the boarding stop
      const waitMin = Math.max(0, Math.round((f.predictedTs - now) / 60_000));
      result.options.push({
        busId: b.busId,
        routeNumber: route.number,
        routeName: route.name,
        towards: o.towards,
        boardAtTs: f.predictedTs,
        waitMin,
        marginMin: f.marginMin,
        rideMin: Math.max(1, Math.round((t.predictedTs - f.predictedTs) / 60_000)),
        arriveTs: t.predictedTs,
        crowdPct: b.occupancyPct,
        crowdLevel: b.crowdLevel,
        crowdSource: b.occupancySource,
        delayMin: b.delayMin,
        score: waitMin + CROWD_PENALTY[b.crowdLevel],
        source: b.source,
      });
    }
  }
  result.options.sort((a, b) => a.score - b.score);
  result.options = result.options.slice(0, 4);

  // Scheduled-only trips (no GPS yet), useful when nothing is live.
  const arrivals = await arrivalsAtStop(from.stop.id, 12, now);
  for (const a of arrivals) {
    if (a.kind !== "scheduled") continue;
    const match = direct.find((d) => d.route.id === a.routeId && d.o.direction === a.direction);
    if (!match) continue;
        result.scheduledOptions.push({
      routeId: a.routeId,
      direction: a.direction,
      // when this trip leaves its first stop (whole minutes), so the app can open the trip's own page
      tripStartTs: a.tripStartTs ?? Math.round((a.scheduledTs - match.o.stops[match.iF].offsetMin * 60_000) / 60_000) * 60_000,
      routeNumber: a.routeNumber,
      towards: a.towards,
      departsTs: a.scheduledTs,
      waitMin: a.etaMin,
      rideMin: a.stopTimes?.length
        ? Math.round((a.stopTimes.find((item) => item.stopId === to.stop.id)?.arrivalTs - a.stopTimes.find((item) => item.stopId === from.stop.id)?.departureTs) / 60_000)
        : Math.round(match.o.stops[match.iT].offsetMin - match.o.stops[match.iF].offsetMin),
      crowdPct: a.crowdPct,
      crowdLevel: a.crowdLevel,
    });
  }
  result.scheduledOptions = result.scheduledOptions.slice(0, 3);

  // Plain-language advice (the chatbot rephrases this; the UI shows it as is).
  const opts = result.options;
  if (!opts.length && !result.scheduledOptions.length) {
    result.advice = result.routeOptions.some((route) => !route.serviceCalendarAvailable)
      ? "No bus is being tracked on this route right now. The GTFS service calendar is unavailable, so today's departures cannot be confirmed."
      : "No bus is being tracked on this route right now and none is scheduled in the next 90 minutes.";
  } else if (!opts.length) {
    const s = result.scheduledOptions[0];
    result.advice = `No bus is live yet. The next scheduled bus is route ${s.routeNumber} at ${fmtClock(s.departsTs)} (expected crowd ~${s.crowdPct}%).`;
  } else {
    const best = opts[0];
    const fastest = [...opts].sort((a, b) => a.waitMin - b.waitMin)[0];
    if (best.busId === fastest.busId) {
      result.advice = `Take bus ${best.routeNumber} (${best.busId}): about ${best.waitMin} min away, ${best.crowdLevel} crowd (${best.crowdPct}% full), ${best.rideMin} min ride.`;
    } else {
      result.advice =
        `Bus ${fastest.routeNumber} (${fastest.busId}) arrives first in ${fastest.waitMin} min but is ${fastest.crowdPct}% full (${fastest.crowdLevel}). ` +
        `Bus ${best.routeNumber} (${best.busId}) arrives in ${best.waitMin} min at ${best.crowdPct}% (${best.crowdLevel}), so waiting ${best.waitMin - fastest.waitMin} more min is likely more comfortable.`;
    }
    if (opts.every((o) => o.crowdLevel === "high")) result.advice += " All upcoming buses are crowded.";
  }
  if (result.lateNight) result.advice += " It is late: wait at a well-lit stop and use the SOS button if you feel unsafe.";
  return result;
}
