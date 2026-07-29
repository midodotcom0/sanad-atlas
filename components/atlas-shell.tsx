"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
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

const views: { id: ViewKey; label: string; ar: string; href: string }[] = [
  { id: "hadith", label: "Hadith-Wege", ar: "الطرق", href: "/hadith" },
  { id: "narrator", label: "Überlieferer", ar: "الرواة", href: "/narrators/yahya" },
  { id: "network", label: "Lehrer & Schüler", ar: "الشيوخ والتلاميذ", href: "/network" },
  { id: "compare", label: "Vergleich", ar: "المقارنة", href: "/compare" },
  { id: "variants", label: "Matn-Varianten", ar: "اختلاف المتن", href: "/variants" },
  { id: "sources", label: "Quellen", ar: "المصادر", href: "/sources" },
];

const confidenceLabel: Record<Narrator["confidence"], string> = {
  verified: "Identität verifiziert",
  high: "Hohe Wahrscheinlichkeit",
  medium: "Prüfung erforderlich",
  low: "Geringe Wahrscheinlichkeit",
  conflict: "Identitätskonflikt",
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
  return <span className={`source-tag ${status}`}>{status === "reviewed" ? "redaktionell geprüft" : "Prüfung ausstehend"}</span>;
}

function WorkspaceHeader({ view, onBack, canGoBack }: { view: ViewKey; onBack: () => void; canGoBack: boolean }) {
  const active = views.find((item) => item.id === view)!;
  return (
    <div className="workspace-heading">
      <div className="breadcrumb">
        <button type="button" className="icon-button" onClick={onBack} disabled={!canGoBack} aria-label="Zurück zur vorherigen Auswahl"><Chevron direction="left" /></button>
        <span>Sanad Atlas</span><Chevron /><strong>{active.label}</strong>
      </div>
      <div className="heading-actions">
        <button type="button" className="quiet-button">Ansicht speichern</button>
        <button type="button" className="quiet-button">Teilen <span aria-hidden="true">↗</span></button>
      </div>
    </div>
  );
}

function NarratorPanel({ narrator, close }: { narrator: Narrator; close: () => void }) {
  const narratorAssertions = assertions.filter((item) => item.subjectId === narrator.id);
  return (
    <aside className="info-panel" aria-label="Überliefererprofil">
      <div className="panel-topline"><span>Überliefererprofil</span><button type="button" onClick={close} aria-label="Profilpanel schließen">×</button></div>
      <div className="identity-head" dir="rtl">
        <span className={`avatar ${narrator.role}`}>{narrator.shortAr.slice(0, 1)}</span>
        <div><h2>{narrator.nameAr}</h2><p dir="ltr">{narrator.transliteration}</p></div>
      </div>
      <Status confidence={narrator.confidence} />
      <dl className="fact-grid">
        <div><dt>Ṭabaqa</dt><dd dir="rtl">{narrator.tabaqa}</dd></div>
        <div><dt>Todesjahr</dt><dd>{narrator.deathAh ? `${narrator.deathAh} AH` : "unbekannt"}</dd></div>
        <div><dt>Region</dt><dd dir="rtl">{narrator.region}</dd></div>
        <div><dt>Ketten</dt><dd>{narrator.hadithCount.toLocaleString("de-DE")}</dd></div>
      </dl>
      <section className="panel-section">
        <div className="section-title"><h3>Netzwerk</h3><span>Mock-Bestand</span></div>
        <div className="metric-row">
          <button type="button"><strong>{narrator.id === "yahya" ? 18 : 4}</strong><span>Lehrer</span></button>
          <button type="button"><strong>{narrator.id === "yahya" ? 127 : 12}</strong><span>Schüler</span></button>
          <button type="button"><strong>{narrator.id === "yahya" ? 43 : 7}</strong><span>Hadithe</span></button>
        </div>
      </section>
      <section className="panel-section">
        <div className="section-title"><h3>Aussagen</h3><button type="button">Alle zeigen</button></div>
        {narratorAssertions.length ? narratorAssertions.map((item) => (
          <article className="assertion" key={item.id} dir="rtl">
            <blockquote>«{item.phraseAr}»</blockquote>
            <p>{item.scholar}</p>
            <cite>{item.work} · Bd. {item.volume}, S. {item.page}</cite>
            <SourceTag status={item.status} />
          </article>
        )) : <p className="empty-copy">Für diese Demo-Person ist noch keine Aussage hinterlegt.</p>}
      </section>
      <section className="panel-section evidence-note">
        <span>Provenance</span>
        <p>Jede fachliche Angabe wird später mit Edition, Textspanne, Prüfer und Datenversion ausgeliefert.</p>
      </section>
      <Link className="panel-cta" href="/narrators/yahya"><span>Vollständiges Profil öffnen</span><b><Chevron /></b></Link>
    </aside>
  );
}

function HadithPanel({ selectedId }: { selectedId: string }) {
  const narrator = narratorMap.get(selectedId);
  if (narrator && selectedId !== "cluster") return <NarratorPanel narrator={narrator} close={() => undefined} />;
  return (
    <aside className="info-panel" aria-label="Hadithdetails">
      <div className="panel-topline"><span>Hadith-Cluster</span><span className="record-id">HCL-0001</span></div>
      <div className="hadith-title" dir="rtl">
        <span className="surah-marker">١</span>
        <div><p>حديث النيات</p><h2>إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ</h2></div>
      </div>
      <div className="cluster-stats">
        <div><strong>7</strong><span>sichtbare Wege</span></div><div><strong>30+</strong><span>Überlieferer</span></div><div><strong>4</strong><span>Sammlungen</span></div>
      </div>
      <section className="panel-section">
        <div className="section-title"><h3>Ausgewählte Fassung</h3><span>Variante A</span></div>
        <p className="matn-snippet" dir="rtl">إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى</p>
        <p className="translation">Die Taten richten sich nach den Absichten; jedem Menschen kommt zu, was er beabsichtigt hat.</p>
      </section>
      <section className="panel-section">
        <div className="section-title"><h3>Beleg</h3><SourceTag /></div>
        <div className="source-card">
          <div><span>Werk</span><strong>Ṣaḥīḥ al-Bukhārī</strong></div>
          <div><span>Stelle</span><strong>Badʾ al-waḥy · Nr. 1</strong></div>
          <div><span>Edition</span><strong>noch festzulegen</strong></div>
        </div>
      </section>
      <section className="panel-section evidence-note warning">
        <span>Demo-Hinweis</span>
        <p>Die Routen illustrieren die Interaktion. Ketten, Nummern und Stellen müssen vor einem echten Datenimport editionsgenau geprüft werden.</p>
      </section>
    </aside>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Legende">
      <span><i className="line isnad" />Isnād-Beleg</span>
      <span><i className="line bio" />biografischer Beleg</span>
      <span><i className="line uncertain" />ungeklärt</span>
      <span><i className="node-key companion" />Ṣaḥābī</span>
      <span><i className="node-key compiler" />Sammler</span>
    </div>
  );
}

function KeyboardNodeList({ ids, onSelect }: { ids: string[]; onSelect: (id: string) => void }) {
  return (
    <div className="keyboard-nodes" aria-label="Sichtbare Graphknoten">
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
      <section className="graph-toolbar" aria-label="Graphfilter">
        <div>
          <span className="eyebrow">{isHadith ? "Hadith-Cluster HCL-0001" : "Überlieferer NAR-0042"}</span>
          <h1 dir="rtl">{isHadith ? "حديث إنما الأعمال بالنيات" : "يحيى بن سعيد الأنصاري"}</h1>
        </div>
        <div className="filter-set">
          <label htmlFor="collection-filter">Sammlung</label>
          <select id="collection-filter" value={collection} onChange={(event) => setCollection(event.target.value)} disabled={!isHadith}>
            {collectionOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
          <button type="button" className="direction-button"><span>Leserichtung</span><b>→</b></button>
        </div>
      </section>
      <div className="graph-shell">
        <AtlasGraph nodes={nodes} edges={edges} collection={isHadith ? collection : "Alle Sammlungen"} highlightedIds={highlightedIds} onSelect={selectNode} />
        <Legend />
        <KeyboardNodeList ids={nodes.map((node) => node.data.id)} onSelect={selectNode} />
      </div>
      {isHadith ? (
        <div className="route-summary">
          <span><b>7</b> Wege sichtbar</span><span><b>1</b> gemeinsamer früher Stamm</span><span><b>2</b> Matn-Familien</span>
          <Link href="/variants">Matn und Isnād koppeln <Chevron /></Link>
        </div>
      ) : (
        <div className="route-summary">
          <span><b>2</b> Lehrer geladen</span><span><b>9</b> Schüler geladen</span><span><b>2</b> Evidenztypen</span>
          <button type="button">Weitere 116 Schüler öffnen <Chevron /></button>
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
  return (
    <div className="content-view compare-view">
      <header className="view-intro"><span className="eyebrow">Quellengebundener Vergleich</span><h1>Zwei Überlieferer, vier Perspektiven.</h1><p>Der Vergleich zeigt dokumentierte Überschneidungen und Unterschiede. Er erzeugt kein eigenes Zuverlässigkeitsurteil.</p></header>
      <div className="compare-picker">
        <label>Person A<select value={a} onChange={(event) => setA(event.target.value)}>{options.map((item) => <option value={item.id} key={item.id}>{item.transliteration}</option>)}</select></label>
        <span className="compare-knot" aria-hidden="true"><i /><i /><b /></span>
        <label>Person B<select value={b} onChange={(event) => setB(event.target.value)}>{options.map((item) => <option value={item.id} key={item.id}>{item.transliteration}</option>)}</select></label>
      </div>
      <div className="comparison-grid">
        <article className="comparison-card network-card">
          <div className="card-index">NETZWERK</div><h2>Gemeinsame Berührungspunkte</h2>
          <div className="mini-path" dir="rtl"><span>{personA.shortAr}</span><i>عن</i><span>{personB.shortAr}</span></div>
          <dl><div><dt>Direkte Beziehung</dt><dd>{a === "yahya" && b === "malik" ? "in Ketten belegt" : "keine im Demo-Bestand"}</dd></div><div><dt>Gemeinsame Hadith-Cluster</dt><dd>1</dd></div><div><dt>Kürzester Pfad</dt><dd>{a === "yahya" && b === "malik" ? "1 Kante" : "2 Kanten"}</dd></div></dl>
        </article>
        <article className="comparison-card biography-card">
          <div className="card-index">BIOGRAFIE</div><h2>Zeit und Raum</h2>
          <div className="timeline"><span style={{ insetInlineStart: "12%", width: "50%" }}><b>{personA.deathAh} AH</b></span><span style={{ insetInlineStart: "35%", width: "46%" }}><b>{personB.deathAh} AH</b></span></div>
          <div className="dual-facts"><p><strong>{personA.transliteration}</strong>{personA.region} · {personA.tabaqa}</p><p><strong>{personB.transliteration}</strong>{personB.region} · {personB.tabaqa}</p></div>
        </article>
        <article className="comparison-card hadith-card">
          <div className="card-index">ÜBERLIEFERUNG</div><h2>Matn-Familien in ihren Wegen</h2>
          <div className="variant-bars"><span><i style={{ width: "78%" }} />Variante A</span><span><i style={{ width: "44%" }} />Variante B</span></div>
          <p>Die Demo zeigt eine gemeinsame Matn-Familie im Cluster HCL-0001. Diese Beobachtung ist keine Bewertung historischer Abhängigkeit.</p>
        </article>
        <article className="comparison-card grades-card">
          <div className="card-index">JARḤ WA TAʿDĪL</div><h2>Aussagen nebeneinander</h2>
          <table><thead><tr><th>Gelehrter</th><th>{personA.shortAr}</th><th>{personB.shortAr}</th></tr></thead><tbody><tr><td>ابن معين</td><td dir="rtl">ثقة <SourceTag /></td><td dir="rtl">ثقة <SourceTag /></td></tr><tr><td>أحمد</td><td dir="rtl">ثبت <SourceTag /></td><td>—</td></tr></tbody></table>
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
      <header className="view-intro compact"><span className="eyebrow">Bidirektionale Analyse</span><h1>Matn lesen. Wege aufleuchten sehen.</h1><p>Eine Textabweichung markiert die zugehörigen Äste. Ein Klick auf einen Überlieferer öffnet wiederum seine Textfassungen.</p></header>
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
              <div className="diff-note"><span>2 Unterschiede</span><p><del>{item.id === "v1" ? "بالنية" : "بالنيات"}</del><ins>{item.id === "v1" ? "بالنيات" : "بالنية"}</ins></p></div>
            </article>
          ))}
        </section>
        <section className="variant-graph">
          <div className="linked-heading"><span>Verknüpfte Wege</span><strong>{active.collections.join(" · ")}</strong></div>
          <AtlasGraph nodes={hadithNodes} edges={hadithEdges} collection="Alle Sammlungen" highlightedIds={active.branchIds} onSelect={selectNode} />
        </section>
      </div>
    </div>
  );
}

function SourcesView() {
  return (
    <div className="content-view sources-view">
      <header className="view-intro"><span className="eyebrow">Data Rights & Provenance</span><h1>Keine Aussage ohne Herkunft.</h1><p>Die beigefügte Bücherliste dient als Ausgangsregister. Aufnahme, Edition, Lizenz und erlaubte Textlänge müssen für jedes Werk separat freigegeben werden.</p></header>
      <div className="rights-banner"><span>0 / 6</span><div><strong>Rechte vollständig geklärt</strong><p>Der Prototyp importiert keine Volltexte.</p></div><button type="button">Data-Rights-Checkliste exportieren</button></div>
      <div className="source-table-wrap">
        <table className="source-table"><thead><tr><th>Werk</th><th>Autor</th><th>Priorität</th><th>Herkunft</th><th>Rechte</th></tr></thead><tbody>{sourceRegister.map((source) => <tr key={source.title}><td dir="rtl"><strong>{source.title}</strong></td><td dir="rtl">{source.author}</td><td>{source.tier}</td><td>{source.origin}</td><td><span className="rights-pending">{source.rights}</span></td></tr>)}</tbody></table>
      </div>
      <div className="source-footnotes"><article><span>PDF 01</span><h2>قائمة بأهم كتب التراجم والجرح والتعديل</h2><p>9 Seiten. Tabellarische Liste mit Rijāl-, Fragen-, Namens-, Tadlīs- und Mursal-Werken. Die Texterkennung ist teilweise fehlerhaft; Seitenbilder haben Vorrang.</p></article><article><span>PDF 02</span><h2>طبقات رواة الأحاديث</h2><p>Eine großformatige Übersicht der Ṭabaqāt. Die Grafik kennzeichnet ihre Zuordnung ausdrücklich als annähernd und iǧtihādī; deshalb nur als Prüfhinweis nutzbar.</p></article></div>
    </div>
  );
}

export function AtlasShell({ initialView }: { initialView: ViewKey }) {
  const [selectedId, setSelectedId] = useState(initialView === "hadith" ? "cluster" : "yahya");
  const [history, setHistory] = useState<string[]>([]);
  const [collection, setCollection] = useState("Alle Sammlungen");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [rtl, setRtl] = useState(false);
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
    <main className="app-shell" dir={rtl ? "rtl" : "ltr"}>
      <div className="prototype-strip"><span>{prototypeNotice}</span><button type="button">Was ist Mock?</button></div>
      <header className="topbar">
        <Link className="brand" href="/hadith"><Mark /><span><b>Sanad Atlas</b><small>أطلس الإسناد</small></span></Link>
        <div className="global-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 160)} placeholder="Name, Hadith, Buch oder Ort suchen …" aria-label="Universelle Suche" />
          <kbd>⌘ K</kbd>
          {searchOpen ? <div className="search-results"><span>Überlieferer</span>{matches.map((person) => <button type="button" key={person.id} onMouseDown={() => selectNode(person.id)}><i>{person.shortAr.slice(0, 1)}</i><b dir="rtl">{person.nameAr}</b><small>{person.transliteration}</small><Status confidence={person.confidence} /></button>)}</div> : null}
        </div>
        <div className="top-actions">
          <button type="button" onClick={() => setRtl((value) => !value)} aria-pressed={rtl}>RTL</button>
          <button type="button">DE <Chevron direction="down" /></button>
          <button type="button" className="compare-action"><span>Vergleichen</span><b>2</b></button>
        </div>
      </header>
      <nav className="mode-nav" aria-label="Hauptansichten">
        {views.map((item) => <Link key={item.id} href={item.href} className={initialView === item.id ? "active" : ""}><span>{item.label}</span><small dir="rtl">{item.ar}</small></Link>)}
      </nav>
      <WorkspaceHeader view={initialView} onBack={goBack} canGoBack={Boolean(history.length)} />
      <div className={`workspace ${panelOpen && graphView ? "with-panel" : ""}`}>
        <section className="main-stage">
          {graphView ? <GraphWorkspace view={initialView as "hadith" | "narrator" | "network"} selectNode={selectNode} collection={collection} setCollection={setCollection} highlightedIds={highlightedIds} /> : null}
          {initialView === "compare" ? <CompareView /> : null}
          {initialView === "variants" ? <VariantsView selectNode={selectNode} /> : null}
          {initialView === "sources" ? <SourcesView /> : null}
        </section>
        {panelOpen && graphView ? (selectedNarrator ? <NarratorPanel narrator={selectedNarrator} close={() => setPanelOpen(false)} /> : <HadithPanel selectedId={selectedId} />) : null}
      </div>
      {graphView && !panelOpen ? <button type="button" className="reopen-panel" onClick={() => setPanelOpen(true)}>Informationspanel öffnen <Chevron /></button> : null}
      <div className="sr-only" aria-live="polite">{selectedNarrator ? `${selectedNarrator.transliteration} ausgewählt` : "Hadith-Cluster ausgewählt"}</div>
    </main>
  );
}
