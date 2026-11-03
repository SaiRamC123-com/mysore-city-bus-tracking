import { Link } from "react-router-dom";
import CrowdBadge from "./CrowdBadge.jsx";
import { useI18n } from "../i18n/index.jsx";
import { clock, delayInfo } from "../utils.js";

const TONE = { ok: "text-low", warn: "text-mid", bad: "text-high" };

/** Upcoming buses at one stop: scheduled time, live predicted time (± margin), delay, crowd. */
export default function ArrivalList({ arrivals, serviceCalendarAvailable }) {
  const { t } = useI18n();

  if (!arrivals?.length) {
    return <p className="rounded-xl bg-white p-4 text-sm text-ink/70">{serviceCalendarAvailable ? t("arrival.none") : t("arrival.calendarUnavailable")}</p>;
  }

  return (
    <ul className="space-y-3">
      {arrivals.map((a, i) => {
        const live = a.kind === "live";
        const d = live ? delayInfo(a.delayMin) : null;
        return (
          <li key={`${a.busId ?? a.routeId}-${a.scheduledTs}-${i}`} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-ink/10">
            <div className="flex items-start gap-3">
              <span className="grid h-10 min-w-12 place-items-center rounded-lg bg-ink px-2 font-display text-lg font-extrabold text-white">
                {a.routeNumber}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{t("towards", { place: a.towards })}</p>
                <p className="text-sm text-ink/70">
                  {live ? (a.atStop ? t("arrival.atStopNow") : t("arrival.stopsAway", { n: a.stopsAway })) : t("arrival.timetable")}
                  {a.endsHere ? ` — ${t("arrival.endsHere")}` : ""}
                </p>
              </div>
              <p className="shrink-0 text-right font-display text-xl font-extrabold">
                {a.etaMin < 1 ? t("arrival.now") : t("arrival.inMin", { n: a.etaMin })}
              </p>
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-4 text-sm">
              <div>
                <dt className="text-ink/60">{t("time.scheduled")}</dt>
                <dd className="font-semibold">{clock(a.scheduledTs)}</dd>
              </div>
              <div>
                <dt className="text-ink/60">{t("time.expected")}</dt>
                <dd className="font-semibold">
                  {live ? (
                    <>
                      {clock(a.predictedTs)}
                      {a.marginMin ? <span className="font-normal text-ink/60"> (±{a.marginMin} {t("min")})</span> : null}
                    </>
                  ) : (
                    "–"
                  )}
                </dd>
              </div>
            </dl>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <CrowdBadge pct={a.crowdPct} level={a.crowdLevel} source={a.crowdSource} />
              <span className="flex items-center gap-3 text-xs">
                {live && <span className={`font-semibold ${TONE[d.tone]}`}>{t(d.key, { n: d.n })}</span>}
                {a.source === "simulator" && <span className="rounded-full bg-lamp/30 px-2 py-0.5 font-semibold">{t("demo.bus")}</span>}
                {live && (
                  <Link to={`/bus/${a.busId}`} className="font-semibold text-maroon underline underline-offset-2">
                    {t("details")}
                  </Link>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
