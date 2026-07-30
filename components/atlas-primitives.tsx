"use client";

import { CONFIDENCE_LABELS_AR, type ConfidenceLevel, type Origin, type ReviewStatus } from "@/lib/types";

/**
 * Kleine, in mehreren Views und Panels benutzte Bausteine. Zuvor lagen sie im
 * Monolithen `atlas-shell.tsx` und wurden dadurch von jeder Route mitgebuendelt.
 *
 * Wichtig: dieses Modul fuehrt **keine** eigene Statuskarte mehr. Die
 * arabischen Beschriftungen der sechs Konfidenzstufen kommen aus
 * `lib/types.ts` (`CONFIDENCE_LABELS_AR`). Die frueher hier bzw. in der Shell
 * gepflegte lokale Karte kannte nur fuenf Stufen -- `unresolved`, der Normalfall
 * fuer 76.081 Erzaehlerpositionen, fehlte darin vollstaendig.
 */

/**
 * Pruefstatus. Eigenes Vokabular, ausdruecklich **nicht** dasselbe wie
 * `ConfidenceLevel`: eine Aussage kann hoch bewertet und trotzdem ungeprueft
 * sein, und eine abgelehnte Aussage bleibt sichtbar.
 */
export const REVIEW_STATUS_LABELS_AR: Record<ReviewStatus, string> = {
  machine_unreviewed: "آلي · لم يُراجع",
  in_review: "قيد المراجعة",
  accepted: "مقبول بقرار محقق",
  rejected: "مردود بقرار محقق",
  superseded: "نُسخ بقرار أحدث",
};

/** Herkunft eines Wertes. `machine` erreicht niemals `verified`. */
export const ORIGIN_LABELS_AR: Record<Origin, string> = {
  machine: "استخراج آلي",
  editorial: "قرار تحقيقي",
  registry: "سجل المصادر",
};

/**
 * Beschriftung eines Wertes, der von aussen kommt.
 *
 * FREMDDATEI-BEDARF: `backend/app/repository.py` und `app/api/_contract.ts`
 * senden `reviewStatus` derzeit noch aus dem Konfidenzvokabular (`"unresolved"`),
 * nicht aus `ReviewStatus`. Ein unbekannter Wert wird deshalb roh angezeigt und
 * ausdruecklich als unbekannt gekennzeichnet, statt als `undefined` zu
 * verschwinden -- ein stillschweigend verlorener Pruefstatus waere schlimmer als
 * ein unschoener.
 */
function labelFrom<K extends string>(labels: Record<K, string>, value: string): string {
  return (labels as Record<string, string>)[value] ?? `${value} (قيمة غير معروفة في المفردات)`;
}

export function reviewStatusLabel(value: string) {
  return labelFrom(REVIEW_STATUS_LABELS_AR, value);
}

export function confidenceLabel(value: string) {
  return labelFrom(CONFIDENCE_LABELS_AR, value);
}

export function originLabel(value: string) {
  return labelFrom(ORIGIN_LABELS_AR, value);
}

export function Mark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i /><i /><i /><i /><b />
    </span>
  );
}

export function Chevron({ direction = "right" }: { direction?: "right" | "left" | "down" }) {
  const rotate = direction === "left" ? "rotate(180 12 12)" : direction === "down" ? "rotate(90 12 12)" : undefined;
  return <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: rotate }}><path d="m9 5 7 7-7 7" /></svg>;
}

/** Konfidenzstufe mit ihrer arabischen Beschriftung aus `lib/types.ts`. */
export function Status({ confidence }: { confidence: ConfidenceLevel }) {
  return <span className={`status status-${confidence}`}><i />{CONFIDENCE_LABELS_AR[confidence]}</span>;
}

/** Pruefstatus als eigenes Etikett, getrennt von der Konfidenz. */
export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return <span className={`review-badge review-${status}`}>{REVIEW_STATUS_LABELS_AR[status]}</span>;
}

export function SourceTag({ status = "pending" }: { status?: "pending" | "reviewed" }) {
  return <span className={`source-tag ${status}`}>{status === "reviewed" ? "مراجَع علميا" : "بانتظار المراجعة"}</span>;
}

/**
 * Hinweis, dass ein Editionsvolltext aus Rechtegruenden nicht ausgeliefert
 * wird. Fehlender Volltext ist damit sichtbar eine Rechteentscheidung und kein
 * Datenfehler.
 */
export function TextWithheldNotice({ what = "النص" }: { what?: string }) {
  return (
    <p className="rights-withheld" role="note">
      <strong>{what} محجوب لأسباب حقوقية</strong>
      حالة حقوق الطبعة لم تُعتمد بعد، فتحجب الواجهة النص الكامل وتُبقي الإحالة إلى الموضع الأصلي. هذا قرار حقوقي، لا نقص في البيانات.
    </p>
  );
}
