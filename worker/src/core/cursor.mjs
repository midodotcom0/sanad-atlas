/**
 * Cursorpaginierung. Byte-treuer Port von `_cursor`/`_offset` aus
 * `backend/app/repository.py`, damit ein Cursor, den die FastAPI-Referenz
 * ausgibt, auch vom Worker verstanden wird und umgekehrt (P3.2: feldgleiche
 * `pageInfo.nextCursor`-Werte).
 *
 * Nutzt ausschliesslich `atob`/`btoa` (Web-Standard, in Node 18+ UND in der
 * Cloudflare-Workers-Laufzeit global verfuegbar) statt `Buffer`, damit
 * dieselbe Datei in beiden Umgebungen unveraendert laeuft.
 */

function base64UrlEncode(text) {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return atob(padded);
}

/** @param {number} offset */
export function encodeCursor(offset) {
  return base64UrlEncode(`v1:${offset}`);
}

/** @param {string | null | undefined} cursor */
export function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const raw = base64UrlDecode(cursor);
    const separatorIndex = raw.indexOf(":");
    if (separatorIndex === -1) return 0;
    const version = raw.slice(0, separatorIndex);
    const value = raw.slice(separatorIndex + 1);
    if (version !== "v1") return 0;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  } catch {
    return 0;
  }
}
