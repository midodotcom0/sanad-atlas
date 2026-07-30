# Sanad Atlas — أطلس الإسناد

Arabische, RTL-first Forschungsplattform für die Vorkommen, Isnād-Wege, Matn-Fassungen und Erzähler in Ṣaḥīḥ al-Bukhārī und Ṣaḥīḥ Muslim.

Die Anwendung trennt konsequent zwischen unverändertem Rohimport, maschinell abgeleiteten Daten und redaktionell freigegebenen Assertions. Automatische Identitäten, Beziehungen und Cluster sind sichtbar, werden aber niemals als geprüft ausgegeben.

Live-Demo: `https://midodotcom0.github.io/sanad-atlas/`

## Aktueller, reproduzierbarer Datenstand

- 7.291 Bukhārī-Vorkommen, darunter alle 7.124 Nummern der eingebundenen Edition;
- 5.775 Muslim-Vorkommen bzw. Wege für 2.974 Hauptnummern;
- 77.566 extrahierte Erzählerpositionen, zunächst sämtlich ungeklärt;
- 9.247 Einträge aus *Tahdhīb al-Tahdhīb*, 9.212 aus *Mīzān al-Iʿtidāl* und 8.646 ergänzende Taqrīb-Einträge;
- 1.154 schwach oder nicht parsebare nummerierte Vorkommen in einer expliziten Review-Queue statt stiller Verwerfung.

Die Zahlen werden durch `npm run import:turath` neu erzeugt. [`completeness.json`](./public/data/corpus/completeness.json) weist jedes importierte nummerierte Vorkommen oder seinen konkreten Parserfehler aus. Die Turath-Editionstexte bleiben wegen der editionsbezogenen Rechteprüfung im lokalen Cache und werden nicht ins Repository aufgenommen.

## Webanwendung

```bash
npm install
npm run dev
```

Danach `http://localhost:3000/hadith` öffnen. Die wichtigsten Ansichten sind:

- `/library` — cursorpaginierte Suche durch alle importierten Hadith-Vorkommen und alle Quelleneinträge aus Tahdhīb, Mīzān und Taqrīb, mit/ohne Diakritika;
- `/hadith?record=…` — positionsgenaue Visualisierung einer importierten Kette; jeder Erzählerknoten öffnet die quellengetrennte Kandidatensuche;
- `/narrators/lookup?name=…` — gerankte, ausdrücklich ungeklärte Identitätskandidaten aus allen drei Rijāl-Werken;
- `/rijal/entry?entry=…` — anklickbarer Einzelbeleg mit Lehrer-/Schülerphrase, Seitenangabe, Datenversion und Link zum Quellort;
- `/narrators/yahya` und `/network` — Personen- und Ego-Netz;
- `/compare` — mehrspurige AH-Zeitachse ohne Mittelwertbildung;
- `/variants` — gekoppelte Matn-/Isnād-Analyse;
- `/sources` — Source Registry und Rechte-Gate;
- `/editor` — reversible Identitäts-, Datierungs-, Relations- und Clusterentscheidungen.

Wird `NEXT_PUBLIC_API_URL` gesetzt, bezieht die Bibliotheksansicht paginierte Treffer aus der Forschungs-API. Ohne diese Variable bleibt die GitHub-Pages-Demo statisch und liest Editionstext nur auf ausdrückliche Nutzeraktion direkt beim Provider.

## Forschungs-API

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
PYTHONPATH=backend .venv/bin/uvicorn app.main:app --reload
```

Die versionierten Endpunkte liegen unter `/api/v1`; die vollständige Spezifikation steht in [`docs/06-API-SPECIFICATION.yaml`](./docs/06-API-SPECIFICATION.yaml). `/api/v1/identity-candidates` durchsucht Tahdhīb, Mīzān und Taqrīb gemeinsam, bevorzugt Treffer im Namenstitel gegenüber bloßen Textnennungen und erzeugt ausdrücklich keine kanonische Identität. Der lokale JSON-Adapter liest unveränderliche Importergebnisse. Im Produktionsbetrieb wird er durch PostgreSQL ersetzt; Graph- und Suchindizes bleiben regenerierbare Projektionen.

## Import

```bash
npm run import:turath
```

Der Importer lädt bei Bedarf die registrierten Turath-Werke 735, 1727, 1278, 1692 und 8609, speichert Rohdateien unverändert unter `.cache/turath/` und schreibt versionierte Ableitungen nach `.cache/turath-derived/`. Sanadset und Multi-IsnadSet sind mit verifizierten Lizenz- und Herkunftsangaben im Source Registry eingetragen; ihre großen Originaldateien werden nicht ins Git-Repository vendort.

## Verifikation

```bash
npm run import:test
npm run test
npm run test:backend
npm run lint
npm run build
```

Das Zielschema steht in [`database/schema.sql`](./database/schema.sql). Es enthält getrennte Tabellen für Hadith-Vorkommen, Nummerierungsaliasse, einzelne Ketten, Erzählerpositionen, Identitätskandidaten und -entscheidungen, Matn-Familien, Datierungen, Beziehungen, Begegnungen, Bewertungen, Quellenpassagen, Import-Batches und reversible redaktionelle Revisionen.

## Noch nicht als abgeschlossen behauptet

Der aktuelle Import ist maschinell und kein wissenschaftlich kuratierter Vollbestand. Insbesondere sind Entity Resolution, semantische Clusterfreigabe, der manuell kontrollierte Goldbestand sowie die produktiven Supabase-, Neo4j-, Elastic-, Redis- und Sentry-Instanzen noch nicht eingerichtet. Die Oberfläche erzeugt keine eigene Hadith-Authentifizierung und keine abschließende Zuverlässigkeitsbewertung.
