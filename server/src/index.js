import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { firebaseConfigured, memoryFallback, usingMemory } from "./config/firebase.js";
import { getStatic } from "./services/dataService.js";
import { mlHealth } from "./services/mlClient.js";
import { apiLimiter, chatLimiter } from "./middleware/rateLimit.js";
import busesRoutes from "./routes/buses.routes.js";
import stopsRoutes from "./routes/stops.routes.js";
import recommendRoutes from "./routes/recommend.routes.js";
import driverRoutes from "./routes/driver.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import gtfsRoutes from "./routes/gtfs.routes.js";
import { startSimulator } from "./services/simulator.js";

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: env.clientOrigins }));
app.use(express.json({ limit: "50kb" }));
app.use(morgan("dev"));

app.get("/api/health", async (_req, res) => {
  const { routeList, metadata } = await getStatic();
  res.json({
    ok: true,
    db: memoryFallback ? "memory (demo fallback)" : usingMemory ? "memory (demo)" : "firebase",
    firebaseConfigured,
    persistentLiveData: !usingMemory,
    simulator: env.runSimulator,
    groqConfigured: !!env.groqKey,
    groqModel: env.groqModel,
    driverEndpoint: !!env.driverSecret && !usingMemory,
    gtfs: {
      available: Boolean(metadata?.feedId),
      verified: metadata?.verified ?? false,
      sourceLabel: metadata?.sourceLabel ?? "No imported GTFS feed",
      routeCount: routeList.length,
      serviceCalendarAvailable: metadata?.serviceCalendarAvailable ?? false,
    },
    ml: await mlHealth(),
    time: new Date().toISOString(),
  });
});

// The server has no web page of its own. Say so, instead of a confusing "Not found".
app.get("/", (_req, res) => {
  res
    .type("text/plain")
    .send(
      `Mysuru Bus API is running.\n\nThis address is the server, not the app.\nOpen the app at: ${env.clientOrigins[0]}\n\nCheck the server: /api/health\nLive buses: /api/buses\n`
    );
});

app.use("/api/chat", chatLimiter);
app.use("/api", apiLimiter);
app.use("/api", busesRoutes);
app.use("/api", stopsRoutes);
app.use("/api", recommendRoutes);
app.use("/api", driverRoutes);
app.use("/api", chatRoutes);
app.use("/api", gtfsRoutes);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && status !== 502 && status !== 503 ? "Something went wrong on the server." : err.message });
});

export default app;

if (process.env.VERCEL !== "1") {
  const stat = await getStatic();
  app.listen(env.port, () => {
    console.log(`Mysuru Bus API on http://localhost:${env.port}  (db: ${usingMemory ? "memory" : "firebase"}, routes: ${stat.routeList.length}, stops: ${Object.keys(stat.stops).length})`);
    if (!stat.routeList.length) console.log("NOTE: no imported GTFS feed is active; demo seed data is available only through Practice Mode.");
    if (!env.groqKey) console.log("NOTE: GROQ_API_KEY not set, the chatbot endpoint will return 503.");
    if (!env.driverSecret) console.log("NOTE: DRIVER_SECRET not set, the driver endpoint is disabled.");
  });

  if (env.runSimulator) {
    startSimulator({ busesPerRoute: env.simBusesPerRoute }).then(() => console.log(`Simulator running: ${env.simBusesPerRoute} demo buses per route`));
  }
}