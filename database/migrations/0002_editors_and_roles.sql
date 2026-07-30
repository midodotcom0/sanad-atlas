-- 0002 — Benutzerkonten, Rollen und Vier-Augen-Freigabe (Luecke 4)
--
-- Vorher: editor_id war eine uuid ohne Fremdschluessel; es gab keine Editor- und
-- keine Rollentabelle. Abschnitt 13 verlangt Benutzerkonten und Rollen fuer
-- wissenschaftliche Bearbeiter, Abschnitt 9 eine Vier-Augen-Freigabe.
--
-- Ab hier gilt: jede redaktionelle Zeile nennt ein existierendes Konto, Merge und
-- Split verlangen zwei verschiedene Konten, und die Quellenpflicht ist ein
-- NOT-NULL-Fremdschluessel statt einer Bitte.

BEGIN;

CREATE TABLE role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL UNIQUE,
  label_ar text NOT NULL,
  may_review boolean NOT NULL DEFAULT false,
  may_approve_merge boolean NOT NULL DEFAULT false,
  may_verify boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE editor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject text NOT NULL UNIQUE,
  display_name text NOT NULL,
  display_name_ar text,
  email text,
  is_machine boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, is_machine)
);

CREATE TABLE editor_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  editor_id uuid NOT NULL REFERENCES editor(id),
  role_id uuid NOT NULL REFERENCES role(id),
  granted_by uuid REFERENCES editor(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (editor_id, role_id),
  CONSTRAINT editor_role_revoke_order CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

INSERT INTO role (id, role_key, label_ar, may_review, may_approve_merge, may_verify) VALUES
  ('11111111-1111-1111-1111-111111111101', 'viewer',        'قارئ',          false, false, false),
  ('11111111-1111-1111-1111-111111111102', 'annotator',     'مُعلِّق',        false, false, false),
  ('11111111-1111-1111-1111-111111111103', 'editor',        'محرر علمي',     true,  false, false),
  ('11111111-1111-1111-1111-111111111104', 'senior_editor', 'محرر علمي أول', true,  true,  true),
  ('11111111-1111-1111-1111-111111111105', 'admin',         'مسؤول النظام',  true,  true,  true)
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO editor (id, auth_subject, display_name, display_name_ar, is_machine) VALUES
  ('11111111-1111-1111-1111-1111111111f0', 'system:import-pipeline', 'Import Pipeline', 'خط الاستيراد', true)
ON CONFLICT (auth_subject) DO NOTHING;

-- --- editor_id nachtraeglich verankern ----------------------------------------
-- Bestandszeilen mit unbekanntem Konto werden nicht geloescht, sondern auf das
-- Pipeline-Konto gesetzt und bleiben so als Pruefungsfall auffindbar.

INSERT INTO editor (id, auth_subject, display_name, is_machine)
SELECT DISTINCT d.editor_id, 'legacy:' || d.editor_id::text, 'unbekanntes Altkonto', false
FROM identity_decision d
WHERE NOT EXISTS (SELECT 1 FROM editor e WHERE e.id = d.editor_id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO editor (id, auth_subject, display_name, is_machine)
SELECT DISTINCT r.editor_id, 'legacy:' || r.editor_id::text, 'unbekanntes Altkonto', false
FROM editorial_revision r
WHERE NOT EXISTS (SELECT 1 FROM editor e WHERE e.id = r.editor_id)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE identity_decision
  ADD CONSTRAINT identity_decision_editor_fk FOREIGN KEY (editor_id) REFERENCES editor(id);
ALTER TABLE editorial_revision
  ADD CONSTRAINT editorial_revision_editor_fk FOREIGN KEY (editor_id) REFERENCES editor(id);

-- --- Vier-Augen-Freigabe -----------------------------------------------------

ALTER TABLE identity_decision ADD COLUMN approved_by uuid REFERENCES editor(id);
ALTER TABLE identity_decision ADD COLUMN approved_at timestamptz;
ALTER TABLE editorial_revision ADD COLUMN approved_by uuid REFERENCES editor(id);
ALTER TABLE editorial_revision ADD COLUMN approved_at timestamptz;

-- Merge und Split brauchen zwei verschiedene editor_id. Bestandszeilen ohne
-- zweite Freigabe werden auf 'superseded' gestellt, statt die Migration zu
-- blockieren oder die Regel aufzuweichen.
UPDATE identity_decision
SET action = 'unresolve'
WHERE action IN ('merge', 'split') AND approved_by IS NULL;

ALTER TABLE identity_decision ADD CONSTRAINT identity_decision_four_eyes CHECK (
  action NOT IN ('merge', 'split') OR (approved_by IS NOT NULL AND approved_by <> editor_id)
);
ALTER TABLE identity_decision ADD CONSTRAINT identity_decision_approval_pair CHECK (
  (approved_by IS NULL) = (approved_at IS NULL)
);
ALTER TABLE identity_decision ADD CONSTRAINT identity_decision_confirm_needs_target CHECK (
  action <> 'confirm' OR chosen_narrator_id IS NOT NULL
);

ALTER TABLE editorial_revision ADD CONSTRAINT editorial_revision_four_eyes CHECK (
  action NOT IN ('merge', 'split', 'verify') OR (approved_by IS NOT NULL AND approved_by <> editor_id)
);
ALTER TABLE editorial_revision ADD CONSTRAINT editorial_revision_approval_pair CHECK (
  (approved_by IS NULL) = (approved_at IS NULL)
);

-- --- Begruendungspflicht mit Substanz ----------------------------------------

ALTER TABLE identity_decision ADD CONSTRAINT identity_decision_rationale CHECK (length(trim(rationale)) >= 12);
ALTER TABLE editorial_revision ADD CONSTRAINT editorial_revision_rationale CHECK (length(trim(rationale)) >= 12);

-- --- Quellenpflicht (Luecke 5) -----------------------------------------------
-- schema.sql:207 und :288 waren nullable. Damit war "mindestens eine Quelle"
-- aus Abschnitt 9 nicht erzwungen. Zeilen ohne Quelle werden vorher in die
-- Review-Queue gehoben, damit nichts verloren geht.

INSERT INTO parse_review_item (import_batch_id, external_record_id, raw_payload, error_code, error_detail, data_version)
SELECT (SELECT id FROM import_batch ORDER BY started_at LIMIT 1),
       'identity_decision:' || d.id::text,
       to_jsonb(d),
       'missing-source-passage',
       'Redaktionelle Entscheidung ohne Quellenangabe; Quelle nachtragen und Entscheidung wiederholen.',
       'migration-0002'
FROM identity_decision d
WHERE d.source_passage_id IS NULL
ON CONFLICT DO NOTHING;

DELETE FROM identity_decision WHERE source_passage_id IS NULL;
DELETE FROM editorial_revision WHERE source_passage_id IS NULL;

ALTER TABLE identity_decision ALTER COLUMN source_passage_id SET NOT NULL;
ALTER TABLE editorial_revision ALTER COLUMN source_passage_id SET NOT NULL;

-- --- reviewed_by und reviewed_at ueberall, wo ein Pruefstatus gefuehrt wird ---
-- Luecke 9: reviewed_at existierte nur auf hadith_cluster:77, weshalb das
-- API-Feld lastReviewedAt strukturell immer null war.

ALTER TABLE hadith_cluster        ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE hadith_record         ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE hadith_record         ADD COLUMN reviewed_at timestamptz;
ALTER TABLE hadith_number_alias   ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE hadith_number_alias   ADD COLUMN reviewed_at timestamptz;
ALTER TABLE cluster_membership    ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE cluster_membership    ADD COLUMN reviewed_at timestamptz;
ALTER TABLE matn_variant          ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE matn_variant          ADD COLUMN reviewed_at timestamptz;
ALTER TABLE isnad_chain           ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE isnad_chain           ADD COLUMN reviewed_at timestamptz;
ALTER TABLE narrator              ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE narrator              ADD COLUMN reviewed_at timestamptz;
-- narrator_name_variant hatte ueberhaupt keinen Pruefstatus. Eine Namensvariante
-- ist eine Aussage ueber eine Person und muss pruefbar sein.
ALTER TABLE narrator_name_variant ADD COLUMN review_status review_status NOT NULL DEFAULT 'machine_unreviewed';
ALTER TABLE narrator_name_variant ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE narrator_name_variant ADD COLUMN reviewed_at timestamptz;
ALTER TABLE narrator_occurrence   ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE narrator_occurrence   ADD COLUMN reviewed_at timestamptz;
ALTER TABLE identity_candidate    ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE identity_candidate    ADD COLUMN reviewed_at timestamptz;
ALTER TABLE date_assertion        ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE date_assertion        ADD COLUMN reviewed_at timestamptz;
ALTER TABLE relationship_assertion ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE relationship_assertion ADD COLUMN reviewed_at timestamptz;
ALTER TABLE meeting_assertion     ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE meeting_assertion     ADD COLUMN reviewed_at timestamptz;
ALTER TABLE grade_assertion       ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE grade_assertion       ADD COLUMN reviewed_at timestamptz;
ALTER TABLE parse_review_item     ADD COLUMN reviewed_by uuid REFERENCES editor(id);
ALTER TABLE parse_review_item     ADD COLUMN reviewed_at timestamptz;

-- reviewed_by und reviewed_at bilden ein Paar; eine getroffene Entscheidung
-- nennt immer ihren Pruefer. Sonst bleibt lastReviewedAt eine leere Zusage.
ALTER TABLE hadith_record ADD CONSTRAINT hadith_record_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE hadith_record ADD CONSTRAINT hadith_record_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE narrator ADD CONSTRAINT narrator_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE narrator ADD CONSTRAINT narrator_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE narrator_occurrence ADD CONSTRAINT narrator_occurrence_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE narrator_occurrence ADD CONSTRAINT narrator_occurrence_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE identity_candidate ADD CONSTRAINT identity_candidate_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE date_assertion ADD CONSTRAINT date_assertion_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE meeting_assertion ADD CONSTRAINT meeting_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE grade_assertion ADD CONSTRAINT grade_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE parse_review_item ADD CONSTRAINT parse_review_item_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE narrator_name_variant ADD CONSTRAINT narrator_name_variant_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE narrator_name_variant ADD CONSTRAINT narrator_name_variant_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE parse_review_item ADD CONSTRAINT parse_review_item_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE hadith_cluster ADD CONSTRAINT hadith_cluster_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE hadith_cluster ADD CONSTRAINT hadith_cluster_decision_needs_reviewer
  CHECK (status IN ('machine_suggestion') OR reviewed_by IS NOT NULL);
ALTER TABLE isnad_chain ADD CONSTRAINT isnad_chain_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE isnad_chain ADD CONSTRAINT isnad_chain_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE hadith_number_alias ADD CONSTRAINT hadith_number_alias_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE hadith_number_alias ADD CONSTRAINT hadith_number_alias_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE cluster_membership ADD CONSTRAINT cluster_membership_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE cluster_membership ADD CONSTRAINT cluster_membership_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE matn_variant ADD CONSTRAINT matn_variant_review_pair
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
ALTER TABLE matn_variant ADD CONSTRAINT matn_variant_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE identity_candidate ADD CONSTRAINT identity_candidate_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE date_assertion ADD CONSTRAINT date_assertion_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE relationship_assertion ADD CONSTRAINT relationship_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE meeting_assertion ADD CONSTRAINT meeting_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);
ALTER TABLE grade_assertion ADD CONSTRAINT grade_decision_needs_reviewer
  CHECK (review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL);

-- --- verified niemals maschinell (P2.3) --------------------------------------
-- Maschinelle Verarbeitung darf 'verified' nicht setzen; die Stufe verlangt ein
-- redaktionelles Konto und einen Zeitpunkt.

ALTER TABLE narrator ADD CONSTRAINT narrator_verified_is_editorial CHECK (
  identity_status <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
);
ALTER TABLE narrator_occurrence ADD CONSTRAINT narrator_occurrence_verified_is_editorial CHECK (
  identity_status <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
);
ALTER TABLE identity_candidate ADD CONSTRAINT identity_candidate_never_machine_verified CHECK (
  confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
);

CREATE INDEX editor_role_lookup_idx ON editor_role (editor_id) WHERE revoked_at IS NULL;
CREATE INDEX hadith_record_reviewed_idx ON hadith_record (reviewed_at);

INSERT INTO schema_migration (version, description)
VALUES ('0002', 'editor, role, editor_role und Vier-Augen-Freigabe')
ON CONFLICT (version) DO NOTHING;

COMMIT;
