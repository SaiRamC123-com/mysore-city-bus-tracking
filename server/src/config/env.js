import "dotenv/config";

const bool = (v, d = false) => (v == null || v === "" ? d : String(v).toLowerCase() === "true");

export const env = {
  port: Number(process.env.PORT || 5000),
  clientOrigins: (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  useMemoryDb: bool(process.env.USE_MEMORY_DB),
  firebaseDbUrl: process.env.FIREBASE_DATABASE_URL,
  credPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json",
  groqKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  mlUrl: (process.env.ML_SERVICE_URL || "").replace(/\/$/, ""),
  driverSecret: process.env.DRIVER_SECRET,
  runSimulator: bool(process.env.RUN_SIMULATOR),
  simBusesPerRoute: Number(process.env.SIM_BUSES_PER_ROUTE || 2),
  festivalMode: bool(process.env.FESTIVAL_MODE),
};
