"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  loadNarratorProfile,
  loadNarratorRelations,
  loadNarratorTimeline,
  researchApiAvailable,
  RIJAL_SOURCE_NAMES_AR,
  type ApiNarratorProfile,
  type ApiNarratorRelation,
  type ApiNarratorTimeline,
} from "@/lib/api-client";
import { Chevron, Status } from "../atlas-primitives";

type NarratorPanelData = {
  profile: ApiNarratorProfile;
  timeline: ApiNarratorTimeline;
  relations: ApiNarratorRelation[];
  relationsTruncated: boolean;
  dataVersion: string;
};

export function NarratorPanel({ narratorId, close }: { narratorId: string; close: () => void }) {
  const [loaded, setLoaded] = useState<NarratorPanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!narratorId) return;
    if (!researchApiAvailable()) {
      const timer = window.setTimeout(() => setError("NEXT_PUBLIC_API_URL غير مضبوط؛ لا يوجد ملف راوٍ بديل."), 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
    }, 0);
    Promise.all([
      loadNarratorProfile(narratorId, controller.signal),
      loadNarratorTimeline(narratorId, controller.signal),
      loadNarratorRelations(narratorId, null, 100, controller.signal),
    ]).then(([profile, timeline, relations]) => {
      setLoaded({ profile: profile.data, timeline: timeline.data, relations: relations.data.items, relationsTruncated: relations.data.pageInfo.hasNextPage, dataVersion: profile.dataVersion });
    }).catch((caught) => {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setLoaded(null);
      setError(caught instanceof Error ? caught.message : "تعذر تحميل ملف الراوي");
    }).finally(() => setLoading(false));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [narratorId]);

  if (loading) return <aside className="info-panel" aria-label="ملف الراوي" dir="rtl"><div className="panel-topline"><span>ملف الراوي</span><button type="button" onClick={close}>×</button></div><p className="loading-copy">جار تحميل الملف من العامل…</p></aside>;
  if (error || !loaded) return <aside className="info-panel" aria-label="ملف الراوي" dir="rtl"><div className="panel-topline"><span>ملف الراوي</span><button type="button" onClick={close}>×</button></div><p className="inline-error" role="alert">{error || "لا توجد استجابة لهذا المعرّف."}</p></aside>;

  const { profile, timeline, relations } = loaded;
  const label = profile.rawSurfaceForms[0] || profile.normalizedSurfaceForm || profile.id;
  const teachers = relations.filter((item) => item.relationshipType === "transmitted_from").length;
  const students = relations.filter((item) => item.relationshipType === "transmitted_to").length;
  const candidateKunyas = [...new Set(profile.rijalCandidates.map((item) => item.kunya).filter((item): item is string => Boolean(item)))];
  const candidateNisbas = [...new Set(profile.rijalCandidates.flatMap((item) => item.nisbas ?? []))];
  const candidateRegions = [...new Set(profile.rijalCandidates.map((item) => item.region).filter((item): item is string => Boolean(item)))];
  const candidateTabaqat = [...new Set(profile.rijalCandidates.map((item) => item.tabaqa).filter((item): item is string => Boolean(item)))];

  return (
    <aside className="info-panel" aria-label="ملف الراوي" dir="rtl">
      <div className="panel-topline"><span>ملف الراوي · {loaded.dataVersion}</span><button type="button" onClick={close} aria-label="إغلاق لوحة الراوي">×</button></div>
      <div className="identity-head"><span className="avatar later">{label.slice(0, 1)}</span><div><h2>{label}</h2><p dir="ltr">{profile.id}</p></div></div>
      <Status confidence={profile.identityStatus} />
      <dl className="fact-grid">
        <div><dt>الطبقة</dt><dd>{candidateTabaqat.join(" / ") || "غير موجودة في الاستجابة"}</dd></div>
        <div><dt>الكنية</dt><dd>{candidateKunyas.join(" / ") || "غير موجودة في الاستجابة"}</dd></div>
        <div><dt>النسبة</dt><dd>{candidateNisbas.join(" / ") || "غير موجودة في الاستجابة"}</dd></div>
        <div><dt>البلد</dt><dd>{candidateRegions.join(" / ") || "غير موجود في الاستجابة"}</dd></div>
        <div><dt>مواضع الإسناد</dt><dd>{profile.occurrenceCount.toLocaleString("ar")}</dd></div>
        <div><dt>الصيغ المختلفة</dt><dd>{profile.rawSurfaceForms.length.toLocaleString("ar")}</dd></div>
      </dl>
      <section className="panel-section"><div className="section-title"><h3>الصيغ الواردة</h3><span>من ملف العامل</span></div>{profile.rawSurfaceForms.length ? <p>{profile.rawSurfaceForms.join(" · ")}</p> : <p className="empty-copy">لا توجد صيغ في الاستجابة.</p>}</section>
      <section className="panel-section">
        <div className="section-title"><h3>التواريخ وإحالاتها</h3><span>بلا تقدير</span></div>
        {timeline.dateAssertions.length ? <ul className="date-assertion-list">{timeline.dateAssertions.map((item) => <li key={`${item.entryId}-${item.event}`}><b>{item.event === "death" ? "وفاة" : "مولد"}</b><span>{item.yearMin === item.yearMax ? `${item.yearMin} هـ` : `${item.yearMin}–${item.yearMax} هـ`}</span><cite>{item.sourceWork} · {item.entryId}</cite></li>)}</ul> : <p className="empty-copy unsourced-date">{timeline.note || "لا توجد إحالة تاريخية مسجلة."}</p>}
      </section>
      <section className="panel-section"><div className="section-title"><h3>شبكة الرواية</h3><span>{loaded.relationsTruncated ? "أول ١٠٠ صلة" : "كل الصلات المرجعة"}</span></div><div className="metric-row"><button type="button"><strong>{teachers.toLocaleString("ar")}{loaded.relationsTruncated ? "+" : ""}</strong><span>الشيوخ</span></button><button type="button"><strong>{students.toLocaleString("ar")}{loaded.relationsTruncated ? "+" : ""}</strong><span>التلاميذ</span></button><button type="button"><strong>{profile.occurrenceCount.toLocaleString("ar")}</strong><span>المواضع</span></button></div>{loaded.relationsTruncated ? <p className="empty-copy">للعلاقات نقطة تصفح مستقلة؛ تعرض الشبكة زر تحميل الصفحة التالية.</p> : null}</section>
      <section className="panel-section"><div className="section-title"><h3>كل المواضع المرجعة في الملف</h3><span>{profile.occurrences.length.toLocaleString("ar")} / {profile.occurrenceCount.toLocaleString("ar")}</span></div>{profile.occurrences.length ? <ul className="date-assertion-list">{profile.occurrences.map((item) => <li key={`${item.chainId}-${item.position}`}><b>{item.collection}</b><span>{item.rawSurfaceForm}</span><cite>{item.chainId} · الموضع {(item.position + 1).toLocaleString("ar")}</cite><Link href={`/hadith?record=${encodeURIComponent(item.hadithId)}`}>فتح الحديث</Link></li>)}</ul> : <p className="empty-copy">لا توجد مواضع في الاستجابة.</p>}{profile.truncatedOccurrences ? <p className="empty-copy">عقد الملف يعيد أول ٥٠ موضعا فقط، ولا يوفر حاليا مؤشر تصفح لبقية المواضع. العدد الكلي أعلاه من الاستجابة نفسها.</p> : null}</section>
      <section className="panel-section"><div className="section-title"><h3>ترجمات الرجال المرشحة</h3><span>{profile.rijalCandidates.length.toLocaleString("ar")}</span></div>{profile.rijalCandidates.length ? profile.rijalCandidates.map((item) => <article className="assertion" key={item.id}><blockquote>«{item.nameSurface || item.id}»</blockquote><p>{RIJAL_SOURCE_NAMES_AR[item.source]} · {item.matchKind}</p><cite>{item.volume ? `ج ${item.volume}` : ""} {item.page ? `· ص ${item.page}` : ""}</cite><Link href={`/rijal/entry?entry=${encodeURIComponent(item.id)}`}>فتح سجل المصدر</Link></article>) : <p className="empty-copy">لا توجد ترجمة مرشحة في الاستجابة.</p>}</section>
      <section className="panel-section evidence-note warning"><span>الرحلات</span><p>لا يرجع عقد ملف الراوي الحالي ادعاءات سفر مرتبطة بمصدر. لذلك لا تعرض الواجهة بلدا أو رحلة مستنتجة.</p></section>
      {profile.note ? <section className="panel-section evidence-note"><span>ملاحظة العامل</span><p>{profile.note}</p></section> : null}
      <Link className="panel-cta" href={`/network?narrator=${encodeURIComponent(profile.id)}`}><span>فتح الشبكة الكاملة</span><b><Chevron direction="left" /></b></Link>
    </aside>
  );
}
