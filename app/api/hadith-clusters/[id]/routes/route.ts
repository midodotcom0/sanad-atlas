import { NextResponse } from "next/server";
import { hadithEdges, hadithNodes, matnVariants } from "@/lib/mock-data";

export const dynamic = "force-static";
export function generateStaticParams() {
  return [{ id: "HCL-0001" }];
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (id !== "HCL-0001") return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
  const collection = new URL(request.url).searchParams.get("collection");
  const edges = collection ? hadithEdges.filter((edge) => edge.data.collection.includes(collection)) : hadithEdges;
  const nodeIds = new Set(edges.flatMap((edge) => [edge.data.source, edge.data.target]));
  return NextResponse.json({
    data: { clusterId: id, nodes: hadithNodes.filter((node) => nodeIds.has(node.data.id)), edges, matnVariants },
    meta: { dataVersion: "mock-0.1.0", editorialStatus: "unreviewed", confidence: "demonstration_only", truncated: false },
    sources: [{ source: "mock", notice: "Prototype routes require edition-level editorial verification." }],
  });
}
