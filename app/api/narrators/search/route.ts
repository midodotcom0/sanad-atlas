import { NextRequest, NextResponse } from "next/server";
import { narrators } from "@/lib/mock-data";
import { normalizeSearchText } from "@/lib/search";

export const dynamic = "force-static";

export function GET(request: NextRequest) {
  const query = normalizeSearchText(request.nextUrl.searchParams.get("q") ?? "");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 20), 50);
  const items = narrators
    .filter((item) => !query || normalizeSearchText(`${item.nameAr} ${item.transliteration}`).includes(query))
    .slice(0, limit);
  return NextResponse.json({
    data: items,
    meta: { dataVersion: "mock-0.1.0", editorialStatus: "unreviewed", confidence: "mixed", resultCount: items.length },
    sources: [],
  });
}
