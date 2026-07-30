import { normalizeSearchText } from "./search";

export type MatnDiffKind = "equal" | "addition" | "omission" | "replacement" | "reorder";
export type MatnDiffOperation = { kind: MatnDiffKind; before: string[]; after: string[] };

const tokenPattern = /[\p{L}\p{M}\p{N}]+/gu;

function tokens(value: string) {
  return value.match(tokenPattern) ?? [];
}

export function diffMatnWords(beforeText: string, afterText: string): MatnDiffOperation[] {
  const before = tokens(beforeText);
  const after = tokens(afterText);
  const a = before.map(normalizeSearchText);
  const b = after.map(normalizeSearchText);
  const rows = a.length + 1;
  const columns = b.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(columns));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }

  const raw: MatnDiffOperation[] = [];
  let i = 0;
  let j = 0;
  const push = (kind: MatnDiffKind, from: string[] = [], to: string[] = []) => {
    const last = raw.at(-1);
    if (last?.kind === kind) {
      last.before.push(...from);
      last.after.push(...to);
    } else raw.push({ kind, before: from, after: to });
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push("equal", [before[i]], [after[j]]); i += 1; j += 1;
    } else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) {
      push("addition", [], [after[j]]); j += 1;
    } else {
      push("omission", [before[i]], []); i += 1;
    }
  }

  const compact: MatnDiffOperation[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const current = raw[index];
    const next = raw[index + 1];
    if ((current.kind === "addition" && next?.kind === "omission") || (current.kind === "omission" && next?.kind === "addition")) {
      const omitted = current.kind === "omission" ? current.before : next.before;
      const added = current.kind === "addition" ? current.after : next.after;
      const omittedNormalized = omitted.map(normalizeSearchText);
      const addedNormalized = added.map(normalizeSearchText);
      const isReorder = omittedNormalized.every((word) => b.includes(word)) && addedNormalized.every((word) => a.includes(word));
      compact.push({ kind: isReorder ? "reorder" : "replacement", before: omitted, after: added });
      index += 1;
    } else compact.push(current);
  }
  return compact.map((operation) => {
    if (operation.kind === "addition" && operation.after.every((word) => a.includes(normalizeSearchText(word)))) return { ...operation, kind: "reorder" as const };
    if (operation.kind === "omission" && operation.before.every((word) => b.includes(normalizeSearchText(word)))) return { ...operation, kind: "reorder" as const };
    return operation;
  });
}
