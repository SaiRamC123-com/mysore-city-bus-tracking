import { useEffect, useId, useState } from "react";
import { matchStop, pick } from "../utils.js";

/**
 * Type-to-search stop chooser. A plain dropdown is unusable with 100+ stops, so the person types
 * (or taps a suggestion) and `onChange` gets the stop id, or "" while the text is not a stop.
 */
export default function StopPicker({ label, stops, value, onChange, excludeId, lang, placeholder, noMatch }) {
  const listId = useId();
  const nameOf = (s) => pick(lang, s.name, s.nameKn);
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);

  // If the chosen stop is changed from outside (the swap button), show its name.
  useEffect(() => {
    const s = stops.find((x) => x.id === value);
    if (s && matchStop(stops, text)?.id !== value) setText(nameOf(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, stops]);

  const change = (e) => {
    const v = e.target.value;
    setText(v);
    setTouched(true);
    const s = matchStop(stops, v);
    onChange(s && s.id !== excludeId ? s.id : "");
  };

  const bad = touched && text.trim() !== "" && !value;

  return (
    <label className="block text-sm font-semibold">
      {label}
      <input
        list={listId}
        value={text}
        onChange={change}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={bad}
        className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 font-normal ${bad ? "border-high" : "border-ink/20"}`}
      />
      <datalist id={listId}>
        {stops
          .filter((s) => s.id !== excludeId)
          .map((s) => (
            <option key={s.id} value={nameOf(s)} label={(s.aliases || []).slice(0, 3).join(", ")} />
          ))}
      </datalist>
      {bad && <span className="mt-1 block text-xs font-normal text-high">{noMatch}</span>}
    </label>
  );
}