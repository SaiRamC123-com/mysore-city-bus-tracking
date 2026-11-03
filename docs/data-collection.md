# Route data and GTFS imports

`server/data/*.seed.json` ships with **Practice Mode demo data** only:

- Stop coordinates are approximate placeholders (`"verified": false`). They are close to the real places but not surveyed.
- Route numbers 201, 62, 44 and 33 and their timetables are invented for the demo. They are not official KSRTC numbers or timings.
- Route lines are straight segments between stops, so distances are shorter than the real road.

These seed files are not used by production route, stop, map, or trip-planning APIs. The application does not currently include an authenticated official Mysuru KSRTC route feed.

## Import an authorized GTFS ZIP

Use the import workflow documented in the root [README](../README.md). Provide an authorized ZIP with `routes.txt`, `stops.txt`, `trips.txt`, and `stop_times.txt`. `shapes.txt`, `calendar.txt`, `calendar_dates.txt`, and `agency.txt` are supported when present.

The importer writes each feed as a versioned set of Firestore collections and switches the active-feed pointer only after all documents have been stored. It marks all imported routes and stops unverified. Verify the source and coordinates with KSRTC before treating this feed as authoritative. Static shapes are route geometry only; they do not represent live vehicle positions.

If `calendar.txt`/`calendar_dates.txt` are absent, trip times can be shown as feed reference times, but the service day cannot be confirmed. Without `shapes.txt`, the map shows a stop-to-stop schematic, not a road-following path.

## Practice seed data

The following legacy JSON details are retained solely for local Practice Mode. Editing them does not publish or activate production routes.

## 1. Stops (`stops.seed.json`)

Stand at the exact place the bus stops (not the building it is named after) and record the phone's GPS position, or drop a pin on OpenStreetMap and check it against satellite view.

```json
{ "id": "s_palace", "name": "Mysore Palace (South Gate)", "nameKn": "ಮೈಸೂರು ಅರಮನೆ",
  "aliases": ["palace", "aramane"], "lat": 12.3040, "lng": 76.6552, "radiusM": 40, "verified": true }
```

- `radiusM`: the geofence. 40 to 50 m works for most city stops; use less on narrow lanes where two stops are close.
- `aliases`: other names people use. The chatbot and the planner search these.
- Set `verified` to `true` once you have checked it on the ground.
- One stop is shared by every route that uses it (for example the City Bus Stand).

## 2. Routes (`routes.seed.json`)

```json
{ "id": "r201", "number": "201", "name": "City Bus Stand ⇄ Chamundi Hills", "nameKn": "…",
  "mlId": 1, "stopIds": ["s_cbs", "s_palace", "s_lalitha", "s_chamundi_base", "s_chamundi_temple"],
  "polyline": [[12.3086, 76.6504], [12.3040, 76.6552]] }
```

- `stopIds` is in the outbound order. The return trip uses the same stops reversed.
- Remove `"demo": true` for a real route.
- `polyline` is optional. Without it the app draws straight lines between stops. For a road-following line, draw the route in a tool such as geojson.io or export it from OSRM, and paste the `[lat, lng]` pairs. Every stop must lie within about 30 m of the line, or arrival detection will miss it.
- `mlId` is the number the ML models know the route by. Give each route its own.

## 3. Timetables (`schedule.seed.json`)

```json
{ "routeId": "r201", "firstDeparture": "06:00", "lastDeparture": "21:00", "headwayMin": 20,
  "avgSpeedKmh": 15, "dwellSec": 30 }
```

This generates a departure every `headwayMin` minutes in both directions, with scheduled stop times computed from distance, `avgSpeedKmh` and `dwellSec`. If you have the printed or board timetable for a route, add `"offsets": { "s_cbs": 0, "s_palace": 4, ... }` (minutes after departure, per stop id) and those exact times are used instead.

## 4. Load practice data

- The Driver page loads bundled seed routes only when Practice Mode is selected.
- Production route APIs never fall back to these seeds.

Run `npm test` in `server/`. It checks that every stop comes after the previous one along each route and that scheduled times increase.

## 5. Real crowd and ETA data

Every time a driver's phone sends a passenger count, the server logs it to Firestore (`crowd_logs`), and every arrival and departure goes to `stop_events`. Once you have a few weeks of real trips:

```bash
cd server && npm run export:training        # writes ml-service/data/*.csv (simulator rows are skipped)
cd ../ml-service
python training/train_crowd.py --csv data/crowd_logs.csv
python training/train_eta.py   --csv data/eta_segments.csv
```

The models then report that they were trained on real logged rows, and the app shows that label next to forecasts.

## 6. Per-bus seat occupancy

The conductor ping stores live occupancy in Firebase Realtime Database at `bus_live/{busId}` (or in the server's in-memory live-bus store when demo mode is enabled). Each bus record includes its own `seatCapacity`, total `occupancy`, `standingPassengers`, derived `occupiedSeats`, `availableSeats`, `seatOccupancyPct`, `crowdStatus`, and `updatedAt`. The existing live subscription/polling path delivers changes to the matching bus popup.

Conductors should report the total passengers on board and the number standing. Seat counts are shown only when the reported counts are consistent with that bus's seat capacity. Forecast crowd estimates and timetable-only buses do not provide measured seat availability; the popup labels the estimate and marks unavailable seat counts instead. GPS location is not used to infer passenger counts. Simulator seat counts are demonstration data and are labelled as such.
