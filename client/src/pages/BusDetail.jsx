import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import CrowdBadge from "../components/CrowdBadge.jsx";
import BusLine from "../components/BusLine.jsx";
import MapView from "../components/MapView.jsx";
import { lineModel, orientedStops, segmentBetween } from "../busline.js";
import { api } from "../api.js";
import { useLiveBuses } from "../hooks/useLiveBuses.js";
import { useI18n } from "../i18n/index.jsx";
import { clock, delayInfo, pick, tripOn } from "../utils.js";

const TONE = { ok: "text-low", warn: "text-mid", bad: "text-high" };

function Row({ name, children, highlight = false }) {
  return (
    <li className={`rounded-lg px-3 py-2 ${highlight ? "bg-lamp/30" : "bg-white ring-1 ring-ink/10"}`}>
      <p className="font-semibold">{name}</p>
      <p className="text-sm text-ink/80">{children}</p>
    </li>
  );
}

/** One bus: where it is, which stops it has served (actual times) and which are still ahead (predicted). */
export default function BusDetail() {
  const { busId } = useParams();
  const { t, lang } = useI18n();
  const { buses, ready } = useLiveBuses();
  const bus = buses.find((b) => b.busId === busId);
  const [sp] = useSearchParams();
  const fromId = sp.get("from") || "";
  const toId = sp.get("to") || "";
  const [routes, setRoutes] = useState([]);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    api.routes().then((d) => setRoutes(d.routes)).catch(() => {});
  }, []);

  const route = routes.find((r) => r.id === bus?.routeId) ?? null;
  const routeList = useMemo(() => (route ? [route] : []), [route]);
  const mapBuses = useMemo(() => (bus ? [bus] : []), [bus]);
  const direction = bus?.direction;
  const model = useMemo(
    () => (bus && route ? lineModel({ stops: orientedStops(route, direction), bus, fromId, toId }) : null),
    [bus, route, direction, fromId, toId]
  );
  const segment = useMemo(() => (route && model?.hasTrip ? segmentBetween(route, fromId, toId) : null), [route, model?.hasTrip, fromId, toId]);

  if (!bus && !ready) return <div className="p-4" aria-busy="true" />; // first data has not arrived yet

  if (!bus) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <p className="rounded-xl bg-white p-4">{t("bus.gone")}</p>
        <Link to="/" className="font-semibold text-maroon underline underline-offset-2">
          {t("back.map")}
        </Link>
      </div>
    );
  }

  const d = delayInfo(bus.delayMin);
  const atStop = bus.nextStops[0]?.atStop ? bus.nextStops[0] : null;
  const served = bus.passed.filter((p) => !(atStop && p.seq + 1 === atStop.seq));
  const arrivedHere = atStop ? bus.passed.find((p) => p.seq + 1 === atStop.seq) : null;
  const ahead = bus.nextStops.filter((s) => !s.atStop);

  // The person's trip on this bus (only when they came from the trip planner).
  const trip = tripOn(bus, fromId, toId);
  const nameOf = (entry, id) => {
    if (entry) return pick(lang, entry.name, entry.nameKn);
    const p = bus.passed.find((x) => x.stopId === id);
    if (p) return p.name;
    const st = route?.stops.find((x) => x.id === id);
    return st ? pick(lang, st.name, st.nameKn) : "";
  };
  let boardLine = "";
  if (trip.board) {
    const stop = nameOf(trip.board.stop, fromId);
    const v = trip.board.stop ? { stop, time: clock(trip.board.stop.predictedTs), m: trip.board.stop.marginMin, n: trip.board.away } : { stop };
    if (stop) boardLine = t({ gone: "track.notComing", at: "track.atBoarding", next: "track.boardNext", ahead: "track.boardAhead" }[trip.board.kind], v);
  }
  const destLine = trip.dest ? t("track.destAt", { stop: nameOf(trip.dest, toId), time: clock(trip.dest.predictedTs), m: trip.dest.marginMin }) : "";
  const focus = { fromId, toId, fromText: t("track.from"), toText: t("track.to") };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Link to="/" className="text-sm font-semibold text-maroon underline underline-offset-2">
        {t("back.map")}
      </Link>

      <div className="flex items-center gap-3 rounded-2xl bg-ink p-4 text-white shadow-sm">
        <span className="grid h-14 min-w-16 place-items-center rounded-xl bg-white px-3 font-display text-3xl font-extrabold text-ink">
          {bus.routeNumber}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl font-extrabold">{t("towards", { place: pick(lang, bus.towards, bus.towardsKn) })}</h1>
          <p className="truncate text-sm text-white/70">
            {bus.busId} · {pick(lang, bus.routeName, bus.routeNameKn)}
          </p>
        </div>
        {bus.source === "simulator" ? (
          <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold">{t("demo.bus")}</span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-lamp px-2.5 py-1 text-xs font-extrabold text-ink">
            <span className="live-dot h-2 w-2 rounded-full bg-ink" />
            {t("line.live")}
          </span>
        )}
      </div>

      <div className="relative isolate overflow-hidden rounded-xl ring-1 ring-ink/10">
        <MapView className="h-64 w-full sm:h-80" routes={routeList} buses={mapBuses} selectedBusId={bus.busId} follow={follow} focus={focus} segment={segment} />
        <button
          type="button"
          onClick={() => setFollow((f) => !f)}
          aria-pressed={follow}
          className={`absolute right-2 top-2 z-[1000] rounded-full px-3 py-1 text-xs font-bold shadow ring-1 ring-ink/15 ${follow ? "bg-lamp text-ink" : "bg-white"}`}
        >
          {follow ? t("track.following") : t("track.follow")}
        </button>
      </div>

      {(boardLine || destLine) && (
        <section aria-labelledby="trip" className="space-y-1 rounded-xl bg-lamp/30 p-3 ring-1 ring-lamp">
          <h2 id="trip" className="font-display text-lg font-extrabold">
            {t("track.yourTrip")}
          </h2>
          {boardLine && <p className="text-sm font-semibold">{boardLine}</p>}
          {destLine && <p className="text-sm font-semibold">{destLine}</p>}
        </section>
      )}

      {model && <BusLine model={model} bus={bus} />}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-white p-3 ring-1 ring-ink/10">
        <CrowdBadge pct={bus.occupancyPct} level={bus.crowdLevel} source={bus.occupancySource} />
        <span className={`font-semibold ${TONE[d.tone]}`}>{t(d.key, { n: d.n })}</span>
        <span className="text-sm text-ink/70">{Math.round(bus.speedKmh)} km/h</span>
        {bus.source === "simulator" && <span className="rounded-full bg-lamp/30 px-2 py-0.5 text-xs font-semibold">{t("demo.bus")}</span>}
      </div>
      <p className="text-xs text-ink/60">
        {bus.occupancySource === "forecast"
          ? t("bus.crowdForecast")
          : bus.occupancySource === "simulated"
            ? t("bus.crowdSimulated")
            : t("bus.crowdCounted", { n: bus.occupancy, cap: bus.capacity })}
      </p>

      <details className="space-y-4">
        <summary className="cursor-pointer rounded-xl bg-white p-3 font-display text-lg font-extrabold ring-1 ring-ink/10">{t("line.allTimes")}</summary>
        <div className="mt-4 space-y-4">
          {served.length > 0 && (
            <section aria-labelledby="served">
              <h2 id="served" className="mb-2 font-display text-xl font-extrabold">
                {t("bus.served")}
              </h2>
              <ul className="space-y-2">
                {served.map((p) => (
                  <Row key={`${p.seq}-${p.arrivedTs ?? "s"}`} name={p.name}>
                    {p.skipped ? (
                      t("bus.skipped")
                    ) : (
                      <>
                        {t("time.scheduled")} {clock(p.scheduledTs)}. {t("time.arrived")} <strong>{clock(p.arrivedTs)}</strong>
                        {p.departedTs ? (
                          <>
                            , {t("time.departed")} <strong>{clock(p.departedTs)}</strong> ({t("bus.stood", { n: p.dwellSec })})
                          </>
                        ) : null}
                      </>
                    )}
                  </Row>
                ))}
              </ul>
            </section>
          )}

          {atStop && (
            <section aria-labelledby="here">
              <h2 id="here" className="mb-2 font-display text-xl font-extrabold">
                {t("bus.here")}
              </h2>
              <ul>
                <Row name={pick(lang, atStop.name, atStop.nameKn)} highlight>
                  {t("time.arrived")} <strong>{clock(arrivedHere?.arrivedTs ?? atStop.predictedTs)}</strong>
                  {", "}
                  {t("bus.leavesAbout")} <strong>{clock(atStop.predictedDepTs)}</strong> ({t("time.scheduled")} {clock(atStop.scheduledDepTs)})
                </Row>
              </ul>
            </section>
          )}

          <section aria-labelledby="ahead">
            <h2 id="ahead" className="mb-2 font-display text-xl font-extrabold">
              {t("bus.ahead")}
            </h2>
            {ahead.length === 0 ? (
              <p className="rounded-xl bg-white p-3 text-sm">{t("bus.endOfLine")}</p>
            ) : (
              <ul className="space-y-2">
                {ahead.map((s) => (
                  <Row key={s.seq} name={pick(lang, s.name, s.nameKn)}>
                    {t("time.scheduled")} {clock(s.scheduledTs)}. {t("time.expected")} <strong>{clock(s.predictedTs)}</strong> (±{s.marginMin} {t("min")}), {t("bus.leavesAbout")} {clock(s.predictedDepTs)}
                  </Row>
                ))}
              </ul>
            )}
          </section>
        </div>
      </details>
    </div>
  );
}