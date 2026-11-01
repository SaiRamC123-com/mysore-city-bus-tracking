import L from "leaflet";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Leaflet icon for a bus: a pill with the route number, its border coloured by crowd level.
 * (A divIcon, so there are no image files to bundle.)
 */
export function busIcon(bus, selected = false) {
  const level = ["low", "medium", "high"].includes(bus.crowdLevel) ? bus.crowdLevel : "low";
  return L.divIcon({
    className: "bus-move",
    html: `<div class="bus-pin bus-pin--${level}${selected ? " bus-pin--sel" : ""}"><span>${esc(bus.routeNumber)}</span></div>`,
    iconSize: [44, 28],
    iconAnchor: [22, 14],
  });
}