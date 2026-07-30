-- 0006 — Append-only-Schutz und menschliche Pruefer (Luecke 10)
--
-- Abschnitt 9 verlangt reversible Historie. Reversibel heisst nicht: nachtraeglich
-- veraenderbar. Eine Korrektur ist eine neue Revision, eine Ruecknahme eine neue
-- Zeile — nie ein UPDATE und nie ein DELETE auf der Historie.
--
-- Zusaetzlich wird "maschinelle Verarbeitung setzt niemals verified" auf der
-- Kontenebene erzwungen: ein Konto mit is_machine = true darf reviewed_by,
-- approved_by, proposed_by und editor_id nicht besetzen. Damit ist der Weg zu
-- 'verified' fuer die Pipeline auch dann versperrt, wenn sie origin = 'editorial'
-- behauptet.

BEGIN;

-- --- Append-only --------------------------------------------------------------

CREATE FUNCTION sanad_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % auf % ist nicht erlaubt; lege eine neue Revision an',
    TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER editorial_revision_append_only
  BEFORE UPDATE OR DELETE ON editorial_revision
  FOR EACH STATEMENT EXECUTE FUNCTION sanad_forbid_mutation();

CREATE TRIGGER identity_decision_append_only
  BEFORE UPDATE OR DELETE ON identity_decision
  FOR EACH STATEMENT EXECUTE FUNCTION sanad_forbid_mutation();

CREATE TRIGGER narrator_merge_member_append_only
  BEFORE UPDATE OR DELETE ON narrator_merge_member
  FOR EACH STATEMENT EXECUTE FUNCTION sanad_forbid_mutation();

CREATE TRIGGER narrator_split_assignment_append_only
  BEFORE UPDATE OR DELETE ON narrator_split_assignment
  FOR EACH STATEMENT EXECUTE FUNCTION sanad_forbid_mutation();

CREATE FUNCTION sanad_split_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % auf narrator_split ist nicht erlaubt', TG_OP;
END;
$$;

CREATE TRIGGER narrator_split_append_only
  BEFORE UPDATE OR DELETE ON narrator_split
  FOR EACH STATEMENT EXECUTE FUNCTION sanad_split_guard();

-- Ein Merge darf nach der Freigabe nur noch als zurueckgenommen markiert werden.
-- Alles andere bleibt unveraenderlich, damit snapshot_before belastbar bleibt.
CREATE FUNCTION sanad_merge_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only: DELETE auf % ist nicht erlaubt', TG_TABLE_NAME;
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.target_narrator_id <> OLD.target_narrator_id
     OR NEW.target_revision_before <> OLD.target_revision_before
     OR NEW.target_revision_after <> OLD.target_revision_after
     OR NEW.rationale <> OLD.rationale
     OR NEW.source_passage_id <> OLD.source_passage_id
     OR NEW.proposed_by <> OLD.proposed_by
     OR NEW.approved_by <> OLD.approved_by
     OR NEW.snapshot_before::text <> OLD.snapshot_before::text
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'narrator_merge ist nach der Freigabe unveraenderlich; nur reverted_by, reverted_at und revert_rationale duerfen gesetzt werden';
  END IF;
  IF OLD.reverted_at IS NOT NULL AND NEW.reverted_at IS DISTINCT FROM OLD.reverted_at THEN
    RAISE EXCEPTION 'narrator_merge wurde bereits zurueckgenommen';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER narrator_merge_guard
  BEFORE UPDATE OR DELETE ON narrator_merge
  FOR EACH ROW EXECUTE FUNCTION sanad_merge_guard();

-- --- Kein Maschinenkonto als Pruefer oder Freigeber ---------------------------

CREATE FUNCTION sanad_reviewer_must_be_human() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  payload jsonb := to_jsonb(NEW);
  candidate_id uuid;
  column_name text;
  machine boolean;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    candidate_id := (payload ->> column_name)::uuid;
    IF candidate_id IS NOT NULL THEN
      SELECT is_machine INTO machine FROM editor WHERE id = candidate_id;
      IF machine THEN
        RAISE EXCEPTION 'maschinelles Konto darf %.% nicht besetzen', TG_TABLE_NAME, column_name;
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER narrator_human_reviewer
  BEFORE INSERT OR UPDATE ON narrator
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('reviewed_by');
CREATE TRIGGER narrator_occurrence_human_reviewer
  BEFORE INSERT OR UPDATE ON narrator_occurrence
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('reviewed_by');
CREATE TRIGGER identity_candidate_human_reviewer
  BEFORE INSERT OR UPDATE ON identity_candidate
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('reviewed_by');
CREATE TRIGGER identity_decision_human_editor
  BEFORE INSERT ON identity_decision
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('editor_id', 'approved_by');
CREATE TRIGGER narrator_merge_human_editor
  BEFORE INSERT ON narrator_merge
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('proposed_by', 'approved_by');
CREATE TRIGGER narrator_split_human_editor
  BEFORE INSERT ON narrator_split
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('proposed_by', 'approved_by');
CREATE TRIGGER editorial_revision_human_editor
  BEFORE INSERT ON editorial_revision
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('editor_id', 'approved_by');
CREATE TRIGGER rijal_entry_human_reviewer
  BEFORE INSERT OR UPDATE ON rijal_entry
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('reviewed_by');
CREATE TRIGGER date_assertion_human_reviewer
  BEFORE INSERT OR UPDATE ON date_assertion
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('reviewed_by');
CREATE TRIGGER relationship_assertion_human_reviewer
  BEFORE INSERT OR UPDATE ON relationship_assertion
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('reviewed_by');
CREATE TRIGGER meeting_assertion_human_reviewer
  BEFORE INSERT OR UPDATE ON meeting_assertion
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('reviewed_by');
CREATE TRIGGER grade_assertion_human_reviewer
  BEFORE INSERT OR UPDATE ON grade_assertion
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('reviewed_by');
CREATE TRIGGER hadith_cluster_human_reviewer
  BEFORE INSERT OR UPDATE ON hadith_cluster
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('reviewed_by');

INSERT INTO schema_migration (version, description)
VALUES ('0006', 'Append-only-Schutz und menschliche Pruefer')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Ruecknahme:
--   DROP TRIGGER editorial_revision_append_only ON editorial_revision;
--   ... (analog fuer alle oben angelegten Trigger)
--   DROP FUNCTION sanad_forbid_mutation, sanad_merge_guard, sanad_split_guard,
--                 sanad_reviewer_must_be_human;
--   DELETE FROM schema_migration WHERE version = '0006';
