"use client";

import { narratorMap } from "@/lib/mock-data";
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
 * niemals eine Person. Sie darf deshalb nicht durch einen Namenstreffer im
 * Demonstrationsbestand verdeckt werden.
 */
export function DetailPanel({ selectedId, liveGraph, close }: { selectedId: string; liveGraph: LiveHadithGraph | null; close: () => void }) {
  const occurrence = liveGraph?.occurrences[selectedId];
  if (occurrence && liveGraph) return <OccurrencePanel occurrence={occurrence} hadithId={liveGraph.record.id} close={close} />;
  const narrator = narratorMap.get(selectedId);
  if (narrator) return <NarratorPanel narrator={narrator} close={close} />;
  return <HadithPanel liveGraph={liveGraph} />;
}
