/**
 * Antwort-Huelle des API-Vertrags (Sanad-Atlas-Projektbeschreibung.txt
 * Abschnitt 12; Umsetzungsplan P2.2; docs/06-API-SPECIFICATION.yaml).
 *
 * Byte-treuer Port von `backend/app/repository.py` (`envelope`, `cited`,
 * `level_from_score`, `aggregate_machine_confidence`, `CONFIDENCE_LEVELS`,
 * `ORIGIN_KINDS`). Die Worker-Antwort muss feldgleich zur FastAPI-Referenz
 * sein (P3.2) -- das ist nur pruefbar, wenn diese Funktionen exakt dieselbe
 * Form, dieselben Feldnamen und dieselbe Validierung erzeugen wie dort.
 * Siehe tests/worker-contract.check.mjs fuer den automatisierten Abgleich.
 */

export const CONFIDENCE_LEVELS = ["verified", "high", "medium", "low", "unresolved", "conflict"];
export const ORIGIN_KINDS = ["machine", "editorial", "registry"];

/**
 * Bildet einen maschinellen Score auf das gemeinsame sechsstufige Vokabular
 * ab. Liefert nie "verified" (nur eine akzeptierte redaktionelle Entscheidung
 * darf das) und nie "conflict" (harte Konfliktregel, hier nicht berechnet).
 * @param {number | null | undefined} score
 * @returns {string}
 */
export function levelFromScore(score) {
  if (score === null || score === undefined) return "unresolved";
  if (score >= 0.9) return "high";
  if (score >= 0.7) return "medium";
  return "low";
}

/**
 * Aggregiert mehrere maschinelle Parser-Konfidenzen zu einer Huellenangabe.
 * Bewusst konservativ: nimmt den SCHWAECHSTEN Wert, nicht den Mittelwert,
 * damit einzelne unsichere Datensaetze keine falsche Gesamtsicherheit erzeugen.
 * @param {Array<number | null | undefined>} scores
 * @returns {[string, number | null]}
 */
export function aggregateMachineConfidence(scores) {
  const values = scores.filter((s) => typeof s === "number" && Number.isFinite(s));
  if (values.length === 0) return ["unresolved", null];
  const weakest = Math.min(...values);
  return [levelFromScore(weakest), Math.round(weakest * 1000) / 1000];
}

/**
 * @param {any} data
 * @param {Array<Record<string, any>>} sources
 * @param {{
 *   confidenceLevel: string,
 *   confidenceScore?: number | null,
 *   origin?: string,
 *   reviewStatus?: string | null,
 *   lastReviewedAt?: string | null,
 *   dataVersion: string,
 * } & Record<string, any>} options
 */
export function envelope(data, sources, options) {
  const { confidenceLevel, origin = "machine", reviewStatus = null, lastReviewedAt = null, dataVersion, ...extra } = options;
  let { confidenceScore = null } = options;

  if (!CONFIDENCE_LEVELS.includes(confidenceLevel)) throw new Error(`unknown confidenceLevel: ${confidenceLevel}`);
  if (!ORIGIN_KINDS.includes(origin)) throw new Error(`unknown origin: ${origin}`);
  if (origin === "machine" && confidenceLevel === "verified") throw new Error("machine origin must never report confidenceLevel='verified'");
  if (origin !== "machine") confidenceScore = null;
  if (confidenceScore !== null && (confidenceScore < 0 || confidenceScore > 1)) throw new Error(`confidenceScore out of range: ${confidenceScore}`);

  const resolvedReviewStatus = reviewStatus !== null ? reviewStatus : confidenceLevel;
  if (!CONFIDENCE_LEVELS.includes(resolvedReviewStatus)) throw new Error(`unknown reviewStatus: ${resolvedReviewStatus}`);

  return {
    data,
    sourceReferences: sources,
    confidenceLevel,
    confidenceScore,
    origin,
    reviewStatus: resolvedReviewStatus,
    dataVersion,
    lastReviewedAt,
    ...extra,
  };
}

/**
 * Garantiert, dass sourceReferences nie leer ist -- auch ein echtes "nichts
 * gefunden" bleibt quellenbezogen dokumentiert statt einfach leer zu sein.
 * @param {Array<Record<string, any>>} references
 * @param {string} reason
 */
export function cited(references, reason) {
  return references.length ? references : [{ notice: reason }];
}
