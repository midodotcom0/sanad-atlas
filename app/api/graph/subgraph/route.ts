import { NextRequest, NextResponse } from "next/server";
import { egoEdges, egoNodes } from "@/lib/mock-data";

export const dynamic = "force-static";

export function GET(request: NextRequest) {
  const narratorId = request.nextUrl.searchParams.get("narratorId") ?? "yahya";
  const depth = Math.min(Math.max(Number(request.nextUrl.searchParams.get("depth") ?? 1), 1), 2);
  if (narratorId !== "yahya") return NextResponse.json({ error: "Narrator not available in mock subgraph" }, { status: 404 });
  return NextResponse.json({
    data: { rootId: narratorId, depth, nodes: egoNodes, edges: egoEdges },
    meta: { dataVersion: "mock-0.1.0", editorialStatus: "unreviewed", confidence: "mixed", truncated: true, limit: 500 },
    sources: [{ source: "mixed mock assertions", reviewStatus: "unreviewed" }],
  });
}
