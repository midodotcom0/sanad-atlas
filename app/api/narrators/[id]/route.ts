import { NextResponse } from "next/server";
import { assertions, narratorMap, narrators } from "@/lib/mock-data";

export const dynamic = "force-static";
export function generateStaticParams() {
  return narrators.map((narrator) => ({ id: narrator.id }));
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const narrator = narratorMap.get(id);
  if (!narrator) return NextResponse.json({ error: "Narrator not found" }, { status: 404 });
  return NextResponse.json({
    data: { ...narrator, evaluationAssertions: assertions.filter((item) => item.subjectId === id) },
    meta: { dataVersion: "mock-0.1.0", editorialStatus: "unreviewed", confidence: narrator.confidence, lastReviewedAt: null },
    sources: assertions.filter((item) => item.subjectId === id).map((item) => ({ work: item.work, volume: item.volume, page: item.page, reviewStatus: item.status })),
  });
}
