# Relationales Datenmodell

Maßgeblich ist `database/schema.sql`. Dieses Dokument erklärt die Entscheidungen;
bei Abweichung gilt das Schema.

```mermaid
erDiagram
  NARRATOR ||--o{ NARRATOR_NAME_VARIANT : has
  NARRATOR ||--o{ IDENTITY_CANDIDATE : candidate
  NARRATOR ||--o{ NARRATOR_OCCURRENCE : resolves
  NARRATOR ||--o{ TRANSMISSION_ASSERTION : subject
  NARRATOR ||--o{ EVALUATION_ASSERTION : evaluated
  NARRATOR ||--o{ DATE_ASSERTION : dated
  NARRATOR ||--o{ NARRATOR_ID_REDIRECT : absorbed
  NARRATOR ||--o{ NARRATOR_MERGE : target
  NARRATOR ||--o{ NARRATOR_SPLIT : source
  SCHOLAR ||--o{ EVALUATION_ASSERTION : states
  SOURCE_PASSAGE ||--o{ EVALUATION_ASSERTION : evidences
  SOURCE_PASSAGE ||--o{ TRANSMISSION_ASSERTION : evidences
  SOURCE_PASSAGE ||--o{ DATE_ASSERTION : evidences
  SOURCE_PASSAGE ||--o{ RIJAL_ENTRY : locates
  BOOK ||--o{ CHAPTER : contains
  BOOK ||--o{ EDITION : has
  BOOK ||--o{ RIJAL_ENTRY : contains
  CHAPTER ||--o{ HADITH_RECORD : contains
  EDITION ||--o{ HADITH_RECORD : realizes
  HADITH_RECORD ||--o{ ISNAD_CHAIN : has
  ISNAD_CHAIN ||--o{ NARRATOR_OCCURRENCE : orders
  NARRATOR_OCCURRENCE ||--o{ TRANSMISSION_ASSERTION : positions
  NARRATOR_OCCURRENCE ||--o{ IDENTITY_DECISION : decides
  RIJAL_ENTRY ||--o{ IDENTITY_CANDIDATE : proposes
  DATE_ASSERTION ||--o{ CHRONOLOGY_BASIS : supports
  TRANSMISSION_ASSERTION ||--o{ CHRONOLOGY_BASIS : rests_on
  HADITH_RECORD }o--|| HADITH_CLUSTER : belongs_to
  HADITH_CLUSTER ||--o{ MATN_VARIANT : families
  NARRATOR ||--o{ NARRATOR_PLACE_ASSERTION : located
  PLACE ||--o{ NARRATOR_PLACE_ASSERTION : hosts
  EDITOR ||--o{ EDITOR_ROLE : holds
  ROLE ||--o{ EDITOR_ROLE : granted
  EDITOR ||--o{ IDENTITY_DECISION : decides
  EDITOR ||--o{ EDITORIAL_REVISION : authors
  EDITOR ||--o{ NARRATOR_MERGE : approves
  NARRATOR_MERGE ||--o{ NARRATOR_MERGE_MEMBER : absorbs
  NARRATOR_SPLIT ||--o{ NARRATOR_SPLIT_ASSIGNMENT : reassigns

  NARRATOR {
    uuid id PK
    text stable_key
    int revision
    text canonical_arabic_name
    text normalized_name
    int homonym_index
    text kunya
    text nisba
    text laqab
    text generation
    text primary_region
    text identity_status
    decimal identity_score
    text origin
    uuid merged_into_id FK
    uuid reviewed_by FK
    timestamptz reviewed_at
    text data_version
  }
  RIJAL_ENTRY {
    uuid id PK
    uuid source_work_id FK
    uuid source_passage_id FK
    text external_entry_id
    text entry_number
    text name_head_raw
    text name_head_normalized
    text kunya
    text nisba
    text tabaqa
    int birth_year_ah
    int death_year_ah
    text primary_region
    text teacher_phrase
    text student_phrase
    jsonb teacher_names
    jsonb student_names
    int span_start
    int span_end
    uuid resolved_narrator_id FK
    text identity_status
  }
  EDITOR {
    uuid id PK
    text auth_subject
    text display_name
    boolean is_machine
    boolean is_active
  }
  ROLE {
    uuid id PK
    text role_key
    boolean may_review
    boolean may_approve_merge
    boolean may_verify
  }
  NARRATOR_MERGE {
    uuid id PK
    uuid target_narrator_id FK
    int target_revision_before
    int target_revision_after
    text rationale
    uuid source_passage_id FK
    uuid proposed_by FK
    uuid approved_by FK
    jsonb snapshot_before
    uuid reverted_by FK
  }
  NARRATOR_ID_REDIRECT {
    uuid id PK
    text absorbed_stable_key
    uuid target_narrator_id FK
    uuid merge_id FK
  }
  CHRONOLOGY_BASIS {
    uuid id PK
    uuid relationship_assertion_id FK
    uuid meeting_assertion_id FK
    uuid date_assertion_id FK
    text basis_role
    text computed_result
  }
  NARRATOR_NAME_VARIANT {
    uuid id PK
    uuid narrator_id FK
    text raw_name
    text normalized_name
    text transliteration
    text source_context
  }
  IDENTITY_CANDIDATE {
    uuid id PK
    uuid occurrence_id FK
    uuid candidate_narrator_id FK
    decimal confidence
    jsonb matching_signals
    jsonb conflicting_signals
    text review_status
  }
  HADITH_RECORD {
    uuid id PK
    uuid chapter_id FK
    uuid edition_id FK
    uuid cluster_id FK
    text source_number
    text arabic_matn
    text full_raw_text
  }
  ISNAD_CHAIN {
    uuid id PK
    uuid hadith_record_id FK
    text raw_isnad
    jsonb parsed_isnad
    text parser_version
    decimal parse_confidence
  }
  NARRATOR_OCCURRENCE {
    uuid id PK
    uuid chain_id FK
    uuid resolved_narrator_id FK
    int position
    text raw_surface_form
    text transmission_term
    decimal resolution_confidence
  }
  TRANSMISSION_ASSERTION {
    uuid id PK
    uuid subject_narrator_id FK
    uuid object_narrator_id FK
    text relationship_type
    text evidence_kind
    uuid chain_id FK
    uuid subject_occurrence_id FK
    uuid object_occurrence_id FK
    uuid source_passage_id FK
    uuid chronology_subject_date_id FK
    uuid chronology_object_date_id FK
    text extraction_method
    text parser_version
    text origin
    text confidence_level
    decimal confidence_score
    text review_status
    uuid reviewed_by FK
    timestamptz reviewed_at
    int valid_from_ah
    int valid_to_ah
    text data_version
  }
  EVALUATION_ASSERTION {
    uuid id PK
    uuid subject_narrator_id FK
    uuid scholar_id FK
    text original_phrase
    text normalized_category
    uuid source_passage_id FK
    text temporal_scope
    text review_status
  }
  SOURCE_PASSAGE {
    uuid id PK
    uuid edition_id FK
    text volume
    text page
    text original_text
    text stable_reference
    text license_status
  }
  BOOK { uuid id PK text title text genre uuid author_id FK }
  CHAPTER { uuid id PK uuid book_id FK text heading text source_order }
  EDITION { uuid id PK uuid book_id FK text publisher text editor int publication_year }
  HADITH_CLUSTER { uuid id PK text stable_key text method text status decimal confidence_score uuid reviewed_by FK }
  MATN_VARIANT { uuid id PK uuid cluster_id FK text family_key text color_token }
  SCHOLAR { uuid id PK text stable_key text canonical_arabic_name uuid narrator_id FK int death_year_ah }
  PLACE { uuid id PK text stable_key text canonical_arabic_name decimal latitude decimal longitude }
```

Im Schema heißt `TRANSMISSION_ASSERTION` `relationship_assertion` und
`EVALUATION_ASSERTION` heißt `grade_assertion`; `BOOK` ist `source_work`.

## Modellierungsentscheidungen

- Die Kettenposition (`NARRATOR_OCCURRENCE`) ist nicht die historische Person (`NARRATOR`). Dadurch bleibt eine ungeklärte Namensform importierbar, ohne sie vorschnell zu verschmelzen.
- `TRANSMISSION_ASSERTION` modelliert fachliche Behauptungen; konkrete Vorkommen in einer Kette werden zusätzlich aus benachbarten `NARRATOR_OCCURRENCE`-Datensätzen abgeleitet.
- Jeder Import bleibt editions- und nummerierungsspezifisch. Cluster ersetzen keine Originaldatensätze.
- Fachliche Tabellen sind append-only versionierbar. Korrekturen erzeugen neue Revisionen; Audit-Ereignisse speichern Vorher/Nachher und Begründung.
- `RIJAL_ENTRY` ist eine Quellenstelle, keine Person. Ein Treffer in Tahdhīb bleibt ein Identitätskandidat und wird nicht mit anderen Treffern verschmolzen. Deshalb kann `IDENTITY_CANDIDATE` auf `NARRATOR` **oder** auf `RIJAL_ENTRY` zeigen, niemals auf beides.
- `SCHOLAR` ist von `NARRATOR` getrennt, weil ein Kritiker in dieser Rolle auftritt und nicht als Kettenglied. Ist der Kritiker zugleich ein bekannter Überlieferer, verbindet `scholar.narrator_id` beide, ohne die Rollen zu vermischen.
- Namensformen sind gegen stille Reimport-Dubletten geschützt, ohne Homonyme zu verbieten: der partielle UNIQUE-Index `narrator_normalized_name_key` gilt auf `(normalized_name, homonym_index)` und nur für nicht absorbierte Zeilen. Zwei gleichnamige Personen brauchen also einen ausdrücklichen `homonym_index` — eine Entscheidung, nicht ein Zufall des Importlaufs.

## Kanonische Identität, Merge und Split

Nach außen ist eine Person `stable_key` plus `revision`, nicht die interne uuid.

| Vorgang | Wirkung |
|---|---|
| Anlegen | `stable_key = SA-P-<base32(8)>`, `revision = 1` |
| Merge | `revision` der Zielperson steigt; absorbierte Zeilen bleiben stehen, erhalten `merged_into_id` und je einen Eintrag in `narrator_id_redirect` |
| Split | `revision` der Quellperson steigt; `narrator_split_assignment` nennt für jede betroffene Position das ausdrücklich gewählte Ziel oder stellt sie auf `unresolved` zurück |
| Ruecknahme | `narrator_merge.snapshot_before` wird zurückgespielt; die kanonische ID der wiederhergestellten Person ist unverändert |

Merge und Split verlangen `proposed_by <> approved_by`, eine Begründung von
mindestens zwölf Zeichen und eine Quellenpassage. Die Historie ist append-only:
`editorial_revision`, `identity_decision`, `narrator_split`,
`narrator_merge_member` und `narrator_split_assignment` lassen kein UPDATE und
kein DELETE zu. `narrator_merge` erlaubt als einzige Ausnahme das Setzen der drei
Rücknahmefelder, alles andere bleibt unveränderlich.

## Antwort-Hülle: welche Spalte trägt welches API-Feld

Jede fachliche API-Antwort führt dieselben sieben Felder. Keines wird zur Laufzeit
erfunden; jedes hat eine Spalte.

| API-Feld | Spalte | Anmerkung |
|---|---|---|
| `sourceReferences` | `source_passage_id` (NOT NULL) plus `evidence_link` | die Pflichtquelle ist ein Fremdschlüssel, weitere Quellen liegen in `evidence_link` |
| `confidenceLevel` | `confidence_level`, auf Personen und Positionen `identity_status` | ENUM mit sechs Stufen |
| `confidenceScore` | `confidence_score` | 0..1 oder null; nur maschinell, siehe `*_score_is_machine` |
| `origin` | `origin` | `machine \| editorial \| registry` |
| `reviewStatus` | `review_status` | fünf Werte |
| `dataVersion` | `data_version` | `NOT NULL` ohne Default |
| `lastReviewedAt` | `reviewed_at` | war strukturell immer null, weil die Spalte nur auf `hadith_cluster` existierte |

Für die beiden häufigsten Fälle liefern die Sichten `narrator_envelope` und
`rijal_entry_envelope` diese Felder bereits unter den Vertragsnamen.

## Quellenpflicht als Mechanismus

`NOT NULL` auf `source_passage_id` gilt für: `hadith_record`,
`hadith_number_alias`, `narrator_name_variant`, `rijal_entry`, `date_assertion`,
`relationship_assertion`, `grade_assertion`, `narrator_place_assertion`,
`place_name_variant`, `identity_decision`, `narrator_merge`, `narrator_split`,
`editorial_revision`, `evidence_link`.

Ausnahme mit Begründung: `meeting_assertion.source_passage_id` bleibt nullable,
weil `contemporary_only` und `impossible` keine Textstelle behaupten, sondern aus
Datierungen berechnet werden. Genau dafür verlangt
`meeting_chronology_needs_dates` beide `chronology_*_date_id`, und
`meeting_claim_needs_evidence` lässt `met` und `heard_from` nur mit Passage oder
Kettenbezug zu. Eine berechnete Gleichzeitigkeit kann sich damit nicht in ein
Hören verwandeln.

## Was bewusst nicht im Schema steht

- Kein aggregierter Zuverlässigkeitswert je Person. Kritikeraussagen bleiben einzeln in `grade_assertion` mit Werk, Band und Seite.
- Kein Mittelwert über widersprüchliche Datierungen. Jede Angabe ist eine eigene `date_assertion`-Zeile; Widersprüche bleiben sichtbar.
- Kein geschätztes Geburtsjahr. `date_assertion_birth_never_derived` verbietet `is_derived = true` für `event_type = 'birth'`.
- Keine exklusiven Daten in Projektionen. `relationship_projection` und `transmission_evidence` sind Sichten und jederzeit neu aufbaubar.
