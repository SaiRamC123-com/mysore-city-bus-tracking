import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useT } from "../i18n/index.jsx";

/**
 * Floating chat with the Groq-powered assistant. The server does the AI work (and keeps the API key);
 * this only sends the message, the last few turns, and the person's location if they already shared it.
 */
export default function ChatWidget({ userPos }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]); // { role: "user" | "assistant", content, error? }
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, open]);

  const send = async (raw) => {
    const message = raw.trim();
    if (!message || busy) return;
    const history = messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: message }]);
    setText("");
    setBusy(true);
    try {
      const out = await api.chat({
        message,
        history,
        location: userPos ? { lat: userPos.lat, lng: userPos.lng } : null,
      });
      setMessages((m) => [...m, { role: "assistant", content: out.reply || t("chat.empty") }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: e.message || t("chat.error"), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const suggestions = [t("chat.s1"), t("chat.s2"), t("chat.s3")];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-[1100] rounded-full bg-lamp px-5 py-3 font-bold text-ink shadow-lg"
        aria-expanded={open}
      >
        {open ? t("chat.close") : t("chat.open")}
      </button>

      {open && (
        <section
          className="fixed bottom-20 right-4 z-[1100] flex h-[min(70dvh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-ink/15"
          aria-label={t("chat.title")}
        >
          <header className="bg-ink px-4 py-3 font-display text-lg font-extrabold text-white">{t("chat.title")}</header>

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
            {messages.length === 0 && (
              <div>
                <p className="text-sm text-ink/80">{t("chat.welcome")}</p>
                <div className="mt-3 flex flex-col gap-2">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-xl border border-ink/15 px-3 py-2 text-left text-sm hover:bg-mist">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <p
                key={i}
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ml-auto bg-ink text-white"
                    : m.error
                      ? "bg-high/10 text-high"
                      : "bg-mist text-ink"
                }`}
              >
                {m.content}
              </p>
            ))}
            {busy && <p className="text-sm text-ink/60">{t("chat.thinking")}</p>}
            <div ref={endRef} />
          </div>

          <form
            className="flex gap-2 border-t border-ink/10 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              placeholder={t("chat.placeholder")}
              className="min-w-0 flex-1 rounded-xl border border-ink/20 px-3 py-2 text-sm"
              aria-label={t("chat.placeholder")}
            />
            <button type="submit" disabled={busy || !text.trim()} className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {t("chat.send")}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
