import { useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Safety sheet. It does NOT alert the bus company or any server: it helps the person call 112
 * and prepare a location message in the native share sheet or SMS app.
 */
export default function SOSButton({ userPos }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [smsHref, setSmsHref] = useState("");

  const prepareShare = async (position, isFallback = false) => {
    const url = `https://www.google.com/maps?q=${position.lat},${position.lng}`;
    const text = t("sos.shareText", { url });
    setSmsHref(`sms:?body=${encodeURIComponent(text)}`);
    setMsg(isFallback ? t("sos.lastKnown") : t("sos.shareReady"));
    if (!navigator.share) return;
    try {
      await navigator.share({ text });
    } catch (error) {
      if (error?.name !== "AbortError") setMsg(t("sos.shareFallback"));
    }
  };

  const useLastKnownLocation = async () => {
    if (userPos && Date.now() - userPos.ts <= 15 * 60_000) {
      await prepareShare(userPos, true);
      return;
    }
    setMsg(t("sos.noLocation"));
  };

  const share = () => {
    setSmsHref("");
    if (!("geolocation" in navigator)) {
      void useLastKnownLocation();
      return;
    }
    setBusy(true);
    setMsg(t("sos.locating"));
    try {
      navigator.geolocation.getCurrentPosition(
        async (p) => {
          setBusy(false);
          await prepareShare({ lat: p.coords.latitude, lng: p.coords.longitude });
        },
        () => {
          setBusy(false);
          void useLastKnownLocation();
        },
        { enableHighAccuracy: true, timeout: 12000 }
      );
    } catch {
      setBusy(false);
      void useLastKnownLocation();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[1100] rounded-full bg-high px-4 py-3 text-sm font-bold text-white shadow-lg"
      >
        {t("sos.button")}
      </button>

      {open && (
        <div className="fixed inset-0 z-[1200] grid place-items-end bg-ink/50 sm:place-items-center" role="dialog" aria-modal="true" aria-label={t("sos.title")}>
          <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <h2 className="font-display text-xl font-extrabold">{t("sos.title")}</h2>
            <div className="mt-4 space-y-3">
              <a href="tel:112" className="block rounded-xl bg-high px-4 py-3 text-center font-bold text-white">
                {t("sos.call")}
              </a>
              <button type="button" onClick={share} disabled={busy} className="block w-full rounded-xl bg-ink px-4 py-3 font-bold text-white disabled:opacity-60">
                {t("sos.share")}
              </button>
              {msg && <p className="text-sm text-ink/70" aria-live="polite">{msg}</p>}
              {smsHref && (
                <a href={smsHref} className="block rounded-xl border border-ink/20 px-4 py-3 text-center font-semibold">
                  {t("sos.openSms")}
                </a>
              )}
            </div>
            <p className="mt-4 text-xs text-ink/60">{t("sos.note")}</p>
            <button type="button" onClick={() => setOpen(false)} className="mt-3 w-full rounded-xl border border-ink/20 px-4 py-2 font-semibold">
              {t("sos.close")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
