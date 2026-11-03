# Mysore City Bus Tracking

Mysuru city bus map and trip planner with GPS-reported live buses, passenger crowd estimates, conductor-reported seat availability, and English/Kannada UI.

## Project layout

- `client/` — React + Vite frontend.
- `server/` — Express API, Firebase Realtime Database/Firestore integration, driver dashboard API, and route data.
- `ml-service/` — optional FastAPI prediction service. The Node API falls back to heuristic crowd estimates when it is not configured.
- `docs/` — data collection and Firebase security guidance.

## Local development

Requires Node.js 20 or newer. Copy `client/.env.example` to `client/.env` and `server/.env.example` to `server/.env`, then supply the appropriate values. Never commit `.env` files or Firebase service-account credentials.

```sh
npm install
npm run build
npm test
npm run dev --workspace server
npm run dev --workspace client
```

Without an imported feed, the production route and stop APIs intentionally return no route data. The bundled seed data is available only through the Driver page's Practice Mode. Configure Firebase server credentials for persistent live bus state and GTFS feed storage.

## Deployment

The Vite frontend is in `client/`; production defaults to `https://mysore-city-bus-api.vercel.app`, while `VITE_API_URL` can override it for another deployment. Configure the public `VITE_FIREBASE_*` client settings if using Firebase live subscriptions. The Express API is in `server/` and needs server-only Firebase credentials, a persistent Firebase configuration, and `CLIENT_ORIGIN` set to the frontend origin. Configure `GROQ_API_KEY` as a backend-only secret to enable the assistant; never use a `VITE_` prefix for it. Set secrets in the hosting provider's environment configuration, not in source files.

## Import an authorized GTFS feed

No authentic Mysuru KSRTC GTFS feed is bundled or implied. The importer accepts an authorized ZIP containing `routes.txt`, `stops.txt`, `trips.txt`, and `stop_times.txt`. `shapes.txt`, `calendar.txt`, `calendar_dates.txt`, and `agency.txt` are supported optional files. Imported data is labeled **unverified** until checked against an authoritative source; static GTFS shapes and timetables are not live GPS.

1. Configure persistent Firebase credentials (`FIREBASE_SERVICE_ACCOUNT_JSON` and `FIREBASE_DATABASE_URL`) and a private `GTFS_IMPORT_SECRET` in `server/.env` or the backend host's secret settings.
2. With the GTFS ZIP available locally, run:

   ```sh
   npm run import:gtfs --workspace server -- "C:\path\to\authorized-feed.zip"
   ```

   Or POST the ZIP to `/api/admin/gtfs/import` using `Content-Type: application/zip` and the `x-gtfs-import-secret` header. The API upload limit is 4 MB. The import CLI uses the same validation and also has a 4 MB archive limit.
3. Check `GET /api/gtfs/status`. The new feed becomes active only after its validated records have been written to a versioned Firestore feed.

The importer validates file headers, required columns, IDs/references, stop coordinates, trip sequences/times, calendar rows, and shape geometry. Without a service calendar, the planner can show feed times for reference but will not present them as today's active departures. Without `shapes.txt`, the map draws a clearly labeled stop-to-stop schematic. Use Practice Mode to try the bundled demo routes; it does not add them to production route search.

See `docs/data-collection.md` and `docs/firebase-rules.md` for data and access details.
