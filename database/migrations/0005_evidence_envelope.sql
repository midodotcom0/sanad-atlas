-- 0005 — Evidenzhuelle, Positionsbindung, Chronologiebasis, Quellenpflicht
--         (Luecken 5, 6, 7, 8)
--
-- Vier Befunde auf einmal, weil sie dieselben Tabellen betreffen:
--
--  * Luecke 8: docs/04-GRAPH-SCHEMA.md:24-35 fordert fuer jede fachliche Kante
--    extraction_method, parser_version, reviewed_by und einen Gueltigkeitszeitraum.
--    Nichts davon existierte im Schema.
--  * Luecke 6: relationship_assertion:227-244 kannte nur chain_id, nicht die
--    Erzaehlerposition. Positionsgebundene Formen wie أبيه waren dadurch nicht
--    rekonstruierbar, und ein Reimport konnte dieselbe Kante beliebig oft anlegen.
--  * Luecke 7: der CHECK auf :242 verlangte fuer chronology_only nur
--    chain_id IS NULL, aber keinen Bezug auf die verwendeten date_assertion-Zeilen.
--  * Luecke 5: source_passage_id war auf :207 und :288 nullable.
--
-- Zusaetzlich wird der Evidenzwert 'isnad_occurrence' auf den Vertragsnamen
-- 'isnad_link' umgestellt.

BEGIN;

CREATE TYPE extraction_method AS ENUM ('manual', 'parser', 'entity_resolution_model');

CREATE TYPE review_queue_kind AS ENUM (
  'identity_candidate', 'narrator_merge_split', 'relative_name_form', 'date_assertion',
  'relationship_assertion', 'place_assertion', 'grade_assertion', 'matn_cluster',
  'source_passage', 'parser_error'
);

ALTER TYPE evidence_kind RENAME VALUE 'isnad_occurrence' TO 'isnad_link';

-- --- Positionsbindung: (chain_id, position, span_start, span_end) --------------
-- Der Vertrag nennt die Spanne spanStart/spanEnd. source_start/source_end wird
-- entsprechend umbenannt, damit Importer, API und Schema denselben Namen fuehren.

ALTER TABLE isnad_chain RENAME COLUMN source_start TO span_start;
ALTER TABLE isnad_chain RENAME COLUMN source_end TO span_end;
ALTER TABLE narrator_occurrence RENAME COLUMN source_start TO span_start;
ALTER TABLE narrator_occurrence RENAME COLUMN source_end TO span_end;

ALTER TABLE isnad_chain ADD CONSTRAINT isnad_chain_span_order
  CHECK (span_start IS NULL OR span_end IS NULL OR span_end > span_start);
ALTER TABLE narrator_occurrence ADD CONSTRAINT narrator_occurrence_span_order
  CHECK (span_start IS NULL OR span_end IS NULL OR span_end > span_start);

-- Relative Namensformen bleiben an ihre Position gebunden. Sie sind keine
-- globale Person und duerfen ohne redaktionelle Entscheidung nicht aufgeloest
-- gelten.
ALTER TABLE narrator_occurrence ADD COLUMN is_relative_form boolean NOT NULL DEFAULT false;
ALTER TABLE narrator_occurrence ADD COLUMN relative_form_kind text
  CHECK (relative_form_kind IN ('father', 'grandfather', 'uncle', 'brother', 'unnamed_man', 'unnamed_shaykh', 'other'));
ALTER TABLE narrator_occurrence ADD COLUMN resolver_version text;

UPDATE narrator_occurrence
SET is_relative_form = true,
    relative_form_kind = CASE
      WHEN normalized_surface_form IN ('ابيه', 'ابوه', 'ابي') THEN 'father'
      WHEN normalized_surface_form IN ('جده', 'جدته')          THEN 'grandfather'
      WHEN normalized_surface_form IN ('عمه', 'عماه')          THEN 'uncle'
      WHEN normalized_surface_form = 'اخيه'                    THEN 'brother'
      WHEN normalized_surface_form = 'رجل'                     THEN 'unnamed_man'
      WHEN normalized_surface_form = 'شيخ'                     THEN 'unnamed_shaykh'
      ELSE 'other'
    END
WHERE normalized_surface_form IN ('ابيه', 'ابوه', 'ابي', 'جده', 'جدته', 'عمه', 'عماه', 'اخيه', 'رجل', 'شيخ');

ALTER TABLE narrator_occurrence ADD CONSTRAINT narrator_occurrence_relative_kind
  CHECK (is_relative_form OR relative_form_kind IS NULL);
ALTER TABLE narrator_occurrence ADD CONSTRAINT narrator_occurrence_relative_needs_editor
  CHECK (is_relative_form = false OR resolved_narrator_id IS NULL OR reviewed_by IS NOT NULL);

CREATE INDEX narrator_occurrence_relative_idx
  ON narrator_occurrence (chain_id, position) WHERE is_relative_form;

-- --- Evidenzhuelle auf jeder fachlichen Kante ---------------------------------

ALTER TABLE date_assertion         ADD COLUMN extraction_method extraction_method NOT NULL DEFAULT 'parser';
ALTER TABLE date_assertion         ADD COLUMN parser_version text;
ALTER TABLE date_assertion         ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';
ALTER TABLE date_assertion         RENAME COLUMN confidence TO confidence_score;
ALTER TABLE date_assertion         ADD COLUMN confidence_level confidence_level NOT NULL DEFAULT 'low';
ALTER TABLE date_assertion         ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE date_assertion         ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE date_assertion         RENAME COLUMN precision TO date_precision;
ALTER TABLE date_assertion         ADD COLUMN is_derived boolean NOT NULL DEFAULT false;
ALTER TABLE date_assertion         ADD COLUMN derived_from_id uuid REFERENCES date_assertion(id);
ALTER TABLE date_assertion         ADD COLUMN derivation_rule text;

ALTER TABLE relationship_assertion ADD COLUMN extraction_method extraction_method NOT NULL DEFAULT 'parser';
ALTER TABLE relationship_assertion ADD COLUMN parser_version text;
ALTER TABLE relationship_assertion ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';
ALTER TABLE relationship_assertion RENAME COLUMN confidence TO confidence_score;
ALTER TABLE relationship_assertion ADD COLUMN confidence_level confidence_level NOT NULL DEFAULT 'low';
ALTER TABLE relationship_assertion ADD COLUMN valid_from_ah integer;
ALTER TABLE relationship_assertion ADD COLUMN valid_to_ah integer;
ALTER TABLE relationship_assertion ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE relationship_assertion ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE relationship_assertion ADD COLUMN rijal_entry_id uuid REFERENCES rijal_entry(id);

ALTER TABLE meeting_assertion      ADD COLUMN extraction_method extraction_method NOT NULL DEFAULT 'parser';
ALTER TABLE meeting_assertion      ADD COLUMN parser_version text;
ALTER TABLE meeting_assertion      ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';
ALTER TABLE meeting_assertion      RENAME COLUMN confidence TO confidence_score;
ALTER TABLE meeting_assertion      ADD COLUMN confidence_level confidence_level NOT NULL DEFAULT 'low';
ALTER TABLE meeting_assertion      ADD COLUMN valid_from_ah integer;
ALTER TABLE meeting_assertion      ADD COLUMN valid_to_ah integer;
ALTER TABLE meeting_assertion      ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE meeting_assertion      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE meeting_assertion      ADD COLUMN subject_occurrence_id uuid REFERENCES narrator_occurrence(id);
ALTER TABLE meeting_assertion      ADD COLUMN object_occurrence_id uuid REFERENCES narrator_occurrence(id);

ALTER TABLE grade_assertion        ADD COLUMN extraction_method extraction_method NOT NULL DEFAULT 'parser';
ALTER TABLE grade_assertion        ADD COLUMN parser_version text;
ALTER TABLE grade_assertion        ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';
ALTER TABLE grade_assertion        RENAME COLUMN confidence TO confidence_score;
ALTER TABLE grade_assertion        ADD COLUMN confidence_level confidence_level NOT NULL DEFAULT 'low';
ALTER TABLE grade_assertion        ADD COLUMN valid_from_ah integer;
ALTER TABLE grade_assertion        ADD COLUMN valid_to_ah integer;
ALTER TABLE grade_assertion        ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE grade_assertion        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE hadith_record          ADD COLUMN extraction_method extraction_method NOT NULL DEFAULT 'parser';
ALTER TABLE hadith_record          ADD COLUMN parse_error_code text;
ALTER TABLE hadith_record          ADD COLUMN full_raw_text_sha256 text;
ALTER TABLE hadith_record          ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
UPDATE hadith_record SET full_raw_text_sha256 = encode(digest(full_raw_text, 'sha256'), 'hex')
  WHERE full_raw_text_sha256 IS NULL;
ALTER TABLE hadith_record          ALTER COLUMN full_raw_text_sha256 SET NOT NULL;

ALTER TABLE isnad_chain            ADD COLUMN extraction_method extraction_method NOT NULL DEFAULT 'parser';
ALTER TABLE isnad_chain            ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE narrator_occurrence    ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE identity_candidate     ADD COLUMN extraction_method extraction_method NOT NULL DEFAULT 'entity_resolution_model';
ALTER TABLE identity_candidate     ADD COLUMN weight_profile_version text;
ALTER TABLE identity_candidate     ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE narrator_name_variant  ADD COLUMN extraction_method extraction_method NOT NULL DEFAULT 'parser';
ALTER TABLE narrator_name_variant  ADD COLUMN parser_version text;
ALTER TABLE narrator_name_variant  ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';
ALTER TABLE narrator_name_variant  ADD COLUMN variant_kind text NOT NULL DEFAULT 'surface'
  CHECK (variant_kind IN ('surface', 'kunya', 'nisba', 'laqab', 'nasab', 'transliteration', 'abbreviation'));
ALTER TABLE narrator_name_variant  ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE hadith_number_alias    ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';
ALTER TABLE hadith_number_alias    RENAME COLUMN confidence TO confidence_score;
ALTER TABLE hadith_number_alias    ADD COLUMN confidence_level confidence_level NOT NULL DEFAULT 'low';
ALTER TABLE hadith_number_alias    ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE cluster_membership     ADD COLUMN extraction_method extraction_method NOT NULL DEFAULT 'parser';
ALTER TABLE cluster_membership     ADD COLUMN parser_version text;
ALTER TABLE cluster_membership     ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';
ALTER TABLE cluster_membership     RENAME COLUMN confidence TO confidence_score;
ALTER TABLE cluster_membership     ADD COLUMN confidence_level confidence_level NOT NULL DEFAULT 'low';
ALTER TABLE cluster_membership     ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE matn_variant           ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';
ALTER TABLE matn_variant           ADD COLUMN confidence_level confidence_level NOT NULL DEFAULT 'low';
ALTER TABLE matn_variant           ADD COLUMN confidence_score numeric(4,3) CHECK (confidence_score BETWEEN 0 AND 1);
ALTER TABLE matn_variant           ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE matn_variant           ADD CONSTRAINT matn_variant_color_unique UNIQUE (cluster_id, color_token);
ALTER TABLE hadith_cluster         RENAME COLUMN confidence TO confidence_score;
ALTER TABLE hadith_cluster         ADD COLUMN confidence_level confidence_level NOT NULL DEFAULT 'low';
ALTER TABLE hadith_cluster         ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';
ALTER TABLE hadith_cluster         ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE parse_review_item      ADD COLUMN queue_kind review_queue_kind NOT NULL DEFAULT 'parser_error';
ALTER TABLE parse_review_item      ADD COLUMN resolution_note text;
ALTER TABLE parse_review_item      ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE parse_review_item      DROP CONSTRAINT IF EXISTS parse_review_item_import_batch_id_external_record_id_error_key;
ALTER TABLE parse_review_item      ADD CONSTRAINT parse_review_item_queue_key
  UNIQUE (import_batch_id, queue_kind, external_record_id, error_code);
ALTER TABLE editorial_revision     ADD COLUMN entity_stable_key text;
ALTER TABLE editorial_revision     ADD COLUMN reverts_revision_id uuid UNIQUE REFERENCES editorial_revision(id);
ALTER TABLE editorial_revision     ADD COLUMN revision_index integer NOT NULL DEFAULT 1 CHECK (revision_index >= 1);
ALTER TABLE editorial_revision     ADD COLUMN data_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE editorial_revision     ADD CONSTRAINT editorial_revision_no_self_revert
  CHECK (reverts_revision_id IS NULL OR reverts_revision_id <> id);

-- Die Defaults 'legacy' sind ein Migrationsbehelf, keine Datenversion. Fuer
-- Neubestaende gilt schema.sql, dort ist data_version ohne Default NOT NULL.
ALTER TABLE date_assertion         ALTER COLUMN data_version DROP DEFAULT;
ALTER TABLE relationship_assertion ALTER COLUMN data_version DROP DEFAULT;
ALTER TABLE meeting_assertion      ALTER COLUMN data_version DROP DEFAULT;
ALTER TABLE grade_assertion        ALTER COLUMN data_version DROP DEFAULT;
ALTER TABLE hadith_record          ALTER COLUMN data_version DROP DEFAULT;
ALTER TABLE isnad_chain            ALTER COLUMN data_version DROP DEFAULT;
ALTER TABLE narrator_occurrence    ALTER COLUMN data_version DROP DEFAULT;
ALTER TABLE identity_candidate     ALTER COLUMN data_version DROP DEFAULT;

-- --- Luecke 6: Occurrence-Fremdschluessel und Reimport-Schutz -----------------

ALTER TABLE relationship_assertion ADD COLUMN subject_occurrence_id uuid REFERENCES narrator_occurrence(id);
ALTER TABLE relationship_assertion ADD COLUMN object_occurrence_id uuid REFERENCES narrator_occurrence(id);
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_type_extended
  CHECK (relationship_type IN ('teacher', 'student', 'transmitted_from', 'transmitted_to', 'contemporary'));
ALTER TABLE relationship_assertion DROP CONSTRAINT IF EXISTS relationship_assertion_relationship_type_check;

-- Bestandskanten aus einem Isnad erhalten ihren Positionsbezug aus der Kette:
-- Subjekt und Objekt sind benachbarte Positionen derselben chain_id.
UPDATE relationship_assertion r
SET subject_occurrence_id = so.id,
    object_occurrence_id = oo.id
FROM narrator_occurrence so, narrator_occurrence oo
WHERE r.evidence_kind = 'isnad_link'
  AND r.chain_id IS NOT NULL
  AND so.chain_id = r.chain_id AND so.resolved_narrator_id = r.subject_narrator_id
  AND oo.chain_id = r.chain_id AND oo.resolved_narrator_id = r.object_narrator_id
  AND r.subject_occurrence_id IS NULL;

ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_distinct_persons
  CHECK (subject_narrator_id <> object_narrator_id);
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_distinct_occurrences
  CHECK (subject_occurrence_id IS NULL OR object_occurrence_id IS NULL
         OR subject_occurrence_id <> object_occurrence_id);
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_valid_range
  CHECK (valid_from_ah IS NULL OR valid_to_ah IS NULL OR valid_from_ah <= valid_to_ah);

CREATE UNIQUE INDEX relationship_isnad_key
  ON relationship_assertion (subject_occurrence_id, object_occurrence_id, relationship_type, parser_version)
  WHERE evidence_kind = 'isnad_link';
CREATE UNIQUE INDEX relationship_rijal_key
  ON relationship_assertion (subject_narrator_id, object_narrator_id, relationship_type, source_passage_id, parser_version)
  WHERE evidence_kind = 'rijal_statement';

CREATE INDEX relationship_object_idx ON relationship_assertion (object_narrator_id, evidence_kind);
CREATE INDEX relationship_occurrence_idx ON relationship_assertion (subject_occurrence_id, object_occurrence_id);
CREATE INDEX relationship_chain_idx ON relationship_assertion (chain_id);
CREATE INDEX meeting_subject_idx ON meeting_assertion (subject_narrator_id, assertion_type);

-- --- Luecke 7: Chronologie nennt ihre Datierungen -----------------------------

ALTER TABLE relationship_assertion ADD COLUMN chronology_subject_date_id uuid REFERENCES date_assertion(id);
ALTER TABLE relationship_assertion ADD COLUMN chronology_object_date_id uuid REFERENCES date_assertion(id);
ALTER TABLE meeting_assertion      ADD COLUMN chronology_subject_date_id uuid REFERENCES date_assertion(id);
ALTER TABLE meeting_assertion      ADD COLUMN chronology_object_date_id uuid REFERENCES date_assertion(id);

CREATE TABLE chronology_basis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_assertion_id uuid REFERENCES relationship_assertion(id) ON DELETE CASCADE,
  meeting_assertion_id uuid REFERENCES meeting_assertion(id) ON DELETE CASCADE,
  date_assertion_id uuid NOT NULL REFERENCES date_assertion(id),
  basis_role text NOT NULL CHECK (
    basis_role IN ('subject_birth', 'subject_death', 'object_birth', 'object_death',
                   'subject_residence', 'object_residence')
  ),
  computed_result chronology_result NOT NULL,
  chronology_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chronology_basis_one_owner CHECK (
    (relationship_assertion_id IS NOT NULL AND meeting_assertion_id IS NULL)
    OR (relationship_assertion_id IS NULL AND meeting_assertion_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX chronology_basis_relationship_key
  ON chronology_basis (relationship_assertion_id, date_assertion_id, basis_role)
  WHERE relationship_assertion_id IS NOT NULL;
CREATE UNIQUE INDEX chronology_basis_meeting_key
  ON chronology_basis (meeting_assertion_id, date_assertion_id, basis_role)
  WHERE meeting_assertion_id IS NOT NULL;
CREATE INDEX chronology_basis_date_idx ON chronology_basis (date_assertion_id);

-- Eine chronologische Moeglichkeit ohne belegbare Datierungsgrundlage ist keine
-- Aussage. Solche Bestandszeilen wandern in die Review-Queue und werden entfernt,
-- statt als Beleg weiterzuleben.
INSERT INTO parse_review_item (import_batch_id, queue_kind, external_record_id, raw_payload, error_code, error_detail, data_version)
SELECT (SELECT id FROM import_batch ORDER BY started_at LIMIT 1),
       'relationship_assertion',
       'relationship_assertion:' || r.id::text,
       to_jsonb(r),
       'chronology-without-basis',
       'Chronologische Moeglichkeit ohne Bezug auf date_assertion; neu berechnen und Grundlage angeben.',
       'migration-0005'
FROM relationship_assertion r
WHERE r.evidence_kind = 'chronology_only'
  AND (r.chronology_subject_date_id IS NULL OR r.chronology_object_date_id IS NULL)
ON CONFLICT DO NOTHING;

DELETE FROM relationship_assertion
WHERE evidence_kind = 'chronology_only'
  AND (chronology_subject_date_id IS NULL OR chronology_object_date_id IS NULL);

-- Der alte CHECK auf :239-243 wird durch die vier praeziseren Regeln ersetzt.
ALTER TABLE relationship_assertion DROP CONSTRAINT IF EXISTS relationship_assertion_check;

ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_isnad_needs_positions CHECK (
  evidence_kind <> 'isnad_link'
  OR (chain_id IS NOT NULL AND subject_occurrence_id IS NOT NULL AND object_occurrence_id IS NOT NULL)
);
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_rijal_needs_passage CHECK (
  evidence_kind <> 'rijal_statement' OR rijal_entry_id IS NOT NULL OR original_phrase IS NOT NULL
);
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_chronology_has_no_chain CHECK (
  evidence_kind <> 'chronology_only'
  OR (chain_id IS NULL AND subject_occurrence_id IS NULL AND object_occurrence_id IS NULL)
);
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_chronology_needs_dates CHECK (
  evidence_kind <> 'chronology_only'
  OR (chronology_subject_date_id IS NOT NULL AND chronology_object_date_id IS NOT NULL)
);
-- Eine chronologische Moeglichkeit ist niemals ein Beleg fuer Hoeren oder
-- Ueberlieferung. Sie darf ausschliesslich als 'contemporary' auftreten.
UPDATE relationship_assertion SET relationship_type = 'contemporary'
  WHERE evidence_kind = 'chronology_only' AND relationship_type <> 'contemporary';
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_chronology_is_never_transmission CHECK (
  evidence_kind <> 'chronology_only' OR relationship_type = 'contemporary'
);

CREATE UNIQUE INDEX relationship_chronology_key
  ON relationship_assertion (subject_narrator_id, object_narrator_id,
                             chronology_subject_date_id, chronology_object_date_id)
  WHERE evidence_kind = 'chronology_only';

ALTER TABLE meeting_assertion DROP CONSTRAINT IF EXISTS meeting_assertion_check;
ALTER TABLE meeting_assertion ADD CONSTRAINT meeting_distinct_persons
  CHECK (subject_narrator_id <> object_narrator_id);
ALTER TABLE meeting_assertion ADD CONSTRAINT meeting_claim_needs_evidence CHECK (
  assertion_type NOT IN ('met', 'heard_from') OR source_passage_id IS NOT NULL OR chain_id IS NOT NULL
);
ALTER TABLE meeting_assertion ADD CONSTRAINT meeting_chronology_needs_dates CHECK (
  assertion_type NOT IN ('contemporary_only', 'impossible')
  OR (chronology_subject_date_id IS NOT NULL AND chronology_object_date_id IS NOT NULL)
);
ALTER TABLE meeting_assertion ADD CONSTRAINT meeting_chronology_is_not_hearing CHECK (
  assertion_type NOT IN ('met', 'heard_from')
  OR extraction_method <> 'entity_resolution_model'
  OR source_passage_id IS NOT NULL
);

-- --- Abschnitt 7: Geburtsjahre niemals aus Todesjahren schaetzen ---------------

ALTER TABLE date_assertion ADD CONSTRAINT date_assertion_derivation CHECK (
  is_derived = false OR (derived_from_id IS NOT NULL AND derivation_rule IS NOT NULL)
);
ALTER TABLE date_assertion ADD CONSTRAINT date_assertion_birth_never_derived CHECK (
  event_type <> 'birth' OR is_derived = false
);
ALTER TABLE date_assertion ADD CONSTRAINT date_assertion_reimport_key
  UNIQUE (narrator_id, event_type, year_min_ah, year_max_ah, source_passage_id, parser_version);

-- --- Luecke 5: Quellenpflicht auf den Assertions ------------------------------

INSERT INTO parse_review_item (import_batch_id, queue_kind, external_record_id, raw_payload, error_code, error_detail, data_version)
SELECT (SELECT id FROM import_batch ORDER BY started_at LIMIT 1),
       'relationship_assertion',
       'relationship_assertion:' || r.id::text,
       to_jsonb(r),
       'missing-source-passage',
       'Beziehungsaussage ohne Quellenpassage; Quelle nachtragen und neu anlegen.',
       'migration-0005'
FROM relationship_assertion r WHERE r.source_passage_id IS NULL
ON CONFLICT DO NOTHING;

DELETE FROM relationship_assertion WHERE source_passage_id IS NULL;
DELETE FROM narrator_name_variant WHERE source_passage_id IS NULL;
DELETE FROM hadith_number_alias WHERE source_passage_id IS NULL;

ALTER TABLE relationship_assertion ALTER COLUMN source_passage_id SET NOT NULL;
ALTER TABLE narrator_name_variant  ALTER COLUMN source_passage_id SET NOT NULL;
ALTER TABLE hadith_number_alias    ALTER COLUMN source_passage_id SET NOT NULL;

-- --- Zusaetzliche Quellenbelege fuer sourceReferences -------------------------

CREATE TABLE evidence_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN (
    'hadith_record', 'isnad_chain', 'narrator', 'narrator_occurrence', 'rijal_entry',
    'date_assertion', 'relationship_assertion', 'meeting_assertion', 'grade_assertion',
    'narrator_place_assertion', 'identity_decision', 'narrator_merge', 'narrator_split',
    'editorial_revision', 'hadith_cluster', 'matn_variant'
  )),
  entity_id uuid NOT NULL,
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  role text NOT NULL DEFAULT 'supporting'
    CHECK (role IN ('primary', 'supporting', 'contradicting', 'parallel')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, source_passage_id, role)
);

CREATE INDEX evidence_link_entity_idx ON evidence_link (entity_type, entity_id);
CREATE INDEX identity_candidate_occurrence_idx ON identity_candidate (occurrence_id, confidence_score DESC);
CREATE INDEX editorial_revision_entity_idx ON editorial_revision (entity_type, entity_id, created_at DESC);
DROP INDEX IF EXISTS review_queue_idx;
CREATE INDEX review_queue_idx ON parse_review_item (queue_kind, review_status, created_at);

-- --- Schwellen und verified-Regel auf allen Assertions ------------------------

ALTER TABLE date_assertion ADD CONSTRAINT date_assertion_level_threshold CHECK (
  confidence_score IS NULL OR confidence_level IN ('verified', 'unresolved', 'conflict')
  OR (confidence_level = 'high' AND confidence_score >= 0.90)
  OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
  OR (confidence_level = 'low' AND confidence_score < 0.70)
);
ALTER TABLE date_assertion ADD CONSTRAINT date_assertion_verified_is_editorial CHECK (
  confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
);
ALTER TABLE date_assertion ADD CONSTRAINT date_assertion_score_is_machine CHECK (
  confidence_score IS NULL OR extraction_method <> 'manual'
);
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_level_threshold CHECK (
  confidence_score IS NULL OR confidence_level IN ('verified', 'unresolved', 'conflict')
  OR (confidence_level = 'high' AND confidence_score >= 0.90)
  OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
  OR (confidence_level = 'low' AND confidence_score < 0.70)
);
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_verified_is_editorial CHECK (
  confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
);
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_score_is_machine CHECK (
  confidence_score IS NULL OR extraction_method <> 'manual'
);
ALTER TABLE meeting_assertion ADD CONSTRAINT meeting_level_threshold CHECK (
  confidence_score IS NULL OR confidence_level IN ('verified', 'unresolved', 'conflict')
  OR (confidence_level = 'high' AND confidence_score >= 0.90)
  OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
  OR (confidence_level = 'low' AND confidence_score < 0.70)
);
ALTER TABLE meeting_assertion ADD CONSTRAINT meeting_verified_is_editorial CHECK (
  confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
);
ALTER TABLE grade_assertion ADD CONSTRAINT grade_level_threshold CHECK (
  confidence_score IS NULL OR confidence_level IN ('verified', 'unresolved', 'conflict')
  OR (confidence_level = 'high' AND confidence_score >= 0.90)
  OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
  OR (confidence_level = 'low' AND confidence_score < 0.70)
);
ALTER TABLE grade_assertion ADD CONSTRAINT grade_verified_is_editorial CHECK (
  confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
);
ALTER TABLE hadith_cluster ADD CONSTRAINT hadith_cluster_verified_is_editorial CHECK (
  confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
);
ALTER TABLE cluster_membership ADD CONSTRAINT cluster_membership_verified_is_editorial CHECK (
  confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
);
ALTER TABLE matn_variant ADD CONSTRAINT matn_variant_verified_is_editorial CHECK (
  confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
);
ALTER TABLE hadith_number_alias ADD CONSTRAINT hadith_number_alias_verified_is_editorial CHECK (
  confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
);

-- --- Projektionen neu aufbauen ------------------------------------------------

DROP VIEW IF EXISTS relationship_projection;

CREATE VIEW relationship_projection AS
SELECT subject_narrator_id, object_narrator_id, relationship_type, evidence_kind, chronology,
       count(*) AS assertion_count,
       max(confidence_score) AS max_confidence_score,
       max(reviewed_at) AS last_reviewed_at
FROM relationship_assertion
WHERE review_status <> 'rejected'
GROUP BY subject_narrator_id, object_narrator_id, relationship_type, evidence_kind, chronology;

CREATE VIEW transmission_evidence AS
SELECT id, subject_narrator_id, object_narrator_id, relationship_type, evidence_kind,
       chain_id, subject_occurrence_id, object_occurrence_id, source_passage_id,
       confidence_level, confidence_score, review_status, reviewed_by, reviewed_at, data_version
FROM relationship_assertion
WHERE evidence_kind IN ('isnad_link', 'rijal_statement')
  AND review_status <> 'rejected';

CREATE VIEW narrator_envelope AS
SELECT n.id, n.stable_key, n.revision, n.canonical_arabic_name,
       n.identity_status AS confidence_level, n.identity_score AS confidence_score,
       n.origin, n.review_status, n.data_version, n.reviewed_at AS last_reviewed_at,
       n.merged_into_id,
       (SELECT count(*) FROM evidence_link e WHERE e.entity_type = 'narrator' AND e.entity_id = n.id)
         AS extra_source_count
FROM narrator n;

CREATE VIEW rijal_entry_envelope AS
SELECT r.id, r.source_work_id, r.entry_number, r.name_head_raw, r.name_head_normalized,
       r.death_year_ah, r.teacher_phrase, r.student_phrase,
       r.identity_status AS confidence_level, r.parse_confidence AS confidence_score,
       r.origin, r.review_status, r.data_version, r.reviewed_at AS last_reviewed_at,
       r.source_passage_id, r.publication_allowed
FROM rijal_entry r;

INSERT INTO schema_migration (version, description)
VALUES ('0005', 'Evidenzhuelle, Occurrence-Bezug, Chronologiebasis, Quellenpflicht')
ON CONFLICT (version) DO NOTHING;

COMMIT;
