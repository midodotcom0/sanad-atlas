"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AtlasGraph } from "./atlas-graph";
import {
  assertions,
  collectionOptions,
  egoEdges,
  egoNodes,
  hadithEdges,
  hadithNodes,
  matnVariants,
  narratorMap,
  narrators,
  prototypeNotice,
  sourceRegister,
} from "@/lib/mock-data";
import type { Narrator, ViewKey } from "@/lib/types";
import { normalizeSearchText } from "@/lib/search";

const views: { id: ViewKey; label: string; href: string }[] = [
  { id: "hadith", label: "طرق الحديث", href: "/hadith" },
  { id: "narrator", label: "الرواة", href: "/narrators/yahya" },
  { id: "network", label: "الشيوخ والتلاميذ", href: "/network" },
  { id: "compare", label: "مقارنة الرواة", href: "/compare" },
  { id: "variants", label: "اختلاف المتن", href: "/variants" },
  { id: "library", label: "المكتبة الحديثية", href: "/library" },
  { id: "sources", label: "المصادر والحقوق", href: "/sources" },
];

const confidenceLabel: Record<Narrator["confidence"], string> = {
  verified: "هوية محققة",
  high: "احتمال قوي",
  medium: "تحتاج إلى مراجعة",
  low: "احتمال ضعيف",
  conflict: "تعارض في الهوية",
};

function Mark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i /><i /><i /><i /><b />
    </span>
  );
}

function Chevron({ direction = "right" }: { direction?: "right" | "left" | "down" }) {
  const rotate = direction === "left" ? "rotate(180 12 12)" : direction === "down" ? "rotate(90 12 12)" : undefined;
  return <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: rotate }}><path d="m9 5 7 7-7 7" /></svg>;
}

function Status({ confidence }: { confidence: Narrator["confidence"] }) {
  return <span className={`status status-${confidence}`}><i />{confidenceLabel[confidence]}</span>;
}

function SourceTag({ status = "pending" }: { status?: "pending" | "reviewed" }) {
  return <span className={`source-tag ${status}`}>{status === "reviewed" ? "مراجَع علميا" : "بانتظار المراجعة"}</span>;
}

function WorkspaceHeader({ view, onBack, canGoBack }: { view: ViewKey; onBack: () => void; canGoBack: boolean }) {
  const active = views.find((item) => item.id === view)!;
  return (
    <div className="workspace-heading">
      <div className="breadcrumb">
        <button type="button" className="icon-button" onClick={onBack} disabled={!canGoBack} aria-label="العودة إلى الاختيار السابق"><Chevron direction="right" /></button>
        <span>أطلس الإسناد</span><Chevron direction="left" /><strong>{active.label}</strong>
      </div>
      <div className="heading-actions">
        <button type="button" className="quiet-button">حفظ العرض</button>
        <button type="button" className="quiet-button">مشاركة <span aria-hidden="true">↗</span></button>
      </div>
    </div>
  );
}

function NarratorPanel({ narrator, close }: { narrator: Narrator; close: () => void }) {
  const narratorAssertions = assertions.filter((item) => item.subjectId === narrator.id);
  return (
    <aside className="info-panel" aria-label="ملف الراوي">
      <div className="panel-topline"><span>ملف الراوي</span><button type="button" onClick={close} aria-label="إغلاق لوحة الراوي">×</button></div>
      <div className="identity-head" dir="rtl">
        <span className={`avatar ${narrator.role}`}>{narrator.shortAr.slice(0, 1)}</span>
        <div><h2>{narrator.nameAr}</h2><p dir="ltr">{narrator.transliteration}</p></div>
      </div>
      <Status confidence={narrator.confidence} />
      <dl className="fact-grid">
        <div><dt>الطبقة</dt><dd>{narrator.tabaqa}</dd></div>
        <div><dt>سنة الوفاة</dt><dd>{narrator.deathAh ? `${narrator.deathAh} هـ` : "غير معروفة"}</dd></div>
        <div><dt>البلد</dt><dd>{narrator.region}</dd></div>
        <div><dt>مواضع الإسناد</dt><dd>{narrator.hadithCount.toLocaleString("ar")}</dd></div>
      </dl>
      <section className="panel-section">
        <div className="section-title"><h3>شبكة الرواية</h3><span>بيانات العرض</span></div>
        <div className="metric-row">
          <button type="button"><strong>{narrator.id === "yahya" ? 18 : 4}</strong><span>الشيوخ</span></button>
          <button type="button"><strong>{narrator.id === "yahya" ? 127 : 12}</strong><span>التلاميذ</span></button>
          <button type="button"><strong>{narrator.id === "yahya" ? 43 : 7}</strong><span>الأحاديث</span></button>
        </div>
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

function HadithPanel({ selectedId }: { selectedId: string }) {
  const narrator = narratorMap.get(selectedId);
  if (narrator && selectedId !== "cluster") return <NarratorPanel narrator={narrator} close={() => undefined} />;
  return (
    <aside className="info-panel" aria-label="تفاصيل الحديث">
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

function Legend() {
  return (
    <div className="legend" aria-label="مفتاح الرسم">
      <span><i className="line isnad" />ثابت في إسناد</span>
      <span><i className="line bio" />مذكور في كتب الرجال</span>
      <span><i className="line variant-b" />اختلاف المتن ب</span>
      <span><i className="line uncertain" />غير محسوم</span>
      <span><i className="node-key companion" />صحابي</span>
      <span><i className="node-key compiler" />مصنّف</span>
    </div>
  );
}

function KeyboardNodeList({ ids, onSelect }: { ids: string[]; onSelect: (id: string) => void }) {
  return (
    <div className="keyboard-nodes" aria-label="عقد الرسم الظاهرة">
      {ids.map((id) => {
        const person = narratorMap.get(id);
        return person ? <button key={id} type="button" onClick={() => onSelect(id)}>{person.transliteration}</button> : null;
      })}
    </div>
  );
}

function GraphWorkspace({
  view, selectNode, collection, setCollection, highlightedIds,
}: {
  view: "hadith" | "narrator" | "network";
  selectNode: (id: string) => void;
  collection: string;
  setCollection: (value: string) => void;
  highlightedIds: string[];
}) {
  const isHadith = view === "hadith";
  const nodes = isHadith ? hadithNodes : egoNodes;
  const edges = isHadith ? hadithEdges : egoEdges;
  return (
    <>
      <section className="graph-toolbar" aria-label="مرشحات الرسم">
        <div>
          <span className="eyebrow">{isHadith ? "عنقود الحديث HCL-0001" : "الراوي NAR-0042"}</span>
          <h1 dir="rtl">{isHadith ? "حديث إنما الأعمال بالنيات" : "يحيى بن سعيد الأنصاري"}</h1>
        </div>
        <div className="filter-set">
          <label htmlFor="collection-filter">المصنف</label>
          <select id="collection-filter" value={collection} onChange={(event) => setCollection(event.target.value)} disabled={!isHadith}>
            {collectionOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
          <button type="button" className="direction-button"><span>اتجاه القراءة</span><b>←</b></button>
        </div>
      </section>
      <div className="graph-shell">
        <AtlasGraph nodes={nodes} edges={edges} collection={isHadith ? collection : "جميع المصنفات"} highlightedIds={highlightedIds} onSelect={selectNode} />
        <Legend />
        <KeyboardNodeList ids={nodes.map((node) => node.data.id)} onSelect={selectNode} />
      </div>
      {isHadith ? (
        <div className="route-summary">
          <span><b>٧</b> طرق ظاهرة</span><span><b>١</b> أصل مبكر مشترك</span><span><b>٣</b> صيغ متنية</span>
          <Link href="/variants">ربط المتن بالإسناد <Chevron direction="left" /></Link>
        </div>
      ) : (
        <div className="route-summary">
          <span><b>٢</b> من الشيوخ</span><span><b>٩</b> من التلاميذ</span><span><b>٣</b> طبقات من الدليل</span>
          <button type="button">فتح ١١٦ تلميذا آخر <Chevron direction="left" /></button>
        </div>
      )}
    </>
  );
}

function CompareView() {
  const [a, setA] = useState("yahya");
  const [b, setB] = useState("malik");
  const personA = narratorMap.get(a)!;
  const personB = narratorMap.get(b)!;
  const options = narrators.filter((item) => ["tabii", "later"].includes(item.role));
  const chronologicalOverlap = personA.deathAh && personB.birthAhMin
    ? personA.deathAh >= personB.birthAhMin + 10
    : null;
  return (
    <div className="content-view compare-view">
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
          <div className="timeline"><span style={{ insetInlineStart: "12%", width: "50%" }}><b>{personA.deathAh} هـ</b></span><span style={{ insetInlineStart: "35%", width: "46%" }}><b>{personB.deathAh} هـ</b></span></div>
          <div className="dual-facts"><p><strong>{personA.nameAr}</strong>{personA.region} · {personA.tabaqa}</p><p><strong>{personB.nameAr}</strong>{personB.region} · {personB.tabaqa}</p></div>
          <p className={`chronology-result ${chronologicalOverlap === false ? "conflict" : ""}`}>{chronologicalOverlap === null ? "المعطيات الزمنية غير كافية." : chronologicalOverlap ? "اللقاء ممكن زمنيا فقط؛ ولا يثبت السماع أو اللقاء بهذا وحده." : "يوجد تعارض زمني ظاهر؛ تُراجع الهوية والتواريخ."}</p>
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

function VariantsView({ selectNode }: { selectNode: (id: string) => void }) {
  const [variant, setVariant] = useState(matnVariants[0].id);
  const active = matnVariants.find((item) => item.id === variant)!;
  return (
    <div className="content-view variants-view">
      <header className="view-intro compact"><span className="eyebrow">تحليل ثنائي الاتجاه</span><h1>اقرأ المتن، وشاهد طرقه تضيء.</h1><p>يحدد كل اختلاف نصي الفروع المرتبطة به، ويفتح الضغط على الراوي الصيغ التي مرت من طريقه.</p></header>
      <div className="variant-layout">
        <section className="variant-texts">
          <div className="variant-tabs" role="tablist">
            {matnVariants.map((item) => <button role="tab" aria-selected={variant === item.id} type="button" key={item.id} onClick={() => setVariant(item.id)}>{item.label}</button>)}
          </div>
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

type CorpusManifest = {
  generatedAt: string;
  parserVersion: string;
  collections: Record<string, { title: string; records: number; uniqueNumbers: number; narratorOccurrences: number; parsedRecords: number; unparsedRecords: number; turathBookId: number; directFile: string }>;
  rijal: Record<string, { title: string; entries: number; deathYearsDetected: number; teacherPhrasesDetected: number; studentPhrasesDetected: number; turathBookId: number; directFile: string }>;
};

type TurathPage = { text: string; vol: string | number; page: string | number };

function plainTurathText(value: string) {
  return value.replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, "$1").replace(/<[^>]+>/g, " ").replace(/⦗[^⦘]+⦘/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function LibraryView() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [manifest, setManifest] = useState<CorpusManifest | null>(null);
  const [collection, setCollection] = useState<"bukhari" | "muslim">("bukhari");
  const [pages, setPages] = useState<TurathPage[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${basePath}/data/corpus/manifest.json`).then((response) => response.json()).then(setManifest).catch(() => setManifest(null));
  }, [basePath]);

  const loadCollection = async () => {
    if (!manifest) return;
    setLoading(true);
    try {
      const response = await fetch(manifest.collections[collection].directFile);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { pages: TurathPage[] };
      setPages(payload.pages);
    } finally {
      setLoading(false);
    }
  };

  const results = useMemo(() => {
    if (!pages.length) return [];
    const normalized = normalizeSearchText(query);
    const indexed = pages.map((page, index) => ({ page, index, text: plainTurathText(page.text) }));
    if (!normalized) return indexed.filter((item) => item.text.length > 80).slice(0, 20);
    return indexed.filter((item) => normalizeSearchText(item.text).includes(normalized)).slice(0, 40);
  }, [query, pages]);

  return (
    <div className="content-view library-view">
      <header className="view-intro"><span className="eyebrow">المكتبة الحديثية المستوردة</span><h1>صحيح البخاري وصحيح مسلم، بسندٍ قابل للتتبع.</h1><p>هذه مرحلة استخراج آلي أولى من تراث. كل سجل يحتفظ بالصفحة، وإصدار المحلل، ودرجة الثقة، وحالة المراجعة. لا تتحول الهوية المقترحة إلى هوية محققة إلا بعد مراجعة علمية.</p></header>
      {manifest ? <div className="corpus-metrics">
        {Object.entries(manifest.collections).map(([key, item]) => <article key={key}><span>{item.title}</span><strong>{item.records.toLocaleString("ar")} رواية وطريقا</strong><p>{item.uniqueNumbers.toLocaleString("ar")} رقما · {item.narratorOccurrences.toLocaleString("ar")} موضع راوٍ</p><small>{item.parsedRecords.toLocaleString("ar")} محلل آليا · {item.unparsedRecords.toLocaleString("ar")} محفوظ للمراجعة</small></article>)}
        {Object.entries(manifest.rijal).map(([key, item]) => <article key={key} className="rijal-metric"><span>{item.title}</span><strong>{item.entries.toLocaleString("ar")} ترجمة</strong><p>{item.teacherPhrasesDetected.toLocaleString("ar")} عبارة شيوخ · {item.studentPhrasesDetected.toLocaleString("ar")} عبارة تلاميذ</p><small>استخراج آلي غير معتمد</small></article>)}
      </div> : <p className="loading-copy">جار تحميل سجل البيانات…</p>}
      <section className="corpus-search">
        <div className="corpus-controls">
          <label>اختر الصحيح<select value={collection} onChange={(event) => { setCollection(event.target.value as "bukhari" | "muslim"); setPages([]); }}><option value="bukhari">صحيح البخاري</option><option value="muslim">صحيح مسلم</option></select></label>
          <button type="button" onClick={loadCollection} disabled={loading || !manifest}>{loading ? "جار تحميل كامل الكتاب من تراث…" : pages.length ? "إعادة تحميل الكتاب" : "فتح النص الكامل من تراث"}</button>
          <label className="corpus-query">البحث في المتن أو السند<input value={query} onChange={(event) => setQuery(event.target.value)} disabled={!pages.length} placeholder="مثال: إنما الأعمال" /></label>
        </div>
        {pages.length ? <><p className="result-count">تم تحميل {pages.length.toLocaleString("ar")} صفحة مباشرة من تراث · تظهر أول {results.length.toLocaleString("ar")} نتيجة</p><div className="hadith-results">{results.map(({ page, index, text }) => <article key={`${collection}-${index}`}><div className="hadith-result-head"><strong>الجزء {page.vol} · الصفحة {page.page}</strong><span className="machine-low">نص مصدر غير مراجع</span></div><p className="record-matn">{text.slice(0, 1800)}</p><footer><span>المصدر: تراث · الكتاب {manifest?.collections[collection].turathBookId}</span><a href={`https://app.turath.io/book/${manifest?.collections[collection].turathBookId}?page=${index + 1}`} target="_blank" rel="noreferrer">فتح الصفحة في تراث ↗</a></footer></article>)}</div></> : <div className="empty-corpus"><strong>النص الكامل يُقرأ مباشرة من مزود المصدر</strong><p>لا نعيد نشر ملف الطبعة داخل GitHub قبل اكتمال مراجعة الحقوق. عند الضغط يُحمّل النص من تراث في متصفحك، بينما تبقى المشتقات الكاملة محليا للمراجعة العلمية.</p></div>}
      </section>
    </div>
  );
}

function SourcesView() {
  return (
    <div className="content-view sources-view">
      <header className="view-intro"><span className="eyebrow">حقوق البيانات وسلسلة المصدر</span><h1>لا معلومة بلا أصل.</h1><p>يُراجع إدخال كل كتاب وطبعة ورخصة ومقدار النص المسموح به على حدة، مع فصل الخام عن المشتق وعن المادة المعتمدة.</p></header>
      <div className="rights-banner"><span>٠ / ٤</span><div><strong>مصادر اكتملت مراجعة حقوقها</strong><p>تم إنشاء موصل تراث، لكن النشر التجاري يحتاج إلى مراجعة حقوق كل طبعة.</p></div><button type="button">تصدير قائمة فحص الحقوق</button></div>
      <div className="source-table-wrap">
        <table className="source-table"><thead><tr><th>الكتاب</th><th>المؤلف</th><th>الأولوية</th><th>الأصل</th><th>الحقوق</th></tr></thead><tbody>{sourceRegister.map((source) => <tr key={source.title}><td><strong>{source.title}</strong></td><td>{source.author}</td><td>{source.tier}</td><td>{source.origin}</td><td><span className="rights-pending">{source.rights}</span></td></tr>)}</tbody></table>
      </div>
      <div className="source-footnotes"><article><span>الملف ٠١</span><h2>قائمة بأهم كتب التراجم والجرح والتعديل</h2><p>قائمة من تسع صفحات تشمل كتب الرجال، والسؤالات، والأسماء، والتدليس، والمراسيل. صورة الصفحة مقدمة عند خطأ التعرف النصي.</p></article><article><span>الملف ٠٢</span><h2>طبقات رواة الأحاديث</h2><p>لوحة كبيرة للطبقات تصف ترتيبها بأنه تقريبي واجتهادي؛ لذلك تُستعمل دليلا للمراجعة لا تصنيفا نهائيا.</p></article></div>
    </div>
  );
}

export function AtlasShell({ initialView }: { initialView: ViewKey }) {
  const [selectedId, setSelectedId] = useState(initialView === "hadith" ? "cluster" : "yahya");
  const [history, setHistory] = useState<string[]>([]);
  const [collection, setCollection] = useState("جميع المصنفات");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [highlightedIds] = useState<string[]>([]);

  const selectNode = useCallback((id: string) => {
    setHistory((current) => [...current, selectedId]);
    setSelectedId(id);
    setPanelOpen(true);
  }, [selectedId]);

  const goBack = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setSelectedId(previous);
    setHistory((current) => current.slice(0, -1));
  };

  const matches = useMemo(() => {
    const normalized = normalizeSearchText(query);
    if (!normalized) return narrators.slice(0, 5);
    return narrators.filter((item) => normalizeSearchText(`${item.nameAr} ${item.transliteration}`).includes(normalized)).slice(0, 6);
  }, [query]);

  const selectedNarrator = narratorMap.get(selectedId);
  const graphView = ["hadith", "narrator", "network"].includes(initialView);

  return (
    <main className="app-shell" dir="rtl">
      <div className="prototype-strip"><span>{prototypeNotice}</span><button type="button">ما معنى «أولي»؟</button></div>
      <header className="topbar">
        <Link className="brand" href="/hadith"><Mark /><span><b>أطلس الإسناد</b><small>شبكة السنة الموثقة</small></span></Link>
        <div className="global-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 160)} placeholder="ابحث باسم راوٍ، أو حديث، أو كتاب، أو بلد…" aria-label="البحث الشامل" />
          <kbd>⌘ K</kbd>
          {searchOpen ? <div className="search-results"><span>الرواة</span>{matches.map((person) => <button type="button" key={person.id} onMouseDown={() => selectNode(person.id)}><i>{person.shortAr.slice(0, 1)}</i><b>{person.nameAr}</b><small>{person.transliteration}</small><Status confidence={person.confidence} /></button>)}</div> : null}
        </div>
        <div className="top-actions">
          <button type="button">العربية <Chevron direction="down" /></button>
          <Link href="/compare" className="compare-action"><span>مقارنة</span><b>٢</b></Link>
        </div>
      </header>
      <nav className="mode-nav" aria-label="المشاهد الرئيسية">
        {views.map((item) => <Link key={item.id} href={item.href} className={initialView === item.id ? "active" : ""}><span>{item.label}</span></Link>)}
      </nav>
      <WorkspaceHeader view={initialView} onBack={goBack} canGoBack={Boolean(history.length)} />
      <div className={`workspace ${panelOpen && graphView ? "with-panel" : ""}`}>
        <section className="main-stage">
          {graphView ? <GraphWorkspace view={initialView as "hadith" | "narrator" | "network"} selectNode={selectNode} collection={collection} setCollection={setCollection} highlightedIds={highlightedIds} /> : null}
          {initialView === "compare" ? <CompareView /> : null}
          {initialView === "variants" ? <VariantsView selectNode={selectNode} /> : null}
          {initialView === "library" ? <LibraryView /> : null}
          {initialView === "sources" ? <SourcesView /> : null}
        </section>
        {panelOpen && graphView ? (selectedNarrator ? <NarratorPanel narrator={selectedNarrator} close={() => setPanelOpen(false)} /> : <HadithPanel selectedId={selectedId} />) : null}
      </div>
      {graphView && !panelOpen ? <button type="button" className="reopen-panel" onClick={() => setPanelOpen(true)}>فتح لوحة المعلومات <Chevron direction="left" /></button> : null}
      <div className="sr-only" aria-live="polite">{selectedNarrator ? `تم اختيار ${selectedNarrator.nameAr}` : "تم اختيار عنقود الحديث"}</div>
    </main>
  );
}
