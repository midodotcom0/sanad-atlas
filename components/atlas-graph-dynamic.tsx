"use client";

import dynamic from "next/dynamic";

/**
 * Cytoscape wird in `atlas-graph.tsx:34` bereits nur clientseitig geladen --
 * aber `AtlasGraph` selbst wurde statisch in den Monolithen importiert. Damit
 * lag der Modulcode des Graphen (samt `@types`-Bindung und Stilbaum) auch im
 * Bundle von `/library`, `/sources` und `/editor`, obwohl dort nie ein Graph
 * erscheint.
 *
 * Dieser Wrapper ist die einzige Einstiegsstelle fuer die Views. Er laedt den
 * Graphen als eigenen Chunk und erst im Browser, sodass nur die drei
 * Graphrouten seinen Code beziehen.
 */
export const AtlasGraph = dynamic(() => import("./atlas-graph").then((loaded) => loaded.AtlasGraph), {
  ssr: false,
  loading: () => (
    <div className="graph-frame" aria-busy="true">
      <div className="graph-load-state"><i /><strong>جار تحضير الرسم التفاعلي…</strong></div>
    </div>
  ),
});
