"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type cytoscape from "cytoscape";
import type { GraphEdge, GraphNode } from "@/lib/types";

type AtlasGraphProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  collection: string;
  highlightedIds?: string[];
  onSelect: (id: string) => void;
};

const controlIcon = (path: React.ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">{path}</svg>
);

export function AtlasGraph({ nodes, edges, collection, highlightedIds = [], onSelect }: AtlasGraphProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [hoverInfo, setHoverInfo] = useState("Knoten wählen, um Quellen und Beziehungen zu öffnen");

  const filtered = useMemo(() => {
    if (collection === "Alle Sammlungen") return { nodes, edges };
    const selectedEdges = edges.filter((edge) => edge.data.collection.includes(collection));
    const ids = new Set(selectedEdges.flatMap((edge) => [edge.data.source, edge.data.target]));
    return { nodes: nodes.filter((node) => ids.has(node.data.id)), edges: selectedEdges };
  }, [collection, edges, nodes]);

  useEffect(() => {
    let active = true;
    const mount = async () => {
      const { default: cytoscapeModule } = await import("cytoscape");
      if (!active || !hostRef.current) return;

      const cy = cytoscapeModule({
        container: hostRef.current,
        elements: [...filtered.nodes, ...filtered.edges],
        layout: { name: "preset", fit: true, padding: 56 },
        minZoom: 0.42,
        maxZoom: 2.2,
        wheelSensitivity: 0.18,
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
              "font-weight": 620,
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
              "line-color": "#2d756e",
              "target-arrow-color": "#2d756e",
              "target-arrow-shape": "triangle",
              "arrow-scale": 0.78,
              "line-cap": "round",
              "overlay-opacity": 0,
              "transition-property": "line-color, opacity, width",
              "transition-duration": 260,
            },
          },
          { selector: "edge.biographical", style: { "line-color": "#b08a43", "target-arrow-color": "#b08a43", "line-style": "dashed", width: 1.5 } },
          { selector: "edge.candidate, edge.uncertain", style: { "line-color": "#8f8b83", "target-arrow-color": "#8f8b83", "line-style": "dashed", opacity: 0.8 } },
          { selector: ".route-muted", style: { opacity: 0.16 } },
          { selector: ".route-highlight", style: { "border-color": "#b86542", "border-width": 4, "line-color": "#b86542", "target-arrow-color": "#b86542", width: 5, "z-index": 10 } },
          { selector: ":selected", style: { "border-color": "#d08351", "border-width": 4 } },
        ],
      });

      cy.on("tap", "node", (event) => onSelect(event.target.id()));
      cy.on("mouseover", "edge", (event) => {
        const data = event.target.data();
        setHoverInfo(`${data.verb} · ${data.count} Beleg${data.count === 1 ? "" : "e"} · ${data.collection}`);
      });
      cy.on("mouseout", "edge", () => setHoverInfo("Knoten wählen, um Quellen und Beziehungen zu öffnen"));
      cyRef.current = cy;
    };
    mount();
    return () => {
      active = false;
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [filtered, onSelect]);

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

  const zoom = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({ zoom: cy.zoom() * factor, duration: 320 });
  };

  return (
    <div className="graph-frame" aria-label="Interaktiver Isnād-Graph">
      <div ref={hostRef} className="graph-canvas" data-testid="atlas-graph" />
      <div className="graph-controls" aria-label="Graphsteuerung">
        <button type="button" onClick={() => zoom(1.22)} aria-label="Hineinzoomen">{controlIcon(<><path d="M12 5v14M5 12h14" /><circle cx="12" cy="12" r="9" /></>)}</button>
        <button type="button" onClick={() => zoom(0.82)} aria-label="Herauszoomen">{controlIcon(<><path d="M5 12h14" /><circle cx="12" cy="12" r="9" /></>)}</button>
        <button type="button" onClick={() => cyRef.current?.animate({ fit: { eles: cyRef.current.elements(), padding: 64 }, duration: 360 })} aria-label="Graph zentrieren">{controlIcon(<><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /><circle cx="12" cy="12" r="3" /></>)}</button>
      </div>
      <div className="graph-hint" aria-live="polite"><span className="pulse-dot" />{hoverInfo}</div>
    </div>
  );
}
