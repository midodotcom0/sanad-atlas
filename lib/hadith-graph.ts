import type { ApiNarratorOccurrence, HadithGraphPayload } from "./api-client";
import type { ConfidenceLevel, GraphEdge, GraphNode } from "./types";

export type LiveHadithGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  title: string;
  eyebrow: string;
  chainCount: number;
  occurrenceCount: number;
  record: HadithGraphPayload["hadith"];
  sources: HadithGraphPayload["sourceReferences"];
  dataVersion: string;
  occurrences: Record<string, ApiNarratorOccurrenceContext>;
};

/**
 * Eine Erzaehlerstelle mit ihrem Kettenkontext. `chainOrder` plus `position`
 * plus `spanStart`/`spanEnd` binden sie an genau eine Stelle im Rohtext; nichts
 * hier gilt global fuer eine Person.
 */
export type ApiNarratorOccurrenceContext = {
  chainOrder: number;
  position: number;
  rawSurfaceForm: string;
  normalizedSurfaceForm: string;
  /** Zeichenoffsets im Rohtext des Datensatzes, fuer den Ruecksprung zur Quelle. */
  spanStart?: number | null;
  spanEnd?: number | null;
  /** Ueberlieferungsbegriff der Stelle (`عن`, `حدثنا`, `اخبرني` …). */
  transmissionTerm?: string | null;
  /** Relative Namensform (`ابيه`, `عمه` …): nur positionsgebunden aufloesbar. */
  relativeForm?: boolean;
  /** Vom Importer markierte Prophetennennung. */
  prophetMention?: boolean;
  identityStatus: ConfidenceLevel;
};

/**
 * Prophetennennung.
 *
 * Frueher stand hier `occurrence.rawSurfaceForm.includes("رسول الله")`. Seit der
 * Importer die Rohform mit Diakritika erhaelt (`رَسُولِ اللَّهِ`), greift dieser
 * Vergleich nicht mehr. Die Entscheidung gehoert ohnehin in den Importer, der
 * den Rohtext und die Normalisierung kennt; das Frontend liest nur noch das
 * Ergebnisfeld. Fehlt es (aeltere Datenversion), wird nichts vermutet.
 */
function isProphetMention(occurrence: ApiNarratorOccurrence): boolean {
  return occurrence.prophetMention === true;
}

export function toHadithGraph(payload: HadithGraphPayload): LiveHadithGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const occurrences: Record<string, ApiNarratorOccurrenceContext> = {};
  const chainCount = payload.chains.length;
  const verticalGap = Math.max(90, Math.min(150, 640 / Math.max(1, chainCount)));
  payload.chains.forEach((chain, chainIndex) => {
    const y = 90 + chainIndex * verticalGap;
    chain.narratorOccurrences.forEach((occurrence, position) => {
      const id = `occ-${chain.chainOrder}-${occurrence.position}`;
      occurrences[id] = { chainOrder: chain.chainOrder, ...occurrence };
      const prophet = isProphetMention(occurrence);
      nodes.push({
        data: {
          id,
          label: occurrence.rawSurfaceForm,
          subtitle: `السلسلة ${chain.chainOrder + 1} · الموضع ${occurrence.position + 1}`,
          kind: prophet ? "prophet" : "later",
          // Der Stand der Identitaetsauflaesung kommt unveraendert aus der API.
          // Er wird hier weder verbessert noch geraten; `verified` kann auf
          // diesem Weg nicht entstehen, weil kein maschineller Pfad es setzt.
          status: occurrence.identityStatus,
          collections: payload.hadith.collection,
        },
        position: { x: 110 + position * 185, y },
        classes: prophet ? "prophet" : "later",
      });
      if (position > 0) {
        edges.push({
          data: {
            id: `edge-${chain.chainOrder}-${position - 1}-${position}`,
            source: `occ-${chain.chainOrder}-${chain.narratorOccurrences[position - 1].position}`,
            target: id,
            verb: occurrence.transmissionTerm || "عن",
            // Evidenzklasse aus dem gemeinsamen Vokabular
            // (`isnad_link | rijal_statement | chronology_only`). Eine Kante aus
            // einer konkreten Kette ist immer ein Isnād-Beleg -- niemals eine
            // bloss chronologische Moeglichkeit.
            evidence: "isnad_link",
            collection: payload.hadith.collection === "bukhari" ? "البخاري" : "مسلم",
            count: 1,
          },
          classes: "isnad",
        });
      }
    });
  });
  return {
    nodes,
    edges,
    title: payload.hadith.matn?.slice(0, 72) || `حديث رقم ${payload.hadith.hadithNumber}`,
    eyebrow: `${payload.hadith.collection === "bukhari" ? "صحيح البخاري" : "صحيح مسلم"} · رقم ${payload.hadith.hadithNumber}`,
    chainCount,
    occurrenceCount: nodes.length,
    record: payload.hadith,
    sources: payload.sourceReferences,
    dataVersion: payload.dataVersion,
    occurrences,
  };
}
