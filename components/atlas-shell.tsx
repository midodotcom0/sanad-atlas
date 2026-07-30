"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { narratorMap, narrators, prototypeNotice } from "@/lib/mock-data";
import type { ViewKey } from "@/lib/types";
import { normalizeSearchText } from "@/lib/search";
import { loadHadithGraph, researchApiAvailable } from "@/lib/api-client";
import { toHadithGraph, type LiveHadithGraph } from "@/lib/hadith-graph";
import { Chevron, Mark, Status } from "./atlas-primitives";
import { DirectionProvider, DirectionToggle, useDirection } from "./direction-context";

/**
 * Die Shell. Hier liegen nur noch Routing, Zustand und Chrome.
 *
 * Vorher waren in dieser Datei sechs Views und drei Panels als 608 Zeilen in
 * einer einzigen Client-Komponente versammelt, die von jeder Route importiert
 * wurde -- `/library` lud damit den Cytoscape-Graphen, den Matn-Diff und die
 * Redaktionsoberflaeche mit, obwohl keine davon dort erscheint. Jede Ansicht
 * liegt jetzt in `components/views/*`, jedes Panel in `components/panels/*`, und
 * beide werden per `next/dynamic` erst geladen, wenn die Route sie braucht.
 */

const views: { id: ViewKey; label: string; href: string }[] = [
  { id: "hadith", label: "طرق الحديث", href: "/hadith" },
  { id: "narrator", label: "الرواة", href: "/narrators/yahya" },
  { id: "network", label: "الشيوخ والتلاميذ", href: "/network" },
  { id: "compare", label: "مقارنة الرواة", href: "/compare" },
  { id: "variants", label: "اختلاف المتن", href: "/variants" },
  { id: "library", label: "المكتبة الحديثية", href: "/library" },
  { id: "sources", label: "المصادر والحقوق", href: "/sources" },
  { id: "editor", label: "لوحة التحقيق", href: "/editor" },
];

function ViewSkeleton() {
  return <div className="view-skeleton" aria-busy="true"><i /><span>جار تحميل هذه الواجهة…</span></div>;
}

// Ein Chunk je Ansicht. `ssr: true` (Standard) bleibt bewusst erhalten, damit
// der statische Export weiterhin Inhalt ausliefert; die Aufteilung des Bundles
// wirkt trotzdem, weil jede Route nur ihre eigenen Chunks referenziert.
const GraphWorkspace = dynamic(() => import("./views/graph-workspace").then((loaded) => loaded.GraphWorkspace), { loading: ViewSkeleton });
const CompareView = dynamic(() => import("./views/compare-view").then((loaded) => loaded.CompareView), { loading: ViewSkeleton });
const VariantsView = dynamic(() => import("./views/variants-view").then((loaded) => loaded.VariantsView), { loading: ViewSkeleton });
const LibraryView = dynamic(() => import("./views/library-view").then((loaded) => loaded.LibraryView), { loading: ViewSkeleton });
const SourcesView = dynamic(() => import("./views/sources-view").then((loaded) => loaded.SourcesView), { loading: ViewSkeleton });
const EditorView = dynamic(() => import("./views/editor-view").then((loaded) => loaded.EditorView), { loading: ViewSkeleton });
const DetailPanel = dynamic(() => import("./panels/detail-panel").then((loaded) => loaded.DetailPanel));

function WorkspaceHeader({ view, onBack, canGoBack }: { view: ViewKey; onBack: () => void; canGoBack: boolean }) {
  const { direction } = useDirection();
  const active = views.find((item) => item.id === view)!;
  return (
    <div className="workspace-heading">
      <div className="breadcrumb">
        <button type="button" className="icon-button" onClick={onBack} disabled={!canGoBack} aria-label="العودة إلى الاختيار السابق"><Chevron direction={direction === "rtl" ? "right" : "left"} /></button>
        <span>أطلس الإسناد</span><Chevron direction={direction === "rtl" ? "left" : "right"} /><strong>{active.label}</strong>
      </div>
      <div className="heading-actions">
        <button type="button" className="quiet-button">حفظ العرض</button>
        <button type="button" className="quiet-button">مشاركة <span aria-hidden="true">↗</span></button>
      </div>
    </div>
  );
}

function AtlasShellBody({ initialView }: { initialView: ViewKey }) {
  const { direction } = useDirection();
  const [selectedId, setSelectedId] = useState(initialView === "hadith" ? "cluster" : "yahya");
  const [history, setHistory] = useState<string[]>([]);
  const [collection, setCollection] = useState("جميع المصنفات");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [highlightedIds] = useState<string[]>([]);
  const [liveGraph, setLiveGraph] = useState<LiveHadithGraph | null>(null);
  const [liveGraphLoading, setLiveGraphLoading] = useState(false);
  const [liveGraphError, setLiveGraphError] = useState("");

  useEffect(() => {
    if (initialView !== "hadith" || !researchApiAvailable()) return;
    const recordId = new URLSearchParams(window.location.search).get("record");
    if (!recordId) return;
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setLiveGraphLoading(true);
      setLiveGraphError("");
    }, 0);
    loadHadithGraph(recordId, controller.signal)
      .then((payload) => {
        setLiveGraph(toHadithGraph(payload));
        setSelectedId("cluster");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLiveGraphError(error instanceof Error ? error.message : "تعذر تحميل بيانات الحديث");
      })
      .finally(() => setLiveGraphLoading(false));
    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [initialView]);

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
  const selectedOccurrence = liveGraph?.occurrences[selectedId];
  const graphView = initialView === "hadith" || initialView === "narrator" || initialView === "network";

  return (
    <main className="app-shell" dir={direction}>
      {/* Chrome: folgt dem Umschalter. Arabische Inhaltsbloecke unten behalten
          ihr eigenes dir="rtl". */}
      <div className="prototype-strip"><span>{prototypeNotice}</span><button type="button">ما معنى «أولي»؟</button></div>
      <header className="topbar">
        <Link className="brand" href="/hadith"><Mark /><span><b>أطلس الإسناد</b><small>شبكة السنة الموثقة</small></span></Link>
        <div className="global-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 160)} placeholder="ابحث باسم راوٍ، أو حديث، أو كتاب، أو بلد…" aria-label="البحث الشامل" dir="rtl" />
          <kbd>⌘ K</kbd>
          {searchOpen ? <div className="search-results" dir="rtl"><span>الرواة</span>{matches.map((person) => <button type="button" key={person.id} onMouseDown={() => selectNode(person.id)}><i>{person.shortAr.slice(0, 1)}</i><b>{person.nameAr}</b><small>{person.transliteration}</small><Status confidence={person.confidence} /></button>)}</div> : null}
        </div>
        <div className="top-actions">
          <DirectionToggle />
          <Link href="/compare" className="compare-action"><span>مقارنة</span><b>٢</b></Link>
        </div>
      </header>
      <nav className="mode-nav" aria-label="المشاهد الرئيسية">
        {views.map((item) => <Link key={item.id} href={item.href} className={initialView === item.id ? "active" : ""}><span>{item.label}</span></Link>)}
      </nav>
      <WorkspaceHeader view={initialView} onBack={goBack} canGoBack={Boolean(history.length)} />
      <div className={`workspace ${panelOpen && graphView ? "with-panel" : ""}`}>
        <section className="main-stage">
          {graphView ? <GraphWorkspace view={initialView as "hadith" | "narrator" | "network"} selectNode={selectNode} collection={collection} setCollection={setCollection} highlightedIds={highlightedIds} liveGraph={liveGraph} loading={liveGraphLoading} error={liveGraphError} /> : null}
          {initialView === "compare" ? <CompareView /> : null}
          {initialView === "variants" ? <VariantsView selectNode={selectNode} /> : null}
          {initialView === "library" ? <LibraryView /> : null}
          {initialView === "sources" ? <SourcesView /> : null}
          {initialView === "editor" ? <EditorView /> : null}
        </section>
        {panelOpen && graphView ? <DetailPanel selectedId={selectedId} liveGraph={liveGraph} close={() => setPanelOpen(false)} /> : null}
      </div>
      {graphView && !panelOpen ? <button type="button" className="reopen-panel" onClick={() => setPanelOpen(true)}>فتح لوحة المعلومات <Chevron direction="left" /></button> : null}
      <div className="sr-only" aria-live="polite">{selectedOccurrence ? `تم اختيار موضع الراوي ${selectedOccurrence.rawSurfaceForm}` : selectedNarrator ? `تم اختيار ${selectedNarrator.nameAr}` : "تم اختيار عنقود الحديث"}</div>
    </main>
  );
}

export function AtlasShell({ initialView }: { initialView: ViewKey }) {
  return (
    <DirectionProvider>
      <AtlasShellBody initialView={initialView} />
    </DirectionProvider>
  );
}
