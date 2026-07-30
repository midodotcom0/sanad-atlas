-- 0004 — Stabile kanonische IDs, Redirects, reversibler Merge und Split
--         (Luecken 2 und 3)
--
-- Vorher: narrator.id war gen_random_uuid() ohne stable_key, obwohl
-- hadith_cluster:72 bereits einen hatte. Ein action='merge' auf
-- identity_decision:205 war eine Notiz, kein Mechanismus — es gab keine
-- narrator_merge-Tabelle, keine Redirect-Aufloesung fuer absorbierte IDs und
-- keinen Snapshot, aus dem sich der Merge zuruecknehmen liesse. Abschnitt 9
-- verlangt reversible Historie.
--
-- Ab hier gilt:
--   * Kanonische Personen-ID nach aussen: SA-P-<base32(8)> plus revision.
--   * Ein Merge erhoeht die revision der Zielperson, laesst die absorbierten
--     Zeilen bestehen und legt fuer jede absorbierte ID einen Redirect an.
--   * snapshot_before enthaelt alles, was zur Ruecknahme gebraucht wird.
--   * Merge und Split verlangen zwei verschiedene editor_id.

BEGIN;

-- --- Deterministische Schluesselerzeugung -------------------------------------
-- Deterministisch aus dem Seed, damit zwei Buildlaeufe identische IDs erzeugen.

CREATE FUNCTION sanad_stable_key(prefix text, seed text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT prefix || (
    SELECT string_agg(
             substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
                    (get_byte(digest(seed, 'sha256'), i) % 32) + 1, 1),
             '' ORDER BY i)
    FROM generate_series(0, 7) AS i
  );
$$;

-- --- narrator: stable_key, revision, Absorptionsmarker ------------------------

ALTER TABLE narrator ADD COLUMN stable_key text;
ALTER TABLE narrator ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE narrator ADD COLUMN homonym_index integer NOT NULL DEFAULT 0 CHECK (homonym_index >= 0);
ALTER TABLE narrator ADD COLUMN merged_into_id uuid REFERENCES narrator(id);
ALTER TABLE narrator ADD COLUMN laqab text;
ALTER TABLE narrator ADD COLUMN generation_number integer;

-- Seed ist die uuid, damit derselbe Bestand immer denselben Schluessel erhaelt.
UPDATE narrator SET stable_key = sanad_stable_key('SA-P-', id::text) WHERE stable_key IS NULL;

-- Sehr unwahrscheinliche Kollisionen werden mit der Revision nachgesalzen,
-- statt sie stillschweigend zu ueberschreiben.
UPDATE narrator n
SET stable_key = sanad_stable_key('SA-P-', n.id::text || ':1')
WHERE EXISTS (
  SELECT 1 FROM narrator o WHERE o.stable_key = n.stable_key AND o.id < n.id
);

ALTER TABLE narrator ALTER COLUMN stable_key SET NOT NULL;
ALTER TABLE narrator ADD CONSTRAINT narrator_stable_key_unique UNIQUE (stable_key);
-- SQLITE-TRANSLATE: '~' -> GLOB 'SA-P-[A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7]'
ALTER TABLE narrator ADD CONSTRAINT narrator_stable_key_format
  CHECK (stable_key ~ '^SA-P-[A-Z2-7]{8}$');
ALTER TABLE narrator ADD CONSTRAINT narrator_not_merged_into_self
  CHECK (merged_into_id IS NULL OR merged_into_id <> id);

-- Reimport-Schutz auf der normalisierten Namensform. Homonyme bleiben moeglich,
-- brauchen aber einen ausdruecklichen Index. Absorbierte Personen zaehlen nicht.
-- Bestandsdubletten werden zuerst durchnummeriert, damit die Migration nicht an
-- vorhandenen Daten scheitert und keine Zeile verloren geht.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY normalized_name ORDER BY created_at, id) - 1 AS rn
  FROM narrator
  WHERE merged_into_id IS NULL
)
UPDATE narrator n SET homonym_index = ranked.rn
FROM ranked WHERE ranked.id = n.id AND ranked.rn > 0;

CREATE UNIQUE INDEX narrator_normalized_name_key
  ON narrator (normalized_name, homonym_index)
  WHERE merged_into_id IS NULL;

-- data_version war integer und meinte die Revision. Ab hier ist revision die
-- Revision und data_version die Datenversion des Bestandes.
ALTER TABLE narrator ALTER COLUMN data_version DROP DEFAULT;
ALTER TABLE narrator ALTER COLUMN data_version TYPE text USING data_version::text;

-- --- Cluster: stabiler Schluessel erst nach Freigabe ---------------------------

-- SQLITE-TRANSLATE: '~' -> GLOB 'SA-C-[A-Z2-7]...'
ALTER TABLE hadith_cluster ADD CONSTRAINT hadith_cluster_stable_key_format
  CHECK (stable_key IS NULL OR stable_key ~ '^SA-C-[A-Z2-7]{8}$');
UPDATE hadith_cluster SET stable_key = sanad_stable_key('SA-C-', id::text)
  WHERE status = 'accepted' AND stable_key IS NULL;
ALTER TABLE hadith_cluster ADD CONSTRAINT hadith_cluster_accepted_needs_key
  CHECK (status <> 'accepted' OR stable_key IS NOT NULL);

-- --- Merge -------------------------------------------------------------------

CREATE TABLE narrator_merge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_narrator_id uuid NOT NULL REFERENCES narrator(id),
  target_revision_before integer NOT NULL CHECK (target_revision_before >= 1),
  target_revision_after integer NOT NULL CHECK (target_revision_after >= 2),
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 12),
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  proposed_by uuid NOT NULL REFERENCES editor(id),
  approved_by uuid NOT NULL REFERENCES editor(id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz NOT NULL DEFAULT now(),
  snapshot_before jsonb NOT NULL,
  reverted_by uuid REFERENCES editor(id),
  reverted_at timestamptz,
  revert_rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT narrator_merge_four_eyes CHECK (proposed_by <> approved_by),
  CONSTRAINT narrator_merge_revision_step CHECK (target_revision_after > target_revision_before),
  CONSTRAINT narrator_merge_revert_pair CHECK ((reverted_by IS NULL) = (reverted_at IS NULL)),
  CONSTRAINT narrator_merge_revert_rationale CHECK (reverted_by IS NULL OR revert_rationale IS NOT NULL)
);

CREATE TABLE narrator_merge_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_id uuid NOT NULL REFERENCES narrator_merge(id) ON DELETE CASCADE,
  absorbed_narrator_id uuid NOT NULL REFERENCES narrator(id),
  absorbed_stable_key text NOT NULL,
  absorbed_revision integer NOT NULL CHECK (absorbed_revision >= 1),
  moved_occurrence_count integer NOT NULL DEFAULT 0 CHECK (moved_occurrence_count >= 0),
  UNIQUE (merge_id, absorbed_narrator_id)
);

-- --- Split -------------------------------------------------------------------

CREATE TABLE narrator_split (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_narrator_id uuid NOT NULL REFERENCES narrator(id),
  source_revision_before integer NOT NULL CHECK (source_revision_before >= 1),
  source_revision_after integer NOT NULL CHECK (source_revision_after >= 2),
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 12),
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  proposed_by uuid NOT NULL REFERENCES editor(id),
  approved_by uuid NOT NULL REFERENCES editor(id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz NOT NULL DEFAULT now(),
  reverses_merge_id uuid REFERENCES narrator_merge(id),
  snapshot_before jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT narrator_split_four_eyes CHECK (proposed_by <> approved_by),
  CONSTRAINT narrator_split_revision_step CHECK (source_revision_after > source_revision_before)
);

CREATE TABLE narrator_split_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_id uuid NOT NULL REFERENCES narrator_split(id) ON DELETE CASCADE,
  occurrence_id uuid NOT NULL REFERENCES narrator_occurrence(id),
  target_narrator_id uuid REFERENCES narrator(id),
  previous_narrator_id uuid REFERENCES narrator(id),
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 4),
  UNIQUE (split_id, occurrence_id)
);

-- --- Redirect fuer absorbierte kanonische IDs ---------------------------------
-- Eine absorbierte ID darf nie ins Leere zeigen. Aufloesung folgt der Kette,
-- bis kein Redirect mehr existiert; maximal acht Schritte.

CREATE TABLE narrator_id_redirect (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  absorbed_stable_key text NOT NULL UNIQUE,
  absorbed_narrator_id uuid NOT NULL REFERENCES narrator(id),
  target_narrator_id uuid NOT NULL REFERENCES narrator(id),
  target_stable_key text NOT NULL,
  merge_id uuid REFERENCES narrator_merge(id),
  split_id uuid REFERENCES narrator_split(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT narrator_id_redirect_no_self CHECK (absorbed_narrator_id <> target_narrator_id),
  CONSTRAINT narrator_id_redirect_has_cause CHECK (merge_id IS NOT NULL OR split_id IS NOT NULL)
);

CREATE INDEX narrator_stable_key_idx ON narrator (stable_key, revision);
CREATE INDEX narrator_merged_idx ON narrator (merged_into_id);
CREATE INDEX narrator_id_redirect_target_idx ON narrator_id_redirect (target_stable_key);
CREATE INDEX narrator_occurrence_narrator_idx ON narrator_occurrence (resolved_narrator_id);
CREATE INDEX narrator_occurrence_status_idx ON narrator_occurrence (identity_status);
CREATE INDEX identity_decision_occurrence_idx ON identity_decision (occurrence_id, created_at DESC);

INSERT INTO schema_migration (version, description)
VALUES ('0004', 'stable_key, revision, Redirect, Merge und Split')
ON CONFLICT (version) DO NOTHING;

COMMIT;
