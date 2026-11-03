import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CrowdBadge from "../components/CrowdBadge.jsx";
import StopPicker from "../components/StopPicker.jsx";
import { api } from "../api.js";
import { useI18n } from "../i18n/index.jsx";
import { clock } from "../utils.js";

/** "From -> to": the server weighs waiting time against crowding and says go now or wait. */
export default function Planner() {
  const { t, lang } = useI18n();
  const [stops, setStops] = useState([]);
  const [feedInfo, setFeedInfo] = useState({ sourceLabel: "", verified: false, serviceCalendarAvailable: false });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState(null);
  const [asked, setAsked] = useState({ from: "", to: "" }); // the pair the shown result is for
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .stops()
      .then((d) => {
        setStops([...d.stops].sort((a, b) => a.name.localeCompare(b.name)));
        setFeedInfo({ sourceLabel: d.sourceLabel, verified: d.verified, serviceCalendarAvailable: d.serviceCalendarAvailable });
      })
      .catch((e) => setError(e.message));
  }, []);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const r = await api.recommend(from, to);
      setAsked({ from, to });
      setResult(r);
    } catch (err) {
      const hints = err.data?.didYouMean?.length ? ` ${t("plan.didYouMean")} ${err.data.didYouMean.join(", ")}` : "";
      setError(err.message + hints);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="font-display text-3xl font-extrabold">{t("plan.title")}</h1>

      <p className="rounded-xl bg-lamp/25 p-3 text-sm ring-1 ring-lamp">
        {feedInfo.sourceLabel === "No imported route feed" ? t("routes.unavailable") : t("routes.unverified")}
      </p>

      <form onSubmit={submit} className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink/10">
        <StopPicker label={t("plan.from")} stops={stops} value={from} onChange={setFrom} excludeId={to} lang={lang} placeholder={t("plan.type")} noMatch={t("plan.noMatch")} />
        <button type="button" onClick={swap} disabled={!from || !to} className="text-sm font-semibold text-maroon underline underline-offset-2 disabled:opacity-40">
          {t("plan.swap")}
        </button>
        <StopPicker label={t("plan.to")} stops={stops} value={to} onChange={setTo} excludeId={from} lang={lang} placeholder={t("plan.type")} noMatch={t("plan.noMatch")} />
        <button type="submit" disabled={!from || !to || loading} className="w-full rounded-xl bg-ink px-4 py-3 font-bold text-white disabled:opacity-50 hover:bg-ink/90">
          {loading ? t("plan.searching") : t("plan.go")}
        </button>
      </form>

      {error && (
        <p className="rounded-xl bg-high/10 p-3 text-sm text-high" role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className="space-y-3" aria-live="polite">
          <p className="rounded-xl bg-lamp/25 p-4 font-semibold ring-1 ring-lamp">{result.advice}</p>
          {result.lateNight && <p className="rounded-xl bg-ink p-3 text-sm text-white">{t("plan.late")}</p>}

          {result.routeOptions?.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-display text-xl font-extrabold">{t("plan.gtfsRoutes")}</h2>
              {result.routeOptions.map((route) => (
                <article key={route.routeId} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-ink/10">
                  <div className="flex items-start gap-3">
                    <span className="grid min-h-10 min-w-12 place-items-center rounded-lg bg-ink px-2 font-display text-lg font-extrabold text-white">
                      {route.routeNumber}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">{route.routeName || t("towards", { place: route.destination })}</p>
                      <p className="text-sm text-ink/70">{t("towards", { place: route.destination })}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm">
                    {[route.from, ...route.intermediateStops, route.to].join(" → ")}
                  </p>
                  {!route.serviceCalendarAvailable && <p className="mt-2 text-xs text-high">{t("plan.calendarMissing")}</p>}
                  {route.serviceCalendarAvailable && !route.times.some((time) => time.scheduledForToday) && (
                    <p className="mt-2 text-xs text-ink/70">{t("plan.notToday")}</p>
                  )}
                  {route.times.length > 0 && (
                    <p className="mt-2 text-sm">
                      {route.times.map((time) => `${time.departure} → ${time.arrival}`).join(", ")}
                    </p>
                  )}
                </article>
              ))}
            </section>
          )}

          {result.options?.map((o) => (
            <Link
              key={o.busId}
              to={`/bus/${o.busId}?from=${encodeURIComponent(asked.from)}&to=${encodeURIComponent(asked.to)}`}
              className="block rounded-2xl bg-white p-3 shadow-sm ring-1 ring-ink/10 transition hover:ring-2 hover:ring-lamp focus-visible:ring-2 focus-visible:ring-lamp"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-11 min-w-12 place-items-center rounded-lg bg-ink px-2 font-display text-lg font-extrabold text-white">
                  {o.routeNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{t("towards", { place: o.towards })}</p>
                  <p className="text-sm text-ink/70">
                    {t("plan.boardIn", { n: o.waitMin })}
                    {o.marginMin ? ` (±${o.marginMin} ${t("min")})` : ""}, {t("plan.ride", { n: o.rideMin })}, {t("plan.arrives", { time: clock(o.arriveTs) })}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <CrowdBadge pct={o.crowdPct} level={o.crowdLevel} source={o.crowdSource} />
                <span className="flex items-center gap-3 text-xs">
                  {o.source === "simulator" && <span className="rounded-full bg-ink/10 px-2 py-0.5 font-semibold">{t("demo.bus")}</span>}
                  <span className="rounded-full bg-lamp px-3 py-1.5 text-sm font-bold text-ink">{t("track.live")} →</span>
                </span>
              </div>
            </Link>
          ))}

          {result.scheduledOptions?.length > 0 && (
            <div className="rounded-xl bg-white p-3 ring-1 ring-ink/10">
              <h2 className="font-display text-lg font-extrabold">{t("plan.scheduled")}</h2>
              <ul className="mt-2 space-y-2 text-sm">
                                {result.scheduledOptions.map((s, i) => (
                  <li key={i}>
                    <Link
                      to={`/trip/${encodeURIComponent(s.routeId)}/${s.direction}/${s.tripStartTs}?from=${encodeURIComponent(asked.from)}&to=${encodeURIComponent(asked.to)}`}
                      className="flex items-center justify-between gap-2 rounded-xl p-2 ring-1 ring-ink/10 transition hover:ring-2 hover:ring-lamp focus-visible:ring-2 focus-visible:ring-lamp"
                    >
                      <span>
                        <strong>{s.routeNumber}</strong> {t("towards", { place: s.towards })}: {clock(s.departsTs)} ({t("arrival.inMin", { n: s.waitMin })})
                        <span className="ml-2 rounded-full bg-lamp px-2 py-0.5 text-xs font-bold text-ink">{t("track.live")} →</span>
                      </span>
                      <CrowdBadge pct={s.crowdPct} level={s.crowdLevel} source="forecast" compact />
                    </Link>
                  </li>
                ))}
                
              </ul>
            </div>
          )}

          {result.transfers?.length > 0 && (
            <ul className="rounded-xl bg-white p-3 text-sm ring-1 ring-ink/10">
              {result.transfers.map((x, i) => (
                <li key={i}>{t("plan.transfer", { a: x.takeFirst, stop: x.changeAt, b: x.thenTake })}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}