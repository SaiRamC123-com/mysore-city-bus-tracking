import { useT } from "../i18n/index.jsx";
import { levelOf } from "../utils.js";

const FILL = { low: "bg-low", medium: "bg-mid", high: "bg-high" };
const TEXT = { low: "text-low", medium: "text-mid", high: "text-high" };

/**
 * Crowd shown as a row of ten bus seats (green / orange / red). `source` says where the number
 * came from: "forecast" means nobody counted, it is the ML estimate, and the badge says so.
 */
export default function CrowdBadge({ pct, level, source, compact = false }) {
  const t = useT();
  const value = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  const lvl = level || levelOf(value);
  const filled = Math.round(value / 10);
  const estimated = source === "forecast" || source === "heuristic";

  return (
    <div className="inline-flex items-center gap-2" role="img" aria-label={`${t(`crowd.${lvl}`)}, ${value}%`}>
      <span className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={`h-3.5 w-2 rounded-[3px] ${i < filled ? FILL[lvl] : "bg-ink/15"}`} />
        ))}
      </span>
      <span className={`text-sm font-semibold ${TEXT[lvl]}`}>{compact ? `${value}%` : t(`crowd.${lvl}`)}</span>
      {!compact && (
        <span className="text-xs text-ink/60">
          {value}%{estimated ? ` ${t("crowd.estimated")}` : ""}
        </span>
      )}
    </div>
  );
}
