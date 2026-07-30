"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type cytoscape from "cytoscape";
import type { GraphEdge, GraphNode } from "@/lib/types";
import { describeEdgeEvidence } from "@/lib/hadith-graph";

type AtlasGraphProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  collection: string;
  highlightedIds?: string[];
  onSelect: (id: string) => void;
  /**
   * Ausgewaehlte Kante, von aussen gesteuert (P5.3/P5.7). So kommt derselbe
   * Zustand gleichermassen aus einem Kantenklick im Canvas wie aus der
   * tastaturbedienbaren Kantenliste in `graph-workspace.tsx` -- beide Wege
   * fuehren zur selben, vollstaendigen Belegliste.
   */
  selectedEdgeId?: string | null;
  onEdgeSelect?: (id: string | null) => void;
};

const controlIcon = (path: React.ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">{path}</svg>
);

export function AtlasGraph({ nodes, edges, collection, highlightedIds = [], onSelect, selectedEdgeId = null, onEdgeSelect }: AtlasGraphProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [hoverInfo, setHoverInfo] = useState("اختر عقدة أو صلة لفتح المصادر والعلاقات");

  const filtered = useMemo(() => {
    if (collection === "جميع المصنفات") return { nodes, edges };
    const selectedEdges = edges.filter((edge) => edge.data.collection.includes(collection));
    const ids = new Set(selectedEdges.flatMap((edge) => [edge.data.source, edge.data.target]));
    return { nodes: nodes.filter((node) => ids.has(node.data.id)), edges: selectedEdges };
  }, [collection, edges, nodes]);

  /**
   * P5.3 -- die drei vertraglichen Evidenzklassen bekommen hier ihre eigene
   * Cytoscape-Klasse (`evidence-isnad_link` / `evidence-rijal_statement` /
   * `evidence-chronology_only`), zusaetzlich zu allem, was die Kante schon an
   * Klassen mitbringt (`classifyEdgeEvidence` uebersetzt dabei die aelteren
   * Bezeichner aus `lib/mock-data.ts`, siehe `lib/hadith-graph.ts`). Eine
   * Kante mit unklarer Identitaet (frueher mit `candidate` vermischt) bekommt
   * zusaetzlich `identity-uncertain`, bleibt dabei aber ein Isnad-Beleg.
   */
  const classifiedElements = useMemo(() => {
    const classifiedEdges = filtered.edges.map((edge) => {
      const { kind, identityUncertain } = describeEdgeEvidence(edge);
      const classes = [edge.classes, `evidence-${kind}`, identityUncertain ? "identity-uncertain" : ""].filter(Boolean).join(" ");
      return { ...edge, classes };
    });
    return [...filtered.nodes, ...classifiedEdges];
  }, [filtered]);

  useEffect(() => {
    let active = true;
    const mount = async () => {
      const { default: cytoscapeModule } = await import("cytoscape");
      if (!active || !hostRef.current) return;

      const cy = cytoscapeModule({
        container: hostRef.current,
        elements: classifiedElements,
        layout: { name: "preset", fit: true, padding: 56 },
        minZoom: 0.42,
        maxZoom: 2.2,
        boxSelectionEnabled: false,
        style: [
          {
            selector: "node",
            style: {
              width: 112,
              height: 52,
              shape: "round-rectangle",
              "background-color": "#fffdf8",
              "border-color": "#c6bcaa",
              "border-width": 1.2,
              label: "data(label)",
              color: "#13272b",
              "font-family": "IBM Plex Sans Arabic, sans-serif",
              "font-size": 12,
              "font-weight": 600,
              "text-wrap": "wrap",
              "text-max-width": "94px",
              "text-valign": "center",
              "text-halign": "center",
              "overlay-opacity": 0,
              "transition-property": "border-color, background-color, opacity",
              "transition-duration": 260,
            },
          },
          { selector: "node.prophet", style: { shape: "ellipse", width: 82, height: 82, "background-color": "#173d3d", color: "#fffdf6", "border-color": "#c8a65b", "border-width": 3 } },
          { selector: "node.companion", style: { "background-color": "#e8ddbd", "border-color": "#a98840", "border-width": 2 } },
          { selector: "node.compiler", style: { shape: "round-diamond", width: 94, height: 76, "background-color": "#213b50", color: "#fffdf6", "border-color": "#213b50" } },
          { selector: "node.center", style: { width: 162, height: 72, "background-color": "#173d3d", color: "#fffdf6", "border-color": "#c8a65b", "border-width": 3, "font-size": 15 } },
          { selector: "node[status = 'medium']", style: { "border-style": "dashed", "border-color": "#a65c4b" } },
          { selector: "node[status = 'high']", style: { "border-style": "dashed" } },
          {
            selector: "edge",
            style: {
              width: "mapData(count, 1, 7, 1.3, 4)",
              "curve-style": "bezier",
              "line-cap": "round",
              "overlay-opacity": 0,
              "transition-property": "line-color, opacity, width",
              "transition-duration": 260,
            },
          },
          // Die drei vertraglichen Evidenzklassen (`lib/types.ts:EvidenceKind`),
          // jede mit eigener Linienart UND eigener Pfeilspitze -- nicht nur
          // Farbe, damit der Unterschied auch ohne Farbwahrnehmung lesbar ist.
          { selector: "edge.evidence-isnad_link", style: { "line-color": "#2d756e", "target-arrow-color": "#2d756e", "line-style": "solid", "target-arrow-shape": "triangle" } },
          { selector: "edge.evidence-rijal_statement", style: { "line-color": "#b08a43", "target-arrow-color": "#b08a43", "line-style": "dashed", "target-arrow-shape": "triangle", width: 1.5 } },
          { selector: "edge.evidence-chronology_only", style: { "line-color": "#8f8b83", "target-arrow-color": "#8f8b83", "line-style": "dotted", "target-arrow-shape": "circle", opacity: 0.78 } },
          // Identitaetsunsicherheit ist eine eigene, unabhaengige Aussage: die
          // Kette selbst bleibt ein Isnad-Beleg (Farbe/Pfeil bleiben), nur die
          // Linienart wechselt auf gestrichelt.
          { selector: "edge.evidence-isnad_link.identity-uncertain", style: { "line-style": "dashed" } },
          { selector: "edge.variant-a", style: { "line-color": "#2d756e", "target-arrow-color": "#2d756e" } },
          { selector: "edge.variant-b", style: { "line-color": "#b86542", "target-arrow-color": "#b86542" } },
          { selector: "edge.variant-c", style: { "line-color": "#356a8a", "target-arrow-color": "#356a8a" } },
          { selector: "edge.variant-shared", style: { "line-color": "#8a7446", "target-arrow-color": "#8a7446", width: 4.5 } },
          { selector: ".route-muted", style: { opacity: 0.16 } },
          { selector: ".route-highlight", style: { "border-color": "#b86542", "border-width": 4, "line-color": "#b86542", "target-arrow-color": "#b86542", width: 5, "z-index": 10 } },
          { selector: "node:selected", style: { "border-color": "#d08351", "border-width": 4 } },
          { selector: "edge:selected", style: { "line-color": "#d08351", "target-arrow-color": "#d08351", width: 5, "z-index": 20 } },
        ],
      });

      cy.on("tap", "node", (event) => onSelect(event.target.id()));
      // P5.3 -- der Kantenklick, der vorher komplett fehlte. Er ersetzt nicht
      // den Hover-Hinweis, sondern setzt zusaetzlich die "angeheftete"
      // Auswahl, aus der `describeEdgeEvidence()` unten die vollstaendige
      // Belegliste baut.
      cy.on("tap", "edge", (event) => onEdgeSelect?.(event.target.id()));
      cy.on("tap", (event) => {
        if (event.target === cy) onEdgeSelect?.(null);
      });
      cy.on("mouseover", "edge", (event) => {
        const match = filtered.edges.find((edge) => edge.data.id === event.target.id());
        if (match) setHoverInfo(describeEdgeEvidence(match).summary);
      });
      cy.on("mouseout", "edge", () => setHoverInfo("اختر عقدة أو صلة لفتح المصادر والعلاقات"));
      cyRef.current = cy;
    };
    mount();
    return () => {
      active = false;
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [classifiedElements, filtered.edges, onSelect, onEdgeSelect]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass("route-highlight route-muted");
    if (!highlightedIds.length) return;
    cy.elements().addClass("route-muted");
    highlightedIds.forEach((id) => {
      const node = cy.getElementById(id);
      node.removeClass("route-muted").addClass("route-highlight");
      node.connectedEdges().removeClass("route-muted").addClass("route-highlight");
    });
  }, [highlightedIds]);

  // Haelt die Cytoscape-Auswahl mit der von aussen gesteuerten `selectedEdgeId`
  // synchron -- unabhaengig davon, ob die Auswahl per Maus-Tap oder per
  // Tastaturliste in `graph-workspace.tsx` ausgeloest wurde.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.edges().unselect();
    if (selectedEdgeId) cy.getElementById(selectedEdgeId).select();
  }, [selectedEdgeId, classifiedElements]);

  const selectedEdge = useMemo(
    () => (selectedEdgeId ? edges.find((edge) => edge.data.id === selectedEdgeId) : undefined),
    [edges, selectedEdgeId],
  );
  const selectedEvidence = selectedEdge ? describeEdgeEvidence(selectedEdge) : null;

  const zoom = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({ zoom: cy.zoom() * factor, duration: 320 });
  };

  return (
    <div className="graph-frame" aria-label="رسم تفاعلي لأسانيد الحديث">
      <div ref={hostRef} className="graph-canvas" data-testid="atlas-graph" />
      <div className="graph-controls" aria-label="أدوات التحكم في الرسم">
        <button type="button" onClick={() => zoom(1.22)} aria-label="تكبير">{controlIcon(<><path d="M12 5v14M5 12h14" /><circle cx="12" cy="12" r="9" /></>)}</button>
        <button type="button" onClick={() => zoom(0.82)} aria-label="تصغير">{controlIcon(<><path d="M5 12h14" /><circle cx="12" cy="12" r="9" /></>)}</button>
        <button type="button" onClick={() => cyRef.current?.animate({ fit: { eles: cyRef.current.elements(), padding: 64 }, duration: 360 })} aria-label="توسيط الرسم">{controlIcon(<><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /><circle cx="12" cy="12" r="3" /></>)}</button>
      </div>
      <div className="graph-hint" aria-live="polite"><span className="pulse-dot" />{hoverInfo}</div>
      {selectedEdge && selectedEvidence ? (
        <div className="edge-evidence-panel" role="region" aria-live="polite" aria-label="الدليل الكامل على الصلة المختارة" dir="rtl">
          <div className="edge-evidence-head">
            <span className={`evidence-tag evidence-${selectedEvidence.kind}`}>{selectedEvidence.kindLabel}</span>
            <button type="button" onClick={() => onEdgeSelect?.(null)} aria-label="إلغاء اختيار الصلة">×</button>
          </div>
          <ul>{selectedEvidence.facts.map((fact, index) => <li key={index}>{fact}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}
