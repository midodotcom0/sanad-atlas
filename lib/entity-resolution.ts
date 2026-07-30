import { normalizeSearchText } from "./search";

export type IdentityProfile = {
  id: string;
  names: string[];
  kunya?: string;
  nisba?: string;
  region?: string;
  deathYearMin?: number;
  deathYearMax?: number;
  teachers: string[];
  students: string[];
};

export type OccurrenceContext = {
  surface: string;
  previousNarratorIds: string[];
  nextNarratorIds: string[];
  region?: string;
  transmissionYear?: number;
};

export type IdentityCandidateScore = {
  narratorId: string;
  confidence: number;
  matchingSignals: string[];
  conflictingSignals: string[];
  requiresEditorialDecision: true;
};

const relativeForms = new Set(["ابيه", "ابوه", "ابي", "عمه", "عماه", "جده", "جدته", "اخيه", "رجل", "شيخ"]);

export function scoreIdentityCandidate(occurrence: OccurrenceContext, candidate: IdentityProfile): IdentityCandidateScore {
  const surface = normalizeSearchText(occurrence.surface);
  const matchingSignals: string[] = [];
  const conflictingSignals: string[] = [];
  if (relativeForms.has(surface)) {
    return { narratorId: candidate.id, confidence: 0, matchingSignals, conflictingSignals: ["relative-or-anonymous-surface"], requiresEditorialDecision: true };
  }

  let score = 0;
  const normalizedNames = candidate.names.map(normalizeSearchText);
  if (normalizedNames.includes(surface)) { score += 0.52; matchingSignals.push("exact-name-variant"); }
  else if (normalizedNames.some((name) => name.includes(surface) || surface.includes(name))) { score += 0.3; matchingSignals.push("partial-name-variant"); }

  const teacherMatches = occurrence.previousNarratorIds.filter((id) => candidate.teachers.includes(id)).length;
  const studentMatches = occurrence.nextNarratorIds.filter((id) => candidate.students.includes(id)).length;
  if (teacherMatches) { score += Math.min(0.18, teacherMatches * 0.09); matchingSignals.push("chain-teacher-neighbor"); }
  if (studentMatches) { score += Math.min(0.18, studentMatches * 0.09); matchingSignals.push("chain-student-neighbor"); }
  if (occurrence.region && candidate.region) {
    if (normalizeSearchText(occurrence.region) === normalizeSearchText(candidate.region)) { score += 0.08; matchingSignals.push("region"); }
    else { score -= 0.04; conflictingSignals.push("region-mismatch"); }
  }
  if (occurrence.transmissionYear && candidate.deathYearMax && occurrence.transmissionYear > candidate.deathYearMax) {
    score -= 0.45;
    conflictingSignals.push("post-death-transmission");
  }
  return { narratorId: candidate.id, confidence: Math.max(0, Math.min(1, Number(score.toFixed(3)))), matchingSignals, conflictingSignals, requiresEditorialDecision: true };
}

export function rankIdentityCandidates(occurrence: OccurrenceContext, profiles: IdentityProfile[], limit = 8) {
  return profiles.map((profile) => scoreIdentityCandidate(occurrence, profile)).filter((item) => item.confidence > 0).sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}
