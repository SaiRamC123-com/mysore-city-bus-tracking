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

By default, the server can run against its in-memory demo store. Configure Firebase server credentials to persist live bus state and Firestore route data.

## Deployment

The Vite frontend is in `client/`; production defaults to `https://mysore-city-bus-api.vercel.app`, while `VITE_API_URL` can override it for another deployment. Configure the public `VITE_FIREBASE_*` client settings if using Firebase live subscriptions. The Express API is in `server/` and needs server-only Firebase credentials, a persistent Firebase configuration, and `CLIENT_ORIGIN` set to the frontend origin. Configure `GROQ_API_KEY` as a backend-only secret to enable the assistant; never use a `VITE_` prefix for it. Set secrets in the hosting provider's environment configuration, not in source files.

See `docs/data-collection.md` and `docs/firebase-rules.md` for data and access details.
