"use client";

import type { LiveHadithGraph } from "@/lib/hadith-graph";
import { HadithPanel } from "./hadith-panel";
import { NarratorPanel } from "./narrator-panel";
import { OccurrencePanel } from "./occurrence-panel";

/**
 * Waehlt das Detailpanel zur aktuellen Auswahl. Diese Entscheidung lag zuvor
 * als verschachtelter Ausdruck in `atlas-shell.tsx:602`; hier ist sie lesbar und
 * wird nur mit den drei Graphrouten geladen.
 *
 * Reihenfolge ist fachlich bedeutsam: eine Erzaehlerstelle aus der API ist
 * niemals eine Person. Nur echte Worker-IDs werden als Personen-/Clusterprofil
 * geladen; fuer fehlende IDs gibt es keinen lokalen Ersatzbestand.
 */
export function DetailPanel({ selectedId, liveGraph, close }: { selectedId: string; liveGraph: LiveHadithGraph | null; close: () => void }) {
  const occurrence = liveGraph?.occurrences[selectedId];
  if (occurrence && liveGraph) return <OccurrencePanel occurrence={occurrence} hadithId={liveGraph.record.id} close={close} />;
  if (selectedId && selectedId !== "cluster") return <NarratorPanel narratorId={selectedId} close={close} />;
  if (liveGraph) return <HadithPanel liveGraph={liveGraph} />;
  return <aside className="info-panel" aria-label="لوحة المعلومات" dir="rtl"><div className="panel-topline"><span>لوحة المعلومات</span><button type="button" onClick={close} aria-label="إغلاق اللوحة">×</button></div><p className="empty-copy">لم تُحمّل استجابة بعد. لا توجد بيانات عرض بديلة.</p></aside>;
}
