"use client";

import type { LiveHadithGraph } from "@/lib/hadith-graph";
import { SourceTag, TextWithheldNotice } from "../atlas-primitives";

/**
 * Detailpanel eines Hadithvorkommens. Zeigt den importierten Datensatz, wenn
 * die Forschungs-API ihn geliefert hat, sonst die statische Beispielansicht.
 *
 * Volltext erscheint nur, wenn das serverseitige Lizenz-Gate ihn freigegeben
 * hat (`ApiHadith.textWithheld`). Ein zurueckgehaltener Text wird als
 * Rechteentscheidung benannt, nicht als Ladefehler.
 */
export function HadithPanel({ liveGraph }: { liveGraph?: LiveHadithGraph | null }) {
  if (liveGraph) {
    const source = liveGraph.sources[0] as { volume?: string | number; page?: string | number; url?: string; rightsStatus?: string } | undefined;
    const withheld = liveGraph.record.textWithheld === true;
    return (
      <aside className="info-panel" aria-label="تفاصيل الحديث المستورد" dir="rtl">
        <div className="panel-topline"><span>موضع الحديث</span><span className="record-id">{liveGraph.record.id}</span></div>
        <div className="hadith-title" dir="rtl"><span className="surah-marker">{liveGraph.record.hadithNumber.toLocaleString("ar")}</span><div><p>{liveGraph.record.collection === "bukhari" ? "صحيح البخاري" : "صحيح مسلم"}</p><h2>{liveGraph.record.book || `الحديث رقم ${liveGraph.record.hadithNumber}`}</h2></div></div>
        <div className="cluster-stats"><div><strong>{liveGraph.chainCount.toLocaleString("ar")}</strong><span>سلاسل</span></div><div><strong>{liveGraph.occurrenceCount.toLocaleString("ar")}</strong><span>مواضع رواة</span></div><div><strong>{Math.round(liveGraph.record.parser.confidence * 100).toLocaleString("ar")}٪</strong><span>ثقة التحليل</span></div></div>
        {withheld ? <TextWithheldNotice what="المتن والسند" /> : <>
          <section className="panel-section"><div className="section-title"><h3>المتن المستخرج</h3><span>غير مراجع</span></div><p className="matn-snippet" dir="rtl">{liveGraph.record.matn || "لم يحدد المحلل حد المتن بثقة."}</p></section>
          <section className="panel-section"><div className="section-title"><h3>السند الخام</h3><SourceTag /></div><p className="record-isnad" dir="rtl">{liveGraph.record.isnad}</p></section>
        </>}
        <section className="panel-section"><div className="source-card"><div><span>الجزء والصفحة</span><strong>{source?.volume ?? "—"} / {source?.page ?? "—"}</strong></div><div><span>إصدار البيانات</span><strong>{liveGraph.dataVersion}</strong></div><div><span>الحقوق</span><strong>{source?.rightsStatus ?? "قيد المراجعة"}</strong></div></div>{source?.url ? <a className="panel-cta" href={source.url} target="_blank" rel="noreferrer"><span>فتح صفحة المصدر</span><b>↗</b></a> : null}</section>
      </aside>
    );
  }
  return (
    <aside className="info-panel" aria-label="تفاصيل الحديث" dir="rtl">
      <div className="panel-topline"><span>عنقود الحديث</span><span className="record-id">HCL-0001</span></div>
      <div className="hadith-title" dir="rtl">
        <span className="surah-marker">١</span>
        <div><p>حديث النيات</p><h2>إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ</h2></div>
      </div>
      <div className="cluster-stats">
        <div><strong>7</strong><span>طرق ظاهرة</span></div><div><strong>30+</strong><span>رواة</span></div><div><strong>4</strong><span>مصنفات</span></div>
      </div>
      <section className="panel-section">
        <div className="section-title"><h3>الصيغة المختارة</h3><span>الرواية أ</span></div>
        <p className="matn-snippet" dir="rtl">إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى</p>
        <p className="translation">يرتبط هذا المتن بالمسارات الملوّنة باللون الأخضر في بيانات العرض.</p>
      </section>
      <section className="panel-section">
        <div className="section-title"><h3>التوثيق</h3><SourceTag /></div>
        <div className="source-card">
          <div><span>الكتاب</span><strong>صحيح البخاري</strong></div>
          <div><span>الموضع</span><strong>بدء الوحي · رقم ١</strong></div>
          <div><span>الطبعة</span><strong>تحتاج إلى اعتماد</strong></div>
        </div>
      </section>
      <section className="panel-section evidence-note warning">
        <span>تنبيه منهجي</span>
        <p>هذه المسارات توضح التفاعل. يجب مراجعة الأسانيد والأرقام والمواضع على الطبعة قبل اعتمادها علميا.</p>
      </section>
    </aside>
  );
}
