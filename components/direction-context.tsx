"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { Chevron } from "./atlas-primitives";

/**
 * FR-10 (`docs/01-PRODUCT-REQUIREMENTS.md:46`): "Die gesamte Shell ist
 * umschaltbar; arabische Inhaltsbloecke behalten RTL."
 *
 * Der Umschalter wirkt auf die Chrome-Ebene -- Kopfzeile, Navigation,
 * Arbeitsbereichsleiste, Panelrahmen -- und auf `document.documentElement`,
 * damit Bildlaufleisten und Browserdialoge mitziehen. Jeder arabische
 * Inhaltsblock traegt sein eigenes `dir="rtl"` und bleibt dadurch in jeder
 * Stellung des Schalters rechts nach links: Isnād-Rohtext, Matn, Namensformen
 * und Quellenzitate sind arabischer Fachtext, ihre Leserichtung ist keine
 * Oberflaechenpraeferenz.
 */
export type TextDirection = "rtl" | "ltr";

const STORAGE_KEY = "sanad-atlas.direction";

/**
 * Die gespeicherte Leserichtung ist ein externer Zustand (localStorage, geteilt
 * ueber Tabs). Sie wird deshalb als externer Store gelesen und nicht in einem
 * Effekt in React-State kopiert; `getServerSnapshot` liefert `rtl` und passt
 * damit zu `app/layout.tsx`, sodass die Hydration nicht abweicht.
 */
const listeners = new Set<() => void>();
let cachedDirection: TextDirection | null = null;

function readStoredDirection(): TextDirection {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ltr" || stored === "rtl") return stored;
  } catch {
    // Privater Modus oder blockierter Speicher: die Voreinstellung genuegt.
  }
  return "rtl";
}

function getSnapshot(): TextDirection {
  if (cachedDirection === null) cachedDirection = readStoredDirection();
  return cachedDirection;
}

function getServerSnapshot(): TextDirection {
  return "rtl";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cachedDirection = null;
    for (const registered of listeners) registered();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function writeDirection(value: TextDirection) {
  if (cachedDirection === value) return;
  cachedDirection = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // siehe oben
  }
  for (const listener of listeners) listener();
}

type DirectionContextValue = {
  direction: TextDirection;
  setDirection: (value: TextDirection) => void;
  toggleDirection: () => void;
};

const DirectionContext = createContext<DirectionContextValue>({
  direction: "rtl",
  setDirection: () => undefined,
  toggleDirection: () => undefined,
});

export function useDirection() {
  return useContext(DirectionContext);
}

export function DirectionProvider({ children }: { children: React.ReactNode }) {
  const direction = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const root = document.documentElement;
    root.dir = direction;
    // Die Inhaltssprache bleibt Arabisch. Umgeschaltet wird die Leserichtung
    // der Oberflaeche, nicht die Sprache der Quellen.
    root.lang = "ar";
  }, [direction]);

  const setDirection = useCallback((value: TextDirection) => writeDirection(value), []);
  const toggleDirection = useCallback(() => writeDirection(getSnapshot() === "rtl" ? "ltr" : "rtl"), []);
  const value = useMemo(() => ({ direction, setDirection, toggleDirection }), [direction, setDirection, toggleDirection]);

  return <DirectionContext.Provider value={value}>{children}</DirectionContext.Provider>;
}

/**
 * Ersetzt den frueher wirkungslosen Knopf „العربية" in der Kopfzeile
 * (`atlas-shell.tsx:585` hatte keinen Handler, FR-10 war damit unerfuellt).
 */
export function DirectionToggle() {
  const { direction, toggleDirection } = useDirection();
  const nextDirection: TextDirection = direction === "rtl" ? "ltr" : "rtl";
  return (
    <button
      type="button"
      className="direction-toggle"
      onClick={toggleDirection}
      aria-pressed={direction === "ltr"}
      aria-label={nextDirection === "ltr" ? "تحويل اتجاه الواجهة إلى اليسار" : "إرجاع اتجاه الواجهة إلى اليمين"}
      title="اتجاه الواجهة · النصوص العربية تبقى من اليمين إلى اليسار"
    >
      <span>{direction === "rtl" ? "العربية · يمين" : "Layout · left"}</span>
      <b aria-hidden="true">{direction === "rtl" ? "→" : "←"}</b>
      <Chevron direction="down" />
    </button>
  );
}
