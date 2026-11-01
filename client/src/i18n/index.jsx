import { createContext, useCallback, useContext, useMemo, useState } from "react";
import en from "./en.json";
import kn from "./kn.json";

const dict = { en, kn };
const Ctx = createContext(null);

const readLang = () => {
  try {
    return localStorage.getItem("lang") === "kn" ? "kn" : "en";
  } catch {
    return "en";
  }
};

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(readLang);

  const setLang = useCallback((l) => {
    setLangState(l);
    try {
      localStorage.setItem("lang", l);
    } catch {
      /* private mode: just don't remember it */
    }
    document.documentElement.lang = l;
  }, []);

  // t("late", { n: 4 }) -> "4 min late"; falls back to English, then to the key itself.
  const t = useCallback(
    (key, vars = {}) => {
      let s = dict[lang][key] ?? dict.en[key] ?? key;
      for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;