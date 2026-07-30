# Graphschema

## Knoten

`Narrator`, `NarratorOccurrence`, `HadithRecord`, `HadithCluster`, `MatnVariant`,
`IsnadChain`, `Book`, `Chapter`, `Edition`, `Scholar`, `SourcePassage`, `RijalEntry`,
`Place`, `IdentityCandidate`.

`Narrator` wird nach außen über `stable_key` (`SA-P-<base32(8)>`) plus `revision`
adressiert, nicht über die interne uuid. Absorbierte Schlüssel bleiben über
`narrator_id_redirect` auflösbar. `RijalEntry` ist ein Quelleneintrag aus Tahdhīb,
Mīzān oder Taqrīb und ausdrücklich keine Person — die Verbindung zu `Narrator`
bleibt ein Vorschlag, bis ein Editor sie entscheidet.

## Primäre Kanten

| Kante | Quelle → Ziel | Bedeutung | Tabelle |
|---|---|---|---|
| `NARRATED_FROM_OCCURRENCE` | Narrator → Narrator | Aus mindestens einer konkreten Kettennachbarschaft abgeleitet. | `relationship_assertion` mit `evidence_kind='isnad_link'` |
| `TEACHER_ASSERTION` | Narrator → Narrator | In biografischer Quelle als Lehrerbeziehung genannt. | `relationship_assertion` mit `evidence_kind='rijal_statement'` |
| `CONTEMPORARY_POSSIBLE` | Narrator → Narrator | Nur zeitlich möglich. Kein Beleg für Hören oder Überlieferung. | `relationship_assertion` mit `evidence_kind='chronology_only'` |
| `APPEARS_IN_CHAIN` | Narrator → IsnadChain | Aufgelöste Person kommt an einer konkreten Position vor. | `narrator_occurrence` |
| `MEMBER_OF_CLUSTER` | HadithRecord → HadithCluster | Redaktionell oder maschinell vorgeschlagene Clusterzuordnung. | `cluster_membership` |
| `HAS_TEXT_VARIANT` | HadithCluster → MatnVariant | Matn-Familie mit stabilem Farbcode. | `matn_variant` |
| `EVALUATED_BY` | Narrator → Scholar | Kritikeraussage mit Originalpassage. | `grade_assertion` |
| `MENTIONED_IN` | Entity → SourcePassage | Nachweisbare Erwähnung, zusätzlich zur Pflichtquelle. | `evidence_link` |
| `LIVED_IN` | Narrator → Place | Zeitlich qualifizierte Ortsassertion. | `narrator_place_assertion` |
| `DATED_BY` | Narrator → SourcePassage | Datierungsaussage ohne Mittelwertbildung. | `date_assertion` |
| `POSSIBLY_IDENTICAL_TO` | Occurrence → Narrator \| RijalEntry | Nicht endgültig aufgelöster Kandidat. | `identity_candidate` |
| `REDIRECTS_TO` | Narrator → Narrator | Bei Merge absorbierte kanonische ID. | `narrator_id_redirect` |

## Pflichtattribute jeder fachlichen Kante

```json
{
  "assertionId": "uuid",
  "evidenceKind": "isnad_link | rijal_statement | chronology_only",
  "sourcePassageId": "uuid",
  "confidenceLevel": "verified | high | medium | low | unresolved | conflict",
  "confidenceScore": 0.0,
  "origin": "machine | editorial | registry",
  "extractionMethod": "manual | parser | entity_resolution_model",
  "parserVersion": "string|null",
  "reviewStatus": "machine_unreviewed | in_review | accepted | rejected | superseded",
  "reviewedBy": "uuid|null",
  "lastReviewedAt": "timestamp|null",
  "validTimeRange": { "fromAh": null, "toAh": null },
  "dataVersion": "string",
  "chainPosition": { "chainId": "uuid|null", "position": 0, "spanStart": null, "spanEnd": null }
}
```

Jedes Feld hat eine Spalte in `database/schema.sql`; keines wird zur Laufzeit erfunden.

| Feld | Spalte | Erzwungen durch |
|---|---|---|
| `evidenceKind` | `evidence_kind` | ENUM `isnad_link \| rijal_statement \| chronology_only` |
| `sourcePassageId` | `source_passage_id` | `NOT NULL` — auch eine Isnād-Kante nennt die Passage ihres Hadithdatensatzes |
| `confidenceLevel` | `confidence_level` | ENUM `confidence_level`, sechs Stufen |
| `confidenceScore` | `confidence_score` | `CHECK BETWEEN 0 AND 1`; `*_level_threshold`; `*_score_is_machine` |
| `origin` | `origin` | ENUM; `*_verified_is_editorial` schließt maschinelles `verified` aus |
| `extractionMethod` | `extraction_method` | ENUM `manual \| parser \| entity_resolution_model` |
| `parserVersion` | `parser_version` | Teil der Reimport-Schlüssel |
| `reviewStatus` | `review_status` | ENUM; `*_decision_needs_reviewer` |
| `reviewedBy` / `lastReviewedAt` | `reviewed_by` / `reviewed_at` | `*_review_pair`: beide gesetzt oder beide leer; Trigger `sanad_reviewer_must_be_human` |
| `validTimeRange` | `valid_from_ah` / `valid_to_ah` | `*_valid_range`: `from <= to` |
| `dataVersion` | `data_version` | `NOT NULL`, ohne Default |
| `chainPosition` | `chain_id`, `narrator_occurrence.position`, `span_start`, `span_end` | `relationship_isnad_needs_positions` |

Die Ausgangsfassung dieser Datei forderte `extractionMethod`, `parserVersion`,
`reviewedBy` und einen Gültigkeitszeitraum, ohne dass eine dieser Spalten
existierte. `database/migrations/0005_evidence_envelope.sql` legt sie an.
`evidenceType` mit den Werten `chain_occurrence | biographical_statement |
editorial_inference` ist entfallen: `editorial_inference` war eine vierte, nirgends
definierte Evidenzklasse, und `chain_occurrence` hieß im Schema `isnad_occurrence`.
Verbindlich sind ausschließlich die drei Klassen des Vertrags.

## Die drei Evidenzklassen dürfen nicht vermischt werden

| Klasse | Bedeutung | Pflichtbezug |
|---|---|---|
| `isnad_link` | konkrete Nachbarschaft in einer geparsten Kette | `chain_id`, `subject_occurrence_id`, `object_occurrence_id` alle gesetzt |
| `rijal_statement` | ausdrückliche Angabe in einem biografischen Werk | `rijal_entry_id` oder `original_phrase` |
| `chronology_only` | zeitliche Möglichkeit, kein Überlieferungsbeleg | `chronology_subject_date_id` und `chronology_object_date_id` gesetzt, `chain_id` leer, `relationship_type = 'contemporary'` |

Die letzte Zeile ist der Kern: eine chronologische Möglichkeit kann im Schema gar
keine Überlieferungsbeziehung ausdrücken. `relationship_chronology_is_never_transmission`
lässt für `chronology_only` nur `contemporary` zu — `teacher`, `student`,
`transmitted_from` und `transmitted_to` sind ausgeschlossen. Zusätzlich liefert die
Sicht `transmission_evidence` ausschließlich `isnad_link` und `rijal_statement`,
damit eine unachtsame Abfrage eine bloße Möglichkeit nicht als Beleg verwendet.

Welche Datierungen eine chronologische Kante tragen, steht nicht im Kommentar,
sondern als Fremdschlüssel: die beiden entscheidenden in
`chronology_subject_date_id` und `chronology_object_date_id`, die vollständige
Liste in `chronology_basis` mit `basis_role` und `chronology_version`.

## Reimport-Schutz

Ein zweiter Importlauf darf keine Kantendubletten erzeugen. Je Evidenzklasse gilt
ein eigener partieller UNIQUE-Index, weil die identifizierenden Felder sich
unterscheiden:

| Index | Schlüssel | gültig für |
|---|---|---|
| `relationship_isnad_key` | `(subject_occurrence_id, object_occurrence_id, relationship_type, parser_version)` | `isnad_link` |
| `relationship_rijal_key` | `(subject_narrator_id, object_narrator_id, relationship_type, source_passage_id, parser_version)` | `rijal_statement` |
| `relationship_chronology_key` | `(subject_narrator_id, object_narrator_id, chronology_subject_date_id, chronology_object_date_id)` | `chronology_only` |

## Projektionen

Neo4j und Elastic entfallen; die Graphprojektion ist eine materialisierte Tabelle
plus `WITH RECURSIVE` in SQLite/D1. Verbindlich bleibt: die Projektion enthält
keine exklusiven wissenschaftlichen Daten und ist jederzeit aus PostgreSQL bzw.
den versionierten Importen neu aufbaubar. Die Sichten `relationship_projection`
und `transmission_evidence` gruppieren nie über `evidence_kind` hinweg — eine
Aggregation, die die Evidenzklasse verliert, wäre eine Vermischung.

## Abfragegrenzen

- `neighbors`: maximal 500 Kanten pro Seite.
- `paths`: `maxDepth <= 8`, maximal 100 Pfade, Timeout 2 s interaktiv.
- `all routes`: nur innerhalb eines Hadith-Clusters; keine globale unbegrenzte Traversierung.
- Globalansicht liefert voraggregierte Epochen-/Regionscluster, keine Einzelknoten vor LOD 4.
