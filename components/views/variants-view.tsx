"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResponseEnvelope, MatnFamiliesPayload, MatnFamily, MatnRoutesPayload } from "@/lib/types";
import { diffMatnWords, type MatnDiffKind } from "@/lib/matn-diff";
import { matnFamilyShortLabel, normalizeMatnColorToken, toMatnFamilyGraph } from "@/lib/hadith-graph";
import { AtlasGraph } from "../atlas-graph-dynamic";

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
const COLLECTIONS = [
  { id: "", label: "جميع المصنفات" },
  { id: "bukhari", label: "البخاري" },
  { id: "muslim", label: "مسلم" },
] as const;

const DIFFERENCE_LABELS: Record<Exclude<MatnDiffKind, "equal">, string> = {
  addition: "إضافة",
  omission: "سقط",
  replacement: "استبدال",
  reorder: "تقديم وتأخير",
};

function familyClass(family: MatnFamily) {
  return `matn-color-${normalizeMatnColorToken(family.id, family.colorToken)}`;
}

async function getEnvelope<T>(path: string, signal: AbortSignal): Promise<ResponseEnvelope<T>> {
  const response = await fetch(`${API_BASE}${path}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  return response.json() as Promise<ResponseEnvelope<T>>;
}

/**
 * P5.4 -- die Ansicht liest beide echten Cluster-Payloads und verbindet sie
 * ueber die vorhandenen hadithIds. Es gibt keinen stillen Mock-Rueckfall:
 * ohne Worker oder Cluster-ID bleibt der Forschungsbereich sichtbar leer.
 */
export function VariantsView({ selectNode }: { selectNode: (id: string) => void }) {
  const [clusterDraft, setClusterDraft] = useState("");
  const [clusterId, setClusterId] = useState("");
  const [collection, setCollection] = useState("");
  const [families, setFamilies] = useState<MatnFamily[]>([]);
  const [routes, setRoutes] = useState<MatnRoutesPayload | null>(null);
  const [selectedFamilyId, setSelectedFamilyId] = useState("");
  const [compareFamilyId, setCompareFamilyId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedDifference, setSelectedDifference] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("cluster")?.trim() ?? "";
    if (!fromUrl) return;
    const timer = window.setTimeout(() => {
      setClusterDraft(fromUrl);
      setClusterId(fromUrl);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!clusterId || !API_BASE) return;
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setLoading(true);
      setError("");
    }, 0);
    const encoded = encodeURIComponent(clusterId);
    const collectionQuery = collection ? `?collection=${encodeURIComponent(collection)}` : "";
    Promise.all([
      getEnvelope<MatnFamiliesPayload>(`/api/v1/clusters/${encoded}/matn-variants`, controller.signal),
      getEnvelope<MatnRoutesPayload>(`/api/v1/clusters/${encoded}/routes${collectionQuery}`, controller.signal),
    ])
      .then(([familyEnvelope, routeEnvelope]) => {
        const nextFamilies = familyEnvelope.data.items;
        setFamilies(nextFamilies);
        setRoutes(routeEnvelope.data);
        setSelectedFamilyId((current) => nextFamilies.some((family) => family.id === current) ? current : nextFamilies[0]?.id ?? "");
        setCompareFamilyId((current) => nextFamilies.some((family) => family.id === current) ? current : nextFamilies[1]?.id ?? nextFamilies[0]?.id ?? "");
        setSelectedEdgeId(null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setFamilies([]);
        setRoutes(null);
        setError(reason instanceof Error ? reason.message : "تعذر تحميل عائلات المتن");
      })
      .finally(() => setLoading(false));
    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [clusterId, collection]);

  const selectedFamily = families.find((family) => family.id === selectedFamilyId) ?? null;
  const compareFamily = families.find((family) => family.id === compareFamilyId) ?? null;
  const graph = useMemo(() => routes ? toMatnFamilyGraph(routes, families) : { nodes: [], edges: [] }, [families, routes]);
  const differences = useMemo(() => {
    if (!selectedFamily?.representativeText || !compareFamily?.representativeText || selectedFamily.id === compareFamily.id) return [];
    return diffMatnWords(selectedFamily.representativeText, compareFamily.representativeText).filter((item) => item.kind !== "equal");
  }, [compareFamily, selectedFamily]);

  const chooseFamily = useCallback((familyId: string) => {
    setSelectedFamilyId(familyId);
    setSelectedDifference(0);
  }, []);

  const loadCluster = () => {
    const next = clusterDraft.trim();
    if (!next) return;
    setClusterId(next);
    const url = new URL(window.location.href);
    url.searchParams.set("cluster", next);
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="content-view variants-view" dir="rtl">
      <header className="view-intro compact">
        <span className="eyebrow">تحليل ثنائي الاتجاه</span>
        <h1>اقرأ المتن، وشاهد طرقه تضيء.</h1>
        <p>اختيار عائلة المتن يحدد طرقها، واختيار طريق ذي عائلة واحدة يعيدك إلى نصها. وتبقى هوية العائلة مكتوبة إلى جانب لونها.</p>
      </header>

      <section className="matn-query" aria-label="مرشحات عائلات المتن">
        <label htmlFor="matn-cluster-id">معرّف العنقود</label>
        <input id="matn-cluster-id" dir="ltr" value={clusterDraft} onChange={(event) => setClusterDraft(event.target.value)} placeholder="HCL-…" />
        <button type="button" onClick={loadCluster} disabled={!clusterDraft.trim() || loading}>تحميل</button>
        <label htmlFor="matn-collection">المصنف</label>
        <select id="matn-collection" value={collection} onChange={(event) => setCollection(event.target.value)} disabled={!clusterId || loading}>
          {COLLECTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </section>

      {!API_BASE ? <div className="matn-state error"><strong>واجهة البحث غير متصلة</strong><span>اضبط NEXT_PUBLIC_API_URL لعرض عائلات المتن وطرقها.</span></div> : null}
      {API_BASE && !clusterId ? <div className="matn-state"><strong>لم يُحدّد عنقود</strong><span>أدخل معرّف عنقود من بيانات البحث؛ لا تُعرض بيانات بديلة عند غياب النتيجة.</span></div> : null}
      {loading ? <div className="matn-state"><strong>جار تحميل العائلات والطرق…</strong></div> : null}
      {error ? <div className="matn-state error"><strong>تعذر تحميل العنقود</strong><span>{error}</span></div> : null}

      {routes && families.length ? (
        <>
          <div className="variant-layout">
            <section className="variant-texts">
              <div className="variant-tabs" role="tablist" aria-label="عائلات المتن">
                {families.map((family) => (
                  <button
                    role="tab"
                    aria-selected={selectedFamilyId === family.id}
                    type="button"
                    className={familyClass(family)}
                    key={family.id}
                    onClick={() => chooseFamily(family.id)}
                  >
                    <i aria-hidden="true" />
                    <span>{matnFamilyShortLabel(family.id)}</span>
                  </button>
                ))}
              </div>

              {selectedFamily ? (
                <article className={`matn-document ${familyClass(selectedFamily)}`}>
                  <div className="document-meta">
                    <span dir="ltr">{routes.clusterId} / {selectedFamily.id}</span>
                    <span>{selectedFamily.reviewStatus} · {selectedFamily.hadithIds.length.toLocaleString("ar")} موضع</span>
                  </div>
                  {selectedFamily.textWithheld ? (
                    <p className="matn-withheld">نص المتن محجوب بحسب حالة حقوق المصدر.</p>
                  ) : (
                    <p dir="rtl">{selectedFamily.representativeText}</p>
                  )}

                  <div className="matn-comparison-controls">
                    <label htmlFor="compare-family">المقارنة بعائلة</label>
                    <select id="compare-family" value={compareFamilyId} onChange={(event) => setCompareFamilyId(event.target.value)}>
                      {families.map((family) => <option value={family.id} key={family.id}>{matnFamilyShortLabel(family.id)}</option>)}
                    </select>
                    {compareFamily ? (
                      <div className="matn-comparison-key" aria-label="عائلتا المقارنة">
                        <span className={`family-key ${familyClass(selectedFamily)}`}><i aria-hidden="true" />{selectedFamily.id}</span>
                        <b aria-hidden="true">↔</b>
                        <span className={`family-key ${familyClass(compareFamily)}`}><i aria-hidden="true" />{compareFamily.id}</span>
                      </div>
                    ) : null}
                  </div>

                  {selectedFamily.id === compareFamily?.id ? <p className="matn-compare-note">اختر عائلة أخرى لإظهار فروق الألفاظ.</p> : null}
                  {(selectedFamily.textWithheld || compareFamily?.textWithheld) ? <p className="matn-compare-note">لا يمكن حساب فرق لفظي لأن أحد النصين محجوب.</p> : null}
                  {differences.length ? (
                    <div className="word-differences" aria-label="فروق الألفاظ">
                      {differences.map((difference, index) => (
                        <button type="button" className={selectedDifference === index ? "active" : ""} key={`${difference.kind}-${index}`} onClick={() => setSelectedDifference(index)}>
                          <span>{DIFFERENCE_LABELS[difference.kind as Exclude<MatnDiffKind, "equal">]}</span>
                          <del>{difference.before.join(" ") || "—"}</del><b>←</b><ins>{difference.after.join(" ") || "—"}</ins>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </article>
              ) : null}
            </section>

            <section className="variant-graph">
              <div className="linked-heading">
                <span>الطرق المرتبطة · {collection ? COLLECTIONS.find((item) => item.id === collection)?.label : "جميع المصنفات"}</span>
                <strong dir="ltr">{selectedFamily?.id ?? "—"}</strong>
              </div>
              <AtlasGraph
                nodes={graph.nodes}
                edges={graph.edges}
                collection="جميع المصنفات"
                onSelect={selectNode}
                selectedEdgeId={selectedEdgeId}
                onEdgeSelect={setSelectedEdgeId}
                selectedMatnFamilyId={selectedFamilyId}
                selectedMatnColorToken={selectedFamily ? normalizeMatnColorToken(selectedFamily.id, selectedFamily.colorToken) : null}
                onMatnFamilySelect={chooseFamily}
              />
            </section>
          </div>

          <section className="matn-family-table" aria-label="جدول عائلات المتن">
            <table>
              <thead><tr><th>العائلة</th><th>المواضع</th><th>المراجعة</th><th>النص</th></tr></thead>
              <tbody>{families.map((family) => (
                <tr key={family.id} className={`${familyClass(family)} ${selectedFamilyId === family.id ? "active" : ""}`}>
                  <td><button type="button" className={`family-key ${familyClass(family)}`} onClick={() => chooseFamily(family.id)}><i aria-hidden="true" /><span dir="ltr">{family.id}</span></button></td>
                  <td>{family.hadithIds.length.toLocaleString("ar")}</td>
                  <td>{family.reviewStatus}</td>
                  <td>{family.textWithheld ? "محجوب" : "متاح"}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  );
}
