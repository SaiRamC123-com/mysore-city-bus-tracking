import { Link } from "react-router-dom";
import CrowdBadge from "./CrowdBadge.jsx";
import { useI18n } from "../i18n/index.jsx";
import { clock, delayInfo, pick } from "../utils.js";

const TONE = { ok: "text-low", warn: "text-mid", bad: "text-high" };

export default function BusCard({ bus, selected = false, onSelect, distanceM }) {
  const { t, lang } = useI18n();
  const next = bus.nextStops[0];
  const d = delayInfo(bus.delayMin);

  return (
    <div className={`rounded-xl bg-white p-3 shadow-sm ${selected ? "ring-2 ring-lamp" : "ring-1 ring-ink/10"}`}>
      <button type="button" onClick={() => onSelect?.(bus.busId)} className="flex w-full items-start gap-3 text-left">
        <span className="grid h-10 min-w-12 place-items-center rounded-lg bg-ink px-2 font-display text-lg font-extrabold text-white">
          {bus.routeNumber}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {t("towards", { place: pick(lang, bus.towards, bus.towardsKn) })}
          </span>
          <span className="block text-sm text-ink/70">
            {bus.status === "AT_STOP"
              ? t("atStop", { stop: bus.currentStopName })
              : t("nextStop", { stop: pick(lang, bus.nextStopName, next?.nameKn) })}
          </span>
        </span>
        <span className={`shrink-0 text-sm font-semibold ${TONE[d.tone]}`}>{t(d.key, { n: d.n })}</span>
      </button>

      {next && (
        <p className="mt-2 text-sm text-ink/80">
          {t("time.scheduled")} {clock(next.scheduledTs)}
          {" → "}
          {t("time.expected")} <strong>{clock(next.predictedTs)}</strong>
          {next.marginMin ? ` (±${next.marginMin} ${t("min")})` : ""}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <CrowdBadge pct={bus.occupancyPct} level={bus.crowdLevel} source={bus.occupancySource} />
        <span className="flex items-center gap-3 text-xs">
          {bus.source === "simulator" && (
            <span className="rounded-full bg-lamp/30 px-2 py-0.5 font-semibold">{t("demo.bus")}</span>
          )}
          {distanceM != null && <span className="text-ink/60">{t("away", { km: (distanceM / 1000).toFixed(1) })}</span>}
          <Link to={`/bus/${bus.busId}`} className="font-semibold text-maroon underline underline-offset-2">
            {t("details")}
          </Link>
        </span>
      </div>
    </div>
  );
}
