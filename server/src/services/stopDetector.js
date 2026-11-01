import { haversineM, projectOnPolyline } from "../utils/geo.js";

/**
 * Decides, from a stream of GPS pings, when each bus ARRIVED at and DEPARTED from every stop.
 *
 * Per bus the state machine is:  EN_ROUTE -> AT_STOP -> EN_ROUTE -> ... -> TRIP_ENDED
 *   ARRIVED   : inside the stop's geofence AND slower than arriveKmh
 *   DEPARTED  : was AT_STOP and (left the geofence OR sped up past departKmh after minDwell)
 *   SKIPPED   : bus drove past the stop (more than skipBufferM beyond it) without ever stopping
 * Only the NEXT stop in sequence is checked, so events always come out in route order. If pings go
 * missing (phone loses signal) the stops in between are caught up as SKIPPED on the next ping.
 *
 * Pure logic: no database or network access, so it is easy to unit-test.
 */
export class StopDetector {
  constructor(opts = {}) {
    this.o = { arriveKmh: 5, departKmh: 8, minDwellMs: 5000, maxAccuracyM: 50, skipBufferM: 150, ...opts };
    this.buses = new Map();
  }

  stateFor(busId, tripId) {
    let st = this.buses.get(busId);
    if (!st || st.tripId !== tripId) {
      st = {
        busId,
        tripId,
        init: false,
        nextIdx: 0,
        status: "EN_ROUTE",
        arrivedAt: null,
        speedEma: null,
        alongM: 0,
        offRouteM: 0,
        lastTs: 0,
        lastEvent: null,
        passed: [],
      };
      this.buses.set(busId, st);
    }
    return st;
  }

  /**
   * @param route  oriented route (see utils/route.js orient())
   * @param ping   { busId, tripId, tripStartTs, direction, lat, lng, speedKmh, accuracyM, ts }
   * @returns { events, state, ignored? }
   */
  update(route, ping) {
    const st = this.stateFor(ping.busId, ping.tripId);
    const events = [];
    if ((ping.accuracyM ?? 0) > this.o.maxAccuracyM) return { events, state: st, ignored: "low_accuracy" };
    if (ping.ts < st.lastTs) return { events, state: st, ignored: "out_of_order" };
    st.lastTs = ping.ts;

    st.speedEma = st.speedEma == null ? ping.speedKmh : 0.7 * st.speedEma + 0.3 * ping.speedKmh;
    const proj = projectOnPolyline(route.polyline, route.cum, ping.lat, ping.lng);
    st.alongM = proj.alongM;
    st.offRouteM = proj.offM;

    const n = route.stops.length;

    // First ping of a trip: if the bus is already past some stops, skip them silently.
    if (!st.init) {
      st.init = true;
      let i = 0;
      while (i < n && route.stops[i].alongM + route.stops[i].radiusM < proj.alongM) i++;
      st.nextIdx = i;
      if (i >= n) st.status = "TRIP_ENDED";
    }

    const make = (type, idx, extra = {}) => {
      const stop = route.stops[idx];
      const offset = type === "DEPARTED" ? stop.departOffsetMin : stop.offsetMin;
      const scheduledTs = ping.tripStartTs + offset * 60_000;
      const ev = {
        type,
        busId: ping.busId,
        tripId: ping.tripId,
        routeId: route.id,
        direction: ping.direction,
        stopId: stop.id,
        stopName: stop.name,
        seq: idx,
        alongM: Math.round(stop.alongM),
        ts: ping.ts,
        scheduledTs,
        delayMin: Math.round(((ping.ts - scheduledTs) / 60_000) * 10) / 10,
        ...extra,
      };
      st.lastEvent = { type, stopName: stop.name, ts: ping.ts, delayMin: ev.delayMin };
      events.push(ev);
      return ev;
    };

    for (let guard = 0; guard < 4; guard++) {
      if (st.status === "TRIP_ENDED" || st.nextIdx >= n) break;
      const idx = st.nextIdx;
      const stop = route.stops[idx];
      const d = haversineM(ping.lat, ping.lng, stop.lat, stop.lng);

      if (st.status === "EN_ROUTE") {
        if (d <= stop.radiusM && ping.speedKmh < this.o.arriveKmh) {
          st.status = "AT_STOP";
          st.arrivedAt = ping.ts;
          const ev = make("ARRIVED", idx);
          st.passed.push({ stopId: stop.id, name: stop.name, seq: idx, arrivedTs: ping.ts, scheduledTs: ev.scheduledTs, delayMin: ev.delayMin });
          break;
        }
        if (st.alongM > stop.alongM + this.o.skipBufferM && d > stop.radiusM) {
          const ev = make("SKIPPED", idx);
          st.passed.push({ stopId: stop.id, name: stop.name, seq: idx, skipped: true, scheduledTs: ev.scheduledTs });
          st.nextIdx++;
          if (st.nextIdx >= n) st.status = "TRIP_ENDED";
          continue; // the same ping may already be inside the following stop
        }
        break;
      }

      // AT_STOP
      const leftZone = d > stop.radiusM;
      const moving = ping.speedKmh > this.o.departKmh && ping.ts - st.arrivedAt >= this.o.minDwellMs;
      if (leftZone || moving) {
        const dwellSec = Math.round((ping.ts - st.arrivedAt) / 1000);
        const ev = make("DEPARTED", idx, { dwellSec });
        const last = st.passed[st.passed.length - 1];
        if (last && last.seq === idx) {
          last.departedTs = ping.ts;
          last.scheduledDepTs = ev.scheduledTs;
          last.dwellSec = dwellSec;
        }
        st.nextIdx++;
        st.status = st.nextIdx >= n ? "TRIP_ENDED" : "EN_ROUTE";
        st.arrivedAt = null;
        continue;
      }
      break;
    }

    if (st.passed.length > 12) st.passed.splice(0, st.passed.length - 12);
    return { events, state: st };
  }
}
