import type { ApiNarratorOccurrence, HadithGraphPayload } from "./api-client";
import type {
  ChainContributor,
  ConfidenceLevel,
  EvidenceKind,
  GraphEdge,
  GraphNode,
  MatnFamily,
  MatnFamilyColorToken,
  MatnRouteEdgeOccurrence,
  MatnRoutesPayload,
} from "./types";

export type LiveHadithGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  title: string;
  eyebrow: string;
  chainCount: number;
  occurrenceCount: number;
  record: HadithGraphPayload["hadith"];
  sources: HadithGraphPayload["sourceReferences"];
  dataVersion: string;
  occurrences: Record<string, ApiNarratorOccurrenceContext>;
};

/**
 * P5.4 -- eine kleine, vertragliche Palette statt frei injizierbarer CSS-Werte.
 * Der Endpunkt liefert eines dieser Tokens. Bei einer aelteren/fehlerhaften
 * Antwort wird deterministisch aus der Familien-ID gewaehlt, sodass dieselbe
 * Familie trotzdem in jeder Ansicht gleich erscheint.
 */
export const MATN_FAMILY_COLOR_TOKENS: readonly MatnFamilyColorToken[] = ["teal", "clay", "gold", "ink", "sage"] as const;

export function normalizeMatnColorToken(familyId: string, token: string): MatnFamilyColorToken {
  if ((MATN_FAMILY_COLOR_TOKENS as readonly string[]).includes(token)) return token as MatnFamilyColorToken;
  let hash = 0;
  for (const char of familyId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return MATN_FAMILY_COLOR_TOKENS[hash % MATN_FAMILY_COLOR_TOKENS.length];
}

export function matnFamilyShortLabel(familyId: string): string {
  return familyId.length <= 8 ? familyId : familyId.slice(0, 8);
}

function matnLayout(nodes: MatnRoutesPayload["nodes"], edges: MatnRoutesPayload["edges"]): Map<string, { x: number; y: number }> {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const depth = new Map<string, number>();
  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  for (const node of nodes) if (!queue.includes(node.id) && !incoming.has(node.id)) queue.push(node.id);
  for (const id of queue) depth.set(id, 0);
  while (queue.length) {
    const source = queue.shift()!;
    for (const target of outgoing.get(source) ?? []) {
      depth.set(target, Math.max(depth.get(target) ?? 0, (depth.get(source) ?? 0) + 1));
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  nodes.forEach((node, index) => {
    if (!depth.has(node.id)) depth.set(node.id, index % 6);
  });
  const rowsByDepth = new Map<number, string[]>();
  for (const node of nodes) {
    const level = depth.get(node.id) ?? 0;
    rowsByDepth.set(level, [...(rowsByDepth.get(level) ?? []), node.id]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, ids] of rowsByDepth) {
    ids.forEach((id, row) => positions.set(id, { x: 100 + level * 180, y: 90 + row * 92 }));
  }
  return positions;
}

/**
 * Verknuepft die beiden echten P3.2-Payloads ohne eine zweite Taxonomie:
 * Familien fuehren `hadithIds`, Routenkanten ihre `occurrences[].hadithId`.
 * Gemeinsame Kanten werden je Familie aufgeteilt. Dadurch behaelt jede
 * Familie auch auf einem gemeinsamen Isnad-Abschnitt ihre eigene Farbe und
 * ihre lesbare ID; kein Einzelbeleg geht verloren.
 */
export function toMatnFamilyGraph(routes: MatnRoutesPayload, families: MatnFamily[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const familyByHadithId = new Map<string, MatnFamily>();
  families.forEach((family) => family.hadithIds.forEach((hadithId) => familyByHadithId.set(hadithId, family)));
  const positions = matnLayout(routes.nodes, routes.edges);
  const familyIdsByNode = new Map<string, Set<string>>();
  const graphEdges: GraphEdge[] = [];

  for (const routeEdge of routes.edges) {
    const groups = new Map<string, { family: MatnFamily | null; occurrences: MatnRouteEdgeOccurrence[] }>();
    for (const occurrence of routeEdge.occurrences) {
      const family = familyByHadithId.get(occurrence.hadithId) ?? null;
      const key = family?.id ?? "__unassigned__";
      const group = groups.get(key) ?? { family, occurrences: [] };
      group.occurrences.push(occurrence);
      groups.set(key, group);
    }
    if (groups.size === 0) groups.set("__unassigned__", { family: null, occurrences: [] });

    for (const { family, occurrences } of groups.values()) {
      const token = family ? normalizeMatnColorToken(family.id, family.colorToken) : undefined;
      const suffix = family ? `matn-${family.id}` : "matn-unassigned";
      const familyIds = family ? [family.id] : [];
      if (family) {
        for (const nodeId of [routeEdge.source, routeEdge.target]) {
          const ids = familyIdsByNode.get(nodeId) ?? new Set<string>();
          ids.add(family.id);
          familyIdsByNode.set(nodeId, ids);
        }
      }
      graphEdges.push({
        data: {
          id: `${routeEdge.id}::${suffix}`,
          source: routeEdge.source,
          target: routeEdge.target,
          verb: "—",
          evidence: routeEdge.evidenceKind,
          collection: routes.clusterId,
          count: occurrences.length,
          variants: family?.id,
          matnFamilyIds: familyIds,
          matnFamilyLabel: family ? matnFamilyShortLabel(family.id) : undefined,
          matnColorToken: token,
          contributors: occurrences.map((occurrence) => ({
            chainOrder: occurrence.chainOrder,
            position: occurrence.position,
          })),
        },
        classes: ["isnad", family ? "matn-family" : "", token ? `matn-${token}` : ""].filter(Boolean).join(" "),
      });
    }
  }

  const graphNodes: GraphNode[] = routes.nodes.map((node) => {
    const familyIds = [...(familyIdsByNode.get(node.id) ?? [])];
    return {
      data: {
        id: node.id,
        label: node.label,
        subtitle: node.reviewStatus,
        kind: "narrator_occurrence",
        status: node.identityStatus,
        collections: routes.clusterId,
        matnFamilyIds: familyIds,
      },
      position: positions.get(node.id),
      classes: node.isRelativeReference ? "relative-reference" : "",
    };
  });
  return { nodes: graphNodes, edges: graphEdges };
}

/**
 * Eine Erzaehlerstelle mit ihrem Kettenkontext. `chainOrder` plus `position`
 * plus `spanStart`/`spanEnd` binden sie an genau eine Stelle im Rohtext; nichts
 * hier gilt global fuer eine Person.
 */
export type ApiNarratorOccurrenceContext = {
  chainOrder: number;
  position: number;
  rawSurfaceForm: string;
  normalizedSurfaceForm: string;
  /** Zeichenoffsets im Rohtext des Datensatzes, fuer den Ruecksprung zur Quelle. */
  spanStart?: number | null;
  spanEnd?: number | null;
  /** Ueberlieferungsbegriff der Stelle (`عن`, `حدثنا`, `اخبرني` …). */
  transmissionTerm?: string | null;
  /** Relative Namensform (`ابيه`, `عمه` …): nur positionsgebunden aufloesbar. */
  relativeForm?: boolean;
  /** Vom Importer markierte Prophetennennung. */
  prophetMention?: boolean;
  identityStatus: ConfidenceLevel;
};

/**
 * Prophetennennung.
 *
 * Frueher stand hier `occurrence.rawSurfaceForm.includes("رسول الله")`. Seit der
 * Importer die Rohform mit Diakritika erhaelt (`رَسُولِ اللَّهِ`), greift dieser
 * Vergleich nicht mehr. Die Entscheidung gehoert ohnehin in den Importer, der
 * den Rohtext und die Normalisierung kennt; das Frontend liest nur noch das
 * Ergebnisfeld. Fehlt es (aeltere Datenversion), wird nichts vermutet.
 */
function isProphetMention(occurrence: ApiNarratorOccurrence): boolean {
  return occurrence.prophetMention === true;
}

/* ---------------------------------------------------------------------------
 * P5.6 -- Gemeinsame Kettenabschnitte deduplizieren.
 *
 * Vorher baute `toHadithGraph` fuer jede (chainOrder, position) einen eigenen
 * Knoten und jede Folgeposition eine eigene Kante. Isnad-Ketten desselben
 * Hadith laufen aber haeufig auf ein gemeinsames, Propheten-nahes Stueck
 * zusammen (Wireframe 1: "Prophet → gemeinsame Kette → Verzweigungen →
 * Sammler") und divergieren erst naeher am Sammler, wo die Kette im Rohtext
 * beginnt (Position 0). Deshalb wird hier vom tiefsten Ende her gruppiert --
 * nicht von Position 0 aus.
 *
 * Zwei Ketten teilen sich einen Abschnitt nur, wenn ihre Erzaehlerstellen an
 * gleicher Tiefe wortgleich sind (Normalform, Ueberlieferungsbegriff,
 * Prophetenmarkierung) UND keine der beiden eine relative Namensform ist --
 * deren Identitaet haengt laut Vertrag ausschliesslich an der eigenen Kette
 * und dem unmittelbar vorhergehenden Erzaehler und darf nie global
 * zusammengefasst werden (`ApiNarratorOccurrence.relativeForm`).
 *
 * Das Ergebnis ist eine gestapelte Kante/ein gestapelter Knoten mit
 * `contributors`: jede beitragende Kette bleibt darin mit eigener Position und
 * eigenen Offsets auffindbar, es geht kein Einzelbeleg verloren.
 * --------------------------------------------------------------------------- */

/** Vorsicht schlaegt Optimismus: bei geteilten Knoten mit abweichenden Stufen gewinnt die zurueckhaltendste. */
const CAUTION_ORDER: ConfidenceLevel[] = ["conflict", "unresolved", "low", "medium", "high", "verified"];

function mostCautiousStatus(statuses: ConfidenceLevel[]): ConfidenceLevel {
  for (const level of CAUTION_ORDER) if (statuses.includes(level)) return level;
  return statuses[0];
}

/** Vergleichsschluessel fuer zwei Erzaehlerstellen. `null` heisst: nie zusammenfassen. */
function segmentMatchKey(occurrence: ApiNarratorOccurrence): string | null {
  if (occurrence.relativeForm) return null;
  return [occurrence.normalizedSurfaceForm, occurrence.transmissionTerm ?? "", occurrence.prophetMention ? "1" : "0"].join("␟");
}

interface ChainWalk {
  chainOrder: number;
  chainId?: string;
  occurrences: ApiNarratorOccurrence[];
}

interface SegmentMember {
  chainOrder: number;
  chainId?: string;
  position: number;
  occurrence: ApiNarratorOccurrence;
}

interface Segment {
  members: SegmentMember[];
  children: Segment[];
}

/**
 * Gruppiert die Ketten schrittweise vom tiefsten Ende her (`depthFromEnd = 0`
 * ist die hoechste Positionsnummer je Kette, also am weitesten vom Sammler und
 * am naechsten am Propheten). Innerhalb einer Gruppe wird mit genau denselben
 * Ketten eine Ebene tiefer weitergruppiert, bis der Schluessel nicht mehr
 * uebereinstimmt, eine relative Namensform auftritt oder eine Kette endet.
 */
function groupByDepth(chains: ChainWalk[], depthFromEnd: number): Segment[] {
  const buckets = new Map<string, SegmentMember[]>();
  const singles: Segment[] = [];

  for (const chain of chains) {
    const index = chain.occurrences.length - 1 - depthFromEnd;
    if (index < 0) continue;
    const occurrence = chain.occurrences[index];
    const member: SegmentMember = { chainOrder: chain.chainOrder, chainId: chain.chainId, position: index, occurrence };
    const key = segmentMatchKey(occurrence);
    if (key === null) {
      // Relative Namensform: eigener, nie zusammengefasster Abschnitt. Die
      // Kette laeuft ab hier fuer sich weiter.
      singles.push({ members: [member], children: groupByDepth([chain], depthFromEnd + 1) });
      continue;
    }
    const bucket = buckets.get(key) ?? [];
    bucket.push(member);
    buckets.set(key, bucket);
  }

  const grouped: Segment[] = [];
  for (const members of buckets.values()) {
    const memberChainOrders = new Set(members.map((member) => member.chainOrder));
    const continuing = chains.filter(
      (chain) => memberChainOrders.has(chain.chainOrder) && chain.occurrences.length - 1 - (depthFromEnd + 1) >= 0,
    );
    grouped.push({ members, children: continuing.length ? groupByDepth(continuing, depthFromEnd + 1) : [] });
  }
  return [...grouped, ...singles];
}

function segmentNodeId(members: SegmentMember[]): string {
  if (members.length === 1) return `occ-${members[0].chainOrder}-${members[0].position}`;
  return `occ-shared-${members.map((member) => `${member.chainOrder}.${member.position}`).sort().join("+")}`;
}

function toContributors(members: SegmentMember[]): ChainContributor[] {
  return members.map((member) => ({
    chainOrder: member.chainOrder,
    chainId: member.chainId,
    position: member.position,
    spanStart: member.occurrence.spanStart ?? null,
    spanEnd: member.occurrence.spanEnd ?? null,
  }));
}

/**
 * Baut Knoten und Kanten aus dem Segmentbaum. Kanten entstehen beim Abstieg zu
 * jedem Kind: die Erzaehlerstellen werden vom Sammler zum Propheten hin immer
 * tiefer (hoehere Position), also zeigt jede Kante vom flacheren Kind (naeher
 * am Sammler) auf das tiefere Elternsegment -- exakt wie zuvor je Kette
 * (`source = vorherige Position`, `target = aktuelle Position`).
 */
function emitSegments(
  roots: Segment[],
  payload: HadithGraphPayload,
  nodes: GraphNode[],
  edges: GraphEdge[],
  occurrences: Record<string, ApiNarratorOccurrenceContext>,
) {
  let nextLeafSlot = 0;
  const originX = 110;
  const horizontalGap = 185;

  const countLeaves = (segment: Segment): number => (segment.children.length ? segment.children.reduce((sum, child) => sum + countLeaves(child), 0) : 1);
  const totalLeaves = roots.reduce((sum, root) => sum + countLeaves(root), 0) || 1;
  const rowGap = Math.max(72, Math.min(140, 640 / totalLeaves));

  const visit = (segment: Segment, depthFromEnd: number): { id: string; y: number } => {
    const id = segmentNodeId(segment.members);
    const representative = segment.members[0];
    const prophet = isProphetMention(representative.occurrence);
    const childResults = segment.children.map((child) => visit(child, depthFromEnd + 1));
    let y: number;
    if (childResults.length) {
      y = childResults.reduce((sum, child) => sum + child.y, 0) / childResults.length;
    } else {
      y = 90 + nextLeafSlot * rowGap;
      nextLeafSlot += 1;
    }
    const contributors = toContributors(segment.members);

    nodes.push({
      data: {
        id,
        label: representative.occurrence.rawSurfaceForm,
        subtitle: segment.members.length === 1
          ? `السلسلة ${representative.chainOrder + 1} · الموضع ${representative.position + 1}`
          : `مشترك بين ${segment.members.length} سلاسل · ${segment.members.map((member) => member.chainOrder + 1).join("، ")}`,
        kind: prophet ? "prophet" : "later",
        // Der Stand der Identitaetsauflaesung kommt unveraendert aus der API;
        // bei geteilten Knoten gewinnt die vorsichtigere Stufe. `verified`
        // kann so nie entstehen, weil kein maschineller Pfad es setzt.
        status: mostCautiousStatus(segment.members.map((member) => member.occurrence.identityStatus)),
        collections: payload.hadith.collection,
        contributors: segment.members.length > 1 ? contributors : undefined,
      },
      position: { x: originX + depthFromEnd * horizontalGap, y },
      classes: prophet ? "prophet" : "later",
    });
    occurrences[id] = { chainOrder: representative.chainOrder, ...representative.occurrence };

    segment.children.forEach((child, index) => {
      const childResult = childResults[index];
      edges.push({
        data: {
          id: `edge-${childResult.id}-${id}`,
          source: childResult.id,
          target: id,
          verb: representative.occurrence.transmissionTerm || "عن",
          // Evidenzklasse aus dem gemeinsamen Vokabular
          // (`isnad_link | rijal_statement | chronology_only`). Eine Kante aus
          // einer konkreten Kette ist immer ein Isnād-Beleg -- niemals eine
          // bloss chronologische Moeglichkeit.
          evidence: "isnad_link",
          collection: payload.hadith.collection === "bukhari" ? "البخاري" : "مسلم",
          count: child.members.length,
          contributors: child.members.length > 1 ? toContributors(child.members) : undefined,
        },
        classes: "isnad",
      });
    });

    return { id, y };
  };

  roots.forEach((root) => visit(root, 0));
}

export function toHadithGraph(payload: HadithGraphPayload): LiveHadithGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const occurrences: Record<string, ApiNarratorOccurrenceContext> = {};
  const chainCount = payload.chains.length;

  const walks: ChainWalk[] = payload.chains.map((chain) => ({
    chainOrder: chain.chainOrder,
    chainId: chain.chainId,
    occurrences: chain.narratorOccurrences,
  }));
  const roots = groupByDepth(walks, 0);
  emitSegments(roots, payload, nodes, edges, occurrences);

  return {
    nodes,
    edges,
    title: payload.hadith.matn?.slice(0, 72) || `حديث رقم ${payload.hadith.hadithNumber}`,
    eyebrow: `${payload.hadith.collection === "bukhari" ? "صحيح البخاري" : "صحيح مسلم"} · رقم ${payload.hadith.hadithNumber}`,
    chainCount,
    occurrenceCount: nodes.length,
    record: payload.hadith,
    sources: payload.sourceReferences,
    dataVersion: payload.dataVersion,
    occurrences,
  };
}

/* ---------------------------------------------------------------------------
 * P5.3 -- Drei getrennte Evidenzklassen fuer die Kantendarstellung.
 *
 * Der Vertrag (`lib/types.ts`) kennt genau drei Evidenzklassen:
 * `isnad_link | rijal_statement | chronology_only`. Live geladene Kanten
 * (oben) liefern bereits `evidence: "isnad_link"`. Die weiterhin verwendeten
 * statischen Demo-Kanten (`lib/mock-data.ts`, ausserhalb der Dateihoheit
 * dieses Agenten) tragen dagegen noch die aelteren Bezeichner `isnad`,
 * `biographical`, `candidate` und die Klasse `uncertain`. Diese Funktion ist
 * die einzige Stelle, die beides in die drei vertraglichen Klassen uebersetzt
 * -- und trennt dabei zwei fachlich verschiedene Aussagen, die vorher beide
 * als `candidate` firmierten:
 *
 *   - Eine Kette nennt eine Erzaehlerstelle, deren Identitaet unklar ist
 *     (`classes` enthaelt `uncertain`, z. B. "welcher Muhammad b. Kathir?").
 *     Der Kettenbeleg selbst steht -- das ist weiterhin `isnad_link`, nur mit
 *     `identityUncertain = true`.
 *   - Eine Verbindung ohne Isnad- oder Rijal-Beleg, die nur aus zeitlicher
 *     Vereinbarkeit vermutet wird (`evidence === "candidate"` ohne
 *     `uncertain`-Klasse). Das ist `chronology_only`: eine reine Moeglichkeit,
 *     niemals ein Beleg fuer Begegnung, Hoeren oder Ueberlieferung.
 * --------------------------------------------------------------------------- */

export interface EdgeEvidenceClassification {
  kind: EvidenceKind;
  /** Nur bei `kind === "isnad_link"` relevant: die Kette ist belegt, wer genau gemeint ist, ist offen. */
  identityUncertain: boolean;
}

const LEGACY_EVIDENCE_KINDS = new Set(["isnad_link", "rijal_statement", "chronology_only"]);

function edgeClassList(edge: Pick<GraphEdge, "classes">): string[] {
  return (edge.classes ?? "").split(/\s+/).filter(Boolean);
}

export function classifyEdgeEvidence(edge: Pick<GraphEdge, "data" | "classes">): EdgeEvidenceClassification {
  const classes = edgeClassList(edge);
  const evidence = edge.data.evidence;
  const identityUncertain = classes.includes("uncertain");

  if (LEGACY_EVIDENCE_KINDS.has(evidence)) {
    return { kind: evidence as EvidenceKind, identityUncertain };
  }
  if (identityUncertain) {
    return { kind: "isnad_link", identityUncertain: true };
  }
  if (evidence === "biographical" || classes.includes("biographical")) {
    return { kind: "rijal_statement", identityUncertain: false };
  }
  if (evidence === "candidate" || classes.includes("candidate")) {
    return { kind: "chronology_only", identityUncertain: false };
  }
  return { kind: "isnad_link", identityUncertain: false };
}

/** Arabische Beschriftung je Evidenzklasse. Einzige Quelle fuer Legende, Hinweis und Belegliste. */
export const EVIDENCE_KIND_LABELS_AR: Record<EvidenceKind, string> = {
  isnad_link: "ثابت في إسناد",
  rijal_statement: "مذكور في كتب الرجال",
  chronology_only: "إمكان زمني فقط، لا دليل سماع",
};

export interface EdgeEvidenceDescription {
  kind: EvidenceKind;
  kindLabel: string;
  identityUncertain: boolean;
  /** Kurzfassung fuer die schwebende Vorschau (Hover). */
  summary: string;
  /** Vollstaendige Belegliste fuer den Kantenklick (P5.3). */
  facts: string[];
}

/**
 * Vollstaendige Belegliste einer Kante fuer den Klick-/Tastaturpfad. Baut
 * ausschliesslich auf Feldern auf, die die Kante bereits mitbringt -- nichts
 * wird hier neu vermutet oder ergaenzt.
 */
export function describeEdgeEvidence(edge: GraphEdge): EdgeEvidenceDescription {
  const { kind, identityUncertain } = classifyEdgeEvidence(edge);
  const kindLabel = EVIDENCE_KIND_LABELS_AR[kind];
  const facts: string[] = [`نوع الدليل: ${kindLabel}`, `الصيغة: ${edge.data.verb}`, `التصنيف: ${edge.data.collection}`];

  if (edge.data.contributors?.length) {
    const chains = edge.data.contributors.map((contributor) => contributor.chainOrder + 1).join("، ");
    facts.push(`مشتركة بين ${edge.data.contributors.length} سلاسل: السلسلة ${chains}`);
  } else {
    facts.push(`عدد الشواهد: ${edge.data.count}`);
  }

  if (edge.data.matnFamilyIds?.length) facts.push(`عائلة المتن: ${edge.data.matnFamilyIds.join("، ")}`);
  else if (edge.data.variants) facts.push(`صيغة المتن: ${edge.data.variants}`);
  if (identityUncertain) facts.push("هوية الراوي في هذا الموضع غير محسومة -- الكتابة تثبت الموضع، وليس مَن بعينه.");
  if (edge.data.chronologyLabel) facts.push(edge.data.chronologyLabel);
  if (kind === "chronology_only") facts.push("إمكان زمني وحده لا يثبت لقاءً ولا سماعاً ولا رواية.");

  const summary = `${kindLabel} · ${edge.data.verb} · ${edge.data.collection}${edge.data.contributors?.length ? ` · ${edge.data.contributors.length} سلاسل` : ""}`;
  return { kind, kindLabel, identityUncertain, summary, facts };
}

/* ---------------------------------------------------------------------------
 * P5.7 -- Tastaturbedienung fuer Kanten.
 *
 * Cytoscape rendert auf einem `<canvas>`, das keine einzelnen Elemente fokussierbar
 * macht. Wie bei den Knoten (`KeyboardNodeList`) liefert diese Funktion die
 * reine Datengrundlage fuer eine parallele, per Tastatur erreichbare
 * Schaltflaechenliste -- unabhaengig von Cytoscape und ohne Leinwand testbar.
 * Die Reihenfolge folgt der uebergebenen Kantenliste (Kettenreihenfolge bzw.
 * Lehrer-vor-Schueler im Netzwerk) und ist damit in RTL wie LTR sinnvoll: das
 * Layout liest die DOM-Reihenfolge, das `dir`-Attribut der Shell dreht nur die
 * visuelle Leserichtung, nicht die Fokusreihenfolge.
 * --------------------------------------------------------------------------- */
export interface KeyboardEdgeItem {
  id: string;
  label: string;
  kind: EvidenceKind;
  identityUncertain: boolean;
}

export function buildKeyboardEdgeItems(nodes: GraphNode[], edges: GraphEdge[]): KeyboardEdgeItem[] {
  const labelById = new Map(nodes.map((node) => [node.data.id, node.data.label]));
  return edges.map((edge) => {
    const { kind, identityUncertain } = classifyEdgeEvidence(edge);
    const sourceLabel = labelById.get(edge.data.source) ?? edge.data.source;
    const targetLabel = labelById.get(edge.data.target) ?? edge.data.target;
    return {
      id: edge.data.id,
      label: `${sourceLabel} ← ${targetLabel} · ${EVIDENCE_KIND_LABELS_AR[kind]}${identityUncertain ? " · هوية غير محسومة" : ""}`,
      kind,
      identityUncertain,
    };
  });
}
