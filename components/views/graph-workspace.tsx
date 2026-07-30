"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  loadNarratorPaths,
  loadNarratorProfile,
  loadNarratorRelations,
  researchApiAvailable,
  type ApiNarratorProfile,
  type ApiNarratorRelation,
  type PageInfo,
} from "@/lib/api-client";
import { buildKeyboardEdgeItems, type LiveHadithGraph } from "@/lib/hadith-graph";
import type { GraphEdge, GraphNode } from "@/lib/types";
import { AtlasGraph } from "../atlas-graph-dynamic";
import { Chevron } from "../atlas-primitives";

const collectionOptions = ["جميع المصنفات", "صحيح البخاري", "صحيح مسلم"];

function Legend() {
  return (
    <div className="legend" aria-label="مفتاح الرسم" dir="rtl">
      <span><i className="line isnad" />ثابت في إسناد</span>
      <span><i className="line isnad identity-uncertain" />إسناد، هوية الراوي غير محسومة</span>
      <span><i className="line bio" />مذكور في كتب الرجال</span>
      <span><i className="line chronology-only" />إمكان زمني فقط، لا دليل سماع</span>
    </div>
  );
}

function KeyboardNodeList({ nodes, onSelect }: { nodes: GraphNode[]; onSelect: (id: string) => void }) {
  return <div className="keyboard-nodes" aria-label="عقد الرسم الظاهرة">{nodes.map((node) => <button key={node.data.id} type="button" onClick={() => onSelect(node.data.id)}>{node.data.label}</button>)}</div>;
}

function KeyboardEdgeList({ nodes, edges, selectedEdgeId, onSelect }: { nodes: GraphNode[]; edges: GraphEdge[]; selectedEdgeId: string | null; onSelect: (id: string) => void }) {
  const items = useMemo(() => buildKeyboardEdgeItems(nodes, edges), [nodes, edges]);
  return <div className="keyboard-edges" aria-label="صلات الرسم الظاهرة">{items.map((item) => <button key={item.id} type="button" aria-pressed={item.id === selectedEdgeId} onClick={() => onSelect(item.id)}>{item.label}</button>)}</div>;
}

function relationGraph(profile: ApiNarratorProfile, relations: ApiNarratorRelation[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeIds = new Set([profile.id, ...relations.map((item) => item.relatedNarratorId)]);
  const nodes = [...nodeIds].map((id, index) => ({
    data: {
      id,
      label: id === profile.id ? profile.rawSurfaceForms[0] || profile.normalizedSurfaceForm || id : id,
      subtitle: id === profile.id ? `${profile.occurrenceCount.toLocaleString("ar")} موضع إسناد` : "هوية مرتبطة من استجابة العلاقات",
      kind: "later",
      status: "unresolved" as const,
      collections: "جميع المصنفات",
    },
    position: { x: id === profile.id ? 520 : index % 2 ? 760 : 280, y: 80 + index * 58 },
    classes: id === profile.id ? "later focus" : "later",
  }));
  const edges = relations.map((item, index) => ({
    data: {
      id: `relation-${index}-${item.chainId}-${item.position}`,
      source: item.relationshipType === "transmitted_from" ? profile.id : item.relatedNarratorId,
      target: item.relationshipType === "transmitted_from" ? item.relatedNarratorId : profile.id,
      verb: item.relationshipType === "transmitted_from" ? "روى عن" : "روى عنه",
      evidence: item.evidenceKind,
      collection: "جميع المصنفات",
      count: 1,
    },
    classes: item.evidenceKind === "rijal_statement" ? "bio" : item.evidenceKind === "chronology_only" ? "chronology-only" : "isnad identity-uncertain",
  }));
  return { nodes, edges };
}

export function GraphWorkspace({
  view, narratorId, selectNode, collection, setCollection, highlightedIds, liveGraph, loading, error,
}: {
  view: "hadith" | "narrator" | "network";
  narratorId: string;
  selectNode: (id: string) => void;
  collection: string;
  setCollection: (value: string) => void;
  highlightedIds: string[];
  liveGraph?: LiveHadithGraph | null;
  loading?: boolean;
  error?: string;
}) {
  const isHadith = view === "hadith";
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [idDraft, setIdDraft] = useState("");
  const [profile, setProfile] = useState<ApiNarratorProfile | null>(null);
  const [relations, setRelations] = useState<ApiNarratorRelation[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>({ nextCursor: null, hasNextPage: false });
  const [networkNodes, setNetworkNodes] = useState<GraphNode[]>([]);
  const [networkEdges, setNetworkEdges] = useState<GraphEdge[]>([]);
  const [networkVersion, setNetworkVersion] = useState("");
  const [networkTruncated, setNetworkTruncated] = useState(false);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState("");

  useEffect(() => {
    if (isHadith || !narratorId) return;
    if (!researchApiAvailable()) {
      const timer = window.setTimeout(() => setNetworkError("NEXT_PUBLIC_API_URL غير مضبوط؛ لا توجد بيانات بديلة."), 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setNetworkLoading(true);
      setNetworkError("");
      setSelectedEdgeId(null);
    }, 0);
    const request = view === "network"
      ? Promise.all([loadNarratorProfile(narratorId, controller.signal), loadNarratorPaths(narratorId, { maxDepth: 3 }, controller.signal)])
          .then(([profileResponse, pathResponse]) => {
            const root = profileResponse.data;
            setProfile(root);
            setNetworkVersion(pathResponse.dataVersion);
            setNetworkTruncated(pathResponse.data.truncated);
            setNetworkNodes(pathResponse.data.nodes.map((node, index) => ({
              data: { id: node.id, label: node.id === root.id ? root.rawSurfaceForms[0] || root.normalizedSurfaceForm : node.id, subtitle: node.id === root.id ? `${root.occurrenceCount.toLocaleString("ar")} موضع إسناد` : "عقدة من مسار العامل", kind: "later", status: "unresolved", collections: "جميع المصنفات" },
              position: { x: 120 + (index % 4) * 200, y: 80 + Math.floor(index / 4) * 90 },
              classes: node.id === root.id ? "later focus" : "later",
            })));
            setNetworkEdges(pathResponse.data.edges.map((edge, index) => ({
              data: { id: `path-${index}-${edge.source}-${edge.target}`, source: edge.source, target: edge.target, verb: edge.relationshipType === "transmitted_from" ? "روى عن" : "روى عنه", evidence: edge.evidenceKind, collection: "جميع المصنفات", count: 1 },
              classes: "isnad identity-uncertain",
            })));
          })
      : Promise.all([loadNarratorProfile(narratorId, controller.signal), loadNarratorRelations(narratorId, null, 100, controller.signal)])
          .then(([profileResponse, relationResponse]) => {
            setProfile(profileResponse.data);
            setRelations(relationResponse.data.items);
            setPageInfo(relationResponse.data.pageInfo);
            setNetworkVersion(profileResponse.dataVersion);
            const graph = relationGraph(profileResponse.data, relationResponse.data.items);
            setNetworkNodes(graph.nodes);
            setNetworkEdges(graph.edges);
          });
    request.catch((caught) => {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setNetworkError(caught instanceof Error ? caught.message : "تعذر تحميل شبكة الراوي");
      setProfile(null);
      setNetworkNodes([]);
      setNetworkEdges([]);
    }).finally(() => setNetworkLoading(false));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isHadith, narratorId, view]);

  const loadMoreRelations = async () => {
    if (!profile || !pageInfo.nextCursor) return;
    setNetworkLoading(true);
    try {
      const response = await loadNarratorRelations(profile.id, pageInfo.nextCursor, 100);
      const combined = [...relations, ...response.data.items];
      const graph = relationGraph(profile, combined);
      setRelations(combined);
      setPageInfo(response.data.pageInfo);
      setNetworkNodes(graph.nodes);
      setNetworkEdges(graph.edges);
      setNetworkVersion(response.dataVersion);
    } catch (caught) {
      setNetworkError(caught instanceof Error ? caught.message : "تعذر تحميل الصفحة التالية");
    } finally {
      setNetworkLoading(false);
    }
  };

  const nodes = isHadith ? liveGraph?.nodes ?? [] : networkNodes;
  const edges = isHadith ? liveGraph?.edges ?? [] : networkEdges;
  const visibleError = isHadith ? error : networkError;
  const visibleLoading = isHadith ? loading : networkLoading;
  const missingSelection = !isHadith && !narratorId;

  return (
    <>
      <section className="graph-toolbar" aria-label="مرشحات الرسم">
        <div dir="rtl"><span className="eyebrow">{isHadith ? liveGraph?.eyebrow ?? "لا عنقود محمّل" : networkVersion ? `إصدار البيانات ${networkVersion}` : "شبكة العامل"}</span><h1>{isHadith ? liveGraph?.title ?? "لم يُحمَّل أي حديث" : profile?.rawSurfaceForms[0] ?? "أدخل معرّف عنقود راوٍ"}</h1></div>
        {isHadith ? <div className="filter-set"><label htmlFor="collection-filter">المصنف</label><select id="collection-filter" value={collection} onChange={(event) => setCollection(event.target.value)} disabled={Boolean(liveGraph)}>{collectionOptions.map((option) => <option key={option}>{option}</option>)}</select></div> : <form className="filter-set" action={view === "network" ? "/network" : "/narrators/yahya"}><label htmlFor="narrator-id">معرّف عنقود الراوي</label><input id="narrator-id" name="narrator" dir="ltr" value={idDraft} onChange={(event) => setIdDraft(event.target.value)} placeholder="UNC-… أو SA-P-…" /><button type="submit" disabled={!idDraft.trim()}>تحميل</button></form>}
      </section>
      <div className="graph-shell">
        <AtlasGraph nodes={nodes} edges={edges} collection={isHadith ? collection : "جميع المصنفات"} highlightedIds={highlightedIds} onSelect={selectNode} selectedEdgeId={selectedEdgeId} onEdgeSelect={setSelectedEdgeId} />
        {visibleLoading ? <div className="graph-load-state"><i /><strong>جار تحميل البيانات من العامل…</strong></div> : null}
        {visibleError ? <div className="graph-load-state error" role="alert"><strong>تعذر تحميل البيانات</strong><span>{visibleError}</span></div> : null}
        {((isHadith && !liveGraph) || missingSelection) && !visibleLoading && !visibleError ? <div className="graph-load-state empty"><strong>{isHadith ? "لا توجد بيانات إسناد محمّلة" : "لم يحدد عنقود راوٍ"}</strong><span>{isHadith ? "اختر حديثا من المكتبة؛ لا يعرض الرسم بديلا عند غياب النتيجة." : "ألصق معرّف عنقود حقيقيا من استجابة العامل. لا يوجد راوٍ افتراضي."}</span></div> : null}
        {!isHadith && narratorId && !nodes.length && !visibleLoading && !visibleError ? <div className="graph-load-state empty"><strong>الاستجابة فارغة</strong><span>لم يرجع العامل عقدا لهذا المعرّف.</span></div> : null}
        <Legend />
        <KeyboardNodeList nodes={nodes} onSelect={selectNode} />
        <KeyboardEdgeList nodes={nodes} edges={edges} selectedEdgeId={selectedEdgeId} onSelect={setSelectedEdgeId} />
      </div>
      {isHadith ? <div className="route-summary" dir="rtl"><span><b>{liveGraph ? liveGraph.chainCount.toLocaleString("ar") : "—"}</b> طرق ظاهرة</span><span><b>{liveGraph ? liveGraph.occurrenceCount.toLocaleString("ar") : "—"}</b> مواضع رواة</span><span><b>{liveGraph ? liveGraph.dataVersion : "—"}</b> إصدار البيانات</span><Link href="/library">العودة إلى المكتبة <Chevron direction="left" /></Link></div> : <div className="route-summary" dir="rtl"><span><b>{edges.filter((edge) => edge.data.source === narratorId).length.toLocaleString("ar")}</b> صلات خارجة</span><span><b>{edges.filter((edge) => edge.data.target === narratorId).length.toLocaleString("ar")}</b> صلات داخلة</span><span><b>{networkTruncated ? "٥٠٠+" : edges.length.toLocaleString("ar")}</b> صلات ظاهرة</span>{view === "narrator" && pageInfo.hasNextPage ? <button type="button" onClick={loadMoreRelations} disabled={networkLoading}>تحميل العلاقات التالية</button> : null}</div>}
      {!isHadith ? <section className="chronology-evidence" dir="rtl"><p className="empty-copy">كل صلة ظاهرة هنا جاءت من نقطة العلاقات أو المسارات في العامل. الإمكان الزمني لا يُعرض كصلة نقل، ولا يُحسب اللقاء من تاريخ غير مسند.</p>{networkTruncated ? <p className="empty-copy">بلغ المسار الحد الصلب: ٥٠٠ صلة. ضيّق العمق لمتابعة البحث.</p> : null}</section> : null}
    </>
  );
}
