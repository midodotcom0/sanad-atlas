export function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\b(?:ibn|bin)\b/gi, "b")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}
