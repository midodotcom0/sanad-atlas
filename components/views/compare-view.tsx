"use client";

import { useState } from "react";
import { ChronologyTimeline } from "../chronology-timeline";
import { dateAssertions, narratorMap, narrators } from "@/lib/mock-data";
import { SourceTag } from "../atlas-primitives";

/**
 * Vergleich zweier Erzaehler (Abschnitt 7). Der Zeitvergleich laeuft
 * ausschliesslich ueber `ChronologyTimeline`, die `compareChronology()` benutzt:
 * jede Jahresangabe bleibt eine eigene Spur mit eigener Quellenfarbe, es wird
 * nichts gemittelt und keine Begegnung behauptet.
 */
export function CompareView() {
  const [a, setA] = useState("yahya");
  const [b, setB] = useState("malik");
  const personA = narratorMap.get(a)!;
  const personB = narratorMap.get(b)!;
  const options = narrators.filter((item) => ["tabii", "later"].includes(item.role));
  return (
    <div className="content-view compare-view" dir="rtl">
      <header className="view-intro"><span className="eyebrow">مقارنة مرتبطة بالمصادر</span><h1>راويان، وأربع زوايا للبحث.</h1><p>تعرض المقارنة مواضع الاتفاق والاختلاف الموثقة، ولا تنشئ حكما آليا في العدالة أو الضبط.</p></header>
      <div className="compare-picker">
        <label>الراوي الأول<select value={a} onChange={(event) => setA(event.target.value)}>{options.map((item) => <option value={item.id} key={item.id}>{item.nameAr}</option>)}</select></label>
        <span className="compare-knot" aria-hidden="true"><i /><i /><b /></span>
        <label>الراوي الثاني<select value={b} onChange={(event) => setB(event.target.value)}>{options.map((item) => <option value={item.id} key={item.id}>{item.nameAr}</option>)}</select></label>
      </div>
      <div className="comparison-grid">
        <article className="comparison-card network-card">
          <div className="card-index">الشبكة</div><h2>مواضع الاتصال المشتركة</h2>
          <div className="mini-path" dir="rtl"><span>{personA.shortAr}</span><i>عن</i><span>{personB.shortAr}</span></div>
          <dl><div><dt>علاقة مباشرة</dt><dd>{a === "yahya" && b === "malik" ? "ثابتة في أسانيد" : "غير موجودة في بيانات العرض"}</dd></div><div><dt>عناقيد حديث مشتركة</dt><dd>١</dd></div><div><dt>أقصر مسار</dt><dd>{a === "yahya" && b === "malik" ? "صلة واحدة" : "صلتان"}</dd></div></dl>
        </article>
        <article className="comparison-card biography-card">
          <div className="card-index">الترجمة</div><h2>الزمن والمكان وإمكان اللقاء</h2>
          <ChronologyTimeline first={personA} second={personB} assertions={dateAssertions} />
          <div className="dual-facts"><p><strong>{personA.nameAr}</strong>{personA.region} · {personA.tabaqa}</p><p><strong>{personB.nameAr}</strong>{personB.region} · {personB.tabaqa}</p></div>
        </article>
        <article className="comparison-card hadith-card">
          <div className="card-index">الرواية</div><h2>صيغ المتن في طرقها</h2>
          <div className="variant-bars"><span><i style={{ width: "78%" }} />الرواية أ</span><span><i style={{ width: "44%" }} />الرواية ب</span></div>
          <p>يبين العرض اقتران كل صيغة متنية بفروعها داخل العنقود. هذه ملاحظة بيانات، وليست حكما على التبعية التاريخية.</p>
        </article>
        <article className="comparison-card grades-card">
          <div className="card-index">الجرح والتعديل</div><h2>أقوال النقاد جنبا إلى جنب</h2>
          <table><thead><tr><th>الناقد</th><th>{personA.shortAr}</th><th>{personB.shortAr}</th></tr></thead><tbody><tr><td>ابن معين</td><td>ثقة <SourceTag /></td><td>ثقة <SourceTag /></td></tr><tr><td>أحمد</td><td>ثبت <SourceTag /></td><td>—</td></tr></tbody></table>
        </article>
      </div>
    </div>
  );
}
