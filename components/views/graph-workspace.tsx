"use client";

import Link from "next/link";
import { collectionOptions, egoEdgeChronology, egoEdges, egoNodes, hadithEdges, hadithNodes, narratorMap } from "@/lib/mock-data";
import type { LiveHadithGraph } from "@/lib/hadith-graph";
import { AtlasGraph } from "../atlas-graph-dynamic";
import { Chevron } from "../atlas-primitives";

/**
 * Die drei Graphansichten (`/hadith`, `/narrators/*`, `/network`). Cytoscape
 * kommt ueber `atlas-graph-dynamic.tsx` und damit nur in diesen Routen ins
 * Bundle.
 */

function Legend() {
  return (
    <div className="legend" aria-label="مفتاح الرسم" dir="rtl">
      <span><i className="line isnad" />ثابت في إسناد</span>
      <span><i className="line bio" />مذكور في كتب الرجال</span>
      <span><i className="line variant-b" />اختلاف المتن ب</span>
      <span><i className="line uncertain" />غير محسوم</span>
      <span><i className="node-key companion" />صحابي</span>
      <span><i className="node-key compiler" />مصنّف</span>
    </div>
  );
}

function KeyboardNodeList({ nodes, onSelect }: { nodes: { data: { id: string; label: string } }[]; onSelect: (id: string) => void }) {
  return (
    <div className="keyboard-nodes" aria-label="عقد الرسم الظاهرة">
      {nodes.map((node) => <button key={node.data.id} type="button" onClick={() => onSelect(node.data.id)}>{narratorMap.get(node.data.id)?.transliteration ?? node.data.label}</button>)}
    </div>
  );
}

/**
 * Chronologie der Netzwerkkanten, jede mit ihren Belegen.
 *
 * `compareChronology()` ist die einzige Quelle dieser Angaben. Wo kein belegtes
 * Geburts- und Todesjahr vorliegt, steht ausdruecklich "المعطيات غير كافية" --
 * nicht eine geschaetzte Moeglichkeit.
 */
function ChronologyEvidenceList() {
  const decided = egoEdgeChronology.filter((item) => item.result !== "insufficient");
  const undecided = egoEdgeChronology.length - decided.length;
  return (
    <section className="chronology-evidence" aria-label="الإمكان الزمني للصلات" dir="rtl">
      <div className="section-title"><h3>الإمكان الزمني، بحسب التواريخ المسندة فقط</h3><span>{undecided.toLocaleString("ar")} صلة بلا معطيات كافية</span></div>
      {decided.length ? <ul>{decided.map((item) => {
        const edge = egoEdges.find((candidate) => candidate.data.id === item.edgeId);
        return (
          <li key={item.edgeId} className={`chronology-result ${item.result}`}>
            <b>{narratorMap.get(edge?.data.source ?? "")?.shortAr} ← {narratorMap.get(edge?.data.target ?? "")?.shortAr}</b>
            <span>{item.label}</span>
            <small>{item.sourceReferences.map((reference) => `${reference.sourceLabel}: ${reference.reference}`).join(" · ")}</small>
          </li>
        );
      })}</ul> : <p className="empty-copy">لا صلة واحدة تملك تاريخا مسندا للطرفين في بيانات العرض.</p>}
      <p className="empty-copy">الإمكان الزمني ليس دليلا على لقاء ولا على سماع ولا على رواية. الدليل يأتي من موضع إسناد أو من نص رجالي صريح.</p>
    </section>
  );
}

export function GraphWorkspace({
  view, selectNode, collection, setCollection, highlightedIds, liveGraph, loading, error,
}: {
  view: "hadith" | "narrator" | "network";
  selectNode: (id: string) => void;
  collection: string;
  setCollection: (value: string) => void;
  highlightedIds: string[];
  liveGraph?: LiveHadithGraph | null;
  loading?: boolean;
  error?: string;
}) {
  const isHadith = view === "hadith";
  const nodes = isHadith ? liveGraph?.nodes ?? hadithNodes : egoNodes;
  const edges = isHadith ? liveGraph?.edges ?? hadithEdges : egoEdges;
  return (
    <>
      <section className="graph-toolbar" aria-label="مرشحات الرسم">
        <div dir="rtl">
          <span className="eyebrow">{isHadith ? liveGraph?.eyebrow ?? "عنقود الحديث HCL-0001" : "الراوي NAR-0042"}</span>
          <h1 dir="rtl">{isHadith ? liveGraph?.title ?? "حديث إنما الأعمال بالنيات" : "يحيى بن سعيد الأنصاري"}</h1>
        </div>
        <div className="filter-set">
          <label htmlFor="collection-filter">المصنف</label>
          <select id="collection-filter" value={collection} onChange={(event) => setCollection(event.target.value)} disabled={!isHadith || Boolean(liveGraph)}>
            {collectionOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </div>
      </section>
      <div className="graph-shell">
        <AtlasGraph nodes={nodes} edges={edges} collection={isHadith ? collection : "جميع المصنفات"} highlightedIds={highlightedIds} onSelect={selectNode} />
        {loading ? <div className="graph-load-state"><i /><strong>جار بناء السلسلة من مواضع المصدر…</strong></div> : null}
        {error ? <div className="graph-load-state error"><strong>تعذر تحميل السلسلة</strong><span>{error}</span></div> : null}
        <Legend />
        <KeyboardNodeList nodes={nodes} onSelect={selectNode} />
      </div>
      {isHadith ? (
        <div className="route-summary" dir="rtl">
          <span><b>{(liveGraph?.chainCount ?? 7).toLocaleString("ar")}</b> طرق ظاهرة</span><span><b>{(liveGraph?.occurrenceCount ?? 30).toLocaleString("ar")}</b> مواضع رواة</span><span><b>{liveGraph ? "آلي" : "٣"}</b> {liveGraph ? "حالة المراجعة" : "صيغ متنية"}</span>
          <Link href={liveGraph ? "/library" : "/variants"}>{liveGraph ? "العودة إلى المكتبة" : "ربط المتن بالإسناد"} <Chevron direction="left" /></Link>
        </div>
      ) : (
        <div className="route-summary" dir="rtl">
          <span><b>{egoEdges.filter((edge) => edge.data.target === "yahya").length.toLocaleString("ar")}</b> من الشيوخ</span>
          <span><b>{egoEdges.filter((edge) => edge.data.source === "yahya").length.toLocaleString("ar")}</b> من التلاميذ</span>
          <span><b>٣</b> طبقات من الدليل</span>
        </div>
      )}
      {view === "network" ? <ChronologyEvidenceList /> : null}
    </>
  );
}
