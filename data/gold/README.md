# P4.7 – Goldbestand für Entity Resolution

## Ehrlicher Status

`hadith-occurrences.frame.json` und `narrator-forms.frame.json` sind
**Stichprobenrahmen, keine Golddaten**. Sie enthalten 250 gezogene
Erzählerpositionen beziehungsweise 100 distinkte normalisierte Namensformen.
Die Formen sind vor der Annotation noch nicht zu Personen aufgelöst. Deshalb
darf der zweite Rahmen bis zur Adjudikation nicht als „100 bestätigte
Erzähler“ bezeichnet werden.

Stand dieses Verzeichnisses:

- Die Ziehung ist deterministisch und gegen die lokalen Korpusdaten prüfbar.
- Beide Rahmen sind nach Namenslänge, Kunya, Nisba, Relativform und dem
  operationalen Homonym-Proxy geschichtet.
- A1, A2, Adjudikation und Resolver-Vorhersagen fehlen noch.
- Folglich sind Übereinstimmungsmaß, Präzision und Recall **nicht bestimmt**.
- `rijal-name-heads.*` und `tahdhib-death-year.*` gehören zur manuellen
  P1.1-Prüfung. Sie erfüllen P4.7 nicht und werden in der P4.7-Auswertung nicht
  mitgezählt.

Der Homonym-Marker `H1` bedeutet nur: Die normalisierte Form hat mindestens
zwei exakte Zeichenkettentreffer gegen Rijāl-Köpfe. Das ist ein reproduzierbarer
Sampling-Proxy, noch kein fachliches Homonymurteil. Kunya und Nisba sind
ebenfalls Oberflächenmerkmale der Ziehung. Die späteren Goldurteile dürfen
diese Flags korrigieren.

## Dateien und Rollen

| Datei | Rolle |
|---|---|
| `hadith-occurrences.frame.json` | 250 zu annotierende Positionen mit Kettenkontext |
| `narrator-forms.frame.json` | 100 zu annotierende distinkte Formen |
| `annotation.schema.json` | maschinenprüfbarer Vertrag für A1/A2, Adjudikation und Vorhersagen |
| `*.template.json` | leere Beispiele; niemals als fertige Annotation zählen |
| `check-gold.mjs` | Integritätsprüfung, Agreement und Metriken |

Produktive Dateien haben je Aufgabe folgende Namen:

```text
hadith-occurrences.annotation-a1.json
hadith-occurrences.annotation-a2.json
hadith-occurrences.adjudication.json
narrator-forms.annotation-a1.json
narrator-forms.annotation-a2.json
narrator-forms.adjudication.json
resolver-predictions.json
```

## Annotationsprotokoll

1. A1 und A2 erhalten denselben Rahmen, aber weder die andere Annotation noch
   Resolver-Vorhersagen. Die Verblindung ist ein organisatorisches Verfahren;
   das Prüfskript kann nur die entsprechende Selbsterklärung kontrollieren.
2. Jede Personenzuordnung braucht mindestens einen konkreten
   `evidenceReference`-Eintrag. Eine Ähnlichkeit oder eine bloß mögliche
   Chronologie ist kein Beleg.
3. Zulässige Goldentscheidungen:
   - `linked`: genau eine stabile kanonische Personen-ID samt Revision;
   - `ambiguous`: die Quellen erlauben keine eindeutige Person;
   - `not-a-narrator`: der Parserrahmen enthält an dieser Stelle keinen
     Erzähler;
   - `invalid-frame`: der Rahmen ist technisch nicht beurteilbar.
4. Die Adjudikationsdatei enthält **jede** gezogene ID. Bei identischen
   Einzelurteilen lautet `method` `agreement`; sonst `adjudicated` und ein
   dritter fachlicher Bearbeiter mit Begründung ist Pflicht.
5. Erst danach wird der Resolver unverändert auf den eingefrorenen Rahmen
   ausgeführt. Seine Ausgabe kommt in `resolver-predictions.json`.

`linked` darf nicht aus `exactHeadMatches`, Resolver-Scores oder der
Importer-Ausgabe kopiert werden. Diese Felder sind nur Such- und
Vergleichshilfen.

## Agreement und Metriken

Das Prüfskript berichtet:

- Cohen-κ für die vier Entscheidungsklassen von A1 und A2;
- exakte Übereinstimmung der vollständigen Goldlabels, wobei
  `linked:<Personen-ID>@r<Revision>` verschiedene Personen und Revisionen
  unterscheidet;
- Link-Präzision und Link-Recall des Resolvers, ungewichtet und mit dem
  Ziehungsgewicht;
- die Metriken für jede vollständige Samplingzelle sowie für die
  aussagekräftigen Randstrata `length`, `kunya`, `nisba`, `relative` und
  `homonym`;
- Coverage und Abstentionsrate, damit gute Präzision nicht durch nahezu
  vollständige Abstinenz erkauft werden kann.

Ein falscher Personenlink zählt als ein False Positive **und** ein False
Negative. `ambiguous`, `not-a-narrator` und `invalid-frame` erzeugen keinen
positiven Goldlink. Wo der Nenner null ist, bleibt die Metrik `null`; sie wird
nicht als 0 oder 1 ausgegeben.

## Aufruf und CI-Gate

```bash
# Rahmen und aktuellen Bearbeitungsstand prüfen; fehlende Fachannotation ist
# sichtbar, aber dieser Audit-Modus bleibt erfolgreich.
node data/gold/check-gold.mjs

# Abnahme-Gate: verlangt A1, A2, vollständige Adjudikation und Vorhersagen.
node data/gold/check-gold.mjs --strict
```

`--strict` ist der für die CI bestimmte Befehl. Solange die menschliche
Doppelannotation fehlt, muss er rot sein. Er darf erst in den Workflow
aufgenommen werden, wenn die sieben produktiven Dateien vorliegen; andernfalls
wäre jede grüne P4.7-Behauptung falsch.
