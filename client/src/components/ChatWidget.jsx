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
  const nextId = useRef(0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, open]);

  const requestReply = async (request, responseId) => {
    if (busy) return;
    setBusy(true);
    setMessages((current) =>
      current.map((item) => (item.id === responseId ? { ...item, content: "", error: false, pending: true } : item))
    );
    try {
      const out = await api.chat(request);
      setMessages((current) =>
        current.map((item) =>
          item.id === responseId ? { ...item, content: out.reply || t("chat.empty"), pending: false, error: false } : item
        )
      );
    } catch (e) {
      setMessages((current) =>
        current.map((item) =>
          item.id === responseId ? { ...item, content: e.message || t("chat.error"), pending: false, error: true } : item
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const send = (raw) => {
    const message = raw.trim();
    if (!message || busy) return;
    const failedRequests = new Set(messages.filter((item) => item.error).map((item) => item.requestId));
    const history = messages
      .filter((item) => !item.pending && !failedRequests.has(item.requestId))
      .map(({ role, content }) => ({ role, content }));
    const requestId = ++nextId.current;
    const responseId = ++nextId.current;
    const request = {
      message,
      history,
      location: userPos ? { lat: userPos.lat, lng: userPos.lng } : null,
    };
    setMessages((current) => [
      ...current,
      { id: requestId, requestId, role: "user", content: message },
      { id: responseId, requestId, role: "assistant", content: "", pending: true, retryRequest: request },
    ]);
    setText("");
    void requestReply(request, responseId);
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

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite" aria-busy={busy}>
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
            {messages.filter((item) => !item.pending).map((m) =>
              m.error ? (
                <div key={m.id} className="max-w-[85%] rounded-2xl bg-high/10 px-3 py-2 text-sm text-high">
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void requestReply(m.retryRequest, m.id)}
                    className="mt-2 font-bold underline underline-offset-2 disabled:opacity-50"
                  >
                    {t("chat.retry")}
                  </button>
                </div>
              ) : (
                <p
                  key={m.id}
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                    m.role === "user" ? "ml-auto bg-ink text-white" : "bg-mist text-ink"
                  }`}
                >
                  {m.content}
                </p>
              )
            )}
            {busy && <p role="status" className="text-sm text-ink/60">{t("chat.thinking")}</p>}
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
