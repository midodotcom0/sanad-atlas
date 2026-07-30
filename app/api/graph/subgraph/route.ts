import { NextRequest, NextResponse } from "next/server";
import { egoEdges, egoNodes } from "@/lib/mock-data";
import { TRANSITIONAL_MOCK_NOTICE, transitionalMockEnvelopeFields } from "@/app/api/_contract";

export const dynamic = "force-static";

// Übergangsattrappe (Umsetzungsplan P2.2/P3.3): liefert ein einzelnes
// festverdrahtetes Demonstrationsnetzwerk ("yahya") aus lib/mock-data.ts,
// keine echten Forschungsdaten. Kein /api/v1-Gegenstück in Abschnitt 12 der
// Projektbeschreibung; die künftige Worker-API (P3.2) liefert Teilgraphen
// stattdessen über /api/v1/clusters/{id}/routes plus progressives Nachladen.
export function GET(request: NextRequest) {
  const narratorId = request.nextUrl.searchParams.get("narratorId") ?? "yahya";
  const depth = Math.min(Math.max(Number(request.nextUrl.searchParams.get("depth") ?? 1), 1), 2);
  if (narratorId !== "yahya") return NextResponse.json({ error: "Narrator not available in mock subgraph" }, { status: 404 });
  return NextResponse.json({
    data: { rootId: narratorId, depth, nodes: egoNodes, edges: egoEdges, truncated: true, limit: 500 },
    ...transitionalMockEnvelopeFields([{ notice: TRANSITIONAL_MOCK_NOTICE, replacementPlan: "worker-api" }]),
  });
}
