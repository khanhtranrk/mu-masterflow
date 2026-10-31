import { useEffect, useState } from "react";

export type DisplayMode = "list" | "grid";
export function useDisplayMode(key: string, fallback: DisplayMode) {
  const read = () => { try { const value = localStorage.getItem(key); return value === "grid" || value === "list" ? value : fallback; } catch { return fallback; } };
  const [mode, setMode] = useState<DisplayMode>(read);
  useEffect(() => {
    const sync = () => setMode(read());
    window.addEventListener("storage", sync);
    window.addEventListener("masterflow-layout", sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("masterflow-layout", sync); };
  }, [key, fallback]);
  return [mode, (value: DisplayMode) => {
    setMode(value);
    try { localStorage.setItem(key, value); window.dispatchEvent(new Event("masterflow-layout")); } catch { /* Keep the choice for this view if persistence is unavailable. */ }
  }] as const;
}

export function DisplayModeSwitch({ mode, onChange, label }: { mode: DisplayMode; onChange: (mode: DisplayMode) => void; label: string }) {
  return <div className="display-mode-switch" role="group" aria-label={label}>
    {(["list", "grid"] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() => onChange(value)}><span aria-hidden="true">{value === "list" ? "☰" : "▦"}</span> {value === "list" ? "List" : "Grid"}</button>)}
  </div>;
}

