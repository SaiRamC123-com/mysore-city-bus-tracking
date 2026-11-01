import { useI18n } from "../i18n/index.jsx";
import { clock, pick } from "../utils.js";

const ROW = 64; // height of one stop row in px; the bus is placed with this number

/**
 * The live "bus line": stops in driving order down the page, the bus sliding along it as it moves.
 * Navy = already driven, amber = your ride (from your boarding stop to where you get off), grey = the rest.
 * `model` comes from lineModel() in busline.js.
 */
export default function BusLine({ model, bus }) {
  const { t, lang } = useI18n();
  const { rows, pos, hasTrip } = model;
  if (!rows.length) return null;

  const last = rows.length - 1;
  const cy = (i) => i * ROW + ROW / 2;
  const busY = pos == null ? null : cy(Math.min(pos, last));
  const fi = rows.findIndex((r) => r.role === "from");
  const ti = rows.findIndex((r) => r.role === "to");
  const rideTop = Math.max(fi >= 0 ? cy(fi) : 0, busY ?? 0);
  const rideBottom = ti >= 0 ? cy(ti) : 0;
  const showRide = hasTrip && ti >= 0 && rideBottom > rideTop;

  const ahead = new Map(bus.nextStops.map((s) => [s.stopId, s]));
  const done = new Map(bus.passed.map((p) => [p.stopId, p]));

  const timeText = (r) => {
    const id = r.stop.id;
    if (r.state === "passed") {
      const p = done.get(id);
      if (p?.skipped) return t("bus.skipped");
      return p?.arrivedTs ? `${t("time.arrived")} ${clock(p.arrivedTs)}` : "";
    }
    if (r.state === "here") return t("line.here");
    const n = ahead.get(id);
    return n ? `${t("time.expected")} ${clock(n.predictedTs)}${n.marginMin ? ` (±${n.marginMin} ${t("min")})` : ""}` : "";
  };

  return (
    <section aria-labelledby="busline" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-ink/10">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="busline" className="font-display text-xl font-extrabold">
          {t("line.title")}
        </h2>
        <span className="flex items-center gap-1.5 rounded-full bg-lamp px-2.5 py-1 text-xs font-extrabold text-ink">
          <span className="live-dot h-2 w-2 rounded-full bg-ink" />
          {t("line.live")}
        </span>
      </div>
      {hasTrip && pos == null && <p className="mb-3 rounded-lg bg-mist p-3 text-sm font-semibold">{t("line.pastDest")}</p>}

      <div className="relative" style={{ height: rows.length * ROW }}>
        {/* the rails */}
        <div className="absolute left-[18px] w-1 rounded-full bg-ink/15" style={{ top: cy(0), height: cy(last) - cy(0) }} />
        {showRide && <div className="absolute left-[16px] w-[8px] rounded-full bg-lamp" style={{ top: rideTop, height: rideBottom - rideTop }} />}
        {busY != null && <div className="absolute left-[17px] w-[6px] rounded-full bg-ink" style={{ top: cy(0), height: busY - cy(0) }} />}

        <ol>
          {rows.map((r) => (
            <li key={r.stop.id} className="relative flex items-center" style={{ height: ROW, paddingLeft: 56 }}>
              <span
                className={`absolute left-[12px] top-1/2 z-10 -translate-y-1/2 rounded-full border-[3px] ${
                  r.role === "to"
                    ? "h-[18px] w-[18px] border-ink bg-lamp"
                    : r.role === "from"
                      ? "h-[18px] w-[18px] border-ink bg-low"
                      : r.state === "passed"
                        ? "h-[14px] w-[14px] border-ink bg-ink"
                        : "h-[14px] w-[14px] border-ink bg-white"
                }`}
                style={r.role ? { left: 11 } : { left: 13 }}
              />
              <div className="min-w-0">
                <p className={`truncate font-semibold ${r.state === "passed" && !r.role ? "text-ink/50" : ""}`}>{pick(lang, r.stop.name, r.stop.nameKn)}</p>
                <p className="truncate text-sm text-ink/70">
                  {r.role === "from" && <span className="mr-2 rounded-full bg-low px-2 py-0.5 text-xs font-bold text-white">{t("track.from")}</span>}
                  {r.role === "to" && <span className="mr-2 rounded-full bg-lamp px-2 py-0.5 text-xs font-bold text-ink">{t("track.to")}</span>}
                  {timeText(r)}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {/* the bus itself */}
        {busY != null && (
          <div
            className="line-bus absolute left-0 z-20 grid h-8 w-10 place-items-center rounded-lg border-[3px] border-lamp bg-ink font-display text-sm font-extrabold text-white shadow-md"
            style={{ top: busY - 16 }}
            aria-label={`${bus.routeNumber}`}
          >
            {bus.routeNumber}
          </div>
        )}
      </div>
    </section>
  );
}