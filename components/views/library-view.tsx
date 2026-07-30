"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  researchApiAvailable,
  searchHadiths,
  searchRijal,
  RIJAL_SOURCE_NAMES_AR,
  type ApiHadith,
  type ApiRijalEntry,
  type PageInfo,
  type RijalSourceKey,
} from "@/lib/api-client";
import { confidenceLabel, TextWithheldNotice } from "../atlas-primitives";

/**
 * Bibliothek der importierten Hadith- und Rijāl-Bestaende.
 *
 * ## Lizenz-Gate (Umsetzungsplan P2.4, Auditbefund B5)
 *
 * Bis zum 30. Juli 2026 stand hier ein zweiter Ladeweg: ohne gesetztes
 * `NEXT_PUBLIC_API_URL` holte der Browser die Datei aus
 * `manifest.collections[…].directFile` -- und das ist keine lokale Ableitung,
 * sondern die **Rohdatei des Anbieters** (`https://files.turath.io/books-v3/735.json`).
 * Damit ging der komplette Editionsvolltext ungeprueft in die Seite, unter
 * vollstaendiger Umgehung des serverseitigen Rechte-Gates, das die
 * `publicDerivedFields`-Allowlist auswertet und `include_text` nur bei
 * freigegebener Rechtelage setzt. Durch den Reparse sind diese Dateien von
 * 83 MB auf rund 155 MB gewachsen.
 *
 * Dieser Weg ist entfernt. Was bleibt:
 *
 * 1. Die statische GitHub-Pages-Demonstration bleibt bedienbar: die
 *    abgeleiteten, veroeffentlichungsfaehigen **Kennzahlen** aus
 *    `public/data/corpus/manifest.json` (Anzahl Vorkommen, Erzaehlerpositionen,
 *    Rijāl-Eintraege, Parserquote) erscheinen weiter.
 * 2. Editionsvolltext liefert ausschliesslich die Forschungs-API, weil nur dort
 *    das Rechte-Gate greift. Der Hinweis darauf steht sichtbar in der Ansicht.
 * 3. Wer den Volltext sehen will, wird auf ausdrueckliche eigene Aktion an die
 *    Seite des Rechteinhabers weitergeleitet. Wir verteilen den Text nicht
 *    weiter, sondern verweisen auf seinen Ort.
 */

type CollectionKey = "bukhari" | "muslim";

type CorpusCollection = {
  title: string;
  records: number;
  uniqueNumbers: number;
  narratorOccurrences: number;
  parsedRecords: number;
  unparsedRecords: number;
  turathBookId: number;
};

type CorpusRijal = {
  title: string;
  entries: number;
  reviewQueueEntries?: number;
  deathAssertionsDetected?: number;
  teacherPhrasesDetected: number;
  studentPhrasesDetected: number;
  turathBookId: number;
};

type CorpusManifest = {
  generatedAt: string;
  dataVersion?: string;
  parserVersion: string;
  collections: Record<string, CorpusCollection>;
  rijal: Record<string, CorpusRijal>;
};

/** Seite des Rechteinhabers. Kein Abruf durch uns, nur ein Verweis. */
function turathBookHref(bookId: number) {
  return `https://app.turath.io/book/${bookId}`;
}

export function LibraryView() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [manifest, setManifest] = useState<CorpusManifest | null>(null);
  const [corpusKind, setCorpusKind] = useState<"hadith" | "rijal">("hadith");
  const [collection, setCollection] = useState<CollectionKey>("bukhari");
  const [rijalSource, setRijalSource] = useState<RijalSourceKey>("tahdhib");
  const [apiRecords, setApiRecords] = useState<ApiHadith[]>([]);
  const [rijalRecords, setRijalRecords] = useState<ApiRijalEntry[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>({ nextCursor: null, hasNextPage: false });
  const [apiVersion, setApiVersion] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const live = researchApiAvailable();

  useEffect(() => {
    fetch(`${basePath}/data/corpus/manifest.json`).then((response) => response.json()).then(setManifest).catch(() => setManifest(null));
  }, [basePath]);

  const clearResults = () => {
    setApiRecords([]);
    setRijalRecords([]);
    setPageInfo({ nextCursor: null, hasNextPage: false });
  };

  /**
   * Sucht ausschliesslich ueber die Forschungs-API. Ohne API gibt es hier
   * keinen Ersatzpfad: ein Browser kann das Rechte-Gate nicht ersetzen.
   */
  const loadCollection = async (append = false) => {
    if (!manifest || !live) return;
    setLoading(true);
    setLoadError("");
    try {
      const cursor = append ? pageInfo.nextCursor : null;
      if (corpusKind === "hadith") {
        const payload = await searchHadiths(collection, query, cursor);
        setApiRecords((current) => append ? [...current, ...payload.data.items] : payload.data.items);
        setRijalRecords([]);
        setPageInfo(payload.data.pageInfo);
        setApiVersion(payload.dataVersion);
      } else {
        const payload = await searchRijal(rijalSource, query, cursor);
        setRijalRecords((current) => append ? [...current, ...payload.data.items] : payload.data.items);
        setApiRecords([]);
        setPageInfo(payload.data.pageInfo);
        setApiVersion(payload.dataVersion);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "تعذر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  };

  const activeBookId = corpusKind === "hadith" ? manifest?.collections[collection]?.turathBookId : manifest?.rijal[rijalSource]?.turathBookId;
  const activeTitle = corpusKind === "hadith" ? manifest?.collections[collection]?.title : manifest?.rijal[rijalSource]?.title;

  return (
    <div className="content-view library-view" dir="rtl">
      <header className="view-intro"><span className="eyebrow">المكتبة الحديثية المستوردة</span><h1>صحيح البخاري وصحيح مسلم، بسندٍ قابل للتتبع.</h1><p>هذه مرحلة استخراج آلي أولى من تراث. كل سجل يحتفظ بالصفحة، وإصدار المحلل، ودرجة الثقة، وحالة المراجعة. لا تتحول الهوية المقترحة إلى هوية محققة إلا بعد مراجعة علمية.</p></header>
      {manifest ? <div className="corpus-metrics">
        {Object.entries(manifest.collections).map(([key, item]) => <article key={key}><span>{item.title}</span><strong>{item.records.toLocaleString("ar")} رواية وطريقا</strong><p>{item.uniqueNumbers.toLocaleString("ar")} رقما · {item.narratorOccurrences.toLocaleString("ar")} موضع راوٍ</p><small>{item.parsedRecords.toLocaleString("ar")} محلل آليا · {item.unparsedRecords.toLocaleString("ar")} محفوظ للمراجعة</small></article>)}
        {Object.entries(manifest.rijal).map(([key, item]) => <article key={key} className="rijal-metric"><span>{item.title}</span><strong>{item.entries.toLocaleString("ar")} ترجمة</strong><p>{item.teacherPhrasesDetected.toLocaleString("ar")} عبارة شيوخ · {item.studentPhrasesDetected.toLocaleString("ar")} عبارة تلاميذ</p><small>استخراج آلي غير معتمد{item.reviewQueueEntries ? ` · ${item.reviewQueueEntries.toLocaleString("ar")} في طابور المراجعة` : ""}</small></article>)}
      </div> : <p className="loading-copy">جار تحميل سجل البيانات…</p>}
      <section className="corpus-search">
        <div className={`data-mode ${live ? "live" : "static"}`}><i /><span>{live ? `متصل بواجهة البحث البحثية${apiVersion ? ` · ${apiVersion}` : ""}` : "عرض GitHub ثابت · الكشوف والأعداد فقط، بلا نص طبعة"}</span></div>

        {!live ? (
          <div className="rights-gate" role="note">
            <strong>الوصول إلى النص الكامل يستلزم واجهة البحث البحثية</strong>
            <p>
              هذه النسخة الثابتة تعرض الأعداد والمشتقات المسموح بنشرها فقط. أما إسناد الطبعة ومتنها فيمرّان عبر بوابة الحقوق في الخادم، التي تقرأ قائمة الحقول المسموحة لكل مصدر ولا تُصدر نصا لم تُعتمد حقوق طبعته.
            </p>
            <p>
              لذلك لا يُنزّل هذا العرض ملفات الطبعات إلى المتصفح. كان ذلك يجري سابقا مباشرة من ملفات المزوّد — نحو ١٥٥ ميغابايت من المشتقات — فيتجاوز البوابة تجاوزا كاملا.
            </p>
            <ul>
              <li>شغّل واجهة البحث واضبط <code dir="ltr">NEXT_PUBLIC_API_URL</code> لتصفح السجلات المستوردة مع حالة الحقوق لكل سجل.</li>
              <li>أو افتح موضع النص عند صاحب الحق مباشرة، بضغطة منك، دون أن نعيد نشره.</li>
            </ul>
            {activeBookId ? <a className="rights-gate-action" href={turathBookHref(activeBookId)} target="_blank" rel="noreferrer">فتح {activeTitle} عند تراث ↗</a> : null}
          </div>
        ) : null}

        <div className="corpus-kind-tabs" role="tablist" aria-label="نوع الفهرس">
          <button type="button" role="tab" aria-selected={corpusKind === "hadith"} onClick={() => { setCorpusKind("hadith"); clearResults(); }}>الأحاديث والأسانيد <small>{manifest ? Object.values(manifest.collections).reduce((sum, item) => sum + item.records, 0).toLocaleString("ar") : "…"}</small></button>
          <button type="button" role="tab" aria-selected={corpusKind === "rijal"} onClick={() => { setCorpusKind("rijal"); clearResults(); }}>كتب الرجال <small>{manifest ? Object.values(manifest.rijal).reduce((sum, item) => sum + item.entries, 0).toLocaleString("ar") : "…"}</small></button>
        </div>
        <div className="corpus-controls">
          {corpusKind === "hadith"
            ? <label>اختر الصحيح<select value={collection} onChange={(event) => { setCollection(event.target.value as CollectionKey); clearResults(); }}>{Object.entries(manifest?.collections ?? {}).map(([key, item]) => <option value={key} key={key}>{item.title} · {item.records.toLocaleString("ar")}</option>)}</select></label>
            : <label>اختر كتاب الرجال<select value={rijalSource} onChange={(event) => { setRijalSource(event.target.value as RijalSourceKey); clearResults(); }}>{Object.entries(manifest?.rijal ?? {}).map(([key, item]) => <option value={key} key={key}>{RIJAL_SOURCE_NAMES_AR[key as RijalSourceKey] ?? item.title} · {item.entries.toLocaleString("ar")}</option>)}</select></label>}
          <button type="button" onClick={() => loadCollection(false)} disabled={loading || !manifest || !live} title={live ? undefined : "يحتاج إلى واجهة البحث البحثية"}>{loading ? "جار البحث…" : live ? "البحث في جميع السجلات" : "البحث معطّل بلا واجهة بحثية"}</button>
          <label className="corpus-query">{corpusKind === "hadith" ? "البحث في المتن أو السند" : "البحث في الاسم أو نص الترجمة"}<input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") loadCollection(false); }} disabled={!live} placeholder={corpusKind === "hadith" ? "مثال: إنما الأعمال" : "مثال: يحيى بن سعيد"} /></label>
        </div>
        {loadError ? <p className="inline-error" role="alert">تعذر تحميل البيانات: {loadError}</p> : null}
        {apiRecords.length ? <><p className="result-count">المعروض {apiRecords.length.toLocaleString("ar")} سجلا · التصفح مستمر حتى آخر موضع</p><div className="hadith-results">{apiRecords.map((record) => <article key={record.id}><div className="hadith-result-head"><strong>{record.collection === "bukhari" ? "صحيح البخاري" : "صحيح مسلم"} · {record.hadithNumber.toLocaleString("ar")}</strong><span className="machine-low">{record.parser.reviewStatus === "unreviewed" ? "آلي · غير مراجع" : record.parser.reviewStatus}</span></div>{record.textWithheld ? <TextWithheldNotice what="المتن والسند" /> : <><p className="record-isnad" dir="rtl">{record.isnad}</p><p className="record-matn" dir="rtl">{record.matn}</p></>}<footer><span>{record.chainCount.toLocaleString("ar")} سلسلة · {record.narratorOccurrenceCount.toLocaleString("ar")} موضع راوٍ · ثقة {record.parser.confidence}</span><span>{record.volume ? `ج ${record.volume}` : ""} {record.page ? `· ص ${record.page}` : ""}</span><Link className="visualize-record" href={`/hadith?record=${encodeURIComponent(record.id)}`}>رسم السند ←</Link></footer></article>)}</div></> : null}
        {rijalRecords.length ? <><p className="result-count">المعروض {rijalRecords.length.toLocaleString("ar")} ترجمة مصدرية · الهويات ما زالت غير محلولة</p><div className="hadith-results rijal-results">{rijalRecords.map((record) => <article key={record.id}><div className="hadith-result-head"><strong>{record.nameSurface}</strong><span className="machine-low">{confidenceLabel(record.identityStatus)}</span></div><dl className="rijal-facts"><div><dt>رقم الترجمة</dt><dd>{record.entryNumber?.toLocaleString("ar") ?? "—"}</dd></div><div><dt>الوفاة المستخرجة</dt><dd>{record.deathYearCandidate ? `${record.deathYearCandidate.toLocaleString("ar")} هـ` : "غير مستخرجة"}</dd></div>{record.kunya ? <div><dt>الكنية</dt><dd>{record.kunya}</dd></div> : null}{record.nisbas?.length ? <div><dt>النسبة</dt><dd>{record.nisbas.join(" · ")}</dd></div> : null}{record.region ? <div><dt>البلد</dt><dd>{record.region}</dd></div> : null}{record.tabaqa ? <div><dt>الطبقة</dt><dd>{record.tabaqa}</dd></div> : null}{record.teacherPhrase ? <div><dt>روى عن</dt><dd dir="rtl">{record.teacherPhrase}</dd></div> : null}{record.studentPhrase ? <div><dt>روى عنه</dt><dd dir="rtl">{record.studentPhrase}</dd></div> : null}</dl>{record.textWithheld ? <TextWithheldNotice what="عبارات الشيوخ والتلاميذ" /> : null}<footer><span>{RIJAL_SOURCE_NAMES_AR[record.source]} · ثقة الاستخراج {record.parser.confidence}</span><span>{record.volume ? `ج ${record.volume}` : ""} {record.page ? `· ص ${record.page}` : ""}</span><Link className="visualize-record" href={`/rijal/entry?entry=${encodeURIComponent(record.id)}`}>فتح الترجمة ←</Link></footer></article>)}</div></> : null}
        {pageInfo.hasNextPage && (apiRecords.length || rijalRecords.length) ? <button className="load-more-records" type="button" onClick={() => loadCollection(true)} disabled={loading}>{loading ? "جار تحميل الصفحة التالية…" : "تحميل الأربعين التالية"}</button> : null}
        {!apiRecords.length && !rijalRecords.length ? <div className="empty-corpus"><strong>{live ? (corpusKind === "hadith" ? "ابدأ بعرض جميع الأحاديث أو ابحث في المتن والسند" : "ابدأ بعرض جميع التراجم أو ابحث باسم الراوي") : "الأعداد أعلاه مشتقات معلنة، لا نص طبعة"}</strong><p>{live ? "تعرض النتائج على صفحات متتابعة من أربعين سجلا حتى نهاية الكتاب." : "لا نعيد نشر ملفات الطبعات داخل GitHub قبل اكتمال مراجعة الحقوق، ولا نحمّلها إلى المتصفح من عند المزوّد."}</p></div> : null}
      </section>
    </div>
  );
}
