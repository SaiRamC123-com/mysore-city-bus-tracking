// India has no DST, so IST is a fixed UTC+05:30 offset.
export const IST_MS = 5.5 * 3600 * 1000;
export const DAY_MS = 86_400_000;

export const dayStartTs = (ts) => Math.floor((ts + IST_MS) / DAY_MS) * DAY_MS - IST_MS;

export function istParts(ts) {
  const d = new Date(ts + IST_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: (d.getUTCDay() + 6) % 7, // Monday = 0 ... Sunday = 6
  };
}

export const fmtClock = (ts) => {
  if (ts == null) return null;
  const p = istParts(ts);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

export const parseHHMM = (s) => {
  const [h, m] = String(s).split(":").map(Number);
  return (h * 60 + m) * 60_000;
};

export const isLateNight = (ts) => {
  const h = istParts(ts).hour;
  return h >= 21 || h < 5;
};
