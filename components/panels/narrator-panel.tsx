"use client";

import Link from "next/link";
import { assertions, dateAssertions, narratorNetworkCounts } from "@/lib/mock-data";
import type { Narrator } from "@/lib/types";
import { Chevron, SourceTag, Status } from "../atlas-primitives";

/**
 * Erzaehlerpanel.
 *
 * Datierungsregel dieses Panels: ein Jahr erscheint nur zusammen mit der
 * Stelle, die es traegt. Fuer Erzaehler ohne `DateAssertion` wird das im
 * Demonstrationsbestand hinterlegte Todesjahr ausdruecklich als unbelegter
 * Anzeigewert gekennzeichnet, statt es wie eine Aussage zu setzen
 * (Abschnitt 14: keine Datierung ohne Quellenreferenz).
 */
export function NarratorPanel({ narrator, close }: { narrator: Narrator; close: () => void }) {
  const narratorAssertions = assertions.filter((item) => item.subjectId === narrator.id);
  const narratorDates = dateAssertions.filter((item) => item.narratorId === narrator.id);
  const network = narratorNetworkCounts(narrator.id);
  const deathDates = narratorDates.filter((item) => item.event === "death");
  return (
    <aside className="info-panel" aria-label="ملف الراوي" dir="rtl">
      <div className="panel-topline"><span>ملف الراوي</span><button type="button" onClick={close} aria-label="إغلاق لوحة الراوي">×</button></div>
      <div className="identity-head" dir="rtl">
        <span className={`avatar ${narrator.role}`}>{narrator.shortAr.slice(0, 1)}</span>
        <div><h2>{narrator.nameAr}</h2><p dir="ltr">{narrator.transliteration}</p></div>
      </div>
      <Status confidence={narrator.confidence} />
      <dl className="fact-grid">
        <div><dt>الطبقة</dt><dd>{narrator.tabaqa}</dd></div>
        <div>
          <dt>سنة الوفاة</dt>
          <dd>
            {deathDates.length
              ? deathDates.map((item) => `${item.yearMin === item.yearMax ? item.yearMin : `${item.yearMin}–${item.yearMax}`} هـ`).join(" / ")
              : narrator.deathAh
                ? `${narrator.deathAh} هـ`
                : "غير معروفة"}
          </dd>
        </div>
        <div><dt>البلد</dt><dd>{narrator.region}</dd></div>
        <div><dt>مواضع الإسناد</dt><dd>{narrator.hadithCount.toLocaleString("ar")}</dd></div>
      </dl>
      <section className="panel-section">
        <div className="section-title"><h3>التواريخ وإحالاتها</h3><span>بلا توسيط</span></div>
        {narratorDates.length ? (
          <ul className="date-assertion-list">
            {narratorDates.map((item) => (
              <li key={item.id}>
                <b>{item.event === "death" ? "وفاة" : "مولد"}</b>
                <span>{item.yearMin === item.yearMax ? `${item.yearMin} هـ` : `${item.yearMin}–${item.yearMax} هـ`}</span>
                <cite>{item.sourceLabel} · {item.reference}</cite>
                <SourceTag status={item.reviewStatus === "reviewed" ? "reviewed" : "pending"} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-copy unsourced-date">
            لا توجد إحالة تاريخية مسجلة لهذا الراوي في بيانات العرض.
            {narrator.deathAh ? ` سنة الوفاة ${narrator.deathAh} هـ المعروضة أعلاه قيمة عرض من كتب الطبقات بلا موضع مصدر، ولا تصلح للاستدلال قبل إسنادها.` : ""}
          </p>
        )}
      </section>
      <section className="panel-section">
        <div className="section-title"><h3>شبكة الرواية</h3><span>بيانات العرض</span></div>
        <div className="metric-row">
          <button type="button"><strong>{network.teachers.toLocaleString("ar")}</strong><span>الشيوخ</span></button>
          <button type="button"><strong>{network.students.toLocaleString("ar")}</strong><span>التلاميذ</span></button>
          <button type="button"><strong>{network.routes.toLocaleString("ar")}</strong><span>الطرق</span></button>
        </div>
        <p className="empty-copy">هذه الأعداد محسوبة من صلات بيانات العرض نفسها، لا من رقم مكتوب باليد. الأعداد الحقيقية تأتي من نقاط النهاية الخاصة بالعلاقات.</p>
      </section>
      <section className="panel-section">
        <div className="section-title"><h3>أقوال النقاد</h3><button type="button">عرض الجميع</button></div>
        {narratorAssertions.length ? narratorAssertions.map((item) => (
          <article className="assertion" key={item.id} dir="rtl">
            <blockquote>«{item.phraseAr}»</blockquote>
            <p>{item.scholar}</p>
            <cite>{item.work} · ج {item.volume}، ص {item.page}</cite>
            <SourceTag status={item.status} />
          </article>
        )) : <p className="empty-copy">لا توجد أقوال مسجلة لهذا الراوي في بيانات العرض بعد.</p>}
      </section>
      <section className="panel-section evidence-note">
        <span>مصدر المعلومة</span>
        <p>ترتبط كل معلومة بالطبعة، وموضع النص، والمراجع، وإصدار البيانات.</p>
      </section>
      <Link className="panel-cta" href="/narrators/yahya"><span>فتح الملف الكامل</span><b><Chevron direction="left" /></b></Link>
    </aside>
  );
}
