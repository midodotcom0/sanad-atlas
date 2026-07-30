-- 0007 — Kanonische Personen-IDs werden erzeugt und aufgeloest (Umsetzungsplan P4.5)
--
-- Vorher: `narrator.stable_key` (SA-P-<base32(8)>), `narrator.revision`,
-- `narrator_merge`, `narrator_split` und `narrator_id_redirect` standen seit
-- 0004 vollstaendig im Schema — und kein einziger Laufzeitpfad hat je eine
-- solche ID erzeugt oder gelesen. Die IDs, unter denen Knoten tatsaechlich
-- zitiert wurden, waren die Occurrence-Cluster-IDs `UNC-<sha1(12)>` aus
-- `backend/app/repository.py:bucket_id()`. Zwei ID-Raeume, von denen der
-- dokumentierte leer war.
--
-- Diese Migration fuegt genau EIN fehlendes Stueck hinzu: die Tabelle, die
-- beide Raeume verbindet. Alles andere ist Laufzeitcode
-- (`scripts/atlas-id-scheme.mjs`, `backend/app/stable_keys.py`,
-- `scripts/atlas-build-lib.mjs`, `worker/src/core/identity.mjs`,
-- `worker/tools/atlas-identity.mjs`) und braucht kein Schema.
--
-- Warum eine eigene Tabelle und nicht `narrator_id_redirect`:
--
--   * `narrator_id_redirect` beantwortet „welche ANDERE Person hat diese ID
--     absorbiert?". Sie verlangt darum `absorbed_narrator_id <> target_narrator_id`
--     und einen Merge oder Split als Ursache — beides trifft auf eine
--     Alt-ID DERSELBEN Person nicht zu.
--   * `narrator_public_alias` beantwortet „unter welchen IDs war DIESE Person
--     jemals oeffentlich adressierbar?". Sie ist die Zusage, dass eine einmal
--     in einem Zitat verwendete ID nie ins Leere zeigt, auch wenn die
--     Namensform im naechsten Korpusstand gar nicht mehr vorkommt.
--
-- Beide Wege zusammen ergeben die vollstaendige Aufloesung:
--   alias_key -> narrator  (diese Tabelle)
--   narrator  -> aktueller narrator  (narrator_id_redirect, hoechstens acht Schritte)
--
-- Positionsgebundene Rueckverweisformen (`UNC-REL-`, „ابيه") bekommen KEINEN
-- Alias und keine kanonische ID. Sie sind keine globale Person, sondern eine
-- Aussage ueber genau eine Position in genau einer Kette; ein globaler
-- Schluessel dafuer waere die Behauptung einer Identitaet, die der Text nicht
-- hergibt.

BEGIN;

-- Die redundanten stable_key-Spalten in Alias und Redirect werden durch
-- zusammengesetzte Fremdschluessel an genau dieselbe narrator-Zeile gebunden.
ALTER TABLE narrator
  ADD CONSTRAINT narrator_id_stable_key_unique UNIQUE (id, stable_key);

-- Migration 0004 machte absorbed_stable_key global UNIQUE. Das verhindert
-- einen zweiten Merge derselben Person nach Split/Undo, weil die inaktive
-- Historienzeile den Schluessel fuer immer belegt. Nur aktive Redirects
-- muessen eindeutig sein.
ALTER TABLE narrator_id_redirect
  DROP CONSTRAINT narrator_id_redirect_absorbed_stable_key_key;
ALTER TABLE narrator_id_redirect
  DROP CONSTRAINT narrator_id_redirect_has_cause;
ALTER TABLE narrator_id_redirect
  ADD CONSTRAINT narrator_id_redirect_one_cause
    CHECK ((merge_id IS NULL) <> (split_id IS NULL)),
  ADD CONSTRAINT narrator_id_redirect_absorbed_key_fk
    FOREIGN KEY (absorbed_narrator_id, absorbed_stable_key)
    REFERENCES narrator(id, stable_key),
  ADD CONSTRAINT narrator_id_redirect_target_key_fk
    FOREIGN KEY (target_narrator_id, target_stable_key)
    REFERENCES narrator(id, stable_key);

CREATE UNIQUE INDEX narrator_id_redirect_active_key_idx
  ON narrator_id_redirect (absorbed_stable_key)
  WHERE is_active;

CREATE TABLE narrator_public_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Historische Zuordnungen bleiben nach Split/Undo erhalten; nur die aktive
  -- Zuordnung ist eindeutig (partieller Index unten).
  alias_key text NOT NULL,
  narrator_id uuid NOT NULL REFERENCES narrator(id),
  -- Redundant zu narrator_id, aber die Aufloesung braucht den Schluessel ohne
  -- zweiten Join; die Aufloesung laeuft auf jedem Profilaufruf.
  narrator_stable_key text NOT NULL,
  alias_kind text NOT NULL DEFAULT 'occurrence_cluster' CHECK (
    alias_kind IN (
      'occurrence_cluster',    -- UNC-<sha1(12)> der normalisierten Namensform
      'legacy_public_id',      -- frueher veroeffentlichte ID aus einem anderen Schema
      'superseded_revision'    -- ID, die eine frueher getrennte Person trug
    )
  ),
  first_seen_data_version text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Der kanonische Schluessel ist kein Alias seiner selbst.
  CONSTRAINT narrator_public_alias_not_canonical CHECK (alias_key <> narrator_stable_key),
  -- Relative Rueckverweise sind positionsgebunden und duerfen nie als globaler
  -- Personenalias registriert werden.
  CONSTRAINT narrator_public_alias_occurrence_kind CHECK (
    alias_kind <> 'occurrence_cluster'
    OR (alias_key LIKE 'UNC-%' AND alias_key NOT LIKE 'UNC-REL-%')
  ),
  CONSTRAINT narrator_public_alias_narrator_key_fk
    FOREIGN KEY (narrator_id, narrator_stable_key)
    REFERENCES narrator(id, stable_key)
);

CREATE INDEX narrator_public_alias_narrator_idx
  ON narrator_public_alias (narrator_id, alias_kind);
CREATE UNIQUE INDEX narrator_public_alias_active_key_idx
  ON narrator_public_alias (alias_key)
  WHERE is_active;

INSERT INTO schema_migration (version, description) VALUES
  ('0007', 'narrator_public_alias: Alt-IDs bleiben aufloesbar')
ON CONFLICT (version) DO NOTHING;

COMMIT;
