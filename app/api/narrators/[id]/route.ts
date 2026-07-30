import { NextResponse } from "next/server";
import { assertions, narratorMap, narrators } from "@/lib/mock-data";
import { TRANSITIONAL_MOCK_NOTICE, transitionalMockEnvelopeFields } from "@/app/api/_contract";

export const dynamic = "force-static";
export function generateStaticParams() {
  return narrators.map((narrator) => ({ id: narrator.id }));
}

// Übergangsattrappe (Umsetzungsplan P2.2/P3.3): liefert Demodaten aus
// lib/mock-data.ts, keine echten Forschungsdaten. narrator.confidence
// (lib/types.ts) wird bewusst NICHT als confidenceLevel durchgereicht --
// das würde eine Mockperson als bestätigt/eingestuft ausgeben. Die echte,
// quellengebundene Implementierung ist /api/v1/narrators/{id}
// (backend/app/repository.py, CorpusRepository.narrator_profile).
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const narrator = narratorMap.get(id);
  if (!narrator) return NextResponse.json({ error: "Narrator not found" }, { status: 404 });
  const narratorAssertions = assertions.filter((item) => item.subjectId === id);
  return NextResponse.json({
    data: { ...narrator, evaluationAssertions: narratorAssertions },
    ...transitionalMockEnvelopeFields([
      { notice: TRANSITIONAL_MOCK_NOTICE, replacementPlan: "worker-api" },
      ...narratorAssertions.map((item) => ({ work: item.work, volume: item.volume, page: item.page, reviewStatus: item.status })),
    ]),
  });
}
