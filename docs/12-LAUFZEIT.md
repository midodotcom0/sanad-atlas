# 12 — Laufzeit: Worker, D1, Deploy und Rollback

Stand: 30. Juli 2026 · Pakete P3.2 und P3.4 des Umsetzungsplans (`docs/10-UMSETZUNGSPLAN.md`)
Harte Randbedingung: **der Betrieb muss dauerhaft kostenlos bleiben.** Alles unten ist an dieser Bedingung ausgerichtet, nicht an Bequemlichkeit.

---

## 1. Was wo läuft

| Baustein | Ort | Kosten |
|---|---|---|
| Statische Oberfläche (Next-Export) | GitHub Pages | frei |
| API, 14 Endpunkte plus `/health` und `/api/v1/narrators/{id}/paths` | **ein** Cloudflare Worker | frei bis 100.000 Anfragen/Tag, 10 ms CPU je Aufruf |
| Fachliche Quelle der Wahrheit | Cloudflare D1 (`atlas.db`, 433,86 MB = 8,47 % des 5-GB-Kontingents) | frei bis 5 Mio. Zeilen-Lesevorgänge/Tag |
| Import, Parser, Bau von `atlas.db` | GitHub Actions | für öffentliche Repositorys frei |
| FastAPI (`backend/`) | **nicht** ausgeliefert | — |

`backend/` bleibt ausschließlich Referenzimplementierung für den Contract-Test (`tests/worker-contract.check.mjs`). Kein Deployment-Pfad führt dorthin.

### Dateien

```
worker/
  wrangler.toml                     Cloudflare-Konfiguration, Platzhalter statt Zugangsdaten
  src/index.mjs                     Cloudflare-Einstiegspunkt (der EINZIGE Ort mit `env`)
  src/adapters/d1-adapter.mjs       D1  -> all()/get()
  src/adapters/node-sqlite-adapter.mjs  node:sqlite -> all()/get()  (nur Tests, lokal)
  src/core/**                       portable Fachlogik, weiß nichts von Cloudflare
  src/core/release.mjs              Release-Zeiger lesen, Umschalt-SQL erzeugen
  tools/atlas-release.mjs           Release vorbereiten, auflisten, aktivieren, zurückrollen
  tools/release-dryrun.mjs          Nachweis der Versionsumschaltung ohne Cloudflare
  tools/query-plan-audit.mjs        Nachweis, dass keine Abfrage scannt
```

Der Schnitt ist bewusst: `src/core/**` ist ohne wrangler ausführbar und wird deshalb feldweise gegen FastAPI geprüft. `src/index.mjs` enthält nichts, was ein Test prüfen könnte, außer der Verdrahtung.

---

## 2. Warum kein Hono

Der Umsetzungsplan nennt in P3.2 „Worker-API (Hono)". Umgesetzt ist ein abhängigkeitsfreier Router (`worker/src/core/router.mjs`). Begründung:

1. **`npm install` ist in dieser Arbeitsumgebung nicht verlässlich verfügbar.** Eine Abhängigkeit, die sich nicht installieren lässt, macht den Kern unprüfbar — und ein unprüfbarer Router ist unter der P3.2-Abnahme („Contract-Test vergleicht Worker- und FastAPI-Antwort feldweise") wertlos.
2. **Der Vergleich mit `backend/app/main.py` bleibt so überhaupt lesbar.** Die Routentabelle in `router.mjs` steht in derselben Reihenfolge und mit denselben Grenzen wie die `@app.get(...)`-Dekoratoren der Referenz; eine Abweichung ist im Diff sichtbar. Durch eine Framework-Schicht hindurch wäre dieser Abgleich Interpretation statt Ablesen.
3. **Hono löst hier kein vorhandenes Problem.** Gebraucht werden Pfadabgleich, Query-Parameter und JSON — alles davon ist Web-Standard (`Request`, `Response`, `URL`), global sowohl in Node ≥ 18 als auch in Workers. Der Router ist 189 Zeilen; ein Framework dafür wäre mehr Code, nicht weniger.
4. **Nullkosten heißt auch Nulllieferkette.** Jede Abhängigkeit im Auslieferungspfad ist eine Versions-, Sicherheits- und Verfügbarkeitsannahme, die dieses Projekt nicht braucht.

Falls Hono später doch gewünscht ist: der Wechsel betrifft nur `router.mjs` und `index.mjs`; `queries/**`, `envelope.mjs` und `license-gate.mjs` bleiben unberührt.

---

## 3. Was der Betreiber selbst setzt

**Im Repository stehen keine Zugangsdaten, keine Account-ID und keine echte `database_id`** — `worker/wrangler.toml` enthält an dieser Stelle `PLACEHOLDER_D1_DATABASE_ID`, den der Workflow zur Laufzeit im Arbeitsbaum des Runners ersetzt und nie zurückschreibt.

Einmalig, von Hand:

```bash
# 1. D1-Datenbank anlegen (kostet nichts, keine Kreditkarte)
npx wrangler d1 create sanad-atlas
#    -> gibt die database_id aus; NICHT ins Repository schreiben
```

Danach drei GitHub-Secrets unter *Settings → Secrets and variables → Actions*:

| Secret | Woher | Wofür |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare-Dashboard → API Tokens; Rechte: *Workers Scripts: Edit*, *D1: Edit* | Deploy und D1-Zugriff |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare-Dashboard, Übersichtsseite | wrangler liest es aus der Umgebung |
| `ATLAS_D1_DATABASE_ID` | Ausgabe von `wrangler d1 create` | ersetzt den Platzhalter in `wrangler.toml` |

Fehlt eines davon, läuft der Workflow **vollständig durch und überspringt genau die Cloudflare-Schritte** — mit einer `::warning::`-Meldung im Protokoll. Er wird nicht rot, damit ein fehlendes Secret nicht wie ein Codefehler aussieht; und er wird nicht still grün, damit „ist deployt" nicht ungeprüft behauptet wird.

Eigene Domain (optional): den `[[routes]]`-Abschnitt in `wrangler.toml` einkommentieren und das Muster einsetzen. Ohne eigene Domain bleibt `workers_dev = false` und die Route wird im Dashboard gesetzt.

---

## 4. Release: Datenversion und Indexversion sind ein Paar (P3.4)

Zwei Versionen, die getrennt gehören und trotzdem nie getrennt ausgeliefert werden dürfen:

| | Bedeutung | Quelle |
|---|---|---|
| `dataVersion` | Fingerabdruck des **Korpus** | `public/data/corpus/manifest.json` (Agent 1) |
| `indexVersion` | Fingerabdruck der **Indexerzeugung**: übersetztes Schema plus die vier Bauskripte, die Zeilenform, IDs, Normalisierung und Projektionen bestimmen | `scripts/atlas-build-lib.mjs:computeIndexVersion()` |

`releaseId = dataVersion + "+" + indexVersion`. Beispiel aus dem aktuellen Baustand:

```
turath-5aa44bb55b758d6d9f0d+idx-e2c37f7e7ebe57dc2944
```

Warum nicht die sha256 der fertigen Datei als Indexversion? Eine Datei kann ihren eigenen Hash nicht enthalten. Die Version muss **vor** dem Schreiben feststehen, damit der Worker sie aus der Datenbank lesen kann. Der Dateihash bleibt zusätzlich im Baubericht (`worker/atlas.db.manifest.json`) als Integritätsnachweis.

### Der Zeiger liegt in der Datenbank, nicht im Code

`atlas_release` (angelegt in `scripts/atlas-build-lib.mjs`) hält eine Zeile je Release; genau eine ist aktiv, erzwungen durch einen partiellen UNIQUE-Index:

```sql
CREATE UNIQUE INDEX atlas_release_single_active_idx ON atlas_release (is_active) WHERE is_active = 1;
```

`worker/src/core/release.mjs` liest genau diese Zeile. Daraus folgt alles Weitere:

- **Umschalten ist ein `UPDATE`,** kein neuer Codestand: kein Worker-Deploy, kein Pages-Build.
- **Daten- und Indexversion können nicht auseinanderlaufen:** sie stehen in derselben Zeile.
- Kosten: **ein** Zeilen-Lesevorgang je Isolate-Lebensdauer, nicht je Anfrage (60 s Zwischenspeicher im Modulzustand). Der Preis dafür ist, dass ein Rollback nicht in derselben Millisekunde greift, sondern innerhalb dieser Frist — bewusst so, weil die Alternative ein zusätzlicher Zeilen-Lesevorgang auf *jeder* Anfrage wäre.
- Fällt die Tabelle weg (ältere `atlas.db`), fällt der Worker sichtbar auf `atlas_build_info` zurück und meldet `indexVersion: null` — **kein erfundener Wert**.

Nachprüfbar von außen, an genau zwei Stellen:

```
GET  <worker>/health                 -> { dataVersion, indexVersion, releaseId, releaseActivatedAt, releasePointer }
GET  <pages>/atlas-release.json      -> derselbe Zeiger, mit der Seite veröffentlicht
     jede Antwort trägt zusätzlich   x-atlas-release / x-atlas-data-version / x-atlas-index-version
```

Die Antwort-Hülle der 14 Fachendpunkte trägt weiterhin **nur** `dataVersion` — feldgleich zur FastAPI-Referenz. Die Indexversion läuft über `/health` und die Kopfzeilen, damit der Vertrag unverändert bleibt.

### Rollback in einem Schritt

```bash
# lokal, gegen eine SQLite-Datei
npm run atlas:release -- list --db worker/atlas.db
npm run atlas:release -- rollback --db worker/atlas.db            # Vorgängerversion
npm run atlas:release -- rollback --db worker/atlas.db --to <id>   # bestimmte Version

# gegen D1 (ein Schritt, über die Actions-Oberfläche)
#   Actions -> "Deploy Sanad Atlas (Pages + Worker/D1)" -> Run workflow
#   Feld "rollback_to" = releaseId
# oder von Hand:
npm run atlas:release -- activate <releaseId> --sql-only > rollback.sql
npx wrangler d1 execute sanad-atlas --remote --file=rollback.sql
```

Das Rollback-**Ziel** ist definiert als „das zuletzt aktiv gewesene Release, das gerade nicht aktiv ist" (`activated_at` bleibt beim Deaktivieren stehen). Nie aktivierte Releases sind kein Rollback-Ziel — ein Zurückrollen auf einen nie ausgelieferten Stand wäre ein Vorwärtsschritt mit falschem Namen.

Beide `UPDATE`s stehen in **einer** Datei und laufen als ein `wrangler d1 execute --file`-Batch. Ein Rollback auf ein nicht registriertes Release bleibt nicht still wirkungslos: `atlas-release.mjs` prüft die Registrierung vorher, und selbst ohne diese Prüfung endet der Zustand als „kein aktives Release" — sichtbarer Fehler statt falsch ausgeliefertem Stand.

**Voraussetzung, die hier klar benannt sein muss:** die Umschaltung wechselt den *Zeiger*, nicht die *Zeilen*. Zwei vollständige Korpusstände nebeneinander in derselben D1-Datenbank sind mit dem heutigen ID-Schema nicht möglich (`hadith_record.id` enthält die Datenversion nicht, gleiche Datensätze zweier Stände kollidieren also im Primärschlüssel). Ein Rollback, der auch die *Daten* zurückholt, ist deshalb: `rollback_to` setzen **und** — falls sich `dataVersion` mitgeändert hat — den D1-Ladevorgang des Vorgängerreleases wiederholen. Wenn sich nur die Indexversion geändert hat (der Regelfall bei Codeänderungen), genügt die Umschaltung allein.

---

## 5. Zeilen-Lesebudget von D1

D1 deckelt **Zeilen-Lesevorgänge**, nicht Anfragen: 5 Mio./Tag. Eine einzige scannende Abfrage kostet mehr als tausend indexgebundene. `worker/tools/query-plan-audit.mjs` lässt `EXPLAIN QUERY PLAN` über genau die Abfragen laufen, die `worker/src/core/**` stellt, und schlägt fehl bei einem Volltabellenscan **oder** einem „AUTOMATIC INDEX" (Wegwerfindex je Anfrage — der teuerste Befund, weil er die ganze Tabelle liest).

```bash
npm run atlas:audit
```

Zwei dabei gefundene und behobene Befunde, mit gemessenen Zahlen:

**(a) Namensabfrage ohne Statistik.** `name_head_normalized = ?` über die Sicht `rijal_entry_ref` wählte ohne `sqlite_stat1` den Weg `source_work → rijal_entry_number_idx` und las damit **alle 34.045** Rijāl-Einträge für eine einzige Namenssuche — rund 145 Anfragen bis zum Tagesbudget. Behoben durch `ANALYZE` am Ende des Baus (`scripts/atlas-build-lib.mjs`, Kosten 76 ms): der Planer wählt jetzt `rijal_entry_name_head_idx` und liest eine Handvoll Zeilen. `ANALYZE` ist deterministisch — `sqlite_stat1` hängt nur an den deterministisch eingefügten Daten.

**(b) Wegwerfindex in der Traversierung.** Der rekursive Zweig verbindet über `(e.source_node_id = w.target_node_id AND e.relationship_type = ?)`. Keiner der bestehenden Indizes deckte beide Gleichheiten ab, also baute SQLite bei **jeder** Anfrage eine `AUTOMATIC PARTIAL COVERING INDEX` über alle 147.458 Kanten:

| | Laufzeit der Traversierung |
|---|---|
| ohne `edge_projection_source_rel_idx` | **2.929 ms**, Vollzugriff auf die Projektion |
| mit `edge_projection_source_rel_idx` | **7 ms**, indexgebundener Teilzugriff |

Gemessen am am stärksten vernetzten Knoten des Korpus (`UNC-3c5a02862689`, 6.474 Kanten, davon 438 in Richtung `transmitted_from`), `maxDepth = 8`, Grenze 500 Kanten. 2,9 s sind das 290-fache des 10-ms-CPU-Budgets eines Worker-Aufrufs; das Tagesbudget wäre mit rund 30 Traversierungen erschöpft gewesen. Behoben durch einen deckenden Index in `createEdgeProjectionIndexes()`.

Eine verbleibende, bewusst in Kauf genommene Ausnahme: **Kandidatenstufe 3** (`name_head_normalized LIKE '%…%'`) scannt den Namensindex. Ein Teilstring in der Wortmitte ist mit einem B-Baum nicht adressierbar; die FastAPI-Referenz macht an dieser Stelle dasselbe (`repository.py:476`, `wanted in name` über alle Einträge), und ein Umbau auf FTS5 würde die Trefferbedeutung von „Teilstring" zu „Token" ändern — also den Vertrag brechen. Die Stufe läuft nur, wenn die beiden indexgebundenen Stufen davor die gewünschte Trefferzahl nicht erreichen. Der Audit gibt sie mit ausdrücklicher Begründung frei, nicht pauschal.

---

## 6. Harte Traversierungsgrenzen

`docs/04-GRAPH-SCHEMA.md:121-122` schreibt vor: `neighbors` höchstens 500 Kanten pro Seite, `paths` `maxDepth <= 8`, höchstens 100 Pfade, Zeitschranke 2 s interaktiv. Umsetzung in `worker/src/core/graph-traversal.mjs`:

- `MAX_DEPTH_HARD_LIMIT = 8` — angefordert 99, wirksam 8 (der Router deckelt zusätzlich auf `max: 8`).
- `MAX_EDGES_HARD_LIMIT = 500` als **globale** Ausführungsschranke. Der Plan bestätigt `CO-ROUTINE walk`: die Rekursion wird träge ausgewertet und bricht ab, sobald 500 Zeilen erzeugt sind — keine nachträgliche Kappung einer vollständig berechneten Menge. Die 100-Pfade-Grenze ist damit automatisch mit abgedeckt (jeder Pfad besteht aus mindestens einer Kante).
- Zyklenschutz über eine mitgeführte `path`-Zeichenkette und `instr(...)`; SQLite erkennt Zyklen in `WITH RECURSIVE` nicht selbst.
- Gemessen am Extremfall: 32 ms Gesamtlaufzeit des Endpunkts (7 ms SQL), 318 Knoten, 500 Kanten, `truncated: true`.

`npm run atlas:audit` prüft alle vier Punkte und schlägt fehl, wenn einer nicht greift.

---

## 7. Der Workflow

`.github/workflows/deploy-pages.yml`, ein Job `build` plus `deploy` (Pages) plus ein eigener Job `rollback`.

```
Korpus aus Cache oder neu ableiten
  -> npm run test / test:backend / import:test
  -> npm run atlas:build            (atlas.db, ~434 MB, entsteht IM Job)
  -> npm run test:atlas             (Schema, IDs, Normalisierungsparität, Determinismus)
  -> npm run test:worker            (Contract-Test gegen FastAPI, 24 Fälle)
  -> npm run atlas:audit            (Zeilenbudget, Traversierungsgrenzen)
  -> npm run atlas:rollback:dryrun  (Versionsumschaltung, ohne Cloudflare)
  -> Release vorbereiten            (Datenversion + Indexversion als ein Paar)
  -> npm run build + out/atlas-release.json
  -> [nur mit Secrets] atlas.db nach D1, Release registrieren, aktivieren, Worker ausrollen
```

Beachtete Grenzen:

- **`atlas.db` geht nie in ein Artefakt.** 434 MB zählen gegen das Speicherkontingent des Kontos, und die Datei ist aus denselben Eingaben deterministisch reproduzierbar (Abnahme P3.1: zwei Läufe, bitgleiche Prüfsumme). Deshalb läuft der einzige Schritt, der sie braucht — der D1-Ladevorgang — im **selben** Job. Als Artefakt gehen nur die Release-Metadaten (ein JSON, zwei SQL-Dateien, 14 Tage).
- **Der Korpusabruf wird zwischengespeichert** (`actions/cache`, Schlüssel über Importer und Quellenregistrierung). Er ist der langsamste Schritt; alles andere liegt im Sekundenbereich (Bau von `atlas.db` lokal gemessen: 6,0 s).
- **`cancel-in-progress: false`** (vorher `true`). Ein laufendes Release oder ein laufender Rollback darf nicht von einem nachfolgenden Push abgebrochen werden, sonst kann D1 mit einem halb umgeschalteten Zeiger stehenbleiben.
- **Der D1-Massenimport** geht über `wrangler d1 import` (zerlegt die Datei selbst und lädt sie über die D1-Import-API), nicht über `d1 execute --file` — das ist für einzelne Anweisungen gedacht, nicht für diese Größe.

---

## 8. Was real erprobt ist und was nur trocken

**Real ausgeführt und mit Zahlen belegt** (lokal, gegen die echte `atlas.db` mit 13.066 Hadith-Datensätzen, 34.045 Rijāl-Einträgen, 147.458 Kanten):

- der Bau von `atlas.db` inklusive Determinismusnachweis;
- alle 24 Fälle des Contract-Tests gegen `backend/app/repository.py`;
- die Abfragepläne aller Worker-Abfragen und die vier Traversierungsgrenzen;
- die Versionsumschaltung und der Rollback als Datenbankoperation — inklusive des Nachweises, dass zwei gleichzeitig aktive Releases von der Datenbank abgelehnt werden;
- `worker/tools/atlas-release.mjs` in allen Unterbefehlen (`prepare`, `list`, `activate`, `rollback`, `--sql-only`), gegen echte SQLite-Dateien.

**Nur trocken belegt, weil dafür Cloudflare-Zugangsdaten nötig sind, die nicht existieren:**

- `wrangler deploy`, `wrangler d1 import`, `wrangler d1 execute --remote` — kein einziger dieser Aufrufe ist ausgeführt worden;
- das Verhalten des D1-Adapters gegen echtes D1 (`bind()/all()/first()`); geprüft ist nur, dass `worker/src/core/**` unverändert gegen die zweite Adapterimplementierung läuft;
- die Zeit- und Größengrenzen des D1-Massenimports für einen 434-MB-Bestand;
- die tatsächlichen Zeilen-Lesevorgänge in D1. Belegt ist der Abfrageplan, nicht die Abrechnung.

Der Trockenlauf (`npm run atlas:rollback:dryrun`) ersetzt genau **einen** Baustein — das D1-Binding — durch eine lokale SQLite-Datei und lässt alles andere echt: dieselbe DDL, dasselbe Umschalt-SQL, dieselbe Leselogik des Workers, denselben Router. Sieben Schritte, Exit-Code 0 nur wenn alle greifen.

---

## 9. Offene Abweichung zur Referenz

**Fachliche Aussage hartcodiert in einer Antwort, mit veralteten Zahlen.** `backend/app/repository.py:832-836` gibt für einen Erzähler ohne Datierungsangabe zurück:

> „… (aktuell nur ein kleiner Bruchteil der 27.105 Einträge mit erkanntem Todesjahr, Geburtsjahr wird derzeit gar nicht extrahiert …)"

Beides stimmt am aktuellen Bestand nicht mehr, gemessen an `atlas.db`:

| Behauptung | gemessen |
|---|---|
| 27.105 Einträge | **34.045** (`rijal_entry`) |
| „ein kleiner Bruchteil" mit Todesjahr | **4.951** = 14,5 % |
| „Geburtsjahr wird gar nicht extrahiert" | **281** Einträge mit Geburtsjahr |

Der Worker gibt diesen Text derzeit **wortgleich** aus (`worker/src/core/queries/narrators.mjs`, mit Kommentar an der Stelle), weil P3.2 Feldgleichheit verlangt und der Worker die Referenz nicht einseitig korrigieren darf. `backend/` gehört nicht zur Dateihoheit dieses Pakets.

Vorschlag zur Behebung: die Zahl aus der Datenbasis ableiten statt sie in den Text zu schreiben, oder — sauberer — sie ganz aus der Meldung nehmen und stattdessen als Feld ausliefern (`coverage: { rijalEntries, withDeathYear, withBirthYear }`). Bis dahin bleibt der Worker wortgleich.

**Zweite Beobachtung, nicht geändert:** `evidenceKind` trägt in den API-Antworten von *beiden* Seiten den Wert `isnad_occurrence` (`repository.py:590,771` und der Worker-Port). Projektweit gilt laut `database/schema.sql:56` das Vokabular `isnad_link | rijal_statement | chronology_only`; `edge_projection.evidence_kind` ist in `atlas.db` korrekt mit `isnad_link` belegt. Die Abweichung liegt also nur in der Antwortdarstellung und ist auf beiden Seiten identisch — der Contract-Test kann sie deshalb nicht sehen. Eine Korrektur muss auf beiden Seiten gleichzeitig erfolgen und ist damit eine Vertragsänderung, keine Worker-Änderung.

---

## 10. Kurzreferenz

```bash
npm run atlas:build                                  # atlas.db bauen (~6 s)
npm run test:worker                                  # Contract-Test gegen FastAPI (24 Fälle)
npm run test:atlas                                   # Schema, IDs, Parität, Determinismus
npm run atlas:audit                                  # Zeilenbudget und Traversierungsgrenzen
npm run atlas:rollback:dryrun                        # Versionsumschaltung nachweisen
npm run atlas:release -- prepare --db worker/atlas.db # Release-Artefakte erzeugen
npm run atlas:release -- list --db worker/atlas.db    # Releases, aktives markiert
npm run atlas:release -- rollback --db worker/atlas.db
```

Scratch-Artefakte des Baus (`worker/*.db`, `worker/atlas.db.manifest.json`, `worker/release/*`) sind über `.gitignore` bzw. `worker/release/.gitignore` ausgeschlossen und gehören nicht ins Repository.
