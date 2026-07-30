/**
 * Uebersetzt `database/schema.sql` (kanonisches PostgreSQL-Schema, von Agent 2
 * gepflegt) nach SQLite/D1-DDL, gemaess den im Schema selbst dokumentierten
 * Portabilitaetshinweisen (schema.sql:22-27):
 *
 *   - Bloecke zwischen "POSTGRES-ONLY BEGIN" und "POSTGRES-ONLY END" werden
 *     uebersprungen (CREATE EXTENSION, GIN-Trigram-Indizes, PL/pgSQL-
 *     Funktionen und -Trigger).
 *   - Zeilen mit "SQLITE-TRANSLATE: '~' -> GLOB '...'" ersetzen den
 *     PostgreSQL-Regex-Operator `~` durch die daneben genannte GLOB-Form.
 *   - ENUM-Typen (`CREATE TYPE x AS ENUM (...)`) werden zu `TEXT` plus
 *     `CHECK (col IN (...))` an jeder Verwendungsstelle.
 *   - `uuid` -> `TEXT`, `timestamptz` -> `TEXT`, `jsonb` -> `TEXT`,
 *     `'...'::jsonb`-Casts werden entfernt (reiner Text-Literal-Default bleibt).
 *   - `DEFAULT gen_random_uuid()` entfaellt ersatzlos: der Loader (P3.1)
 *     liefert fuer jede eingefuegte Zeile eine deterministische ID, nie eine
 *     zufaellige -- das ist Voraussetzung fuer die geforderte bitgleiche
 *     Pruefsumme ueber zwei Baulaeufe. Ein INSERT, das id vergisst, soll
 *     laut fehlschlagen statt still eine nicht reproduzierbare UUID zu ziehen.
 *   - `DEFAULT now()` wird zu einem festen Platzhalter-Zeitstempel, NICHT
 *     entfernt: die in schema.sql selbst enthaltenen Seed-INSERTs (role,
 *     editor) lassen created_at weg und verlassen sich auf den Default. Ein
 *     Wanduhr-Default waere nicht reproduzierbar; der feste Platzhalter ist
 *     es, und macht zugleich sichtbar, dass es kein echter Beobachtungs-
 *     zeitpunkt ist.
 *
 * `translateSchemaToSqlite` ist eine reine Funktion (String -> String):
 * keine Dateizugriffe, damit sie unabhaengig von build-atlas-db.mjs getestet
 * werden kann (tests/atlas-db-schema-translate.check.mjs).
 */

const ENUM_TYPE_RE = /^CREATE TYPE (\w+) AS ENUM \(([^)]*)\);\s*$/gm;

/** Fester, klar als Platzhalter erkennbarer Ersatz fuer `now()`-Defaults. */
export const DETERMINISTIC_TIMESTAMP_PLACEHOLDER = "1970-01-01T00:00:00.000Z";

/**
 * @param {string} sqlText Inhalt von database/schema.sql
 * @returns {{ sql: string, enumTypes: Map<string, string[]>, tableNames: string[], viewNames: string[] }}
 */
export function translateSchemaToSqlite(sqlText) {
  // Schritt 1: ENUM-Typdefinitionen einsammeln, bevor irgendetwas entfernt wird.
  const enumTypes = new Map();
  for (const match of sqlText.matchAll(ENUM_TYPE_RE)) {
    const [, name, valuesRaw] = match;
    const values = valuesRaw.split(",").map((part) => part.trim().replace(/^'|'$/g, ""));
    enumTypes.set(name, values);
  }
  if (enumTypes.size === 0) {
    throw new Error("Keine CREATE TYPE ... AS ENUM Definitionen gefunden -- schema.sql-Format hat sich geaendert?");
  }

  // Schritt 2: POSTGRES-ONLY-Bloecke zeilenweise entfernen.
  let sql = stripPostgresOnlyBlocks(sqlText);

  // Schritt 3: CREATE TYPE ... AS ENUM Statements entfernen (SQLite kennt kein CREATE TYPE).
  sql = sql.replace(ENUM_TYPE_RE, "");

  // Schritt 4: SQLITE-TRANSLATE '~' -> GLOB '...' anwenden.
  sql = applyGlobTranslations(sql);

  // Schritt 5: ENUM-Spaltentypen zu TEXT + CHECK (...) auf jeder Verwendungsstelle.
  sql = applyEnumColumnChecks(sql, enumTypes);

  // Schritt 6: '...'::jsonb-Casts entfernen (das TEXT-Literal bleibt gueltig).
  // Muss VOR der Basistyp-Uebersetzung laufen, sonst hat "jsonb" im Cast
  // bereits sein eigenes Erkennungsmerkmal an "TEXT" verloren.
  sql = sql.replace(/::jsonb/g, "");

  // Schritt 7: Basistypen uebersetzen.
  sql = sql
    .replace(/\buuid\b/g, "TEXT")
    .replace(/\btimestamptz\b/g, "TEXT")
    .replace(/\bjsonb\b/g, "TEXT");

  // Schritt 8: nicht portable Funktions-Defaults behandeln.
  sql = sql
    .replace(/\s*DEFAULT gen_random_uuid\(\)/g, "")
    .replace(/DEFAULT now\(\)/g, `DEFAULT '${DETERMINISTIC_TIMESTAMP_PLACEHOLDER}'`);

  const tableNames = [...sql.matchAll(/^CREATE TABLE (\w+)/gm)].map((m) => m[1]);
  const viewNames = [...sql.matchAll(/^CREATE VIEW (\w+)/gm)].map((m) => m[1]);

  return { sql, enumTypes, tableNames, viewNames };
}

function stripPostgresOnlyBlocks(sqlText) {
  const kept = [];
  let skipping = false;
  for (const line of sqlText.split("\n")) {
    if (line.includes("POSTGRES-ONLY BEGIN")) {
      skipping = true;
      continue;
    }
    if (line.includes("POSTGRES-ONLY END")) {
      skipping = false;
      continue;
    }
    if (skipping) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

function applyGlobTranslations(sqlText) {
  const lines = sqlText.split("\n");
  const out = [];
  let pendingGlob = null;
  for (const line of lines) {
    const translateComment = line.match(/SQLITE-TRANSLATE:\s*'~'\s*->\s*(GLOB\s*'[^']*')/);
    if (translateComment) {
      pendingGlob = translateComment[1];
      out.push(line);
      continue;
    }
    if (pendingGlob && /~\s*'[^']*'/.test(line)) {
      const replaced = line.replace(/(\w+)\s*~\s*'[^']*'/, (_whole, col) => `${col} ${pendingGlob}`);
      out.push(replaced);
      pendingGlob = null;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Wendet die Spaltentyp-Ersetzung NUR innerhalb von `CREATE TABLE ( ... )`-
 * Rumpfen an, nie im gesamten Dateitext.
 *
 * Grund: mehrere Spalten heissen wortgleich zu ihrem ENUM-Typ (z. B. die
 * Spalte `evidence_kind` vom Typ `evidence_kind`, `review_status` vom Typ
 * `review_status`). Genau dieselbe Zeichenkette taucht aber auch in
 * `CREATE UNIQUE INDEX ... WHERE evidence_kind = 'isnad_link';` und in den
 * Sichten (`WHERE review_status <> 'rejected'`) auf -- dort ist es ein
 * Spaltenverweis in einer Bedingung, kein Spaltentyp. Eine ungescopte Regex
 * wuerde `WHERE evidence_kind = 'isnad_link';` faelschlich als Spaltendefinition
 * lesen und in kaputtes SQL verwandeln. Deshalb wird zuerst jede Zeichenspanne
 * zwischen der oeffnenden und der zusammengehoerigen schliessenden Klammer
 * jeder `CREATE TABLE`-Anweisung ermittelt (klammer- und Stringliteral-
 * bewusst), und nur dort ersetzt.
 */
/**
 * Woerter, die vor einem zufaellig gleichlautenden Enum-Typnamen stehen
 * koennen, ohne dass eine Spaltendefinition gemeint ist -- z. B.
 * "OR extraction_method <> 'manual'" in einer mehrzeiligen CHECK-Bedingung
 * (schema.sql:1036). Anders als die WHERE-Klauseln von CREATE INDEX/VIEW
 * liegt so eine Zeile *innerhalb* des CREATE-TABLE-Rumpfs, das Scoping
 * allein reicht hier also nicht; zusaetzlich muss das vermeintliche
 * Spaltenname-Token ausschliessen, ein SQL-Schluesselwort zu sein.
 */
const NON_COLUMN_LEADING_TOKENS = new Set([
  "OR", "AND", "NOT", "WHERE", "XOR", "CASE", "WHEN", "THEN", "ELSE", "IN",
  "ON", "SELECT", "FROM", "GROUP", "ORDER", "HAVING", "VALUES", "DEFAULT",
  "CHECK", "CONSTRAINT", "UNIQUE", "PRIMARY", "REFERENCES", "NULL", "IS",
]);

function applyEnumColumnChecks(sqlText, enumTypes) {
  const typeNames = [...enumTypes.keys()].sort((a, b) => b.length - a.length).join("|");
  const columnTypeRe = new RegExp(`^(\\s*)(\\w+)\\s+(${typeNames})\\b([^,\\n]*)(,?)\\s*$`, "gm");

  let result = "";
  let cursor = 0;
  for (const [start, end] of findCreateTableBodySpans(sqlText)) {
    result += sqlText.slice(cursor, start);
    const body = sqlText.slice(start, end);
    result += body.replace(columnTypeRe, (whole, indent, column, typeName, rest, trailingComma) => {
      if (NON_COLUMN_LEADING_TOKENS.has(column.toUpperCase())) return whole;
      const values = enumTypes.get(typeName).map((value) => `'${value}'`).join(", ");
      return `${indent}${column} TEXT${rest} CHECK (${column} IN (${values}))${trailingComma}`;
    });
    cursor = end;
  }
  result += sqlText.slice(cursor);
  return result;
}

/** @returns {Array<[number, number]>} [start, end) Zeichenspannen zwischen der oeffnenden und der passenden schliessenden Klammer jeder CREATE-TABLE-Anweisung. */
function findCreateTableBodySpans(sqlText) {
  const spans = [];
  const startRe = /CREATE TABLE \w+ \(/g;
  let match;
  while ((match = startRe.exec(sqlText))) {
    const openParenIndex = match.index + match[0].length - 1;
    const closeParenIndex = findMatchingParenIndex(sqlText, openParenIndex);
    spans.push([openParenIndex + 1, closeParenIndex]);
  }
  return spans;
}

/** Klammer- und Stringliteral-bewusste Suche nach der zur Klammer bei `openIndex` passenden schliessenden Klammer. */
function findMatchingParenIndex(text, openIndex) {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Keine schliessende Klammer zu Position ${openIndex} gefunden -- CREATE TABLE unausgewogen?`);
}
