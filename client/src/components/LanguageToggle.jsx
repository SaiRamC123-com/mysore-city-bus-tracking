import { useI18n } from "../i18n/index.jsx";

export default function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "en" ? "kn" : "en")}
      className="rounded-full border border-white/30 px-3 py-1 text-sm font-semibold text-white hover:bg-white/10"
      aria-label={t("lang.label")}
    >
      {t("lang.other")}
    </button>
  );
}
