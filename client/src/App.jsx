import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import Home from "./pages/Home.jsx";
import StopPage from "./pages/StopPage.jsx";
import Planner from "./pages/Planner.jsx";
import BusDetail from "./pages/BusDetail.jsx";
import ScheduledTrip from "./pages/ScheduledTrip.jsx";
import Driver from "./pages/Driver.jsx";
import ChatWidget from "./components/ChatWidget.jsx";
import Logo from "./components/Logo.jsx";
import SOSButton from "./components/SOSButton.jsx";
import LanguageToggle from "./components/LanguageToggle.jsx";
import { useGeolocation } from "./hooks/useGeolocation.js";
import { useT } from "./i18n/index.jsx";
import { api } from "./api.js";

const navClass = ({ isActive }) =>
  `rounded-full px-3 py-1 text-sm font-semibold ${isActive ? "bg-lamp text-ink" : "text-white/85 hover:bg-white/10"}`;

export default function App() {
  const t = useT();
  const geo = useGeolocation(); // shared: the map's "near me" and the chatbot both use it
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const demo = health && (health.simulator || String(health.db).startsWith("memory"));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 bg-ink px-3 text-white shadow-md">
        <Link to="/" className="shrink-0" aria-label={t("app.name")}>
          <Logo name={t("app.name")} />
        </Link>
        {demo && <span className="rounded-full bg-lamp/25 px-2 py-0.5 text-xs font-semibold text-lamp">{t("demo.badge")}</span>}
        <nav className="ml-auto flex items-center gap-1" aria-label="Main">
          <NavLink to="/" end className={navClass}>
            {t("nav.map")}
          </NavLink>
          <NavLink to="/plan" className={navClass}>
            {t("nav.plan")}
          </NavLink>
          <NavLink to="/driver" className={navClass}>
            {t("nav.driver")}
          </NavLink>
          <LanguageToggle />
        </nav>
      </header>

      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<Home geo={geo} />} />
          <Route path="/stop/:stopId" element={<StopPage />} />
          <Route path="/plan" element={<Planner />} />
          <Route path="/bus/:busId" element={<BusDetail />} />
          <Route path="/trip/:routeId/:direction/:start" element={<ScheduledTrip />} />
          <Route path="/driver" element={<Driver />} />
          <Route path="*" element={<p className="p-6">{t("notFound")}</p>} />
        </Routes>
      </main>

      <SOSButton />
      <ChatWidget userPos={geo.pos} />
    </div>
  );
}