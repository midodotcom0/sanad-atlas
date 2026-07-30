"use client";

import Link from "next/link";
import type { ApiNarratorOccurrenceContext } from "@/lib/hadith-graph";
import { Chevron, confidenceLabel } from "../atlas-primitives";

/**
 * Panel einer einzelnen Erzaehlerstelle.
 *
 * Eine Stelle ist keine Person. Alles hier ist an `(chainOrder, position)` und
 * an die Zeichenoffsets im Rohtext gebunden; eine relative Namensform wie
 * `ابيه` wird ausdruecklich nicht global aufgeloest.
 */
export function OccurrencePanel({ occurrence, hadithId, close }: { occurrence: ApiNarratorOccurrenceContext; hadithId: string; close: () => void }) {
  const lookup = `/narrators/lookup?name=${encodeURIComponent(occurrence.rawSurfaceForm)}&hadith=${encodeURIComponent(hadithId)}&chain=${occurrence.chainOrder}&position=${occurrence.position}`;
  const hasSpan = typeof occurrence.spanStart === "number" && typeof occurrence.spanEnd === "number";
  return (
    <aside className="info-panel occurrence-panel" aria-label="موضع الراوي في الإسناد" dir="rtl">
      <div className="panel-topline"><span>موضع راوٍ</span><button type="button" onClick={close} aria-label="إغلاق لوحة الراوي">×</button></div>
      <div className="occurrence-identity" dir="rtl"><span>{occurrence.rawSurfaceForm.slice(0, 1)}</span><div><p>النص كما ورد في السند</p><h2>{occurrence.rawSurfaceForm}</h2></div></div>
      <span className={`status status-${occurrence.identityStatus}`}><i />{confidenceLabel(occurrence.identityStatus)}</span>
      <dl className="fact-grid">
        <div><dt>السلسلة</dt><dd>{(occurrence.chainOrder + 1).toLocaleString("ar")}</dd></div>
        <div><dt>الموضع</dt><dd>{(occurrence.position + 1).toLocaleString("ar")}</dd></div>
        <div><dt>الصيغة المطبّعة</dt><dd dir="rtl">{occurrence.normalizedSurfaceForm}</dd></div>
        <div><dt>صيغة التحمل</dt><dd dir="rtl">{occurrence.transmissionTerm || "غير محددة"}</dd></div>
        <div><dt>موضع الحرف في النص الخام</dt><dd dir="ltr">{hasSpan ? `${occurrence.spanStart}–${occurrence.spanEnd}` : "غير مسجل"}</dd></div>
        <div><dt>حالة القرار</dt><dd>لم تراجع</dd></div>
      </dl>
      {occurrence.relativeForm ? (
        <section className="panel-section evidence-note warning">
          <span>صيغة نسبية</span>
          <p>هذه صيغة إضافة مثل «أبيه» أو «عمه». لا تُحل إلا داخل هذه السلسلة وبهذا الموضع، بالرجوع إلى الراوي السابق ونص المصدر. لا يجوز ضمها إلى شخص عام في قاعدة البيانات.</p>
        </section>
      ) : null}
      <section className="panel-section evidence-note warning"><span>لماذا لا يظهر ملف شخص واحد؟</span><p>هذا موضع في سند، لا هوية محققة. يعرض البحث التالي مرشحين من كتب الرجال مع إبقاء كل ترجمة ودليلها منفصلين.</p></section>
      <Link className="panel-cta primary" href={lookup}><span>البحث في كتب الرجال</span><b><Chevron direction="left" /></b></Link>
      <Link className="panel-text-link" href={`/hadith?record=${encodeURIComponent(hadithId)}`}>العودة إلى تفاصيل الحديث</Link>
    </aside>
  );
}
