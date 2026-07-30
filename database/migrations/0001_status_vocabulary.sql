-- 0001 — Ein Statusvokabular mit sechs Stufen (P2.3)
--
-- Vorher existierten drei unvereinbare Vokabulare:
--   lib/types.ts:3       verified | high | medium | low | conflict          (ohne unresolved)
--   database/schema.sql  verified | candidate | unresolved | conflict       (ohne die drei Stufen)
--   docs/05              sechs Stufen, nirgends implementiert
--
-- Ab hier gilt an allen drei Stellen identisch:
--   verified | high | medium | low | unresolved | conflict
--   Schwellen: high >= 0.90, medium 0.70..0.89, low < 0.70
--
-- 'candidate' wird nicht pauschal auf eine Stufe geworfen, sondern anhand des
-- vorhandenen Scores abgebildet. Wo kein Score existiert, ist das Ergebnis
-- 'unresolved' — das ist die ehrliche Aussage und keine stille Aufwertung.
--
-- Rueckbau: siehe Abschnitt "Ruecknahme" am Dateiende.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migration (
  version text PRIMARY KEY,
  description text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  checksum text
);

CREATE TYPE confidence_level AS ENUM ('verified', 'high', 'medium', 'low', 'unresolved', 'conflict');
CREATE TYPE assertion_origin AS ENUM ('machine', 'editorial', 'registry');

-- --- 1. narrator.identity_status: alter Typ -> confidence_level -----------------

ALTER TABLE narrator ADD COLUMN identity_status_v2 confidence_level;
ALTER TABLE narrator ADD COLUMN identity_score numeric(4,3) CHECK (identity_score BETWEEN 0 AND 1);
ALTER TABLE narrator ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';

-- 1a. Bester bekannter maschineller Score je Person.
CREATE TEMPORARY TABLE tmp_narrator_score AS
SELECT n.id AS narrator_id,
       max(s.score) AS score
FROM narrator n
JOIN (
  SELECT candidate_narrator_id AS narrator_id, max(confidence) AS score
  FROM identity_candidate
  GROUP BY candidate_narrator_id
  UNION ALL
  SELECT resolved_narrator_id AS narrator_id, max(resolution_confidence) AS score
  FROM narrator_occurrence
  WHERE resolved_narrator_id IS NOT NULL
  GROUP BY resolved_narrator_id
) s ON s.narrator_id = n.id
GROUP BY n.id;

UPDATE narrator n
SET identity_score = t.score
FROM tmp_narrator_score t
WHERE t.narrator_id = n.id;

-- 1b. Die drei unveraenderten Stufen uebernehmen.
UPDATE narrator SET identity_status_v2 = 'verified'::confidence_level
  WHERE identity_status::text = 'verified';
UPDATE narrator SET identity_status_v2 = 'unresolved'::confidence_level
  WHERE identity_status::text = 'unresolved';
UPDATE narrator SET identity_status_v2 = 'conflict'::confidence_level
  WHERE identity_status::text = 'conflict';

-- 1c. 'candidate' anhand des Scores auf high / medium / low abbilden.
UPDATE narrator
SET identity_status_v2 = CASE
      WHEN identity_score IS NULL      THEN 'unresolved'::confidence_level
      WHEN identity_score >= 0.90      THEN 'high'::confidence_level
      WHEN identity_score >= 0.70      THEN 'medium'::confidence_level
      ELSE                                  'low'::confidence_level
    END
WHERE identity_status::text = 'candidate';

-- 1d. Rest absichern und Spalte tauschen.
UPDATE narrator SET identity_status_v2 = 'unresolved'::confidence_level
  WHERE identity_status_v2 IS NULL;

ALTER TABLE narrator DROP COLUMN identity_status;
ALTER TABLE narrator RENAME COLUMN identity_status_v2 TO identity_status;
ALTER TABLE narrator ALTER COLUMN identity_status SET NOT NULL;
ALTER TABLE narrator ALTER COLUMN identity_status SET DEFAULT 'unresolved';

DROP TABLE tmp_narrator_score;

-- --- 2. Score und Stufe getrennt auf identity_candidate -----------------------
-- confidenceScore ist der maschinelle Zahlenwert, confidenceLevel die Stufe.
-- Beide duerfen sich nicht widersprechen.

ALTER TABLE identity_candidate RENAME COLUMN confidence TO confidence_score;
ALTER TABLE identity_candidate ADD COLUMN confidence_level confidence_level NOT NULL DEFAULT 'low';
ALTER TABLE identity_candidate ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';

UPDATE identity_candidate
SET confidence_level = CASE
      WHEN confidence_score >= 0.90 THEN 'high'::confidence_level
      WHEN confidence_score >= 0.70 THEN 'medium'::confidence_level
      ELSE                               'low'::confidence_level
    END;

-- --- 3. Erzaehlerposition erhaelt eine eigene Stufe ---------------------------
-- Ohne diese Spalte muss die API identityStatus bei jeder Antwort neu erfinden.

ALTER TABLE narrator_occurrence ADD COLUMN identity_status confidence_level NOT NULL DEFAULT 'unresolved';
ALTER TABLE narrator_occurrence ADD COLUMN origin assertion_origin NOT NULL DEFAULT 'machine';

UPDATE narrator_occurrence
SET identity_status = CASE
      WHEN resolved_narrator_id IS NULL      THEN 'unresolved'::confidence_level
      WHEN resolution_confidence IS NULL     THEN 'low'::confidence_level
      WHEN resolution_confidence >= 0.90     THEN 'high'::confidence_level
      WHEN resolution_confidence >= 0.70     THEN 'medium'::confidence_level
      ELSE                                        'low'::confidence_level
    END;

-- --- 4. Die Schwellen als Constraint ----------------------------------------
-- 'verified', 'unresolved' und 'conflict' sind redaktionelle bzw. strukturelle
-- Aussagen und deshalb von der Schwellenpruefung ausgenommen.

ALTER TABLE narrator ADD CONSTRAINT narrator_level_threshold CHECK (
  identity_score IS NULL
  OR identity_status IN ('verified', 'unresolved', 'conflict')
  OR (identity_status = 'high' AND identity_score >= 0.90)
  OR (identity_status = 'medium' AND identity_score >= 0.70 AND identity_score < 0.90)
  OR (identity_status = 'low' AND identity_score < 0.70)
);

ALTER TABLE identity_candidate ADD CONSTRAINT identity_candidate_level_threshold CHECK (
  confidence_level IN ('verified', 'unresolved', 'conflict')
  OR (confidence_level = 'high' AND confidence_score >= 0.90)
  OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
  OR (confidence_level = 'low' AND confidence_score < 0.70)
);

ALTER TABLE narrator_occurrence ADD CONSTRAINT narrator_occurrence_level_threshold CHECK (
  resolution_confidence IS NULL
  OR identity_status IN ('verified', 'unresolved', 'conflict')
  OR (identity_status = 'high' AND resolution_confidence >= 0.90)
  OR (identity_status = 'medium' AND resolution_confidence >= 0.70 AND resolution_confidence < 0.90)
  OR (identity_status = 'low' AND resolution_confidence < 0.70)
);

ALTER TABLE narrator_occurrence ADD CONSTRAINT narrator_occurrence_resolved_needs_status CHECK (
  resolved_narrator_id IS NULL OR identity_status <> 'unresolved'
);

-- Der alte Typ verschwindet erst, wenn keine Spalte ihn mehr benutzt.
DROP TYPE identity_status;

INSERT INTO schema_migration (version, description)
VALUES ('0001', 'ein Statusvokabular mit sechs Stufen')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Ruecknahme (nur solange 0002 nicht angewendet ist):
--   BEGIN;
--   CREATE TYPE identity_status AS ENUM ('verified','candidate','unresolved','conflict');
--   ALTER TABLE narrator ADD COLUMN identity_status_v1 identity_status;
--   UPDATE narrator SET identity_status_v1 = CASE
--     WHEN identity_status IN ('high','medium','low') THEN 'candidate'::identity_status
--     ELSE identity_status::text::identity_status END;
--   ALTER TABLE narrator DROP COLUMN identity_status;
--   ALTER TABLE narrator RENAME COLUMN identity_status_v1 TO identity_status;
--   -- ... umgekehrt fuer identity_candidate und narrator_occurrence
--   DELETE FROM schema_migration WHERE version = '0001';
--   COMMIT;
