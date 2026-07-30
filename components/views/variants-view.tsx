"use client";

import { useMemo, useState } from "react";
import { hadithEdges, hadithNodes, matnVariants } from "@/lib/mock-data";
import { diffMatnWords, type MatnDiffKind } from "@/lib/matn-diff";
import { AtlasGraph } from "../atlas-graph-dynamic";
import { SourceTag } from "../atlas-primitives";

/**
 * Matn-Varianten und ihre Zweige (Abschnitt 5). Der Wortvergleich kommt aus
 * `lib/matn-diff.ts` und unterscheidet die vier verlangten Arten von
 * Unterschieden inklusive تقديم وتأخير.
 */
export function VariantsView({ selectNode }: { selectNode: (id: string) => void }) {
  const [variant, setVariant] = useState(matnVariants[0].id);
  const [selectedDifference, setSelectedDifference] = useState(0);
  const active = matnVariants.find((item) => item.id === variant)!;
  const differences = useMemo(() => diffMatnWords(matnVariants[0].text, matnVariants[1].text).filter((item) => item.kind !== "equal"), []);
  const differenceLabels: Record<Exclude<MatnDiffKind, "equal">, string> = { addition: "إضافة", omission: "سقط", replacement: "استبدال", reorder: "تقديم وتأخير" };
  return (
    <div className="content-view variants-view" dir="rtl">
      <header className="view-intro compact"><span className="eyebrow">تحليل ثنائي الاتجاه</span><h1>اقرأ المتن، وشاهد طرقه تضيء.</h1><p>يحدد كل اختلاف نصي الفروع المرتبطة به، ويفتح الضغط على الراوي الصيغ التي مرت من طريقه.</p></header>
      <div className="variant-layout">
        <section className="variant-texts">
          <div className="variant-tabs" role="tablist">
            {matnVariants.map((item) => <button role="tab" aria-selected={variant === item.id} type="button" key={item.id} onClick={() => setVariant(item.id)}>{item.label}</button>)}
          </div>
          <div className="word-differences" aria-label="فروق الألفاظ">{differences.map((difference, index) => <button type="button" className={selectedDifference === index ? "active" : ""} key={`${difference.kind}-${index}`} onClick={() => setSelectedDifference(index)}><span>{differenceLabels[difference.kind as Exclude<MatnDiffKind, "equal">]}</span><del>{difference.before.join(" ") || "—"}</del><b>←</b><ins>{difference.after.join(" ") || "—"}</ins></button>)}</div>
          {matnVariants.map((item) => (
            <article key={item.id} hidden={variant !== item.id} className="matn-document">
              <div className="document-meta"><span>HCL-0001 / {item.id.toUpperCase()}</span><SourceTag /></div>
              <p dir="rtl">{item.id === "v1" ? <>إِنَّمَا الأَعْمَالُ <mark>بِالنِّيَّاتِ</mark>، وَإِنَّمَا <mark>لِكُلِّ امْرِئٍ</mark> مَا نَوَى</> : <>إِنَّمَا الأَعْمَالُ <mark>بِالنِّيَّةِ</mark>، وَإِنَّمَا <mark>لاِمْرِئٍ</mark> مَا نَوَى</>}</p>
              <p className="translation">{item.translation}</p>
              <div className="diff-note"><span>موضعا اختلاف</span><p><del>{item.id === "v1" ? "بالنية" : "بالنيات"}</del><ins>{item.id === "v1" ? "بالنيات" : "بالنية"}</ins></p></div>
            </article>
          ))}
        </section>
        <section className="variant-graph">
          <div className="linked-heading"><span>الطرق المرتبطة</span><strong>{active.collections.join(" · ")}</strong></div>
          <AtlasGraph nodes={hadithNodes} edges={hadithEdges} collection="جميع المصنفات" highlightedIds={active.branchIds} onSelect={selectNode} />
        </section>
      </div>
    </div>
  );
}
