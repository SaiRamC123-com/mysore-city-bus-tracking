# Mysuru Bus

Live Mysuru city-bus tracker that also tells you **how crowded each bus is**, **when it reaches and leaves each stop** (scheduled, expected and actual), and **whether to go now or wait**, with a Groq-powered chatbot that answers from the app's real data.

```
client/       React + Vite + Tailwind + Leaflet         http://localhost:5173
server/       Node + Express, Firebase, Groq chatbot    http://localhost:5000
ml-service/   Python FastAPI, scikit-learn models       http://localhost:8000
docs/         data-collection.md, firebase-rules.md
```

## Read this first: what is real and what is demo

- **Demo data.** Stops, route numbers (201, 62, 44, 33) and timetables are placeholders. Coordinates are approximate and the route numbers are not official KSRTC numbers. See `docs/data-collection.md` to replace them with surveyed data.
- **Simulated buses.** With `RUN_SIMULATOR=true` the server drives fake buses along those routes through the same code path a real driver phone uses. The app labels them "Demo bus", and so does the chatbot.
- **Synthetic ML models.** Until you have logged real trips, the crowd and ETA models are trained on generated data that encodes plausible Mysuru patterns. Their accuracy numbers only prove the pipeline works. The app shows what each forecast was trained on.
- **Where real data comes from.** The `/driver` page on a conductor's or driver's phone sends GPS and a passenger count. That is the real data source, and it needs the operator's permission.

## What has been tested, and what has not

This code was written and checked in a sandbox that could not reach npm or PyPI, so **nothing was installed from them and the full stack was never started**. Specifically:

| Part | Checked | Not checked |
|---|---|---|
| Server logic (stop detection, geo, ETA, crowd, recommend, simulator, chatbot tool loop) | 28 unit tests (`npm test`) and a 26-check run of the real modules in memory mode with a stand-in ML server | Express routes and middleware, Firebase, the real Groq API |
| ML service | Training scripts and 9 tests run with scikit-learn 1.9 | `app/main.py` (FastAPI wrapper) was only byte-compiled |
| Client | All files parse, every translation key exists in both languages, 21 render checks with real server output, English and Kannada | Vite build, Tailwind styling, Leaflet map, browser behaviour, how it looks |

Expect to fix small things on first run. If something fails, the error messages are written to say what to change.

## Quick start (demo mode, no Firebase needed)

You need Node 20+ and Python 3.10+.

### 1. ML service

```bash
cd ml-service
python -m venv venv
# Windows:  venv\Scripts\activate        macOS/Linux:  source venv/bin/activate
pip install -r requirements.txt
python training/train_crowd.py
python training/train_eta.py
python -m unittest discover -s tests -v      # optional check
uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000/health. It should list both models.

### 2. Server

```bash
cd server
npm install express cors dotenv helmet morgan express-rate-limit zod groq-sdk firebase-admin
npm install -D nodemon
copy .env.example .env          # macOS/Linux: cp .env.example .env
```

Edit `server/.env` for the demo:

```
USE_MEMORY_DB=true
RUN_SIMULATOR=true
DRIVER_SECRET=pick-a-long-random-string
GROQ_API_KEY=your-key-from-console.groq.com
```

Then:

```bash
npm test          # 28 tests, no network needed
npm run dev
```

Open http://localhost:5000/api/health and http://localhost:5000/api/buses. After a few seconds you should see 8 demo buses. The server runs without the ML service (it falls back to rules and says so), and without a Groq key (the chat endpoint returns a clear 503).

### 3. Client

```bash
cd client
npm install react react-dom react-router-dom leaflet firebase
npm install -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite
copy .env.example .env          # macOS/Linux: cp .env.example .env
npm run dev
```

Leave the `VITE_FIREBASE_*` lines empty in demo mode: the client then polls the server every 3 seconds. Open http://localhost:5173.

## Switching to Firebase

1. Firebase console, new project, then **Build > Realtime Database** (region `asia-southeast1`) and **Build > Firestore Database**.
2. **Project settings > Service accounts > Generate new private key.** Save it as `server/serviceAccountKey.json`.
3. In `server/.env`:
   ```
   USE_MEMORY_DB=false
   FIREBASE_DATABASE_URL=https://YOUR-PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app
   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
   ```
4. `cd server && npm run seed` copies routes, stops and timetables to Firestore.
5. In the Firebase console, **Project settings > General > Your apps > Web**, register an app and copy its config into `client/.env` (all five `VITE_FIREBASE_*` values). The client now gets live buses through Firebase instead of polling.
6. Replace the test-mode rules with the ones in `docs/firebase-rules.md`.

With Firebase you can run the simulator in the server (`RUN_SIMULATOR=true`) or as a separate process (`npm run simulate`).

## Real buses: the driver page

Open `/driver` on a phone, enter the `DRIVER_SECRET`, a bus ID, the route and the scheduled trip, and tap **Start sharing location**. The conductor taps +/- to count passengers. Until the first tap, no count is sent, so the app shows an ML estimate marked "estimated" instead of reporting an empty bus.

Phones only share location on **https://** pages (or localhost). To test on a phone, deploy the client and server (for example Vercel and Render) or use a tunnel, then add the client's URL to `CLIENT_ORIGIN` in `server/.env`.

## The chatbot

`POST /api/chat` runs a tool-calling loop on Groq: the model decides which tool to call (live buses, next buses at a stop, recommend a bus, route info, today's schedule, which routes serve a stop), the server runs it against its own data, and the model answers from the result. Its rules forbid inventing times, claiming a bus is "safe" (crowd level is a comfort measure), or passing off demo buses as real. Set `GROQ_MODEL` in `server/.env` to a current tool-capable model from console.groq.com/docs/models.

## API summary

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Database mode, simulator, Groq and ML status |
| `GET /api/buses?route=` | Live buses (polling fallback for the client) |
| `GET /api/routes`, `GET /api/stops` | Geometry and stops for the map |
| `GET /api/stops/:id/arrivals` | Next buses: scheduled, expected (± margin), delay, crowd |
| `GET /api/stops/:id/forecast` | Hourly crowd forecast for each route at the stop |
| `GET /api/routes/:id/today` | Today's trips and which are running |
| `GET /api/routes/:id/trips?direction=` | Trips near now (used by the driver page) |
| `GET /api/events?busId=` | Recent ARRIVED / DEPARTED / SKIPPED events |
| `GET /api/recommend?from=&to=` | Best bus now, balancing waiting time against crowd |
| `POST /api/driver/ping` | Driver phone location and count (header `x-driver-secret`) |
| `POST /api/chat` | Chatbot |

## How arrival and departure are detected

Each bus is a small state machine: **ARRIVED** when it is inside a stop's geofence and slower than 5 km/h, **DEPARTED** when it leaves the geofence or speeds up after at least 5 s, and **SKIPPED** if it drives past without stopping (also used to catch up after a GPS gap). Passengers see three values: **scheduled** (timetable), **expected** (live estimate with a margin that grows with distance) and **actual** (logged after the fact).

## Tests

```bash
cd server && npm test                                          # stop detection, geo, time
cd ml-service && python -m unittest discover -s tests -v       # after training
```

## Known limits

- Kannada text was written without native review. Please have a Kannada speaker read `client/src/i18n/kn.json`.
- The ETA margin (±) is a simple rule that grows with distance; replace it with the model's validation error once real trips are logged.
- Route lines are straight between stops until you supply road-following polylines.
- The SOS sheet helps the person call 112 and share their location. It does not alert the bus company or any server.
- Stop-level crowd and ETA models know each route only by its `mlId`; adding a route means retraining on data that includes it.
