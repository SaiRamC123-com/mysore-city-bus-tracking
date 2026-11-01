import { useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Safety sheet. It does NOT alert the bus company or any server: it helps the person call 112
 * and send their live location to someone they trust (share sheet or WhatsApp).
 */
export default function SOSButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const share = () => {
    if (!("geolocation" in navigator)) {
      setMsg(t("sos.noLocation"));
      return;
    }
    setBusy(true);
    setMsg(t("sos.locating"));
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const url = `https://www.google.com/maps?q=${p.coords.latitude},${p.coords.longitude}`;
        const text = t("sos.shareText", { url });
        setBusy(false);
        setMsg("");
        try {
          if (navigator.share) await navigator.share({ text });
          else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
        } catch {
          /* the person closed the share sheet */
        }
      },
      () => {
        setBusy(false);
        setMsg(t("sos.noLocation"));
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
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
