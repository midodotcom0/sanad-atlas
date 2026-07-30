"use client";

import { useEffect, useState } from "react";
import { loadSources, researchApiAvailable, type ApiSource } from "@/lib/api-client";

const PUBLIC_RIGHTS = new Set(["cleared", "public-domain", "editorially-cleared", "open-with-attribution-record", "open-attribution-required"]);

export function SourcesView() {
  const [sources, setSources] = useState<ApiSource[]>([]);
  const [dataVersion, setDataVersion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!researchApiAvailable()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => setLoading(true), 0);
    loadSources(controller.signal).then((response) => {
      setSources(response.data.items);
      setDataVersion(response.dataVersion);
      setError("");
    }).catch((caught) => {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "تعذر تحميل سجل المصادر");
      setSources([]);
    }).finally(() => setLoading(false));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const cleared = sources.filter((source) => PUBLIC_RIGHTS.has(source.rightsStatus)).length;
  return (
    <div className="content-view sources-view" dir="rtl">
      <header className="view-intro"><span className="eyebrow">حقوق البيانات وسلسلة المصدر</span><h1>لا معلومة بلا أصل.</h1><p>هذه القائمة هي استجابة سجل المصادر في العامل، بما فيها حالة الحقوق والحقول المشتقة المسموح بها. لا تحتوي هذه الصفحة نصوص الطبعات.</p></header>
      {!researchApiAvailable() ? <p className="inline-error" role="alert">NEXT_PUBLIC_API_URL غير مضبوط؛ لا تعرض الصفحة سجلا ثابتا بديلا.</p> : null}
      {loading ? <p className="loading-copy">جار تحميل سجل المصادر من العامل…</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {!loading && !error && researchApiAvailable() && !sources.length ? <div className="empty-corpus"><strong>سجل المصادر فارغ</strong><p>أرجع العامل قائمة بلا عناصر.</p></div> : null}
      {sources.length ? <>
        <div className="rights-banner">
          <span>{cleared.toLocaleString("ar")} / {sources.length.toLocaleString("ar")}</span>
          <div><strong>{cleared.toLocaleString("ar")} مصادر بحالة نشر مفتوحة أو معتمدة</strong><p>كل مصدر آخر يبقى خلف بوابة حقوق الطبعة. إصدار البيانات: <b dir="ltr">{dataVersion}</b>.</p></div>
        </div>
        <div className="source-table-wrap">
          <table className="source-table"><thead><tr><th>المصدر</th><th>المؤلف / النوع</th><th>الأولوية</th><th>الحقوق</th><th>المشتقات المسموحة</th></tr></thead><tbody>{sources.map((source) => <tr key={source.key}><td><strong>{source.title}</strong><small dir="ltr">{source.key}</small></td><td>{source.author || source.kind || "—"}</td><td>{source.priority || source.importStatus || "—"}</td><td><span className={PUBLIC_RIGHTS.has(source.rightsStatus) ? "rights-cleared" : "rights-pending"}>{source.rightsStatus}</span></td><td>{source.publicDerivedFields?.length ? source.publicDerivedFields.join(" · ") : "—"}</td></tr>)}</tbody></table>
        </div>
      </> : null}
    </div>
  );
}
