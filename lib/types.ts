export type ViewKey = "hadith" | "narrator" | "network" | "compare" | "variants" | "library" | "sources";

export type Confidence = "verified" | "high" | "medium" | "low" | "conflict";

export interface Narrator {
  id: string;
  nameAr: string;
  shortAr: string;
  transliteration: string;
  role: "prophet" | "companion" | "tabii" | "later" | "compiler";
  tabaqa: string;
  birthAhMin?: number;
  birthAhMax?: number;
  deathAh?: number;
  region: string;
  confidence: Confidence;
  teachers: string[];
  students: string[];
  hadithCount: number;
  aliases?: string[];
}

export interface SourceAssertion {
  id: string;
  subjectId: string;
  scholar: string;
  phraseAr: string;
  normalized: string;
  work: string;
  volume: string;
  page: string;
  status: "reviewed" | "pending";
}

export interface GraphNode {
  data: {
    id: string;
    label: string;
    subtitle: string;
    kind: string;
    status: Confidence;
    collections?: string;
  };
  position?: { x: number; y: number };
  classes?: string;
}

export interface GraphEdge {
  data: {
    id: string;
    source: string;
    target: string;
    verb: string;
    evidence: string;
    collection: string;
    count: number;
    chronologyStatus?: "possible" | "impossible" | "unknown";
    chronologyLabel?: string;
    variants?: string;
  };
  classes?: string;
}
