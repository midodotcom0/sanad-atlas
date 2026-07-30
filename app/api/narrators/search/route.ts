import { NextRequest, NextResponse } from "next/server";
import { narrators } from "@/lib/mock-data";
import { normalizeSearchText } from "@/lib/search";
import { TRANSITIONAL_MOCK_NOTICE, transitionalMockEnvelopeFields } from "@/app/api/_contract";

export const dynamic = "force-static";

// Übergangsattrappe (Umsetzungsplan P2.2/P3.3): liefert Demodaten aus
// lib/mock-data.ts, keine echten Forschungsdaten. Wegen "output: export" kann
// diese Route nicht dynamisch gegen die Forschungs-API antworten; siehe
// app/api/_contract.ts für die Begründung und den Ablöseplan (P3.2/P3.3).
export function GET(request: NextRequest) {
  const query = normalizeSearchText(request.nextUrl.searchParams.get("q") ?? "");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 20), 50);
  const items = narrators
    .filter((item) => !query || normalizeSearchText(`${item.nameAr} ${item.transliteration}`).includes(query))
    .slice(0, limit);
  return NextResponse.json({
    data: items,
    ...transitionalMockEnvelopeFields([{ notice: TRANSITIONAL_MOCK_NOTICE, replacementPlan: "worker-api" }]),
    resultCount: items.length,
  });
}
