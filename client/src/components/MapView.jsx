import { useEffect, useRef } from "react";
import L from "leaflet";
import { busIcon } from "./BusMarker.jsx";
import { busPopupHtml } from "./busPopup.js";
import { useI18n } from "../i18n/index.jsx";
import { ROUTE_COLORS } from "../utils.js";

const MYSURU = [12.3052, 76.6552];
const tooltipNode = (text) => {
  const node = L.DomUtil.create("span");
  node.textContent = text;
  return node;
};

/**
 * Plain Leaflet inside React: routes + stops drawn once, bus markers moved as new data arrives.
 * focus = { fromId, toId, fromText, toText } marks the person's boarding and destination stops.
 * follow = keep the map centred on the selected bus as it moves.
 * segment = [[lat,lng], ...] drawn thick in amber: the part of the route the person will ride.
 * allStops = every stop in the city; the ones not on any route yet are drawn as small grey dots.
 */
export default function MapView({ routes, buses, selectedBusId, onSelectBus, onSelectStop, userPos, focus, follow = false, allStops, segment, className = "" }) {
    const { t, lang } = useI18n();
  const words = useRef({ t, lang }); // latest translator, for the bus popups
  words.current = { t, lang };
    const el = useRef(null);
  const map = useRef(null);
  const store = useRef({ buses: new Map(), user: null, fitted: false, zoomed: false });
  // Latest callbacks/data, so map event handlers never go stale.
  const onBus = useRef(onSelectBus);
  const onStop = useRef(onSelectStop);
  const busesRef = useRef(buses);
  onBus.current = onSelectBus;
  onStop.current = onSelectStop;
  busesRef.current = buses;

  // create the map once
  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false }).setView(MYSURU, 13);
    L.control.zoom({ position: "bottomright" }).addTo(m);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      store.current = { buses: new Map(), user: null, fitted: false, zoomed: false };
    };
  }, []);

  // route lines and stops
  useEffect(() => {
    const m = map.current;
    if (!m || !routes?.length) return undefined;
    const group = L.layerGroup().addTo(m);
    const bounds = [];
    const drawn = new Set();
    routes.forEach((r, i) => {
      const line = L.polyline(r.polyline, {
        color: ROUTE_COLORS[i % ROUTE_COLORS.length],
        weight: 4,
        opacity: 0.75,
        ...(r.source === "gtfs-upload" ? { dashArray: "8 6" } : {}),
      }).addTo(group);
      if (r.source === "gtfs-upload") {
        line.bindTooltip(tooltipNode(`${r.number}: unverified GTFS upload${r.shapeApprox ? " - schematic between stops; no shapes.txt path" : ""}`));
      }
      bounds.push(...r.polyline);
      for (const s of r.stops) {
        if (drawn.has(s.id)) continue; // shared stops are drawn once
        drawn.add(s.id);
        const role = s.id === focus?.fromId ? "from" : s.id === focus?.toId ? "to" : null;
        const marker = role
          ? L.circleMarker([s.lat, s.lng], { radius: 11, color: "#ffffff", weight: 3, fillColor: role === "from" ? "#1f9d6b" : "#ffb400", fillOpacity: 1 })
          : L.circleMarker([s.lat, s.lng], { radius: 6, color: "#0b2a5b", weight: 2, fillColor: "#ffffff", fillOpacity: 1 });
        const caption = role && focus?.[`${role}Text`] ? `${focus[`${role}Text`]}: ${s.name}` : s.name;
        marker
          .bindTooltip(tooltipNode(caption), role ? { permanent: true, direction: "top", offset: [0, -10] } : undefined)
          .on("click", () => onStop.current?.(s.id))
          .addTo(group);
      }
    });
    if (!store.current.fitted && !follow && bounds.length) {
      m.fitBounds(bounds, { padding: [30, 30] });
      store.current.fitted = true;
    }
    return () => group.remove();
  }, [routes, focus?.fromId, focus?.toId, focus?.fromText, focus?.toText]);

  // "your ride": the stretch between boarding and getting off, highlighted
  useEffect(() => {
    const m = map.current;
    if (!m || !segment || segment.length < 2) return undefined;
    const line = L.polyline(segment, { color: "#ffb400", weight: 9, opacity: 0.95, lineCap: "round" }).addTo(m);
    line.bringToBack();
    return () => line.remove();
  }, [segment]);

  // stops that no route serves yet (grey, so you can see what has been added)
  useEffect(() => {
    const m = map.current;
    if (!m || !allStops?.length) return undefined;
    const onRoute = new Set((routes || []).flatMap((r) => r.stops.map((x) => x.id)));
    const group = L.layerGroup().addTo(m);
    for (const s of allStops) {
      if (onRoute.has(s.id)) continue;
      L.circleMarker([s.lat, s.lng], { radius: 5, color: "#6b7280", weight: 2, fillColor: "#e5e7eb", fillOpacity: 1 })
        .bindTooltip(tooltipNode(s.name))
        .on("click", () => onStop.current?.(s.id))
        .addTo(group);
    }
    return () => group.remove();
  }, [allStops, routes]);

  // bus markers
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const markers = store.current.buses;
    const seen = new Set();
    for (const b of buses) {
      seen.add(b.busId);
      const icon = busIcon(b, b.busId === selectedBusId);
      const look = `${b.routeNumber}|${b.crowdLevel}|${b.busId === selectedBusId}`;
      const popup = busPopupHtml(b, words.current.t, words.current.lang); // opens when the bus is tapped
      const existing = markers.get(b.busId);
      if (existing) {
        existing.setLatLng([b.lat, b.lng]);
                existing.setPopupContent(popup);
        // Only swap the icon when it really looks different: replacing it every update would cancel the gliding.
        if (existing.__look !== look) {
          existing.setIcon(icon);
          existing.__look = look;
        }
      } else {
        const mk = L.marker([b.lat, b.lng], { icon, zIndexOffset: 500 }).addTo(m);
                mk.bindPopup(popup, { className: "bus-popup", offset: [0, -8], maxWidth: 300 });
        mk.on("click", () => onBus.current?.(b.busId));
        mk.__look = look;
        markers.set(b.busId, mk);
      }
    }
    for (const [id, mk] of markers) {
      if (!seen.has(id)) {
        mk.remove();
        markers.delete(id);
      }
    }
  }, [buses, selectedBusId]);

  // pan to a bus when it gets selected
  useEffect(() => {
    const b = busesRef.current.find((x) => x.busId === selectedBusId);
    if (b && map.current) map.current.panTo([b.lat, b.lng]);
  }, [selectedBusId]);

  // keep the bus in view while following it (zoom in once, then just move with it)
  useEffect(() => {
    const m = map.current;
    if (!follow || !m) return;
    const b = buses.find((x) => x.busId === selectedBusId) ?? buses[0];
    if (!b) return;
    if (!store.current.zoomed) {
      m.setView([b.lat, b.lng], 15);
      store.current.zoomed = true;
    } else {
      m.panTo([b.lat, b.lng], { animate: true });
    }
  }, [buses, follow, selectedBusId]);

  // "you are here"
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (store.current.user) {
      store.current.user.remove();
      store.current.user = null;
    }
    if (userPos) {
      store.current.user = L.circleMarker([userPos.lat, userPos.lng], {
        radius: 8,
        color: "#ffffff",
        weight: 3,
        fillColor: "#3d5afe",
        fillOpacity: 1,
      }).addTo(m);
    }
  }, [userPos]);

  return <div ref={el} className={className} role="application" aria-label="Map of Mysuru city buses" />;
}