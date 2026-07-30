"use client";

import { useEffect, useState } from "react";
import {
  compareNarratorChronology,
  compareNarrators,
  loadNarratorProfile,
  loadNarratorTimeline,
  researchApiAvailable,
  type ApiChronologyComparison,
  type ApiNarratorComparison,
  type ApiNarratorProfile,
  type ApiNarratorTimeline,
} from "@/lib/api-client";
import { confidenceLabel } from "../atlas-primitives";

type LoadedComparison = {
  comparison: ApiNarratorComparison;
  chronology: ApiChronologyComparison;
  profiles: [ApiNarratorProfile, ApiNarratorProfile];
  timelines: [ApiNarratorTimeline, ApiNarratorTimeline];
  dataVersion: string;
  sourceCount: number;
};

function narratorLabel(profile: ApiNarratorProfile) {
  return profile.rawSurfaceForms[0] || profile.normalizedSurfaceForm || profile.id;
}

export function CompareView() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [loaded, setLoaded] = useState<LoadedComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const timer = window.setTimeout(() => {
      setA(parameters.get("a") ?? "");
      setB(parameters.get("b") ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const runComparison = async () => {
    if (!researchApiAvailable()) {
      setError("NEXT_PUBLIC_API_URL غير مضبوط؛ لا توجد مقارنة بديلة.");
      return;
    }
    if (!a.trim() || !b.trim()) return;
    setLoading(true);
    setError("");
    setLoaded(null);
    try {
      const [comparison, chronology, profileA, profileB, timelineA, timelineB] = await Promise.all([
        compareNarrators(a.trim(), b.trim()),
        compareNarratorChronology(a.trim(), b.trim()),
        loadNarratorProfile(a.trim()),
        loadNarratorProfile(b.trim()),
        loadNarratorTimeline(a.trim()),
        loadNarratorTimeline(b.trim()),
      ]);
      setLoaded({
        comparison: comparison.data,
        chronology: chronology.data,
        profiles: [profileA.data, profileB.data],
        timelines: [timelineA.data, timelineB.data],
        dataVersion: comparison.dataVersion,
        sourceCount: comparison.sourceReferences.length + chronology.sourceReferences.length + timelineA.sourceReferences.length + timelineB.sourceReferences.length,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تحميل المقارنة");
    } finally {
      setLoading(false);
    }
  };

  const personA = loaded?.profiles[0];
  const personB = loaded?.profiles[1];
  return (
    <div className="content-view compare-view" dir="rtl">
      <header className="view-intro"><span className="eyebrow">مقارنة من نقاط العامل</span><h1>راويان، والنتيجة مرتبطة بأدلتها.</h1><p>تستخدم الواجهة المقارنة الزمنية وعلاقات الإسناد وملفي الراوي كما أرجعها العامل. لا تنشئ حكما في العدالة أو الضبط.</p></header>
      <div className="compare-picker">
        <label>معرّف الراوي الأول<input dir="ltr" value={a} onChange={(event) => setA(event.target.value)} placeholder="UNC-… أو SA-P-…" /></label>
        <span className="compare-knot" aria-hidden="true"><i /><i /><b /></span>
        <label>معرّف الراوي الثاني<input dir="ltr" value={b} onChange={(event) => setB(event.target.value)} placeholder="UNC-… أو SA-P-…" /></label>
        <button type="button" onClick={runComparison} disabled={loading || !a.trim() || !b.trim()}>{loading ? "جار التحميل…" : "قارن"}</button>
      </div>
      {!researchApiAvailable() ? <p className="inline-error" role="alert">واجهة العامل غير مضبوطة. اضبط <code dir="ltr">NEXT_PUBLIC_API_URL</code> لعرض مقارنة حقيقية.</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {!loaded && !loading && !error ? <div className="empty-corpus"><strong>أدخل معرّفين من قاعدة العامل</strong><p>لا تختار الصفحة راويين افتراضيين ولا تعرض نتيجة تجريبية.</p></div> : null}
      {loaded && personA && personB ? <>
        <p className="result-count">إصدار البيانات: <b dir="ltr">{loaded.dataVersion}</b> · {loaded.sourceCount.toLocaleString("ar")} إحالات في الاستجابات</p>
        <div className="comparison-grid">
          <article className="comparison-card network-card">
            <div className="card-index">الشبكة</div><h2>صلة الإسناد المباشرة</h2>
            <div className="mini-path"><span>{narratorLabel(personA)}</span><i>↔</i><span>{narratorLabel(personB)}</span></div>
            <dl><div><dt>حكم نقطة المقارنة</dt><dd>{loaded.comparison.meeting === "asserted_isnad" ? "مثبتة في موضع إسناد" : "لا توجد صلة مثبتة"}</dd></div><div><dt>عدد المواضع المباشرة</dt><dd>{loaded.comparison.meetingEvidence.length.toLocaleString("ar")}</dd></div><div><dt>الحكم الزمني</dt><dd>{loaded.chronology.result}</dd></div></dl>
            {loaded.comparison.meetingEvidence.length ? <ul className="date-assertion-list">{loaded.comparison.meetingEvidence.map((item, index) => <li key={`${item.chainId}-${index}`}><b>{item.collection}</b><span>{item.hadithId}</span><cite>{item.chainId} · الموضع {item.position.toLocaleString("ar")}</cite></li>)}</ul> : <p className="empty-copy">لا تدّعي الاستجابة لقاء أو سماعا.</p>}
          </article>
          <article className="comparison-card biography-card">
            <div className="card-index">الزمن</div><h2>التواريخ كما وردت في المصادر</h2>
            <p className={`chronology-result ${loaded.chronology.result}`}>{loaded.chronology.reason}</p>
            {loaded.timelines.map((timeline, personIndex) => <section key={timeline.narratorId}><h3>{narratorLabel(loaded.profiles[personIndex])}</h3>{timeline.dateAssertions.length ? <ul className="date-assertion-list">{timeline.dateAssertions.map((item) => <li key={`${item.entryId}-${item.event}`}><b>{item.event === "death" ? "وفاة" : "مولد"}</b><span>{item.yearMin === item.yearMax ? `${item.yearMin} هـ` : `${item.yearMin}–${item.yearMax} هـ`}</span><cite>{item.sourceWork} · {item.entryId}</cite></li>)}</ul> : <p className="empty-copy">{timeline.note || "لا تاريخ مسندا في الاستجابة."}</p>}</section>)}
          </article>
          <article className="comparison-card hadith-card">
            <div className="card-index">الهوية</div><h2>الصيغ والترجمات المرشحة</h2>
            {[personA, personB].map((person) => <section key={person.id}><h3>{narratorLabel(person)}</h3><p>{person.rawSurfaceForms.join(" · ") || "لا صيغ إضافية"}</p><small>{confidenceLabel(person.identityStatus)} · {person.rijalCandidates.length.toLocaleString("ar")} ترجمات مرشحة</small></section>)}
          </article>
          <article className="comparison-card grades-card">
            <div className="card-index">حدود البيانات</div><h2>ما لا تقوله الاستجابة</h2>
            <p>نقطة المقارنة الحالية لا ترجع رحلات، ولا أقوال جرح وتعديل مربوطة بشخص محقق، ولا عناقيد متن مشتركة. لذلك تظل هذه الخانات فارغة، ولا تستبدلها الواجهة بأرقام أو عبارات ثابتة.</p>
            <p className="empty-copy">{loaded.comparison.chronologyReason}</p>
          </article>
        </div>
      </> : null}
    </div>
  );
}
