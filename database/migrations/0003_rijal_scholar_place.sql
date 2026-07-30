-- 0003 — rijal_entry, scholar, place (Luecke 1)
--
-- Vorher hatten die 27.105 Rijal-Eintraege aus Tahdhib al-Tahdhib, Mizan
-- al-Iʿtidal und Taqrib al-Tahdhib ueberhaupt keine Tabelle. entryNumber,
-- nameSurface, deathYearCandidate, teacherPhrase und studentPhrase hatten kein
-- Ziel. Ebenso fehlten scholar und place aus docs/03-DATA-MODEL.md:109-110.
--
-- Die Spalten sind auf die Felder ausgelegt, die der neue Rijal-Parser (P1.1)
-- liefert: echter Namenskopf statt 180-Zeichen-Schnitt, Kunya, Nisba, Laqab,
-- Ṭabaqa, Todes- und Geburtsjahr, Region, Lehrer- und Schuelerphrase.
--
-- Ein Rijal-Eintrag ist eine Quellenstelle, keine kanonische Person. Die
-- Verbindung zu narrator bleibt ein Vorschlag, bis ein Editor sie entscheidet.

BEGIN;

CREATE TABLE rijal_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_work_id uuid NOT NULL REFERENCES source_work(id),
  edition_id uuid REFERENCES edition(id),
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  import_batch_id uuid NOT NULL REFERENCES import_batch(id),
  external_entry_id text NOT NULL,
  entry_number text NOT NULL,
  entry_number_int integer,

  name_head_raw text NOT NULL,
  name_head_normalized text NOT NULL,
  full_nasab text,
  kunya text,
  nisba text,
  laqab text,
  tabaqa text,
  tabaqa_number integer,

  birth_year_ah integer,
  birth_year_min_ah integer,
  birth_year_max_ah integer,
  birth_precision precision_kind NOT NULL DEFAULT 'unknown',
  birth_original_phrase text,
  death_year_ah integer,
  death_year_min_ah integer,
  death_year_max_ah integer,
  death_precision precision_kind NOT NULL DEFAULT 'unknown',
  death_original_phrase text,

  primary_region text,
  regions jsonb NOT NULL DEFAULT '[]'::jsonb,

  teacher_phrase text,
  student_phrase text,
  teacher_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  student_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  grade_phrase text,

  entry_text text,
  entry_text_sha256 text NOT NULL,
  volume text,
  printed_page text,
  span_start integer,
  span_end integer,

  resolved_narrator_id uuid REFERENCES narrator(id),
  identity_status confidence_level NOT NULL DEFAULT 'unresolved',

  extraction_method extraction_method NOT NULL DEFAULT 'parser',
  parser_version text NOT NULL,
  parse_confidence numeric(4,3) CHECK (parse_confidence BETWEEN 0 AND 1),
  parse_error_code text,
  origin assertion_origin NOT NULL DEFAULT 'machine',
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  publication_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_work_id, external_entry_id),
  UNIQUE (import_batch_id, external_entry_id),
  CONSTRAINT rijal_entry_span_order CHECK (span_start IS NULL OR span_end IS NULL OR span_end > span_start),
  CONSTRAINT rijal_entry_birth_range CHECK (
    birth_year_min_ah IS NULL OR birth_year_max_ah IS NULL OR birth_year_min_ah <= birth_year_max_ah
  ),
  CONSTRAINT rijal_entry_death_range CHECK (
    death_year_min_ah IS NULL OR death_year_max_ah IS NULL OR death_year_min_ah <= death_year_max_ah
  ),
  CONSTRAINT rijal_entry_verified_is_editorial CHECK (
    identity_status <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT rijal_entry_resolved_needs_status CHECK (
    resolved_narrator_id IS NULL OR identity_status <> 'unresolved'
  ),
  CONSTRAINT rijal_entry_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT rijal_entry_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  )
);

CREATE TABLE scholar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SQLITE-TRANSLATE: '~' -> GLOB 'SA-S-[A-Z2-7]...'
  stable_key text NOT NULL UNIQUE CHECK (stable_key ~ '^SA-S-[A-Z2-7]{8}$'),
  canonical_arabic_name text NOT NULL,
  normalized_name text NOT NULL,
  homonym_index integer NOT NULL DEFAULT 0 CHECK (homonym_index >= 0),
  transliteration text,
  narrator_id uuid REFERENCES narrator(id),
  scholar_role text NOT NULL DEFAULT 'critic'
    CHECK (scholar_role IN ('critic', 'author', 'editor', 'transmitter')),
  death_year_ah integer,
  identity_status confidence_level NOT NULL DEFAULT 'unresolved',
  origin assertion_origin NOT NULL DEFAULT 'registry',
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_name, homonym_index),
  CONSTRAINT scholar_verified_is_editorial CHECK (
    identity_status <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT scholar_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);

CREATE TABLE place (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SQLITE-TRANSLATE: '~' -> GLOB 'SA-L-[A-Z2-7]...'
  stable_key text NOT NULL UNIQUE CHECK (stable_key ~ '^SA-L-[A-Z2-7]{8}$'),
  canonical_arabic_name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  transliteration text,
  place_type text NOT NULL DEFAULT 'city'
    CHECK (place_type IN ('city', 'region', 'province', 'village', 'route', 'unknown')),
  latitude numeric(8,5) CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(8,5) CHECK (longitude BETWEEN -180 AND 180),
  modern_country text,
  origin assertion_origin NOT NULL DEFAULT 'registry',
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT place_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);

CREATE TABLE place_name_variant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid NOT NULL REFERENCES place(id),
  raw_name text NOT NULL,
  normalized_name text NOT NULL,
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  data_version text NOT NULL,
  UNIQUE (place_id, normalized_name, source_passage_id)
);

-- LIVED_IN aus docs/04-GRAPH-SCHEMA.md:18 als zeitlich qualifizierte,
-- quellengebundene Ortsassertion.
CREATE TABLE narrator_place_assertion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  narrator_id uuid NOT NULL REFERENCES narrator(id),
  place_id uuid NOT NULL REFERENCES place(id),
  relation_type text NOT NULL CHECK (
    relation_type IN ('birth', 'residence', 'death', 'travel', 'study', 'teaching')
  ),
  original_phrase text,
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  rijal_entry_id uuid REFERENCES rijal_entry(id),
  extraction_method extraction_method NOT NULL DEFAULT 'parser',
  parser_version text,
  origin assertion_origin NOT NULL DEFAULT 'machine',
  confidence_level confidence_level NOT NULL DEFAULT 'low',
  confidence_score numeric(4,3) CHECK (confidence_score BETWEEN 0 AND 1),
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  valid_from_ah integer,
  valid_to_ah integer,
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT narrator_place_valid_range CHECK (
    valid_from_ah IS NULL OR valid_to_ah IS NULL OR valid_from_ah <= valid_to_ah
  ),
  CONSTRAINT narrator_place_level_threshold CHECK (
    confidence_score IS NULL
    OR confidence_level IN ('verified', 'unresolved', 'conflict')
    OR (confidence_level = 'high' AND confidence_score >= 0.90)
    OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
    OR (confidence_level = 'low' AND confidence_score < 0.70)
  ),
  CONSTRAINT narrator_place_verified_is_editorial CHECK (
    confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT narrator_place_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT narrator_place_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  ),
  UNIQUE (narrator_id, place_id, relation_type, source_passage_id)
);

-- --- Rijal-Eintraege als Identitaetskandidaten --------------------------------
-- /api/v1/identity-candidates rankt Treffer aus den drei Rijal-Werken. Bisher
-- konnte identity_candidate nur auf narrator zeigen; damit hatte die Antwort
-- kein Ziel in der Datenbank.

ALTER TABLE identity_candidate ADD COLUMN candidate_rijal_entry_id uuid REFERENCES rijal_entry(id);
ALTER TABLE identity_candidate ADD COLUMN match_kind text NOT NULL DEFAULT 'name_contains'
  CHECK (match_kind IN ('exact_name', 'name_prefix', 'name_contains', 'biography_mention'));
ALTER TABLE identity_candidate ALTER COLUMN candidate_narrator_id DROP NOT NULL;
ALTER TABLE identity_candidate ADD CONSTRAINT identity_candidate_one_target CHECK (
  (candidate_narrator_id IS NOT NULL AND candidate_rijal_entry_id IS NULL)
  OR (candidate_narrator_id IS NULL AND candidate_rijal_entry_id IS NOT NULL)
);

-- Der alte UNIQUE-Schluessel kollidiert mit dem neuen nullable Ziel und wird
-- durch zwei partielle Indizes ersetzt.
ALTER TABLE identity_candidate
  DROP CONSTRAINT IF EXISTS identity_candidate_occurrence_id_candidate_narrator_id_res_key;
CREATE UNIQUE INDEX identity_candidate_narrator_key
  ON identity_candidate (occurrence_id, candidate_narrator_id, resolver_version)
  WHERE candidate_narrator_id IS NOT NULL;
CREATE UNIQUE INDEX identity_candidate_rijal_key
  ON identity_candidate (occurrence_id, candidate_rijal_entry_id, resolver_version)
  WHERE candidate_rijal_entry_id IS NOT NULL;

-- --- Rijal-Bezug auf die bestehenden Assertions -------------------------------

ALTER TABLE date_assertion  ADD COLUMN rijal_entry_id uuid REFERENCES rijal_entry(id);
ALTER TABLE grade_assertion ADD COLUMN rijal_entry_id uuid REFERENCES rijal_entry(id);
ALTER TABLE grade_assertion ADD COLUMN scholar_id uuid REFERENCES scholar(id);
ALTER TABLE grade_assertion ADD COLUMN temporal_scope text;

CREATE INDEX rijal_entry_number_idx ON rijal_entry (source_work_id, entry_number_int);
CREATE INDEX rijal_entry_name_head_idx ON rijal_entry (name_head_normalized);
CREATE INDEX rijal_entry_death_idx ON rijal_entry (death_year_ah);
CREATE INDEX rijal_entry_narrator_idx ON rijal_entry (resolved_narrator_id);
CREATE INDEX rijal_entry_name_trgm_idx ON rijal_entry USING gin (name_head_normalized gin_trgm_ops);
CREATE INDEX grade_narrator_idx ON grade_assertion (narrator_id);

INSERT INTO schema_migration (version, description)
VALUES ('0003', 'rijal_entry, scholar, place')
ON CONFLICT (version) DO NOTHING;

COMMIT;
