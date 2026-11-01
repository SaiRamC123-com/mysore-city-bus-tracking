// The little card that opens when someone taps a bus on the map. Returns HTML for a Leaflet popup,
// so every piece of text is escaped. Pure function (no browser), easy to test.
import { delayInfo, levelOf, pick } from "../utils.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function busPopupHtml(bus, t, lang) {
  const place = pick(lang, bus.towards, bus.towardsKn);
  const nextName = bus.nextStopName
    ? pick(lang, bus.nextStopName, bus.nextStops?.[0]?.nameKn)
    : bus.nextStops?.[0]
      ? pick(lang, bus.nextStops[0].name, bus.nextStops[0].nameKn)
      : "";

  const seatCapacity = Number.isInteger(bus.seatCapacity) && bus.seatCapacity > 0 ? bus.seatCapacity : null;
  const hasSeatCount =
    seatCapacity != null &&
    Number.isInteger(bus.occupiedSeats) &&
    Number.isInteger(bus.availableSeats) &&
    Number.isInteger(bus.standingPassengers) &&
    Number.isFinite(bus.seatOccupancyPct) &&
    ["free", "normal", "crowded", "full"].includes(bus.crowdStatus);
  const seatGrid = seatCapacity
    ? `<div class="bp-seat-grid" role="img" aria-label="${esc(t("pop.seatGrid", { n: seatCapacity }))}">` +
      Array.from({ length: seatCapacity }, (_, index) => {
        const seatClass = hasSeatCount ? (index < bus.occupiedSeats ? "occupied" : "available") : "unavailable";
        return `<i class="bp-seat bp-seat-${seatClass}"></i>`;
      }).join("") +
      `</div><div class="bp-legend"><span><i class="bp-seat-available"></i>${esc(t("pop.available"))}</span><span><i class="bp-seat-occupied"></i>${esc(t("pop.occupied"))}</span><span><i class="bp-seat-unavailable"></i>${esc(t("pop.unavailable"))}</span></div>`
    : "";
  let crowd;
  if (hasSeatCount) {
    crowd =
      `<p class="bp-level bp-status-${bus.crowdStatus}">${esc(t(`pop.status.${bus.crowdStatus}`))} · ${Math.round(bus.seatOccupancyPct * 10) / 10}%</p>` +
      seatGrid +
      `<p class="bp-line">${esc(t("pop.seatCapacity", { n: seatCapacity }))} · ${esc(t("pop.seatCounts", { occupied: bus.occupiedSeats, available: bus.availableSeats }))}</p>` +
      `<p class="bp-line">${esc(t("pop.standing", { n: bus.standingPassengers }))}</p>` +
      `<p class="bp-note">${esc(bus.occupancySource === "simulated" ? t("pop.simulated") : t("pop.counted"))}</p>`;
  } else {
    const pct = Math.max(0, Math.min(100, Math.round(bus.occupancyPct ?? 0)));
    const lvl = ["low", "medium", "high"].includes(bus.crowdLevel) ? bus.crowdLevel : levelOf(pct);
    const filled = Math.round(pct / 10);
    const bars = Array.from({ length: 10 }, (_, i) => `<i${i < filled ? ' class="on"' : ""}></i>`).join("");
    const how =
      bus.source === "scheduled"
        ? t("pop.noGps")
        : bus.occupancySource === "forecast"
          ? t("pop.forecast")
          : bus.occupancySource === "simulated"
            ? t("pop.simulated")
            : t("pop.counted");
    crowd =
      (bus.source !== "scheduled" ? `<p class="bp-level bp-${lvl}">${esc(t(`crowd.${lvl}`))} · ${pct}%</p>` : "") +
      (bus.source !== "scheduled" ? `<div class="bp-seats bp-${lvl}">${bars}</div>` : "") +
      seatGrid +
      (seatCapacity ? `<p class="bp-line">${esc(t("pop.seatCapacity", { n: seatCapacity }))}</p>` : "") +
      `<p class="bp-note">${esc(how)}</p>` +
      `<p class="bp-note">${esc(t("pop.seatDataUnavailable"))}</p>` +
      (bus.occupancy != null && bus.capacity && bus.source !== "scheduled"
        ? `<p class="bp-line"><b>${esc(t("pop.passengers", { n: bus.occupancy, cap: bus.capacity }))}</b></p>`
        : "");
  }

  const lines = [];
  if (nextName) lines.push(esc(t("nextStop", { stop: nextName })));
  if (bus.source !== "scheduled") {
    const d = delayInfo(bus.delayMin);
    lines.push(`<span class="bp-d-${d.tone}">${esc(t(d.key, { n: d.n }))}</span> · ${esc(t("pop.speed", { n: Math.round(bus.speedKmh ?? 0) }))}`);
  }

  const updated = Number.isFinite(bus.updatedAt)
    ? new Date(bus.updatedAt).toLocaleTimeString(lang === "kn" ? "kn-IN" : "en-IN", { hour: "numeric", minute: "2-digit" })
    : "";
  return (
    `<div class="bp"><div class="bp-head"><span class="bp-num">${esc(bus.routeNumber)}</span><span>${esc(t("towards", { place }))}</span></div>` +
    `<p class="bp-note">${esc(t("pop.busId", { id: bus.busId }))}</p>` +
    crowd +
    lines.map((l) => `<p class="bp-line">${l}</p>`).join("") +
    (updated ? `<p class="bp-note">${esc(t("pop.updated", { time: updated }))}</p>` : "") +
    `</div>`
  );
}