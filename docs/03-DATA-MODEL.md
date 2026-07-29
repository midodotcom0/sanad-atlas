# Relationales Datenmodell

```mermaid
erDiagram
  NARRATOR ||--o{ NARRATOR_NAME_VARIANT : has
  NARRATOR ||--o{ IDENTITY_CANDIDATE : candidate
  NARRATOR ||--o{ NARRATOR_OCCURRENCE : resolves
  NARRATOR ||--o{ TRANSMISSION_ASSERTION : subject
  NARRATOR ||--o{ EVALUATION_ASSERTION : evaluated
  SCHOLAR ||--o{ EVALUATION_ASSERTION : states
  SOURCE_PASSAGE ||--o{ EVALUATION_ASSERTION : evidences
  SOURCE_PASSAGE ||--o{ TRANSMISSION_ASSERTION : evidences
  BOOK ||--o{ CHAPTER : contains
  BOOK ||--o{ EDITION : has
  CHAPTER ||--o{ HADITH_RECORD : contains
  EDITION ||--o{ HADITH_RECORD : realizes
  HADITH_RECORD ||--o{ ISNAD_CHAIN : has
  ISNAD_CHAIN ||--o{ NARRATOR_OCCURRENCE : orders
  HADITH_RECORD }o--|| HADITH_CLUSTER : belongs_to
  NARRATOR }o--o{ PLACE : associated_with

  NARRATOR {
    uuid canonical_id PK
    text canonical_arabic_name
    int birth_year_ah_min
    int birth_year_ah_max
    int death_year_ah_min
    int death_year_ah_max
    text identity_status
    text editorial_status
    int version
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
    uuid source_narrator_id FK
    uuid target_narrator_id FK
    text assertion_type
    text evidence_type
    uuid source_passage_id FK
    decimal confidence
    text review_status
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
  HADITH_CLUSTER { uuid id PK text method decimal confidence text editorial_status }
  SCHOLAR { uuid id PK text canonical_name }
  PLACE { uuid id PK text canonical_name decimal latitude decimal longitude }
```

## Modellierungsentscheidungen

- Die Kettenposition (`NARRATOR_OCCURRENCE`) ist nicht die historische Person (`NARRATOR`). Dadurch bleibt eine ungeklärte Namensform importierbar, ohne sie vorschnell zu verschmelzen.
- `TRANSMISSION_ASSERTION` modelliert fachliche Behauptungen; konkrete Vorkommen in einer Kette werden zusätzlich aus benachbarten `NARRATOR_OCCURRENCE`-Datensätzen abgeleitet.
- Jeder Import bleibt editions- und nummerierungsspezifisch. Cluster ersetzen keine Originaldatensätze.
- Fachliche Tabellen sind append-only versionierbar. Korrekturen erzeugen neue Revisionen; Audit-Ereignisse speichern Vorher/Nachher und Begründung.
