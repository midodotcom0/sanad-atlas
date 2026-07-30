import { NextResponse } from "next/server";
import { hadithEdges, hadithNodes, matnVariants } from "@/lib/mock-data";
import { TRANSITIONAL_MOCK_NOTICE, transitionalMockEnvelopeFields } from "@/app/api/_contract";

export const dynamic = "force-static";
export function generateStaticParams() {
  return [{ id: "HCL-0001" }];
}

// Übergangsattrappe (Umsetzungsplan P2.2/P3.3): liefert ein einzelnes
// festverdrahtetes Demonstrationscluster ("HCL-0001") aus lib/mock-data.ts,
// keine echten Forschungsdaten. Pfad UND Hülle wichen bislang von der
// spezifizierten /clusters/{id}/routes ab (docs/06-API-SPECIFICATION.yaml);
// die echte, quellengebundene, indexierte Implementierung ist
// /api/v1/clusters/{id}/routes (backend/app/repository.py, routes()).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (id !== "HCL-0001") return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
  const collection = new URL(request.url).searchParams.get("collection");
  const edges = collection ? hadithEdges.filter((edge) => edge.data.collection.includes(collection)) : hadithEdges;
  const nodeIds = new Set(edges.flatMap((edge) => [edge.data.source, edge.data.target]));
  return NextResponse.json({
    data: { clusterId: id, nodes: hadithNodes.filter((node) => nodeIds.has(node.data.id)), edges, matnVariants, truncated: false },
    ...transitionalMockEnvelopeFields([{ notice: TRANSITIONAL_MOCK_NOTICE, replacementPlan: "worker-api" }, { notice: "Prototype routes require edition-level editorial verification." }]),
  });
}
