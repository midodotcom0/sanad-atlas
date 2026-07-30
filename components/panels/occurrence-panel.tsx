"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApiNarratorOccurrenceContext } from "@/lib/hadith-graph";
import {
  loadRijalEntry,
  researchApiAvailable,
  searchRijalCandidates,
  type ApiRijalCandidate,
  type ApiRijalCriticism,
  type ApiRijalEntry,
} from "@/lib/api-client";
import type { ResponseEnvelope } from "@/lib/types";
import { confidenceLabel } from "../atlas-primitives";

type PanelTab = "card" | "critics" | "relations" | "sources";

const tabs: Array<{ id: PanelTab; label: string }> = [
  { id: "card", label: "البطاقة" },
  { id: "critics", label: "أقوال العلماء" },
  { id: "relations", label: "الشيوخ والتلاميذ" },
  { id: "sources", label: "المصادر" },
];

function isTeacherEvidence(item: ApiRijalCriticism) {
  return Boolean(item.phrase && /(?:روى\s+عن|سمع\s+من|لقي|أدرك)/.test(item.phrase));
}

function isStudentEvidence(item: ApiRijalCriticism) {
  return Boolean(item.phrase && /(?:روى\s+عنه|حدث\s+عنه|سمع\s+منه)/.test(item.phrase));
}

function sourceLabel(item: ApiRijalCriticism) {
  const locator = [item.citedVolume ? `ج ${item.citedVolume}` : "", item.citedPage ? `ص ${item.citedPage}` : ""].filter(Boolean).join(" · ");
  return `${item.citedWork}${locator ? ` · ${locator}` : ""}`;
}

function CriticismList({ items, empty }: { items: ApiRijalCriticism[]; empty: string }) {
  if (!items.length) return <p className="empty-copy">{empty}</p>;
  return <div className="narrator-opinions">{items.map((item) => (
    <article key={`${item.sequenceNo}-${item.criticName}-${item.citedWork}`}>
      <header><strong>{item.criticName}</strong><span>{item.sectionKind === "critic" ? "جرح وتعديل" : "دليل علاقة أو سماع"}</span></header>
      {item.phrase ? <p>{item.phrase}</p> : <p className="withheld-copy">النص محجوب في النشر العام حتى تراجع حقوق المصدر.</p>}
      <cite>{sourceLabel(item)}</cite>
    </article>
  ))}</div>;
}

/**
 * Integrated narrator card, modelled after the flow in Jami al-Kutub al-Tis'a:
 * tap a name in the isnad, then inspect the card, scholar opinions and sources
 * without leaving the hadith workspace.
 *
 * The crucial Atlas distinction remains visible: a name occurrence is not a
 * verified person. The selected Shamela record is an identity candidate until
 * an editor confirms the link.
 */
export function OccurrencePanel({ occurrence, close }: { occurrence: ApiNarratorOccurrenceContext; hadithId: string; close: () => void }) {
  const [tab, setTab] = useState<PanelTab>("card");
  const [candidates, setCandidates] = useState<ApiRijalCandidate[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [entryPayload, setEntryPayload] = useState<ResponseEnvelope<ApiRijalEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const resetTimer = window.setTimeout(() => {
      setTab("card");
      setCandidates([]);
      setSelectedEntryId("");
      setEntryPayload(null);
      setError("");
      setLoading(!occurrence.relativeForm);
    }, 0);
    if (occurrence.relativeForm) {
      return () => window.clearTimeout(resetTimer);
    }
    if (!researchApiAvailable()) {
      const errorTimer = window.setTimeout(() => {
        setLoading(false);
        setError("واجهة بيانات الرواة غير متصلة.");
      }, 0);
      return () => {
        window.clearTimeout(resetTimer);
        window.clearTimeout(errorTimer);
      };
    }
    const controller = new AbortController();
    searchRijalCandidates(occurrence.rawSurfaceForm, controller.signal)
      .then((response) => {
        const shamela = response.data.items.filter((item) => item.source === "shamela");
        const exact = shamela.filter((item) => item.matchKind === "exact_name");
        const usable = exact.length ? exact : shamela;
        setCandidates(usable);
        const first = usable[0];
        if (!first) return null;
        setSelectedEntryId(first.id);
        return loadRijalEntry(first.id, controller.signal);
      })
      .then((payload) => {
        if (payload) setEntryPayload(payload);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "تعذر تحميل بطاقة الراوي");
      })
      .finally(() => setLoading(false));
    return () => {
      window.clearTimeout(resetTimer);
      controller.abort();
    };
  }, [occurrence.rawSurfaceForm, occurrence.relativeForm]);

  const selectCandidate = async (candidate: ApiRijalCandidate) => {
    if (candidate.id === selectedEntryId) return;
    setSelectedEntryId(candidate.id);
    setLoading(true);
    setError("");
    try {
      setEntryPayload(await loadRijalEntry(candidate.id));
      setTab("card");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تحميل بطاقة الراوي");
    } finally {
      setLoading(false);
    }
  };

  const entry = entryPayload?.data;
  const criticisms = useMemo(() => entry?.criticisms ?? [], [entry?.criticisms]);
  const teacherEvidence = useMemo(() => criticisms.filter(isTeacherEvidence), [criticisms]);
  const studentEvidence = useMemo(() => criticisms.filter(isStudentEvidence), [criticisms]);
  const sources = useMemo(() => {
    const unique = new Map<string, ApiRijalCriticism>();
    for (const item of criticisms) {
      const key = `${item.citedWork}|${item.citedVolume ?? ""}|${item.citedPage ?? ""}`;
      if (!unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()];
  }, [criticisms]);

  return (
    <aside className="info-panel occurrence-panel narrator-card-panel" aria-label="بطاقة الراوي في الإسناد" dir="rtl">
      <div className="panel-topline"><span>بطاقة الراوي من داخل السند</span><button type="button" onClick={close} aria-label="إغلاق بطاقة الراوي">×</button></div>
      <div className="occurrence-context">
        <span>النص في هذا الإسناد</span>
        <strong>{occurrence.rawSurfaceForm}</strong>
        <small>السلسلة {(occurrence.chainOrder + 1).toLocaleString("ar")} · الموضع {(occurrence.position + 1).toLocaleString("ar")} · {confidenceLabel(occurrence.identityStatus)}</small>
      </div>

      {occurrence.relativeForm ? <section className="panel-section evidence-note warning"><span>صيغة نسبية</span><p>«{occurrence.rawSurfaceForm}» لا تعيّن شخصاً بذاتها. تُحل داخل هذه السلسلة فقط، لذلك لم تُفتح لها بطاقة عامة.</p></section> : null}
      {loading ? <p className="loading-copy">جار فتح ترجمة الشاملة وأقوال العلماء…</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {!loading && !error && !occurrence.relativeForm && !entry ? <p className="empty-copy">لم توجد ترجمة مطابقة في دليل رواة الشاملة لهذا اللفظ.</p> : null}

      {entry ? <>
        <div className="narrator-card-heading">
          <span className="avatar later">{entry.nameSurface.slice(0, 1)}</span>
          <div><h2>{entry.nameSurface}</h2><p>{entry.longName && entry.longName !== entry.nameSurface ? entry.longName : "دليل رواة المكتبة الشاملة"}</p></div>
        </div>
        <p className="identity-candidate-note">مطابقة اسمية من المصدر، وليست ربطاً محققاً بهوية الراوي في السند.</p>

        {candidates.length > 1 ? <div className="candidate-switcher"><span>توجد تراجم متشابهة — اختر المقصود</span>{candidates.slice(0, 8).map((candidate) => <button key={candidate.id} type="button" aria-pressed={candidate.id === selectedEntryId} onClick={() => selectCandidate(candidate)}><strong>{candidate.nameSurface}</strong><small>{[candidate.tabaqa, candidate.deathYearCandidate ? `ت ${candidate.deathYearCandidate.toLocaleString("ar")} هـ` : "", `ترجمة ${candidate.entryNumber.toLocaleString("ar")}`].filter(Boolean).join(" · ")}</small></button>)}</div> : null}

        <div className="narrator-card-tabs" role="tablist" aria-label="أقسام بطاقة الراوي">
          {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}{item.id === "critics" && criticisms.length ? <b>{criticisms.length.toLocaleString("ar")}</b> : null}</button>)}
        </div>

        {tab === "card" ? <div className="narrator-tab-panel" role="tabpanel">
          <dl className="fact-grid">
            <div><dt>الكنية</dt><dd>{entry.kunya || "—"}</dd></div>
            <div><dt>النسب</dt><dd>{entry.nisbas?.join(" · ") || "—"}</dd></div>
            <div><dt>الطبقة</dt><dd>{entry.tabaqa || "—"}</dd></div>
            <div><dt>الوفاة</dt><dd>{entry.deathYearCandidate ? `${entry.deathYearCandidate.toLocaleString("ar")} هـ` : "—"}</dd></div>
            <div><dt>الإقامة</dt><dd>{entry.residencePlaces?.join(" · ") || entry.region || "—"}</dd></div>
            <div><dt>الرحلة</dt><dd>{entry.travelPlaces?.join(" · ") || "—"}</dd></div>
          </dl>
          {entry.creedNote ? <section className="compact-source-note"><span>وصف في المصدر</span><p>{entry.creedNote}</p></section> : null}
          <section className="rank-card ibn-hajar"><span>حكم ابن حجر</span><p>{entry.ibnHajarGrade || "لا يوجد حكم مختصر في السجل"}</p></section>
          <section className="rank-card al-dhahabi"><span>حكم الذهبي</span><p>{entry.alDhahabiGrade || "لا يوجد حكم مختصر في السجل"}</p></section>
        </div> : null}

        {tab === "critics" ? <div className="narrator-tab-panel" role="tabpanel">
          <p className="tab-intro">كل قول مستقل باسم قائله ومرجع الكتاب؛ لا يجمع الأطلس الأقوال في حكم واحد.</p>
          <CriticismList items={criticisms.filter((item) => item.sectionKind === "critic")} empty="لم يسجل المصدر قولاً نقدياً لهذه الترجمة." />
        </div> : null}

        {tab === "relations" ? <div className="narrator-tab-panel relation-tab" role="tabpanel">
          <section><h3>الشيوخ والسماع</h3><CriticismList items={teacherEvidence} empty="لم توجد في السجل عبارة صريحة من نوع «روى عن» أو «سمع من»." /></section>
          <section><h3>التلاميذ والرواية عنه</h3><CriticismList items={studentEvidence} empty="لم توجد في السجل عبارة صريحة من نوع «روى عنه» أو «حدث عنه»." /></section>
          <p className="tab-intro">هذه عبارات مصدرية، لا علاقات أشخاص مدمجة آلياً.</p>
        </div> : null}

        {tab === "sources" ? <div className="narrator-tab-panel" role="tabpanel">
          <ul className="narrator-source-list">{sources.map((item) => <li key={`${item.citedWork}-${item.citedVolume}-${item.citedPage}`}><strong>{item.citedWork}</strong><span>{[item.citedVolume ? `ج ${item.citedVolume}` : "", item.citedPage ? `ص ${item.citedPage}` : ""].filter(Boolean).join(" · ") || "موضع غير مرقم"}</span></li>)}</ul>
          <a className="panel-cta primary" href={`https://shamela.ws/narrator/${entry.entryNumber}`} target="_blank" rel="noreferrer"><span>فتح بطاقة المصدر في الشاملة</span><b>↗</b></a>
          <small className="source-version">{entryPayload?.dataVersion}</small>
        </div> : null}
      </> : null}
    </aside>
  );
}
