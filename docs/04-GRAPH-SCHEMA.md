# Graphschema

## Knoten

`Narrator`, `HadithRecord`, `HadithCluster`, `Book`, `Chapter`, `Scholar`, `SourcePassage`, `Place`, `Edition`, `IdentityCandidate`.

## Primäre Kanten

| Kante | Quelle → Ziel | Bedeutung |
|---|---|---|
| `NARRATED_FROM_OCCURRENCE` | Narrator → Narrator | Aus mindestens einer konkreten Kettennachbarschaft abgeleitet. |
| `TEACHER_ASSERTION` | Narrator → Narrator | In biografischer Quelle als Lehrerbeziehung genannt. |
| `APPEARS_IN_CHAIN` | Narrator → IsnadChain | Aufgelöste Person kommt in konkreter Kette vor. |
| `MEMBER_OF_CLUSTER` | HadithRecord → HadithCluster | Redaktionell oder maschinell vorgeschlagene Clusterzuordnung. |
| `HAS_TEXT_VARIANT` | HadithCluster → HadithRecord | Konkrete Matn-Fassung. |
| `EVALUATED_BY` | Narrator → Scholar | Aussageknoten/Assertion verweist auf Originalpassage. |
| `MENTIONED_IN` | Entity → SourcePassage | Nachweisbare Erwähnung. |
| `LIVED_IN` | Narrator → Place | Zeitlich qualifizierte Ortsassertion. |
| `POSSIBLY_IDENTICAL_TO` | Occurrence → Narrator | Nicht endgültig aufgelöster Kandidat. |

## Pflichtattribute jeder fachlichen Kante

```json
{
  "assertionId": "uuid",
  "evidenceType": "chain_occurrence | biographical_statement | editorial_inference",
  "sourcePassageId": "uuid|null",
  "confidence": 0.0,
  "extractionMethod": "manual | parser | entity_resolution_model",
  "parserVersion": "string|null",
  "reviewStatus": "unreviewed | accepted | rejected | superseded",
  "reviewedBy": "uuid|null",
  "validTimeRange": { "fromAh": null, "toAh": null },
  "dataVersion": "semver"
}
```

## Abfragegrenzen

- `neighbors`: maximal 500 Kanten pro Seite.
- `paths`: `maxDepth <= 8`, maximal 100 Pfade, Timeout 2 s interaktiv.
- `all routes`: nur innerhalb eines Hadith-Clusters; keine globale unbegrenzte Traversierung.
- Globalansicht liefert voraggregierte Epochen-/Regionscluster, keine Einzelknoten vor LOD 4.
