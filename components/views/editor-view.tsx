"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SourceTag } from "../atlas-primitives";

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
const TOKEN_KEY = "sanad-atlas-editor-token";

type SourceRef = { id: string; work: string | null; stableReference: string | null; locator: unknown };
type ReviewItem = {
  id: string;
  entityType: string;
  kind: string;
  title: string;
  context: string;
  before: unknown;
  proposal: unknown;
  source: SourceRef;
  allowedActions: Array<"accept" | "reject" | "merge" | "verify">;
};
type PendingProposal = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  rationale: string;
  before: unknown;
  after: unknown;
  proposedBy: { id: string; displayName: string };
  requiresFourEyes: boolean;
  canFinalize: boolean;
  source: SourceRef;
};
type Revision = {
  id: string;
  action: string;
  rationale: string;
  before: unknown;
  after: unknown;
  isReverted: boolean;
  source: SourceRef;
};
type EditorSession = {
  id: string;
  displayName: string;
  displayNameAr: string | null;
  roles: string[];
  permissions: { mayReview: boolean; mayApproveMerge: boolean; mayVerify: boolean };
};

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function editorialFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  if (!API_BASE) throw new ApiError(503, "NEXT_PUBLIC_API_URL غير مضبوط؛ لا توجد بيانات بديلة.");
  const response = await fetch(`${API_BASE}/api/v1/editorial${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
  if (!response.ok) throw new ApiError(response.status, payload.detail ?? `HTTP ${response.status}`);
  return payload as T;
}

function showValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value, null, 2);
}

function sourceLabel(source: SourceRef) {
  return [source.work, source.stableReference].filter(Boolean).join(" · ") || source.id;
}

export function EditorView() {
  const [token, setToken] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [session, setSession] = useState<EditorSession | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [proposals, setProposals] = useState<PendingProposal[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selected, setSelected] = useState("");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (activeToken: string) => {
    const [nextSession, queue, pending, history] = await Promise.all([
      editorialFetch<EditorSession>("/session", activeToken),
      editorialFetch<{ items: ReviewItem[] }>("/review-queue?limit=60", activeToken),
      editorialFetch<{ items: PendingProposal[] }>("/proposals?limit=60", activeToken),
      editorialFetch<{ items: Revision[] }>("/revisions?limit=60", activeToken),
    ]);
    setSession(nextSession);
    setItems(queue.items);
    setProposals(pending.items);
    setRevisions(history.items);
    setSelected((current) => {
      const ids = new Set([...queue.items.map((item) => `item:${item.id}`), ...pending.items.map((item) => `proposal:${item.id}`)]);
      return ids.has(current) ? current : (queue.items[0] ? `item:${queue.items[0].id}` : pending.items[0] ? `proposal:${pending.items[0].id}` : "");
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => {
      refresh(token).catch((caught: unknown) => {
        window.sessionStorage.removeItem(TOKEN_KEY);
        setToken("");
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh, token]);

  const activeItem = selected.startsWith("item:") ? items.find((item) => `item:${item.id}` === selected) : undefined;
  const activeProposal = selected.startsWith("proposal:") ? proposals.find((item) => `proposal:${item.id}` === selected) : undefined;
  const latestReversible = revisions.find((revision) => !revision.isReverted && revision.action !== "revert");

  const pendingForMe = useMemo(() => proposals.filter((proposal) => proposal.canFinalize).length, [proposals]);

  const connect = async () => {
    const candidate = tokenInput.trim();
    if (candidate.length < 32) {
      setError("رمز التحرير أقصر من الحد الأدنى.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await refresh(candidate);
      window.sessionStorage.setItem(TOKEN_KEY, candidate);
      setToken(candidate);
      setTokenInput("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    window.sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setSession(null);
    setItems([]);
    setProposals([]);
    setRevisions([]);
    setSelected("");
    setRationale("");
  };

  const propose = async (action: "accept" | "reject" | "merge" | "verify") => {
    if (!activeItem || rationale.trim().length < 12 || !token) return;
    setBusy(true);
    setError("");
    try {
      const proposal = await editorialFetch<{ id: string; requiresFourEyes: boolean }>("/proposals", token, {
        method: "POST",
        body: JSON.stringify({
          entityType: activeItem.entityType,
          entityId: activeItem.id,
          action,
          rationale: rationale.trim(),
          sourcePassageId: activeItem.source.id,
          afterValue: { decision: action, proposal: activeItem.proposal },
        }),
      });
      if (!proposal.requiresFourEyes) {
        await editorialFetch(`/proposals/${encodeURIComponent(proposal.id)}/finalize`, token, { method: "POST" });
      }
      setRationale("");
      await refresh(token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    if (!activeProposal || !token || !activeProposal.canFinalize) return;
    setBusy(true);
    setError("");
    try {
      await editorialFetch(`/proposals/${encodeURIComponent(activeProposal.id)}/finalize`, token, { method: "POST" });
      await refresh(token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const revertLatest = async () => {
    if (!latestReversible || !token || rationale.trim().length < 12) return;
    setBusy(true);
    setError("");
    try {
      await editorialFetch(`/revisions/${encodeURIComponent(latestReversible.id)}/revert`, token, {
        method: "POST",
        body: JSON.stringify({ rationale: rationale.trim(), sourcePassageId: latestReversible.source.id }),
      });
      setRationale("");
      await refresh(token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content-view editor-view" dir="rtl">
      <header className="view-intro compact"><span className="eyebrow">مساحة المحقق</span><h1>كل قرار قابل للتتبع والتراجع.</h1><p>تُحفظ المراجعة في سجل لا يقبل التعديل، مع المصدر والتعليل والفرق قبل القرار وبعده.</p></header>

      {!API_BASE ? <p className="inline-error" role="alert">واجهة العامل غير مضبوطة. اضبط <code dir="ltr">NEXT_PUBLIC_API_URL</code>؛ لا تعرض هذه الصفحة عينة أو بيانات بديلة.</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}

      {!token || !session ? (
        <section className="decision-workbench" aria-label="تسجيل دخول المحرر">
          <div className="decision-top"><span>اتصال آمن بواجهة التحرير</span><SourceTag /></div>
          <h2>رمز المحرر</h2>
          <p>يبقى الرمز في ذاكرة هذه النافذة فقط، ولا يُحفظ في قاعدة البيانات إلا بصمة SHA-256.</p>
          <label className="rationale-field">رمز Bearer<input dir="ltr" type="password" autoComplete="off" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} /></label>
          <div className="decision-actions"><button type="button" className="accept" onClick={connect} disabled={busy || !API_BASE || tokenInput.trim().length < 32}>اتصال</button></div>
        </section>
      ) : (
        <>
          <div className="editor-summary">
            <span><strong>{items.length.toLocaleString("ar")}</strong> بانتظار المراجعة</span>
            <span><strong>{pendingForMe.toLocaleString("ar")}</strong> بانتظار موافقتك</span>
            <span><strong>{revisions.length.toLocaleString("ar")}</strong> مراجعات محفوظة</span>
            <button type="button" onClick={revertLatest} disabled={busy || !latestReversible || rationale.trim().length < 12}>تسجيل تراجع عن آخر مراجعة</button>
            <button type="button" onClick={disconnect}>خروج {session.displayNameAr ?? session.displayName}</button>
          </div>
          <div className="editor-layout">
            <section className="review-queue" aria-label="طابور المراجعة">
              <div className="review-heading"><h2>طابور المراجعة</h2><span>بيانات حية من D1</span></div>
              {items.map((item) => <button type="button" className={selected === `item:${item.id}` ? "active" : ""} key={`item:${item.id}`} onClick={() => setSelected(`item:${item.id}`)}><span>{item.kind} · {item.id}</span><strong>{item.title}</strong><small>{item.context}</small></button>)}
              {proposals.length ? <div className="review-heading"><h2>مقترحات معلقة</h2><span>الموافقة الثانية</span></div> : null}
              {proposals.map((proposal) => <button type="button" className={selected === `proposal:${proposal.id}` ? "active" : ""} key={`proposal:${proposal.id}`} onClick={() => setSelected(`proposal:${proposal.id}`)}><span>{proposal.action} · {proposal.entityType}</span><strong>{proposal.proposedBy.displayName}</strong><small>{proposal.rationale}</small></button>)}
              {!items.length && !proposals.length ? <div className="review-empty"><strong>لا عناصر مفتوحة</strong><p>لا توجد عينة ثابتة بديلة.</p></div> : null}
            </section>
            <section className="decision-workbench" aria-live="polite">
              {activeItem ? <>
                <div className="decision-top"><span>{activeItem.kind}</span><SourceTag /></div>
                <h2>{activeItem.title}</h2><p>{activeItem.context}</p>
                <div className="before-after"><article><span>قبل</span><strong dir="auto">{showValue(activeItem.before)}</strong></article><article><span>اقتراح الآلة</span><strong dir="auto">{showValue(activeItem.proposal)}</strong></article></div>
                <div className="decision-source"><span>المصدر الملزم</span><strong>{sourceLabel(activeItem.source)}</strong><small dir="ltr">{activeItem.source.id}</small></div>
                <label className="rationale-field">سبب القرار<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="اكتب تعليلا علميا مرتبطا بالمصدر…" rows={4} /><small>اثنا عشر حرفا على الأقل. يُحفظ التعليل ضمن السجل الدائم.</small></label>
                <div className="decision-actions">
                  {activeItem.allowedActions.includes("reject") ? <button type="button" className="reject" onClick={() => propose("reject")} disabled={busy || rationale.trim().length < 12}>رفض وتسجيل</button> : null}
                  {activeItem.allowedActions.includes("accept") ? <button type="button" className="accept" onClick={() => propose("accept")} disabled={busy || rationale.trim().length < 12}>قبول وتسجيل</button> : null}
                  {activeItem.allowedActions.includes("merge") ? <button type="button" onClick={() => propose("merge")} disabled={busy || rationale.trim().length < 12}>اقتراح دمج</button> : null}
                  {activeItem.allowedActions.includes("verify") ? <button type="button" onClick={() => propose("verify")} disabled={busy || rationale.trim().length < 12}>اقتراح توثيق</button> : null}
                </div>
              </> : activeProposal ? <>
                <div className="decision-top"><span>{activeProposal.action} · {activeProposal.entityType}</span><SourceTag /></div>
                <h2>مقترح من {activeProposal.proposedBy.displayName}</h2><p>{activeProposal.rationale}</p>
                <div className="before-after"><article><span>قبل</span><strong dir="auto">{showValue(activeProposal.before)}</strong></article><article><span>بعد</span><strong dir="auto">{showValue(activeProposal.after)}</strong></article></div>
                <div className="decision-source"><span>المصدر الملزم</span><strong>{sourceLabel(activeProposal.source)}</strong><small dir="ltr">{activeProposal.source.id}</small></div>
                {activeProposal.requiresFourEyes ? <p className="rights-withheld"><strong>مبدأ العينين</strong>لا يستطيع صاحب المقترح اعتماده. يلزم محرر ثانٍ بصلاحية مناسبة.</p> : null}
                <div className="decision-actions"><button type="button" className="accept" onClick={finalize} disabled={busy || !activeProposal.canFinalize}>اعتماد المقترح وتسجيل المراجعة</button></div>
              </> : <div className="review-empty"><strong>لا عنصر محدد</strong><p>اختر عنصرا من طابور المراجعة.</p></div>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
