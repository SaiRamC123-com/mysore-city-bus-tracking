import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ArrivalList from "../components/ArrivalList.jsx";
import { api } from "../api.js";
import { useI18n } from "../i18n/index.jsx";
import { istHour, levelOf, pick } from "../utils.js";

const BAR = { low: "bg-low", medium: "bg-mid", high: "bg-high" };

/** Hourly crowd forecast for one route at this stop; the current hour is outlined. */
function ForecastBars({ series }) {
  const { t } = useI18n();
  const now = istHour();
  return (
    <div className="space-y-4">
      {series.map((s) => (
        <div key={`${s.routeNumber}-${s.direction}`}>
          <p className="text-sm font-semibold">{t("forecast.route", { n: s.routeNumber, place: s.towards })}</p>
          <div className="mt-1 flex h-16 items-end gap-0.5" role="img" aria-label={t("forecast.aria")}>
            {s.hours.map((h, i) => (
              <span
                key={h}
                title={`${h}:00 — ${s.values[i]}%`}
                className={`flex-1 rounded-t-sm ${BAR[levelOf(s.values[i])]} ${h === now ? "outline-2 outline-ink" : ""}`}
                style={{ height: `${Math.max(6, s.values[i])}%` }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-ink/60">
            <span>{s.hours[0]}:00</span>
            <span>12:00</span>
            <span>{s.hours[s.hours.length - 1]}:00</span>
          </div>
        </div>
      ))}
      <p className="text-xs text-ink/60">{t("forecast.basis", { data: series[0]?.modelData ?? "?" })}</p>
    </div>
  );
}

export default function StopPage() {
  const { stopId } = useParams();
  const { t, lang } = useI18n();
  const [data, setData] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .arrivals(stopId, 8)
        .then((d) => alive && (setData(d), setError("")))
        .catch((e) => alive && setError(e.message));
    load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [stopId]);

  useEffect(() => {
    let alive = true;
    api
      .forecast(stopId)
      .then((d) => alive && setForecast(d))
      .catch(() => alive && setForecast(null));
    return () => {
      alive = false;
    };
  }, [stopId]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Link to="/" className="text-sm font-semibold text-maroon underline underline-offset-2">
        {t("back.map")}
      </Link>
      <h1 className="font-display text-3xl font-extrabold">{data ? pick(lang, data.stop.name, data.stop.nameKn) : "…"}</h1>

      {error && (
        <p className="rounded-xl bg-high/10 p-3 text-sm text-high" role="alert">
          {error}
        </p>
      )}

      <section aria-labelledby="next-buses">
        <h2 id="next-buses" className="mb-2 font-display text-xl font-extrabold">
          {t("stop.next")}
        </h2>
        {data && <ArrivalList arrivals={data.arrivals} />}
      </section>

      {forecast?.series?.length > 0 && (
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink/10" aria-labelledby="busy">
          <h2 id="busy" className="mb-3 font-display text-xl font-extrabold">
            {t("stop.busy")}
          </h2>
          <ForecastBars series={forecast.series} />
        </section>
      )}
    </div>
  );
}
