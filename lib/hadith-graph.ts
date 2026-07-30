import type { HadithGraphPayload } from "./api-client";
import type { GraphEdge, GraphNode } from "./types";

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

export type ApiNarratorOccurrenceContext = {
  chainOrder: number;
  position: number;
  rawSurfaceForm: string;
  normalizedSurfaceForm: string;
  identityStatus: string;
};

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
      nodes.push({
        data: {
          id,
          label: occurrence.rawSurfaceForm,
          subtitle: `السلسلة ${chain.chainOrder + 1} · الموضع ${occurrence.position + 1}`,
          kind: occurrence.rawSurfaceForm.includes("رسول الله") ? "prophet" : "later",
          status: occurrence.identityStatus === "unresolved" ? "low" : "high",
          collections: payload.hadith.collection,
        },
        position: { x: 110 + position * 185, y },
        classes: occurrence.rawSurfaceForm.includes("رسول الله") ? "prophet" : "later",
      });
      if (position > 0) {
        edges.push({
          data: {
            id: `edge-${chain.chainOrder}-${position - 1}-${position}`,
            source: `occ-${chain.chainOrder}-${chain.narratorOccurrences[position - 1].position}`,
            target: id,
            verb: "عن",
            evidence: "isnad_occurrence",
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
