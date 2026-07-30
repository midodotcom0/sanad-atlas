-- 0008 — Persistente, authentifizierte Redaktionsschnittstelle (P5.8)
--
-- Der Browser uebergibt niemals eine editor_id. Ein hochentropischer Bearer-
-- Token wird ausserhalb der Datenbank erzeugt; nur sein SHA-256-Hash wird hier
-- einem aktiven menschlichen Editor zugeordnet. Vorschlaege und Revisionen sind
-- append-only. Merge und Verify werden erst als editorial_revision wirksam,
-- wenn ein zweiter, entsprechend berechtigter Editor sie finalisiert.

BEGIN;

CREATE TABLE editor_api_credential (
  id uuid PRIMARY KEY,
  editor_id uuid NOT NULL REFERENCES editor(id),
  token_sha256 text NOT NULL UNIQUE CHECK (length(token_sha256) = 64),
  label text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editor_api_credential_expiry_order CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT editor_api_credential_revoke_order CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX editor_api_credential_editor_idx
  ON editor_api_credential (editor_id, revoked_at, expires_at);

CREATE TABLE editorial_proposal (
  id uuid PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN (
    'identity_candidate', 'narrator', 'rijal_entry', 'date_assertion',
    'relationship_assertion', 'hadith_cluster', 'matn_variant', 'parse_review_item'
  )),
  entity_id uuid NOT NULL,
  entity_stable_key text,
  action text NOT NULL CHECK (action IN ('accept', 'reject', 'merge', 'verify')),
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 12),
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  proposed_by uuid NOT NULL REFERENCES editor(id),
  before_value jsonb NOT NULL,
  after_value jsonb NOT NULL,
  baseline_revision_id uuid,
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_proposal_changes_value CHECK (before_value <> after_value)
);

CREATE INDEX editorial_proposal_entity_idx
  ON editorial_proposal (entity_type, entity_id, created_at DESC);

ALTER TABLE editorial_revision
  ADD COLUMN proposal_id uuid UNIQUE REFERENCES editorial_proposal(id);

ALTER TABLE editorial_revision
  ADD CONSTRAINT editorial_revision_entity_index_unique
  UNIQUE (entity_type, entity_id, revision_index);

CREATE TRIGGER editorial_proposal_append_only
  BEFORE UPDATE OR DELETE ON editorial_proposal
  FOR EACH STATEMENT EXECUTE FUNCTION sanad_forbid_mutation();

CREATE TRIGGER editorial_proposal_human_editor
  BEFORE INSERT ON editorial_proposal
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('proposed_by');

INSERT INTO schema_migration (version, description)
VALUES ('0008', 'persistente Redaktionsvorschlaege und gehashte API-Zugangsdaten')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Ruecknahme (nur solange 0008 noch keine produktiven Zeilen enthaelt):
--   DROP TRIGGER editorial_proposal_human_editor ON editorial_proposal;
--   DROP TRIGGER editorial_proposal_append_only ON editorial_proposal;
--   ALTER TABLE editorial_revision DROP COLUMN proposal_id;
--   DROP TABLE editorial_proposal;
--   DROP TABLE editor_api_credential;
--   DELETE FROM schema_migration WHERE version = '0008';
