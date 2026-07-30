"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  loadRijalEntry,
  researchApiAvailable,
  searchRijalCandidates,
  RIJAL_SOURCE_NAMES_AR,
  type ApiRijalCandidate,
  type ApiRijalEntry,
  type RijalSourceKey,
} from "@/lib/api-client";
import { normalizeSearchText } from "@/lib/search";
import type { ResponseEnvelope, SourceReference } from "@/lib/types";
import { confidenceLabel, originLabel, reviewStatusLabel, TextWithheldNotice } from "./atlas-primitives";

/**
 * Werktitel der Rijāl-Quellen. Bezieht die Beschriftung aus `lib/api-client.ts`,
 * damit die am 30. Juli 2026 registrierte vierte Quelle (al-Kāshif, Turath 2171,
 * 6.942 Eintraege) ueberall benannt ist -- vorher endete diese Karte bei drei
 * Werken und ein Kāshif-Treffer waere ohne Quellenangabe erschienen.
 */
const sourceNames = RIJAL_SOURCE_NAMES_AR;

/** Reihenfolge der Quellenabschnitte: Primaerwerke zuerst, Ergaenzungen danach. */
const sourceOrder: RijalSourceKey[] = ["tahdhib", "mizan", "taqrib", "kashif"];

const matchNames: Record<ApiRijalCandidate["matchKind"], string> = {
  exact_name: "مطابقة الاسم",
  name_prefix: "مطابقة صدر الاسم",
  name_contains: "الاسم يشتمل على العبارة",
  biography_mention: "ذِكر داخل الترجمة",
};

/**
 * Quellenreferenz, wie der aktuelle Entwicklungsadapter sie liefert.
 *
 * FREMDDATEI-BEDARF: `backend/app/repository.py:396,452` sendet `sourceWork`
 * und `entryNumber`, waehrend `lib/types.ts` `SourceReference` `sourcePassageId`
 * und `work` vorschreibt. Bis das angeglichen ist, beschreibt dieser Typ beide
 * Formen, damit die Oberflaeche keine Referenz stillschweigend verliert.
 */
type RecordSourceReference = Partial<SourceReference> & {
  sourceWork?: string;
  entryNumber?: number;
  sourcePageId?: number;
};

function ResearchHeader() {
  return (
    <header className="record-header">
      <Link className="record-brand" href="/hadith"><span aria-hidden="true">۞</span><strong>أطلس الإسناد</strong></Link>
      <nav aria-label="التنقل في السجل"><Link href="/library">المكتبة</Link><Link href="/hadith">طرق الحديث</Link><Link href="/sources">المصادر</Link></nav>
    </header>
  );
}

function StateCard({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <div className={`record-state ${error ? "error" : ""}`}>{children}</div>;
}

/**
 * Relative Namensform.
 *
 * FREMDDATEI-BEDARF / Umsetzungsplan P4.4: diese Liste existiert derzeit an drei
 * Stellen (`scripts/import-turath-corpus.mjs`, `lib/entity-resolution.ts` und
 * hier) und prueft nur exakte Gleichheit. Sobald `lib/relative-forms.ts`
 * existiert, ersetzt sie diese Funktion. Bis dahin bleibt die Warnung erhalten,
 * weil eine relative Form niemals global aufgeloest werden darf.
 */
function isRelativeSurface(value: string) {
  return /^(ابيه|ابيها|عمه|اخيه|جده|امه|شيخه)$/.test(normalizeSearchText(value));
}

/** Prueft- und Herkunftsangaben der Antworthuelle, sichtbar und getrennt. */
function EnvelopeFooter({ payload }: { payload: ResponseEnvelope<unknown> }) {
  return (
    <p className="record-method-note">
      إصدار البيانات: {payload.dataVersion} · درجة الثقة: {confidenceLabel(payload.confidenceLevel)}
      {payload.confidenceScore !== null ? ` (${payload.confidenceScore})` : ""} · حالة المراجعة: {reviewStatusLabel(payload.reviewStatus)}
      {" "}· المصدر: {originLabel(payload.origin)} · آخر مراجعة: {payload.lastReviewedAt ?? "لم تُراجع بعد"}.
      الترتيب آلي بحسب مطابقة عنوان الترجمة قبل الذكر العابر داخل النص.
    </p>
  );
}

export function NarratorLookup() {
  const parameters = useSearchParams();
  const name = parameters.get("name")?.trim() ?? "";
  const hadithId = parameters.get("hadith");
  const chain = parameters.get("chain");
  const position = parameters.get("position");
  const [payload, setPayload] = useState<ResponseEnvelope<{ query: string; items: ApiRijalCandidate[] }> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!name || !researchApiAvailable()) return;
    const controller = new AbortController();
    searchRijalCandidates(name, controller.signal).then(setPayload).catch((cause) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "تعذر البحث في كتب الرجال");
    });
    return () => controller.abort();
  }, [name]);

  const grouped = useMemo(() => {
    const groups = new Map<RijalSourceKey, ApiRijalCandidate[]>();
    for (const candidate of payload?.data.items ?? []) groups.set(candidate.source, [...(groups.get(candidate.source) ?? []), candidate]);
    return groups;
  }, [payload]);

  return (
    <main className="research-record-shell" dir="rtl">
      <ResearchHeader />
      <div className="record-container">
        <div className="record-breadcrumb"><Link href={hadithId ? `/hadith?record=${encodeURIComponent(hadithId)}` : "/library"}>العودة إلى {hadithId ? "السند" : "المكتبة"}</Link><span>←</span><strong>مرشحو الهوية</strong></div>
        <header className="record-hero">
          <span className="eyebrow">موضع راوٍ · بحث في أربعة كتب رجال</span>
          <h1>{name || "لم يحدد اسم الراوي"}</h1>
          <p>هذه نتائج بحث مصدرية، وليست حكما بأن التراجم المعروضة هي الشخص نفسه. لا تنشأ هوية موحدة إلا بقرار تحقيقي موثق.</p>
          {hadithId ? <div className="occurrence-context"><span>الحديث <b>{hadithId}</b></span><span>السلسلة <b>{Number(chain ?? 0) + 1}</b></span><span>الموضع <b>{Number(position ?? 0) + 1}</b></span></div> : null}
        </header>

        {isRelativeSurface(name) ? <StateCard error><strong>صيغة نسبية لا تصلح للدمج العام</strong><p>يجب حل «{name}» داخل هذا الإسناد بالرجوع إلى الراوي السابق وسياق المصدر. نتائج النص أدناه للاستكشاف فقط.</p></StateCard> : null}
        {!researchApiAvailable() ? <StateCard error><strong>واجهة البحث المحلية غير متصلة</strong><p>شغّل واجهة البحث واضبط NEXT_PUBLIC_API_URL لعرض تراجم تهذيب التهذيب وميزان الاعتدال وتقريب التهذيب والكاشف المستوردة.</p></StateCard> : null}
        {error ? <StateCard error><strong>تعذر تحميل المرشحين</strong><p>{error}</p></StateCard> : null}
        {researchApiAvailable() && !payload && !error ? <StateCard><strong>جار البحث في كتب الرجال…</strong></StateCard> : null}
        {payload && !payload.data.items.length ? <StateCard><strong>لا توجد مطابقة نصية</strong><p>يبقى موضع الراوي ظاهرا بصفته هوية غير محسومة.</p></StateCard> : null}

        {sourceOrder.map((source) => {
          const candidates = grouped.get(source) ?? [];
          if (!candidates.length) return null;
          return <section className="candidate-section" key={source}><div className="candidate-heading"><div><span>المصدر</span><h2>{sourceNames[source]}</h2></div><b>{candidates.length.toLocaleString("ar")} نتائج</b></div><div className="candidate-grid">{candidates.map((candidate) => <Link className="candidate-card" href={`/rijal/entry?entry=${encodeURIComponent(candidate.id)}`} key={candidate.id}><div><span className="candidate-match">{matchNames[candidate.matchKind]}</span><span className="machine-low">{confidenceLabel(candidate.identityStatus)}</span></div><h3>{candidate.nameSurface}</h3><dl><div><dt>رقم الترجمة</dt><dd>{candidate.entryNumber?.toLocaleString("ar") ?? "—"}</dd></div><div><dt>الوفاة المستخرجة</dt><dd>{candidate.deathYearCandidate ? `${candidate.deathYearCandidate.toLocaleString("ar")} هـ` : "—"}</dd></div>{candidate.kunya ? <div><dt>الكنية</dt><dd>{candidate.kunya}</dd></div> : null}{candidate.nisbas?.length ? <div><dt>النسبة</dt><dd>{candidate.nisbas.join(" · ")}</dd></div> : null}</dl><footer><span>{candidate.volume ? `ج ${candidate.volume}` : ""} {candidate.page ? `· ص ${candidate.page}` : ""}</span><strong>فتح الدليل ←</strong></footer></Link>)}</div></section>;
        })}
        {payload ? <EnvelopeFooter payload={payload} /> : null}
      </div>
    </main>
  );
}

export function RijalEntryRecord() {
  const entryId = useSearchParams().get("entry")?.trim() ?? "";
  const [payload, setPayload] = useState<ResponseEnvelope<ApiRijalEntry> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!entryId || !researchApiAvailable()) return;
    const controller = new AbortController();
    loadRijalEntry(entryId, controller.signal).then(setPayload).catch((cause) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "تعذر تحميل الترجمة");
    });
    return () => controller.abort();
  }, [entryId]);

  const entry = payload?.data;
  const reference = payload?.sourceReferences[0] as RecordSourceReference | undefined;
  return (
    <main className="research-record-shell" dir="rtl">
      <ResearchHeader />
      <div className="record-container narrow">
        <div className="record-breadcrumb"><Link href="/library">المكتبة</Link><span>←</span><strong>نص رجالي مستخرج</strong></div>
        {!entryId ? <StateCard error><strong>لم يحدد رقم الترجمة</strong></StateCard> : null}
        {!researchApiAvailable() ? <StateCard error><strong>واجهة البحث المحلية غير متصلة</strong><p>هذه الصفحة تقرأ الترجمة من الفهرس المحلي المشتق، ولا تتصل بخدمة تجارية.</p></StateCard> : null}
        {error ? <StateCard error><strong>تعذر تحميل الترجمة</strong><p>{error}</p></StateCard> : null}
        {researchApiAvailable() && entryId && !entry && !error ? <StateCard><strong>جار تحميل الدليل المصدري…</strong></StateCard> : null}
        {entry ? <article className="rijal-record">
          <header><div><span className="eyebrow">{sourceNames[entry.source]} · الترجمة {entry.entryNumber?.toLocaleString("ar")}</span><h1>{entry.nameSurface}</h1></div><span className="status status-unresolved"><i />{confidenceLabel(entry.identityStatus)}</span></header>
          <p className="record-warning">هذا سجل مصدر منفصل. عرضه لا يعني دمجه آليا مع راوٍ في سند، ولا يمثل حكما مستقلا على عدالته أو ضبطه.</p>
          <dl className="record-facts">
            <div><dt>المصدر</dt><dd>{sourceNames[entry.source]}</dd></div>
            <div><dt>الجزء والصفحة</dt><dd>{entry.volume ?? "—"} / {entry.page ?? "—"}</dd></div>
            {entry.nameChain ? <div><dt>سلسلة الاسم</dt><dd>{entry.nameChain}</dd></div> : null}
            {entry.kunya ? <div><dt>الكنية</dt><dd>{entry.kunya}</dd></div> : null}
            {entry.nisbas?.length ? <div><dt>النسبة</dt><dd>{entry.nisbas.join(" · ")}</dd></div> : null}
            {entry.region ? <div><dt>البلد المستخرج</dt><dd>{entry.region}</dd></div> : null}
            {entry.tabaqa ? <div><dt>الطبقة كما نص عليها الكتاب</dt><dd>{entry.tabaqa}</dd></div> : null}
            {entry.ageAtDeath ? <div><dt>السن كما نص عليه الكتاب</dt><dd>{entry.ageAtDeath.toLocaleString("ar")} سنة</dd></div> : null}
            <div><dt>ثقة المحلل</dt><dd>{entry.parser.confidence}</dd></div>
          </dl>
          {entry.dateAssertions?.length ? <section className="evidence-passage date-assertions">
            <span>كل تاريخ ورد في الترجمة، بلا توسيط ولا ترجيح</span>
            <ul>{entry.dateAssertions.map((assertion, index) => <li key={`${assertion.kind}-${assertion.textOffset ?? index}`}>
              <b>{assertion.kind === "death" ? "وفاة" : assertion.kind === "birth" ? "مولد" : assertion.kind}</b>
              <span>{assertion.valueAh ? `${assertion.valueAh.toLocaleString("ar")} هـ` : "بلا سنة صريحة"}{assertion.approximate ? " · بصيغة تقريبية" : ""}</span>
              {assertion.rawPhrase ? <q>{assertion.verb ? `${assertion.verb} ` : ""}{assertion.rawPhrase}</q> : null}
              <small>موضع النص {assertion.textOffset ?? "—"} · صنف الدليل {assertion.evidenceClass}</small>
            </li>)}</ul>
          </section> : null}
          {entry.textWithheld ? <TextWithheldNotice what="عبارات الشيوخ والتلاميذ" /> : null}
          {entry.teacherPhrase ? <section className="evidence-passage"><span>عبارة «روى عن» المستخرجة</span><p>{entry.teacherPhrase}</p>{entry.teacherMentions?.length ? <ul className="mention-list">{entry.teacherMentions.map((mention, index) => <li key={`t-${index}`}>{mention}<em>مرشح، لم يُربط بهوية</em></li>)}</ul> : null}</section> : null}
          {entry.studentPhrase ? <section className="evidence-passage"><span>عبارة «روى عنه» المستخرجة</span><p>{entry.studentPhrase}</p>{entry.studentMentions?.length ? <ul className="mention-list">{entry.studentMentions.map((mention, index) => <li key={`s-${index}`}>{mention}<em>مرشح، لم يُربط بهوية</em></li>)}</ul> : null}</section> : null}
          <section className="source-proof"><h2>إحالة المصدر</h2><dl><div><dt>رقم الترجمة</dt><dd>{reference?.entryNumber ?? entry.entryNumber}</dd></div><div><dt>معرّف السجل</dt><dd dir="ltr">{entry.id}</dd></div><div><dt>حالة الحقوق</dt><dd>{reference?.rightsStatus ?? "قيد المراجعة"}</dd></div><div><dt>إصدار البيانات</dt><dd>{payload?.dataVersion}</dd></div></dl>{reference?.url ? <a href={reference.url} target="_blank" rel="noreferrer">فتح الموضع لدى المصدر ↗</a> : null}</section>
          {payload ? <EnvelopeFooter payload={payload} /> : null}
          <footer className="record-actions"><Link href={`/narrators/lookup?name=${encodeURIComponent(entry.nameSurface)}`}>البحث عن تراجم موازية</Link><Link href="/library">العودة إلى كتب الرجال</Link></footer>
        </article> : null}
      </div>
    </main>
  );
}
