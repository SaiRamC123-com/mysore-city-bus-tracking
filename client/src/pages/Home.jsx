import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import MapView from "../components/MapView.jsx";
import BusCard from "../components/BusCard.jsx";
import { useLiveBuses } from "../hooks/useLiveBuses.js";
import { useT } from "../i18n/index.jsx";
import { api } from "../api.js";
import { haversineM } from "../utils.js";

/** Live map plus the list of buses, nearest first once the person shares their location. */
export default function Home({ geo }) {
  const t = useT();
  const nav = useNavigate();
  const { buses, error } = useLiveBuses();
  const [routes, setRoutes] = useState([]);
  const [routeSource, setRouteSource] = useState("");
      const [allStops, setAllStops] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api
      .routes()
      .then((d) => {
        setRoutes(d.routes);
        setRouteSource(d.sourceLabel);
      })
            .catch((e) => setLoadError(e.message));
    api
      .stops()
      .then((d) => setAllStops(d.stops))
      .catch(() => {}); // the map still works without the grey dots
  }, []);

  const list = useMemo(() => {
    const withDist = buses
      .filter((b) => !filter || b.routeNumber === filter)
      .map((b) => ({ bus: b, d: geo.pos ? haversineM(geo.pos.lat, geo.pos.lng, b.lat, b.lng) : null }));
    withDist.sort((a, b) => (a.d != null && b.d != null ? a.d - b.d : a.bus.routeNumber.localeCompare(b.bus.routeNumber, undefined, { numeric: true })));
    return withDist;
  }, [buses, filter, geo.pos]);

  const visibleBuses = useMemo(() => list.map((x) => x.bus), [list]);

  return (
    <div className="grid h-[calc(100dvh-56px)] grid-rows-[42%_58%] lg:grid-cols-[400px_1fr] lg:grid-rows-1">
      <aside className="order-2 min-h-0 space-y-3 overflow-y-auto p-3 lg:order-1">
        {(loadError || error) && (
          <p className="rounded-xl bg-high/10 p-3 text-sm text-high" role="alert">
            {loadError || error}
          </p>
        )}
        {routeSource && <p className="rounded-xl bg-lamp/25 p-3 text-xs ring-1 ring-lamp">{routeSource === "No imported route feed" ? t("routes.unavailable") : t("routes.unverified")}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${!filter ? "bg-ink text-white" : "bg-white ring-1 ring-ink/15"}`}
          >
            {t("filter.all")}
          </button>
          {routes.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setFilter(filter === r.number ? null : r.number)}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${filter === r.number ? "bg-ink text-white" : "bg-white ring-1 ring-ink/15"}`}
            >
              {r.number}
            </button>
          ))}
          <button
            type="button"
            onClick={geo.request}
            disabled={geo.watching}
            className="ml-auto rounded-full bg-lamp px-3 py-1 text-sm font-bold text-ink disabled:opacity-60"
          >
            {geo.pos ? t("near.on") : t("near.ask")}
          </button>
        </div>
        {geo.error && <p className="text-sm text-high">{geo.error}</p>}

        {list.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-ink/70">{t("home.empty")}</p>
        ) : (
          <div className="space-y-3">
            {list.map(({ bus, d }) => (
              <BusCard key={bus.busId} bus={bus} distanceM={d} selected={bus.busId === selected} onSelect={setSelected} />
            ))}
          </div>
        )}
        <p className="text-xs text-ink/60">{t("home.hint")}</p>
      </aside>

      <MapView
        className="order-1 h-full w-full lg:order-2"
        routes={routes}
        buses={visibleBuses}
        selectedBusId={selected}
        onSelectBus={setSelected}
        onSelectStop={(id) => nav(`/stop/${id}`)}
        userPos={geo.pos}
                  allStops={allStops}
      />
    </div>
  );
}
