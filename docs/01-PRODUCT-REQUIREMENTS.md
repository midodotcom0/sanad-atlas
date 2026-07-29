# Product Requirements — Sanad Atlas Research MVP

## 1. Ziel

Sanad Atlas macht die quellengebundene Überlieferungslandschaft eines Hadith-Clusters und das Netzwerk einzelner Überlieferer navigierbar. Das MVP beweist insbesondere die bidirektionale Kopplung von Isnād und Matn sowie eine explizite Unsicherheits- und Provenance-Semantik.

## 2. Zielgruppen

1. Hadith-Forscher: prüfen Wege, Personenidentitäten, Varianten und Quellen.
2. Datenredakteure: prüfen Auflösungs- und Clustering-Vorschläge mit Audit-Trail.
3. Fortgeschrittene Lernende: erkunden Lehrer, Schüler und Sammlungen ohne einen globalen Riesengraphen.
4. Institutionen: integrieren kuratierte Teilbestände und exportieren Forschungsergebnisse.

## 3. MVP-Scope

- Demonstrationscluster „إنما الأعمال بالنيات“ mit sieben sichtbaren Wegen und mehr als 30 im Testbestand vorhandenen Personen.
- Mock-Bestand mit Bukhārī, Muslim, al-Nasāʾī und Abū Dāwūd; die fachlichen Details sind als nicht redaktionell verifiziert gekennzeichnet.
- Hadith-Graph mit zusammengeführten Kettenabschnitten, Sammlungsfilter und progressiver Offenlegung.
- Überliefererprofil und Lehrer-/Schüler-Ego-Graph mit getrennten Evidenztypen.
- Personenvergleich in den Bereichen Netzwerk, Biografie, Hadith und Jarḥ wa-Taʿdīl.
- Matn-Differenz mit bidirektionaler Hervorhebung zu den zugehörigen Graphästen.
- Quellen- und Data-Rights-Register auf Basis der zwei beigefügten PDFs.
- Tastaturbedienbare Alternativliste für Graphknoten und responsive Drawer-Navigation.

## 4. Nicht im MVP

- Kein produktiver Volltextimport und keine Aussage zu kommerziellen Nutzungsrechten.
- Keine automatische Authentizitäts- oder Personenbewertung.
- Keine endgültige Zusammenführung unsicherer Identitäten.
- Keine unbegrenzten Pfadabfragen, globale Zentralitätsberechnung oder Massendarstellung im Browser.
- Keine behauptete historische Abhängigkeit aus einer stemmatologischen Visualisierung.

## 5. Funktionale Anforderungen

| ID | Anforderung | Akzeptanzkriterium |
|---|---|---|
| FR-01 | Universelle Suche | Arabische und transliterierte Mock-Namen liefern gruppierbare Treffer. |
| FR-02 | Hadith-Teilgraph | Gemeinsame Kettenabschnitte erscheinen nur einmal; sieben Wege sind filterbar. |
| FR-03 | Evidenzsemantik | Isnād-, biografische und unsichere Kanten sind visuell und textuell unterscheidbar. |
| FR-04 | Knotennavigation | Klick oder Tastaturauswahl öffnet das Personenpanel und wird in der Historie gespeichert. |
| FR-05 | Ego-Graph | Lehrer und Schüler stehen auf getrennten Seiten des Zentralknotens. |
| FR-06 | Vergleich | Zwei Personen sind wählbar; vier Vergleichsbereiche aktualisieren sich. |
| FR-07 | Matn ↔ Isnād | Auswahl einer Matn-Variante hebt die verknüpften Graphäste hervor. |
| FR-08 | Provenance | Fachliche Aussagen zeigen Prüfstatus; fehlende Verifikation bleibt sichtbar. |
| FR-09 | Quellenregister | Werk, Autor, Priorität, Herkunft und Rechte-Status werden getrennt geführt. |
| FR-10 | RTL/LTR | Die gesamte Shell ist umschaltbar; arabische Inhaltsblöcke behalten RTL. |

## 6. Nichtfunktionale Anforderungen

- Initialer MVP-Build ohne TypeScript-Fehler.
- Teilgraph statt Vollgraph; Cytoscape wird erst clientseitig geladen.
- Tastaturfokus ist sichtbar; Motion respektiert `prefers-reduced-motion`.
- Desktop-Panel wird unter 820 px zum mobilen Drawer.
- API-Antworten tragen `dataVersion`, `editorialStatus`, `confidence` und `sources`.
- Teure Pfadabfragen haben eine harte `maxDepth`- und Ergebnisgrenze.

## 7. Fachliche Leitplanken

- Originalaussage hat Vorrang vor normalisiertem Label.
- „In konkreter Kette belegt“ und „in biografischem Werk genannt“ bleiben getrennte Assertions.
- Automatische Ergebnisse sind Vorschläge, niemals endgültige Fachentscheidungen.
- Jede Merge-Entscheidung ist reversibel und versioniert.
- Die beigefügte Ṭabaqāt-Grafik kennzeichnet ihre Einordnung selbst als annähernd/iǧtihādī; sie darf nur als Prüfhinweis dienen.

## 8. MVP-Messgrößen

- 100 % der Demo-Assertions zeigen einen Prüfstatus.
- 100 % der unsicheren Demo-Identitäten sind gestrichelt und textlich gekennzeichnet.
- Hauptansichten sind in höchstens einer Navigationsebene erreichbar.
- Graphinteraktion bleibt bei 1.000 sichtbaren Elementen auf einem Mittelklassegerät flüssig; das MVP liefert deutlich weniger.
- In Produktion: mindestens 95 % sichtbare Kanten mit direktem Quellenbeleg, Zielwert 100 % für redaktionell freigegebene Kanten.
