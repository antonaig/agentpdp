import { useState, type FormEvent } from "react";
import { normalizeProductUrl } from "./validate";
import "./generator.css";

export function UrlForm({ onSubmit, initial = "" }: { onSubmit: (url: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = normalizeProductUrl(value);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    onSubmit(r.url);
  };

  return (
    <form className="gen-form" onSubmit={submit} noValidate>
      <label className="sr-only" htmlFor="gen-url">Product page URL</label>
      <input
        id="gen-url"
        className="text"
        type="url"
        inputMode="url"
        placeholder="https://store.com/products/…"
        value={value}
        onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
      <button type="submit" className="btn primary">Make it agent-ready</button>
      {error && <p className="gen-error" role="alert">{error}</p>}
    </form>
  );
}
