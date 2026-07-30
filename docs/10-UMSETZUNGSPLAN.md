# Umsetzungsplan Sanad Atlas

Stand: 30. Juli 2026 · Grundlage: `Sanad-Atlas-Projektbeschreibung.txt` (15 Abschnitte) als maßgebliche Spezifikation
Erstellt aus fünf parallelen Code-Audits (Backend/API/Infrastruktur, Entity Resolution, Import/Datenqualität, Frontend/UX, Repo-Inventar).
Harte Randbedingung des Auftraggebers: **der Betrieb muss dauerhaft kostenlos möglich sein und trotzdem funktionieren.**

---

## Fortschritt nach Umsetzungswelle 2

Der Audit-Bestand unten bleibt als Ausgangsmessung erhalten. Der aktuelle
Arbeitsstand ist deutlich weiter:

- P0, P1.2–P1.4, P2.1–P2.4, P3.1–P3.4, P4.1–P4.4 und P5.1–P5.3/P5.6/P5.7
  sind implementiert und geprüft.
- P4.5 hat jetzt einen reversiblen Merge-/Split-Lifecycle für echte
  `SA-P-*`-Identitätsentitäten. Ein `UNC-*`-Namenscluster wird ausdrücklich
  **nicht** automatisch zu einer Person, weil es Homonyme enthalten kann.
- P4.6 extrahiert 126.005 Rijāl-Nennungen: 83.825 quellengebundene,
  personenscharf segmentierte Identitätskandidaten und 42.180 begründete
  Review-Fälle. Solange beide Enden nicht auf historische Personen aufgelöst
  sind, entstehen bewusst 0 `rijal_statement`-Kanten.
- P4.7 hat reproduzierbare Rahmen für 250 Hadithpositionen und 100 distinkte
  Namensformen sowie ein Prüfprogramm für Doppelannotation, Cohen-κ,
  Adjudikation und Präzision/Recall je Stratum. Der Goldbestand ist noch nicht
  abgeschlossen: zwei unabhängige Fachannotationen, Adjudikation und
  Resolver-Vorhersagen fehlen.
- Der aktuelle deterministische D1-Build umfasst 13.066 Hadithdatensätze,
  87.867 Erzählerpositionen, 34.451 Rijāl-Einträge und 147.458
  Projektionskanten. Größe: 552,9 MB.
- Verifikation: 84 Vitest-Tests, 27 Backendtests, 19/20 Atlas-Checks
  (ein erwarteter Plattform-Fallback-Skip), 6 Rijāl-Vollkorpuschecks und 27
  Worker-Vertragstests grün; TypeScript, ESLint und Produktionsbuild grün.

Nächste fachliche Blocker: echte Goldannotation (P4.7), Frontend vollständig
von Demonstrationsdaten lösen (P3.3/P5.4/P5.5), anschließend persistente
Redaktionsoberfläche (P5.8) und das strikte Gold-CI-Gate (P6.1).

---

## 1. Was der Audit bestätigt hat

Die Zahlen aus Abschnitt 2 der Beschreibung stimmen exakt mit `public/data/corpus/manifest.json` überein — keine Abweichung:

| Größe | Beschreibung | gemessen |
|---|---:|---:|
| Bukhārī-Vorkommen | 7.291 | 7.291 |
| Muslim-Vorkommen | 5.775 | 5.775 |
| Erzählerpositionen | 77.566 | 41.893 + 35.673 = 77.566 |
| Rijāl-Einträge | 27.105 | 9.247 + 9.212 + 8.646 = 27.105 |
| nicht sicher parsebar | 1.154 | 417 + 737 = 1.154 |

Belastbar funktionierend: der Rijāl-Klickpfad aus Abschnitt 3 in allen zehn Schritten; die vier Differenzarten des Matn-Diffs inklusive تقديم وتأخير (`lib/matn-diff.ts:3,58-61`); `lib/chronology.ts:21-37` liefert ausschließlich `possible / impossible / insufficient` ohne Mittelwertbildung; die Kennzeichnung ungeprüfter Vorschläge ist durchgängig; RTL ist konsequent umgesetzt; `npm run lint` und `npx tsc --noEmit` sind fehlerfrei; `backend/tests` 6/6 grün.

## 2. Die acht kritischen Befunde

Diese Punkte bestimmen die Reihenfolge des gesamten Plans.

**B1 — `nameSurface` ist kein Name, sondern ein abgeschnittener Textanfang.**
`scripts/import-turath-corpus.mjs:216` schneidet mit `.slice(0, 180)`. 6.642 von 9.247 Tahdhīb-Einträgen sind exakt 180 Zeichen lang. Die vierstufige Rangfolge in `backend/app/repository.py:238-273` feuert `exact_name` deshalb praktisch nie; `name_contains` verhält sich wie eine bloße Textnennung. Die in Abschnitt 3 (Z. 87) geforderte Höherbewertung des Namenstitels gegenüber der Erwähnung im Biografietext ist damit **faktisch wirkungslos**.

**B2 — Todesjahre fehlen fast vollständig.** `deathYearCandidate`: 24 von 9.247 (Tahdhīb), 16 von 9.212 (Mīzān), 15 von 8.646 (Taqrīb). Das Chronologiesignal der Entity Resolution ist dadurch leer, und der Zeitvergleich aus Abschnitt 7 hat für den Echtbestand keine Datenbasis.

**B3 — Die Rohform ist im Import verloren.** Der Importer schreibt bereits normalisierten Isnād (`import-turath-corpus.mjs:100-101`), weshalb `rawSurfaceForm` und `normalizedSurfaceForm` in 69.859 von 77.566 Fällen identisch sind. Zeichen-Offsets fehlen, obwohl `database/schema.sql:183-184` sie vorsieht. `position` ist ein Sequenzindex im Ergebnis-Array, kein Offset im Rohtext. **Das Abnahmekriterium „jede Kette positionsgenau zum Rohtext rekonstruierbar" ist heute unerfüllbar** — und es widerspricht dem Leitsatz aus Abschnitt 6, arabisch zu normalisieren *ohne Verlust des Originaltextes*.

**B4 — Für die 27.105 Rijāl-Einträge existiert keine Tabelle.** `database/schema.sql` hat 21 Tabellen, aber keine für Rijāl-Einträge; `entryNumber`, `nameSurface`, `deathYearCandidate`, `teacherPhrase`, `studentPhrase` haben kein Ziel. Ebenso fehlen `scholar` und `place`, die `docs/03-DATA-MODEL.md:110-111` vorsieht.

**B5 — Das Lizenz-Gate ist ein Etikett, kein Mechanismus.** `data/sources/turath-manifest.json` dokumentiert `rightsStatus`, `redistributionStatus` und eine `publicDerivedFields`-Allowlist. Diese Allowlist wird **im Code nirgends gelesen** (0 Treffer). `backend/app/repository.py:158,175` ruft `public_record(record, include_text=True)` fest verdrahtet auf: volle Isnād- und Matn-Texte gehen unabhängig vom Rechtestatus über `/api/v1/hadiths` hinaus. Zusätzlich lädt der Browser ohne `NEXT_PUBLIC_API_URL` rund 30 MB Turath-Rohdaten direkt (`components/atlas-shell.tsx:398`) und umgeht damit jede serverseitige Prüfung. Lokal unkritisch, vor jedem öffentlichen Deployment ein Blocker.

**B6 — Eine unbelegte Datierung wird als Aussage angezeigt.** `lib/mock-data.ts:159-168` enthält eine zweite, nicht sanktionierte Chronologieberechnung (`deathAh >= birthAhMin + 10`), die `compareChronology()` umgeht und für etwa 30 von 33 Erzählern auf hartcodierten `estimatedBirthRanges` (`lib/mock-data.ts:51-59`) **ohne jede Quelle** beruht. Das Ergebnis erscheint als sichtbares `chronologyLabel` — ein direkter Verstoß gegen „keine Datierung ohne Quellenreferenz".

**B7 — Fünf Endpunkte sind Attrappen, acht sind im Client nicht verdrahtet.** `/narrators/{id}` liefert immer 404 (`backend/app/main.py:100-104`), `/narrators/{id}/relations` immer `items: []` (:107-109), `/narrators/{id}/timeline` immer `dateAssertions: []` (:112-114), `/narrators/compare` (:95-97) und `/chronology/compare` (:117-119) immer `insufficient`. In `lib/api-client.ts` sind nur 6 der 14 Endpunkte aus Abschnitt 12 angebunden. Folge: `/network`, `/compare`, `/variants`, `/sources`, `/editor` und `/narrators/yahya` laufen vollständig auf Mockdaten; echt angebunden sind nur `/library`, `/narrators/lookup`, `/rijal/entry` und `/hadith?record=`.

**B8 — Drei inkompatible Statusvokabulare und zwei divergierende Normalisierer.** `lib/types.ts:3` kennt `verified|high|medium|low|conflict` (ohne `unresolved`), `database/schema.sql:7` kennt `verified|candidate|unresolved|conflict`, `docs/05-ENTITY-RESOLUTION.md` sechs Stufen. `lib/search.ts:1-15` und `backend/app/repository.py:26-29` normalisieren arabischen Text unterschiedlich (andere Diakritika-Range, kein ibn/bin im Python-Zwilling). Die Entscheidungsstufen aus docs/05 sind nirgends implementiert: `rankIdentityCandidates` (`lib/entity-resolution.ts:61-63`) filtert nur `confidence > 0`, ohne die Schwellen 0,90 und 0,70.

Weitere Feststellungen: `coveragePercent` in `completeness.json` ist irreführend — `import-turath-corpus.mjs:301` setzt `records.length ? 100 : 0`, also immer 100; `tests/mock-data.test.ts:56` zementiert diesen Wert sogar als Erwartung. Die echte Parserquote ist Bukhārī 94,3 % und Muslim 87,2 %. In `.cache/` liegt eine nicht registrierte Quelle (Turath 2171, al-Kāshif, 2,2 MB) plus ein verwaistes `kashif.json` (4,8 MB), das das aktuelle Skript nicht mehr erzeugt. `npm run test` schlägt derzeit an einer fehlenden Rollup-Plattformbibliothek fehl, nicht am Testcode. Und: **15 geänderte plus 15 unversionierte Dateien** liegen uncommittet im Arbeitsbaum, darunter das komplette `backend/`.

## 3. Architekturentscheidung: Nullkosten-Betrieb

Die in Abschnitt 11 vorgesehene Zielarchitektur ist unter der Nullkosten-Bedingung nicht haltbar. Recherchierter Stand der Gratis-Konditionen am 30. Juli 2026:

| Dienst | Gratis-Kondition | Bewertung |
|---|---|---|
| Cloudflare Workers | 100.000 Requests/Tag, 10 ms CPU je Aufruf, Egress frei | tragfähig |
| Cloudflare D1 | 5 GB, 5 Mio. Zeilen-Lesevorgänge/Tag, FTS5 **und** `WITH RECURSIVE` | tragfähig |
| GitHub Pages / Actions | 1 GB Site, 100 GB/Monat weich; Actions für öffentliche Repos unbegrenzt | tragfähig, bereits im Einsatz |
| Neon | 0,5 GB/Projekt, 100 CU-h, Scale-to-Zero nach 5 min | knapp, ~500 ms Kaltstart |
| Supabase Free | 500 MB, **Pause nach 7 Tagen Inaktivität** | für eine Forschungsseite ungeeignet |
| Vercel Hobby | 1 Mio. Invocations, 4 CPU-h, **nicht kommerziell** | Lizenzfalle bei späteren Spenden |
| Fly.io | Free-Tier für Neuaccounts abgeschafft (2-h-Trial) | entfällt |
| Render | 750 h, Spin-down nach 15 min, ~60 s Kaltstart | für interaktive Graphen unbrauchbar |
| Hugging Face Spaces | 2 vCPU / 16 GB, Schlaf nach 48 h | Notlösung für Python |
| Oracle Always Free | im Juni 2026 auf 2 OCPU/12 GB halbiert, Rückholung bei <20 % CPU | unzuverlässig |
| Sentry Free | 5.000 Fehler/Monat, Überschuss verworfen | ausreichend |

**Empfehlung:** statischer Next-Export auf GitHub Pages (existiert bereits) plus **ein** Cloudflare Worker mit **D1 als fachlicher Quelle der Wahrheit**. Kein Idle-Suspend, kein Kaltstart, keine Kreditkarte. Der aktuelle deterministische Build liegt bei 552,9 MB.

**FastAPI wird als Auslieferungslaufzeit aufgegeben**, weil jeder kostenlose Python-Host schläft, abgeschafft wurde oder Leerlaufspiele verlangt. Python bleibt als Importer, Parser und Entity-Resolution-Pipeline in GitHub Actions — dort ist es kostenlos und sachlich richtig platziert. `backend/` bleibt zusätzlich die lokale Referenzimplementierung für Contract-Tests. Unabhängig davon ist `repository.py` nicht auslieferungsreif: es scannt bei jeder Anfrage alle 13.066 Datensätze im Volltext (`:148, :167-176, :291, :320`).

Elastic und Neo4j entfallen ersatzlos: FTS5 mit einer diakritikafreien Zusatzspalte ersetzt den Suchindex, eine materialisierte `edge_projection` plus `WITH RECURSIVE` mit harter Grenze (`maxDepth ≤ 8`, ≤ 500 Kanten, `docs/04-GRAPH-SCHEMA.md:40-41`) ersetzt die Graph-Datenbank. Beides bleibt damit — wie Abschnitt 11 fordert — eine jederzeit neu aufbaubare Projektion, und die relationale Ebene bleibt die einzige fachliche Wahrheit.

## 4. Phasen und Arbeitspakete

Aufwand in Personentagen. „Effort" ist das für den ausführenden Agent empfohlene Denkniveau.

### Phase 0 — Sicherung (blockiert alles Weitere)

| ID | Paket | Dateien | Abnahme | Aufwand | Effort |
|---|---|---|---|---|---|
| P0.1 | Arbeitsstand committen: 15 geänderte + 15 unversionierte Dateien in nachvollziehbare Commits | Arbeitsbaum | `git status` sauber, jede Änderung reversibel | 0,25 | low |
| P0.2 | CI reparieren: fehlende Rollup-Plattformbibliothek, `npm run test` grün | `package-lock.json`, Workflow | alle 6 Suiten laufen lokal und in Actions | 0,5 | low |
| P0.3 | `coveragePercent`-Lüge entfernen und Test korrigieren | `import-turath-corpus.mjs:301`, `tests/mock-data.test.ts:56` | Wert entspricht der echten Parserquote (94,3 / 87,2 %) | 0,5 | low |

### Phase 1 — Datenfundament (blockiert Entity Resolution und Chronologie)

| ID | Paket | Dateien | Vorbedingung | Abnahme | Aufwand | Effort |
|---|---|---|---|---|---|---|
| P1.1 | Rijāl-Reparse: echter Namenskopf statt 180-Zeichen-Schnitt, Todes- und Geburtsjahr, Ṭabaqa, Kunya, Nisba, Region; Lehrer-/Schülerregex erweitern (Taqrīb erkennt heute nur 109 von 8.646) | `import-turath-corpus.mjs:199-241` | P0 | ≥ 80 % Einträge mit Namenskopf ≤ 60 Zeichen; Todesjahr ≥ 60 % in Tahdhīb; Goldstichprobe von 100 Köpfen manuell geprüft | 3 | **extra high** |
| P1.2 | Ein einziger Normalisierer für TS und Python; Rohform erhalten; `spanStart`/`spanEnd` je Erzählerposition | `lib/search.ts`, `repository.py:26-29`, Importer `:90-125` | P0 | Property-Test belegt bitgleiche Normalisierung; jede Position ist auf `.cache/turath` zurückschneidbar | 2 | high |
| P1.3 | Parser-Robustheit: `matn-boundary-not-found` (1.041 Fälle, 90 % aller Fehler), danach `transmission-term-not-found` (113, nur Bukhārī; Begriffsliste `:16` erweitern) | `import-turath-corpus.mjs:90-104,16` | P1.2 | nicht parsebare Vorkommen < 500, jeder Rest mit konkretem Fehlercode | 3 | high |
| P1.4 | Vollständigkeit ehrlich: Rijāl-Abdeckung in `completeness.json`, Review-Queue für verworfene `plausibleName`-Kandidaten (`:222`) statt stiller Verwerfung | Importer `:305-320` | P0.3 | jeder verworfene Kandidat ist in der Queue auffindbar | 1,5 | medium |
| P1.5 | Nicht registrierte Quelle al-Kāshif (Turath 2171) klären: nach Rechteprüfung registrieren oder Cache und verwaistes `kashif.json` entfernen | `data/sources/turath-manifest.json`, `.cache` | P0 | keine Datei ohne Registry-Eintrag | 0,5 | low |

### Phase 2 — Schema und Antwortvertrag

| ID | Paket | Dateien | Vorbedingung | Abnahme | Aufwand | Effort |
|---|---|---|---|---|---|---|
| P2.1 | Schema-Lücken schließen: `rijal_entry`, `scholar`, `place`; `narrator.stable_key` plus Redirect-Tabelle für absorbierte IDs; `narrator_merge`; `editor` und `role`; `reviewed_at`/`reviewed_by`; UNIQUE und Occurrence-Fremdschlüssel auf `relationship_assertion`; `chronology_only` mit Bezug auf die verwendeten `date_assertion`-Zeilen; Quellenpflicht erzwingen (`source_passage_id` heute nullable auf `:207,:288`); Append-only-Trigger | `database/schema.sql`, `docs/03-DATA-MODEL.md`, `docs/04-GRAPH-SCHEMA.md` | P0 | Schema lädt; Abschnitt 8, 9 und 13 sind durch Constraints erzwungen, nicht nur dokumentiert | 3 | **extra high** |
| P2.2 | Antwort-Hülle vereinheitlichen: `confidence` als Enum plus getrennter Zahlenscore, `lastReviewedAt` mit echter Datenbasis, alle fünf Attrappen ersetzen, die vier Next-Routen an die Hülle binden | `repository.py:47-59`, `main.py:95-119`, `app/api/**`, `docs/06-API-SPECIFICATION.yaml` | P2.1 | Schema-Test über alle Endpunkte grün; kein Endpunkt ohne `sourceReferences`, `confidence`, `reviewStatus`, `dataVersion`, `lastReviewedAt` | 2 | high |
| P2.3 | Ein Statusvokabular über `types.ts`, `schema.sql` und docs/05 (sechs Stufen inklusive `unresolved`) | `lib/types.ts:3`, `schema.sql:7`, `docs/05` | P2.1 | ein Enum, an drei Stellen identisch, typgeprüft | 0,5 | medium |
| P2.4 | Lizenz-Gate technisch erzwingen: `publicDerivedFields`-Allowlist auswerten, `include_text` nur bei freigegebenem Rechtestatus, Direktladen der 30 MB im Browser abschalten | `repository.py:138,158,175`, `atlas-shell.tsx:398` | P2.2 | Test schlägt rot aus, wenn ein Volltext ohne Freigabe ausgeliefert wird | 1,5 | high |

### Phase 3 — Nullkosten-Laufzeit

| ID | Paket | Dateien | Vorbedingung | Abnahme | Aufwand | Effort |
|---|---|---|---|---|---|---|
| P3.1 | Build-Pipeline JSON → `atlas.db` (SQLite/D1) inklusive FTS5 mit diakritikafreier Spalte und materialisierter `edge_projection` | neu `scripts/build-atlas-db.mjs`, Workflow | P1, P2.1 | deterministisch, Prüfsumme über zwei Läufe identisch | 2,5 | high |
| P3.2 | Worker-API (Hono) für alle 14 Endpunkte, Traversierung per `WITH RECURSIVE` mit harter Tiefen- und Ergebnisgrenze | neu `worker/`, `lib/api-client.ts` | P2.2, P3.1 | Contract-Test vergleicht Worker- und FastAPI-Antwort feldweise | 3 | high |
| P3.3 | Mock-Routen entfernen, Frontend vollständig an den Worker binden, stillen Mock-Rückfall `liveGraph?.nodes ?? hadithNodes` (`atlas-shell.tsx:223`) beseitigen | `app/api/**`, `atlas-shell.tsx` | P3.2 | kein `lib/mock-data`-Import mehr unterhalb `app/` und `components/` | 2 | high |
| P3.4 | Datenversion und Indexversion gemeinsam deploybar, Rollback stellt beide wieder her | Workflow, `manifest.json` | P3.1 | Rollback auf die Vorversion in einem Schritt nachgewiesen | 1 | medium |

### Phase 4 — Entity Resolution

Messwerte aus dem Audit: Kopftoken-Invertindex über 27.105 Einträge ergibt 14.341 Tokens, Aufbau 0,1 s. Blocking aller 9.271 Nicht-Prophet-Namensformen: Median 388, p90 1.803, Maximum 4.492 Kandidaten. Entscheidender Hebel ist die Deduplizierung auf **9.696 distinkte Namensformen statt 77.566 Positionen** (Faktor 8) und der Ausschluss der 9.876 Prophetenpositionen. Rund 6,4 Mio. Paare, unter 15 Minuten einsträngig — ohne bezahlte Infrastruktur.

| ID | Paket | Dateien | Vorbedingung | Abnahme | Aufwand | Effort |
|---|---|---|---|---|---|---|
| P4.1 | Blocking-Index und Batch-Resolver mit Formen-Deduplizierung und Prophetenausschluss | neu `lib/blocking.ts` bzw. `backend/app/resolver.py` | P1.1, P1.2 | vollständiger Lauf < 20 min, Recall ≥ 0,97 auf dem Goldbestand | 3 | high |
| P4.2 | Scoring nach der Gewichtstabelle aus docs/05 (heute 0,52 statt 0,22 für exakte Namensgleichheit, vier Signale fehlen ganz) plus Entscheidungsstufen; Gewichte in versionierter Konfiguration | `lib/entity-resolution.ts`, `lib/types.ts`, `schema.sql:189-199` | P4.1, P2.3 | alle neun Signale einzeln testbar; **kein Pfad setzt jemals `verified`**; Gewichtsdatei versioniert | 3 | **extra high** |
| P4.3 | Harte Konfliktregeln: unmögliche Chronologie, expliziter Quellenkonflikt, zwei Kandidaten ≥ 0,80 mit Abstand < 0,05 | `lib/entity-resolution.ts`, `lib/chronology.ts` | P4.2 | jede Regel blockiert Auto-Merge nachweisbar, Ergebnis `conflict` mit Begründung | 1,5 | high |
| P4.4 | Relative Namensformen als eigener, positionsgebundener Algorithmus; heute drei verschiedene Listen an drei Stellen (`Importer:121`, `entity-resolution.ts:31`, `research-record-layout.tsx:43`), nur exakte Gleichheit | neu `lib/relative-forms.ts`, `repository.py:275-288` | P1.2, P4.2 | eine Liste, Trailing-Token erkannt, 1.496 Positionen erfasst; Ergebnis hängt nur an `(chain, position)`, niemals global | 2 | **extra high** |
| P4.5 | Stabile kanonische IDs (`SA-P-<base32(8)>` plus Revision); Merge erzeugt neue Revision und Alias, Split spielt zurück | `schema.sql:149-211`, `main.py:100-114` | P2.1, P4.2 | Merge-, Split- und Undo-Rundlauf getestet; ID nach Split stabil, Alias auflösbar | 2,5 | high |
| P4.6 | Lehrer und Schüler aus Tahdhīb als quellengebundene Assertions (rund 59.250 Rohnennungen, Median 6 je Phrase) | `schema.sql:227-244`, Importer `:218` | P1.1, P4.5 | jede Kante mit `evidence_kind='rijal_statement'` und Passage; keine Chronologiekante als Beleg | 4 | high |
| P4.7 | Goldbestand 250 Hadithvorkommen und 100 Erzähler, stratifiziert nach Namenslänge, Kunya, Nisba, Relativform und Homonym; Doppelannotation, Adjudikation, Metriken je Stratum in der CI | neu `data/gold/`, `tests/` | P1.1, P4.4 | Übereinstimmungsmaß dokumentiert; Präzision und Recall je Stratum laufen in der CI | 5 | **extra high** |

### Phase 5 — Frontend

| ID | Paket | Dateien | Vorbedingung | Abnahme | Aufwand | Effort |
|---|---|---|---|---|---|---|
| P5.1 | Monolith teilen: 608 Zeilen, sechs Views und drei Panels in einer Client-Komponente, die jede Route importiert | `atlas-shell.tsx` → `components/views/*`, `components/panels/*`, `next/dynamic` | P0 | jede Route bündelt nur ihre eigenen Views | 3 | medium |
| P5.2 | Unbelegte Chronologie entfernen: Zweitberechnung `mock-data.ts:159-168` und quellenlose `estimatedBirthRanges:51-59` streichen, `compareChronology()` als einzige Quelle | `lib/mock-data.ts`, `lib/chronology.ts` | P0 | kein sichtbares Datum ohne Quellenreferenz; Test verbietet Regression | 1 | high |
| P5.3 | Kantenklick mit vollständiger Belegliste (heute nur `mouseover`, kein `tap` auf Kanten) und drei visuell getrennte Evidenzklassen; „candidate" vermischt derzeit Identitätsunsicherheit mit chronologischer Möglichkeit | `atlas-graph.tsx:89-101`, `atlas-shell.tsx`, `lib/types.ts` | P2.1 | Isnād-Beleg, Rijāl-Aussage und bloße Möglichkeit sind visuell und textuell unterscheidbar | 2 | medium |
| P5.4 | Matn ↔ Isnād bidirektional plus stabile Familienfarbe: `matnVariants` hat kein `color`-Feld, der Graph hebt einheitlich orange hervor, und zwei Taxonomien (`v1/v2` gegen `أ/ب/ج`) sind unverknüpft; die Oberfläche verspricht die Kopplung bereits im Text (`:309`) | `atlas-shell.tsx:302-327`, `atlas-graph.tsx:96,120-127`, `lib/types.ts` | P3.2 | eine Farbe je Familie, identisch in Text, Graph, Vergleich, Tabellen und Filtern; Klick in beide Richtungen wirksam | 4 | high |
| P5.5 | Erzählerpanel, `/network`, `/compare` und `/sources` an echte Endpunkte; hartcodierte Zahlen wie `id === "yahya" ? 18 : 4` (`:102-104`) entfernen; Kunya, Nisba, Varianten, Reisen, alle Vorkommen und Datenversion ergänzen | `lib/api-client.ts`, `atlas-shell.tsx` | P3.2, P4.5 | keine hartcodierte Fachaussage mehr im Frontend | 5 | high |
| P5.6 | Progressives Nachladen: der Button „فتح ١١٦ تلميذا آخر" (`:255`) hat keinen Handler; `hadith-graph.ts` dedupliziert gemeinsame Kettenabschnitte im Livepfad nicht | `atlas-shell.tsx`, `lib/hadith-graph.ts` | P3.2 | Nachbarn laden schrittweise, gemeinsame Abschnitte erscheinen einmal als gestapelte Kante | 2,5 | medium |
| P5.7 | RTL/LTR-Umschalter (Button `:585` ohne Handler, FR-10 unerfüllt) und Tastaturauswahl auch für Kanten | `atlas-shell.tsx`, `app/layout.tsx`, `globals.css` | P5.1 | Shell umschaltbar, arabische Blöcke bleiben RTL; Graph vollständig ohne Maus bedienbar | 1,5 | low |
| P5.8 | Redaktionsoberfläche an die Revisions-API: heute reiner React-State mit `initialReviewItems:459-464`, kein Persistenz- und kein Reversibilitätsnachweis; Vier-Augen-Freigabe, Begründungspflicht, Vorher-Nachher-Diff, Rollen | `atlas-shell.tsx:459-511`, Worker, `schema.sql:201-211,282-294` | P2.1, P3.2, P4.5 | zwei verschiedene `editor_id` je Merge; Begründung und Quelle Pflicht; jede Revision nachweislich rücknehmbar | 5 | **extra high** |

### Phase 6 — Abnahme

| ID | Paket | Abnahme | Aufwand | Effort |
|---|---|---|---|---|
| P6.1 | CI-Gates für Parser, Entity Resolution, Chronologie, Cluster, API, RTL, Tastatur, Rechte und Performance | rote CI bei fehlender Quellenreferenz, bei Rechteverstoß und bei Regression in einer Stratum-Metrik | 3 | high |
| P6.2 | Performance- und Barrierefreiheitstest im Produktionsbetrieb; Teilgraph mit 1.000 sichtbaren Elementen | Messwerte dokumentiert, Grenzen eingehalten | 2 | medium |
| P6.3 | Goldbestand-Abnahme: vollständige Quellen- und Kettenübereinstimmung auf 250 Vorkommen und 100 Erzählern | Bericht mit Abweichungsliste, keine ungeprüfte Behauptung | 2 | high |

**Reihenfolge:** P0 → P1 ∥ P2.1 → P2.2 → P2.3 ∥ P2.4 → P3.1 → P3.2 → P3.3 ∥ P3.4 → P4.1 → P4.2 → P4.3 ∥ P4.4 → P4.5 → P4.6 ∥ P4.7 → P5 → P6.
P5.1 und P5.2 sind ab sofort parallel möglich und hängen an nichts. P4.7 und P5.8 dürfen erst starten, wenn P2.1 stabil ist, sonst wird die Historie zweimal migriert.
Gesamtaufwand: rund 90 Personentage.

## 5. Agent-Flotte für die Umsetzung

| Agent | Effort | Zuständigkeit |
|---|---|---|
| Datenfundament | extra high | P1.1, P1.2, P1.3 — Parser, Normalisierung, Offsets |
| Schema und Vertrag | extra high | P2.1, P2.2, P2.3, P2.4 |
| Laufzeit | high | P3.1–P3.4 — SQLite-Build, Worker, Deploy |
| Entity Resolution Kern | extra high | P4.2, P4.4, P4.7 — Scoring, Relativformen, Goldbestand |
| Entity Resolution Mechanik | high | P4.1, P4.3, P4.5, P4.6 |
| Frontend Struktur | medium | P5.1, P5.3, P5.6, P5.7 |
| Frontend Fachlogik | high | P5.2, P5.4, P5.5 |
| Redaktion | extra high | P5.8 — Vier-Augen, Audit, Rollen |
| Verifikation | medium | nach jeder Phase: `test`, `lint`, `tsc`, `build`, Diff-Review, Abgleich gegen Abschnitt 14 |
| Inventar | low | Datei- und Symbolsuche auf Zuruf |

## 6. Abnahmematrix

Abschnitt 14 der Beschreibung, dreizehn Kriterien:

| Kriterium | abgedeckt durch | heute |
|---|---|---|
| jedes nummerierte Vorkommen importiert oder mit konkretem Parserfehler | P1.3, P1.4, P0.3 | teilweise, 1.154 offen, `coveragePercent` falsch |
| jede Kette positionsgenau zum Rohtext rekonstruierbar | P1.2 | **nein**, Rohform verloren (B3) |
| jede Erzählerposition mit bestätigter Identität oder sichtbarem offenem Status | P4.1–P4.5 | Status sichtbar, 76.081 `unresolved` |
| keine Beziehung, Datierung, Bewertung ohne Quellenreferenz | P2.1, P2.4, P5.2 | **nein**, B6 |
| widersprüchliche Datierungen gleichzeitig sichtbar | P1.1, P5.5 | Komponente ja, Datenbasis fehlt (B2) |
| Zeitgrafik zeigt Überlappung, Abstand, identische Intervalle | P5.5 | teilweise, nur auf Mockdaten |
| Matn-Farben in Text, Graph und Vergleich identisch | P5.4 | **nein** |
| arabische Suche mit und ohne Diakritika | P1.2 | ja, aber zwei divergierende Normalisierer |
| Teilgraphen schnell und progressiv | P3.2, P5.6 | **nein**, Button ohne Handler |
| automatische Vorschläge klar als ungeprüft markiert | vorhanden, P4.2 sichert es ab | ja, durchgängig |
| redaktionelle Entscheidungen begründet, versioniert, reversibel | P2.1, P4.5, P5.8 | nur Schema-Ansatz, kein Mechanismus |
| Parser-, Entity-, Chronologie-, Cluster-, API-, RTL-, Tastatur-, Rechte-, Performance-Tests in der CI | P0.2, P6.1 | **nein**, CI derzeit blockiert |
| Goldbestand mit vollständiger Quellen- und Kettenübereinstimmung | P4.7, P6.3 | nicht begonnen |

Abschnitt 13, elf offene Punkte: geprüfte Entity Resolution → P4.1–P4.7 · weitere Rijāl-Werke nach Rechteprüfung → P1.5, P2.4 · vollständiger Lehrer-/Schülerimport → P4.6 · stabile kanonische IDs → P2.1, P4.5 · bestätigte Matn-Cluster → P2.1, P5.8 · Matn-Farben an allen Isnād-Zweigen → P5.4 · produktive Datenhaltung → P3.1, P3.2 in der Nullkosten-Variante · Benutzerkonten und Rollen → P2.1, P5.8 · Goldbestand → P4.7 · Performance und Barrierefreiheit → P6.2 · öffentliches dynamisches Backend → P3.2.

## 7. Risiken

Vor jedem öffentlichen Deployment ist B5 ein Blocker: ohne technisches Lizenz-Gate gehen Editionsvolltexte ungeprüft hinaus, und der Browser lädt 30 MB Rohdaten direkt beim Anbieter. B6 ist ein fachlicher Fehler mit Außenwirkung, weil eine erfundene Datierung wie eine Aussage aussieht — Priorität hoch bei nur einem Tag Aufwand. P1.1 ist das Nadelöhr des ganzen Vorhabens: ohne echte Namensköpfe und Todesjahre bleiben vier der neun Entity-Resolution-Signale strukturell leer, und jede Arbeit an Scoring oder Chronologie läuft ins Nichts. Solange P0.1 nicht erledigt ist, existiert kein Rückfallpunkt für Agent-Änderungen. Und der D1-Freibetrag ist zwar großzügig, deckelt aber Zeilen-Lesevorgänge pro Tag: Volltextscans nach dem Muster von `repository.py` würden das Limit reißen, weshalb P3.1 die Indizes von Anfang an mitbauen muss.
