import { normalizeSearchText } from "./search";

function setOf<T>(items: T[]) { return new Set(items); }
function jaccard<T>(first: Set<T>, second: Set<T>) {
  if (!first.size && !second.size) return 1;
  let intersection = 0;
  for (const value of first) if (second.has(value)) intersection += 1;
  return intersection / (first.size + second.size - intersection);
}
function characterNgrams(value: string, size = 3) {
  const compact = normalizeSearchText(value).replace(/\s/g, "");
  return Array.from({ length: Math.max(0, compact.length - size + 1) }, (_, index) => compact.slice(index, index + size));
}

export function matnSimilarity(first: string, second: string, semanticSimilarity?: number) {
  const normalizedFirst = normalizeSearchText(first);
  const normalizedSecond = normalizeSearchText(second);
  const exact = normalizedFirst === normalizedSecond;
  const tokenScore = jaccard(setOf(normalizedFirst.split(" ").filter(Boolean)), setOf(normalizedSecond.split(" ").filter(Boolean)));
  const characterScore = jaccard(setOf(characterNgrams(first)), setOf(characterNgrams(second)));
  const semanticScore = semanticSimilarity === undefined ? null : Math.max(0, Math.min(1, semanticSimilarity));
  const combined = exact ? 1 : semanticScore === null ? tokenScore * 0.58 + characterScore * 0.42 : tokenScore * 0.35 + characterScore * 0.25 + semanticScore * 0.4;
  return { exact, tokenScore, characterScore, semanticScore, combined: Number(combined.toFixed(4)), status: "machine_suggestion" as const, needsEditorialApproval: true as const };
}

export function shouldSuggestCluster(first: string, second: string, semanticSimilarity?: number, threshold = 0.76) {
  return matnSimilarity(first, second, semanticSimilarity).combined >= threshold;
}
