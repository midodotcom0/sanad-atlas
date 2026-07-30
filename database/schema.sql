-- Sanad Atlas canonical PostgreSQL schema.
-- PostgreSQL is the scholarly source of truth; search and graph indexes are projections.
--
-- Leitprinzip, mechanisch erzwungen und nicht nur dokumentiert:
--   1. Keine Information ohne Quelle        -> source_passage_id NOT NULL auf jeder Assertion
--                                              und auf jeder redaktionellen Entscheidung.
--   2. Keine Vermutung als Tatsache         -> confidence_level = 'verified' ist nur mit
--                                              origin = 'editorial' und gesetztem reviewed_by
--                                              erlaubt; maschinelle Zeilen (origin='machine')
--                                              koennen 'verified' nicht erreichen.
--   3. Keine Entscheidung ohne Begruendung  -> rationale text NOT NULL.
--   4. Jede Entscheidung reversibel         -> Audit-Tabellen sind append-only (Trigger);
--                                              Merge/Split fuehren snapshot_before mit sich.
--
-- Statusvokabular (P2.3, verbindlich in lib/types.ts, docs/05 und hier identisch):
--   verified | high | medium | low | unresolved | conflict
--   Schwellen: high >= 0.90, medium 0.70..0.89, low < 0.70.
--
-- Kanonische Personen-ID: SA-P-<base32(8)> plus ganzzahlige revision.
-- Positionsbindung einer Erzaehlerstelle: (chain_id, position, span_start, span_end).
--
-- Portabilitaetshinweise fuer den SQLite/D1-Uebersetzer (P3.1):
--   * ein Statement pro Objekt, keine Vererbung, keine Partitionen, keine Regeln;
--   * Bloecke zwischen "POSTGRES-ONLY BEGIN" und "POSTGRES-ONLY END" ueberspringen;
--   * Zeilen mit "SQLITE-TRANSLATE:" nennen die portable Ersatzform;
--   * ENUM-Typen werden zu TEXT plus CHECK (... IN (...)) uebersetzt;
--   * partielle UNIQUE-Indizes (CREATE UNIQUE INDEX ... WHERE ...) kennt SQLite ab 3.8.0.

-- >>> POSTGRES-ONLY BEGIN (SQLite translator: skip this block)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- <<< POSTGRES-ONLY END

-- ---------------------------------------------------------------------------
-- 0. Aufzaehlungstypen
-- ---------------------------------------------------------------------------

CREATE TYPE review_status AS ENUM ('machine_unreviewed', 'in_review', 'accepted', 'rejected', 'superseded');

-- Ein einziges Statusvokabular fuer Identitaet und Konfidenz (P2.3).
-- Ersetzt den alten Typ identity_status ('verified','candidate','unresolved','conflict');
-- 'candidate' wird in database/migrations/0001_status_vocabulary.sql anhand des Scores
-- auf high/medium/low abgebildet.
CREATE TYPE confidence_level AS ENUM ('verified', 'high', 'medium', 'low', 'unresolved', 'conflict');

-- Wer den Wert erzeugt hat. 'machine' darf niemals 'verified' setzen.
CREATE TYPE assertion_origin AS ENUM ('machine', 'editorial', 'registry');

-- docs/04-GRAPH-SCHEMA.md: Pflichtattribut jeder fachlichen Kante.
CREATE TYPE extraction_method AS ENUM ('manual', 'parser', 'entity_resolution_model');

CREATE TYPE precision_kind AS ENUM ('exact', 'range', 'before', 'after', 'approximate', 'unknown');

-- Evidenzklassen strikt getrennt. Eine chronologische Moeglichkeit ist niemals
-- ein Beleg fuer Hoeren oder Ueberlieferung.
CREATE TYPE evidence_kind AS ENUM ('isnad_link', 'rijal_statement', 'chronology_only');

CREATE TYPE chronology_result AS ENUM ('possible', 'impossible', 'insufficient');

CREATE TYPE cluster_status AS ENUM ('machine_suggestion', 'accepted', 'rejected', 'superseded');

-- Die zehn Pruefarten des Scholar-Dashboards aus Abschnitt 9 der Projektbeschreibung.
CREATE TYPE review_queue_kind AS ENUM (
  'identity_candidate',
  'narrator_merge_split',
  'relative_name_form',
  'date_assertion',
  'relationship_assertion',
  'place_assertion',
  'grade_assertion',
  'matn_cluster',
  'source_passage',
  'parser_error'
);

-- ---------------------------------------------------------------------------
-- 1. Migrationsbuchhaltung
-- ---------------------------------------------------------------------------

CREATE TABLE schema_migration (
  version text PRIMARY KEY,
  description text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  checksum text
);

-- ---------------------------------------------------------------------------
-- 2. Benutzerkonten und Rollen (Abschnitt 13; Vier-Augen-Freigabe Abschnitt 9)
-- ---------------------------------------------------------------------------

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
  -- Pipeline-Konten. Ein Maschinenkonto darf nie als reviewed_by oder approved_by
  -- auftreten; das erzwingt der Trigger sanad_reviewer_must_be_human.
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

-- Zugangsdaten fuer die getrennte Redaktionsschnittstelle (P5.8). Der
-- Klartext-Token wird niemals gespeichert; der Worker vergleicht ausschliesslich
-- den SHA-256-Hash eines mindestens 32 Byte zufaelligen Bearer-Tokens. Eine
-- Sperre ist bewusst ein expliziter Zustand und kein Loeschen der Historie.
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

-- ---------------------------------------------------------------------------
-- 3. Quellen, Editionen, Importe, Passagen
-- ---------------------------------------------------------------------------

CREATE TABLE source_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title_ar text NOT NULL,
  author_ar text,
  genre text NOT NULL,
  provider text NOT NULL,
  provider_work_id text,
  canonical_url text,
  rights_status text NOT NULL DEFAULT 'review_required',
  license_spdx text,
  -- Allowlist der oeffentlich ausspielbaren abgeleiteten Felder. Das Lizenz-Gate
  -- (P2.4) liest genau diese Spalte; ein leeres Objekt bedeutet: nichts freigegeben.
  public_field_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  retrieved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE edition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_work_id uuid NOT NULL REFERENCES source_work(id),
  editor_ar text,
  publisher_ar text,
  publication_year integer,
  edition_label text NOT NULL,
  rights_status text NOT NULL DEFAULT 'review_required',
  UNIQUE (source_work_id, edition_label)
);

CREATE TABLE import_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_work_id uuid NOT NULL REFERENCES source_work(id),
  source_version text NOT NULL,
  importer_version text NOT NULL,
  raw_object_key text NOT NULL,
  raw_sha256 text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  record_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_work_id, source_version, raw_sha256)
);

CREATE TABLE source_passage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_work_id uuid NOT NULL REFERENCES source_work(id),
  edition_id uuid REFERENCES edition(id),
  import_batch_id uuid REFERENCES import_batch(id),
  volume text,
  page text,
  source_locator jsonb NOT NULL,
  original_text text,
  original_text_sha256 text NOT NULL,
  stable_reference text,
  publication_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. Hadithbestand, Cluster, Matn-Familien, Ketten
-- ---------------------------------------------------------------------------

CREATE TABLE hadith_cluster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Eine stabile Clusterzuordnung entsteht erst nach redaktioneller Freigabe
  -- (Abschnitt 5). Deshalb ist stable_key vor 'accepted' NULL.
  -- SQLITE-TRANSLATE: '~' -> GLOB 'SA-C-[A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7]'
  stable_key text UNIQUE CHECK (stable_key IS NULL OR stable_key ~ '^SA-C-[A-Z2-7]{8}$'),
  method text NOT NULL,
  method_version text NOT NULL,
  status cluster_status NOT NULL DEFAULT 'machine_suggestion',
  origin assertion_origin NOT NULL DEFAULT 'machine',
  confidence_level confidence_level NOT NULL DEFAULT 'low',
  confidence_score numeric(4,3) CHECK (confidence_score BETWEEN 0 AND 1),
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hadith_cluster_level_threshold CHECK (
    confidence_score IS NULL
    OR confidence_level IN ('verified', 'unresolved', 'conflict')
    OR (confidence_level = 'high' AND confidence_score >= 0.90)
    OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
    OR (confidence_level = 'low' AND confidence_score < 0.70)
  ),
  CONSTRAINT hadith_cluster_verified_is_editorial CHECK (
    confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT hadith_cluster_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT hadith_cluster_decision_needs_reviewer CHECK (
    status IN ('machine_suggestion') OR reviewed_by IS NOT NULL
  ),
  CONSTRAINT hadith_cluster_accepted_needs_key CHECK (status <> 'accepted' OR stable_key IS NOT NULL)
);

CREATE TABLE hadith_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_work_id uuid NOT NULL REFERENCES source_work(id),
  edition_id uuid REFERENCES edition(id),
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  import_batch_id uuid NOT NULL REFERENCES import_batch(id),
  external_record_id text NOT NULL,
  source_order integer,
  book_heading text,
  chapter_heading text,
  primary_number text,
  arabic_matn text,
  normalized_matn text,
  full_raw_text text NOT NULL,
  full_raw_text_sha256 text NOT NULL,
  extraction_method extraction_method NOT NULL DEFAULT 'parser',
  parser_version text NOT NULL,
  parse_confidence numeric(4,3) CHECK (parse_confidence BETWEEN 0 AND 1),
  parse_error_code text,
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, external_record_id),
  CONSTRAINT hadith_record_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT hadith_record_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  )
);

CREATE TABLE hadith_number_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hadith_record_id uuid NOT NULL REFERENCES hadith_record(id) ON DELETE CASCADE,
  numbering_system text NOT NULL,
  number_value text NOT NULL,
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  origin assertion_origin NOT NULL DEFAULT 'machine',
  confidence_level confidence_level NOT NULL DEFAULT 'low',
  confidence_score numeric(4,3) CHECK (confidence_score BETWEEN 0 AND 1),
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  UNIQUE (hadith_record_id, numbering_system, number_value),
  CONSTRAINT hadith_number_alias_level_threshold CHECK (
    confidence_score IS NULL
    OR confidence_level IN ('verified', 'unresolved', 'conflict')
    OR (confidence_level = 'high' AND confidence_score >= 0.90)
    OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
    OR (confidence_level = 'low' AND confidence_score < 0.70)
  ),
  CONSTRAINT hadith_number_alias_verified_is_editorial CHECK (
    confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT hadith_number_alias_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT hadith_number_alias_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  )
);

CREATE TABLE cluster_membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES hadith_cluster(id),
  hadith_record_id uuid NOT NULL REFERENCES hadith_record(id),
  similarity jsonb NOT NULL,
  extraction_method extraction_method NOT NULL DEFAULT 'parser',
  parser_version text,
  origin assertion_origin NOT NULL DEFAULT 'machine',
  confidence_level confidence_level NOT NULL DEFAULT 'low',
  confidence_score numeric(4,3) CHECK (confidence_score BETWEEN 0 AND 1),
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  UNIQUE (cluster_id, hadith_record_id),
  CONSTRAINT cluster_membership_level_threshold CHECK (
    confidence_score IS NULL
    OR confidence_level IN ('verified', 'unresolved', 'conflict')
    OR (confidence_level = 'high' AND confidence_score >= 0.90)
    OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
    OR (confidence_level = 'low' AND confidence_score < 0.70)
  ),
  CONSTRAINT cluster_membership_verified_is_editorial CHECK (
    confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT cluster_membership_score_is_machine CHECK (
    confidence_score IS NULL OR extraction_method <> 'manual'
  ),
  CONSTRAINT cluster_membership_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT cluster_membership_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  )
);

CREATE TABLE matn_variant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES hadith_cluster(id),
  family_key text NOT NULL,
  -- Die Familienfarbe ist an die Familie gebunden, nicht an die Ansicht. Sie muss
  -- in Matn-Text, Isnad-Graph, Vergleich, Tabellen und Filtern identisch bleiben.
  color_token text NOT NULL,
  normalized_text text NOT NULL,
  representative_record_id uuid REFERENCES hadith_record(id),
  method_version text NOT NULL,
  origin assertion_origin NOT NULL DEFAULT 'machine',
  confidence_level confidence_level NOT NULL DEFAULT 'low',
  confidence_score numeric(4,3) CHECK (confidence_score BETWEEN 0 AND 1),
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  UNIQUE (cluster_id, family_key),
  UNIQUE (cluster_id, color_token),
  CONSTRAINT matn_variant_verified_is_editorial CHECK (
    confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT matn_variant_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT matn_variant_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  )
);

CREATE TABLE isnad_chain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hadith_record_id uuid NOT NULL REFERENCES hadith_record(id) ON DELETE CASCADE,
  matn_variant_id uuid REFERENCES matn_variant(id),
  chain_order integer NOT NULL CHECK (chain_order >= 0),
  raw_isnad text NOT NULL,
  -- Zeichenoffsets im Rohtext des Datensatzes. Ohne diese beiden Werte ist das
  -- Abnahmekriterium "jede Kette positionsgenau zum Rohtext rekonstruierbar"
  -- nicht pruefbar.
  span_start integer,
  span_end integer,
  extraction_method extraction_method NOT NULL DEFAULT 'parser',
  parser_version text NOT NULL,
  parse_confidence numeric(4,3) CHECK (parse_confidence BETWEEN 0 AND 1),
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  UNIQUE (hadith_record_id, chain_order),
  CONSTRAINT isnad_chain_span_order CHECK (span_start IS NULL OR span_end IS NULL OR span_end > span_start),
  CONSTRAINT isnad_chain_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT isnad_chain_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  )
);

-- ---------------------------------------------------------------------------
-- 5. Personen
-- ---------------------------------------------------------------------------

CREATE TABLE narrator (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Kanonische Personen-ID des Vertrags: SA-P-<base32(8)>. Die uuid bleibt
  -- interner Verbundschluessel; nach aussen gilt ausschliesslich stable_key.
  -- Eine narrator-Zeile wird erst fuer eine Identitaetsentitaet angelegt,
  -- niemals pauschal je normalisierter Namensform: ein UNC-Namenscluster kann
  -- mehrere homonyme Personen enthalten. `unresolved` bedeutet, dass diese
  -- Entitaet noch nicht verifiziert ist, nicht dass ein Import jeden gleichen
  -- Namen vorab zu einer Person zusammenlegen darf.
  -- SQLITE-TRANSLATE: '~' -> GLOB 'SA-P-[A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7]'
  stable_key text NOT NULL UNIQUE CHECK (stable_key ~ '^SA-P-[A-Z2-7]{8}$'),
  -- Ganzzahlige Revision der kanonischen Person. Merge und Split erhoehen sie;
  -- der stable_key bleibt dabei stabil.
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  canonical_arabic_name text NOT NULL,
  normalized_name text NOT NULL,
  -- Homonyme sind fachlich normal. Der Index unten erzwingt Eindeutigkeit ueber
  -- (normalized_name, homonym_index), damit ein Reimport keine stille Dublette
  -- erzeugt, gleichnamige Personen aber weiterhin getrennt bleiben duerfen.
  homonym_index integer NOT NULL DEFAULT 0 CHECK (homonym_index >= 0),
  full_nasab text,
  kunya text,
  nisba text,
  laqab text,
  generation text,
  generation_number integer,
  primary_region text,
  identity_status confidence_level NOT NULL DEFAULT 'unresolved',
  identity_score numeric(4,3) CHECK (identity_score BETWEEN 0 AND 1),
  origin assertion_origin NOT NULL DEFAULT 'machine',
  -- Bei einem Merge absorbierte Person: die Zeile bleibt erhalten, damit der
  -- Merge zurueckgenommen werden kann. Aufloesung erfolgt ueber narrator_id_redirect.
  merged_into_id uuid REFERENCES narrator(id),
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT narrator_not_merged_into_self CHECK (merged_into_id IS NULL OR merged_into_id <> id),
  CONSTRAINT narrator_level_threshold CHECK (
    identity_score IS NULL
    OR identity_status IN ('verified', 'unresolved', 'conflict')
    OR (identity_status = 'high' AND identity_score >= 0.90)
    OR (identity_status = 'medium' AND identity_score >= 0.70 AND identity_score < 0.90)
    OR (identity_status = 'low' AND identity_score < 0.70)
  ),
  CONSTRAINT narrator_verified_is_editorial CHECK (
    identity_status <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT narrator_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT narrator_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  ),
  -- Ermoeglicht zusammengesetzte Fremdschluessel, die redundante stable_key-
  -- Spalten in Alias und Redirect gegen die tatsaechliche narrator-Zeile
  -- absichern. Ohne diese Kopplung koennte ein Alias auf narrator A zeigen,
  -- aber den stable_key von narrator B aufloesen.
  CONSTRAINT narrator_id_stable_key_unique UNIQUE (id, stable_key)
);

-- Reimport-Schutz: gleiche normalisierte Namensform nur einmal je Homonym-Index,
-- absorbierte Personen zaehlen nicht mit.
CREATE UNIQUE INDEX narrator_normalized_name_key
  ON narrator (normalized_name, homonym_index)
  WHERE merged_into_id IS NULL;

CREATE TABLE narrator_name_variant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  narrator_id uuid NOT NULL REFERENCES narrator(id),
  raw_name text NOT NULL,
  normalized_name text NOT NULL,
  transliteration text,
  variant_kind text NOT NULL DEFAULT 'surface'
    CHECK (variant_kind IN ('surface', 'kunya', 'nisba', 'laqab', 'nasab', 'transliteration', 'abbreviation')),
  -- Keine Namensvariante ohne Quelle.
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  source_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  extraction_method extraction_method NOT NULL DEFAULT 'parser',
  parser_version text,
  origin assertion_origin NOT NULL DEFAULT 'machine',
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  UNIQUE (narrator_id, normalized_name, variant_kind, source_passage_id),
  CONSTRAINT narrator_name_variant_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT narrator_name_variant_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  )
);

CREATE TABLE narrator_occurrence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Positionsbindung des Vertrags: (chain_id, position, span_start, span_end).
  chain_id uuid NOT NULL REFERENCES isnad_chain(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  raw_surface_form text NOT NULL,
  normalized_surface_form text NOT NULL,
  transmission_term text,
  -- Relative Formen wie ابيه, عمه, اخيه, جده sind keine globale Person. Sie bleiben
  -- an genau diese Position gebunden; die Aufloesung haengt nur an (chain_id, position).
  is_relative_form boolean NOT NULL DEFAULT false,
  relative_form_kind text CHECK (relative_form_kind IN ('father', 'grandfather', 'uncle', 'brother', 'unnamed_man', 'unnamed_shaykh', 'other')),
  resolved_narrator_id uuid REFERENCES narrator(id),
  identity_status confidence_level NOT NULL DEFAULT 'unresolved',
  resolution_confidence numeric(4,3) CHECK (resolution_confidence BETWEEN 0 AND 1),
  resolver_version text,
  origin assertion_origin NOT NULL DEFAULT 'machine',
  span_start integer,
  span_end integer,
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  UNIQUE (chain_id, position),
  CONSTRAINT narrator_occurrence_span_order CHECK (span_start IS NULL OR span_end IS NULL OR span_end > span_start),
  CONSTRAINT narrator_occurrence_relative_kind CHECK (is_relative_form OR relative_form_kind IS NULL),
  -- Eine relative Form darf nie global aufgeloest gelten, ohne dass ein Editor
  -- die Position entschieden hat.
  CONSTRAINT narrator_occurrence_relative_needs_editor CHECK (
    is_relative_form = false OR resolved_narrator_id IS NULL OR reviewed_by IS NOT NULL
  ),
  CONSTRAINT narrator_occurrence_level_threshold CHECK (
    resolution_confidence IS NULL
    OR identity_status IN ('verified', 'unresolved', 'conflict')
    OR (identity_status = 'high' AND resolution_confidence >= 0.90)
    OR (identity_status = 'medium' AND resolution_confidence >= 0.70 AND resolution_confidence < 0.90)
    OR (identity_status = 'low' AND resolution_confidence < 0.70)
  ),
  CONSTRAINT narrator_occurrence_verified_is_editorial CHECK (
    identity_status <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT narrator_occurrence_resolved_needs_status CHECK (
    resolved_narrator_id IS NULL OR identity_status <> 'unresolved'
  ),
  CONSTRAINT narrator_occurrence_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT narrator_occurrence_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  )
);

-- ---------------------------------------------------------------------------
-- 6. Gelehrte (Kritiker) und Orte  (docs/03-DATA-MODEL.md:109-110)
-- ---------------------------------------------------------------------------

CREATE TABLE scholar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SQLITE-TRANSLATE: '~' -> GLOB 'SA-S-[A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7]'
  stable_key text NOT NULL UNIQUE CHECK (stable_key ~ '^SA-S-[A-Z2-7]{8}$'),
  canonical_arabic_name text NOT NULL,
  normalized_name text NOT NULL,
  homonym_index integer NOT NULL DEFAULT 0 CHECK (homonym_index >= 0),
  transliteration text,
  -- Viele Kritiker sind selbst Ueberlieferer. Die Verknuepfung ist optional und
  -- quellenpflichtig wie jede andere Aussage.
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
  -- SQLITE-TRANSLATE: '~' -> GLOB 'SA-L-[A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7][A-Z2-7]'
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

-- ---------------------------------------------------------------------------
-- 7. Rijal-Quelleneintraege  (27.105 Datensaetze aus Tahdhib, Mizan, Taqrib)
-- ---------------------------------------------------------------------------

CREATE TABLE rijal_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_work_id uuid NOT NULL REFERENCES source_work(id),
  edition_id uuid REFERENCES edition(id),
  -- Kein Rijal-Eintrag ohne Quellenpassage.
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  import_batch_id uuid NOT NULL REFERENCES import_batch(id),
  -- Schluessel des Importers, z. B. "tahdhib-1234-56-7". Traegt die Reimport-Identitaet.
  external_entry_id text NOT NULL,
  -- Als Text, weil Eintragsnummern arabisch-indische Ziffern und Zusaetze tragen.
  entry_number text NOT NULL,
  entry_number_int integer,

  -- Echter Namenskopf statt 180-Zeichen-Schnitt (Befund B1). Rohform und
  -- normalisierte Form bleiben getrennt erhalten.
  name_head_raw text NOT NULL,
  name_head_normalized text NOT NULL,
  full_nasab text,
  kunya text,
  nisba text,
  laqab text,
  tabaqa text,
  tabaqa_number integer,

  -- Datierungskandidaten des Parsers. Sie sind noch keine date_assertion; erst
  -- die Uebernahme in date_assertion macht sie zu einer belegten Aussage.
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

  -- Lehrer- und Schuelerphrase im Wortlaut plus die vom Parser zerlegte Liste.
  teacher_phrase text,
  student_phrase text,
  teacher_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  student_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  grade_phrase text,

  entry_text text,
  entry_text_sha256 text NOT NULL,
  volume text,
  printed_page text,
  -- Offsets im Rohtext der Seite, damit der Eintrag zum Original zurueckschneidbar ist.
  span_start integer,
  span_end integer,

  -- Ein Rijal-Eintrag ist eine Quellenstelle, keine kanonische Person. Die
  -- Verknuepfung bleibt ein Vorschlag, bis ein Editor sie entscheidet.
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

-- ---------------------------------------------------------------------------
-- 8. Identitaetsaufloesung
-- ---------------------------------------------------------------------------

CREATE TABLE identity_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES narrator_occurrence(id),
  -- Ein Kandidat ist entweder eine bereits bekannte Person oder ein einzelner
  -- Rijal-Quelleneintrag. Beides bleibt Vorschlag; nichts wird verschmolzen.
  candidate_narrator_id uuid REFERENCES narrator(id),
  candidate_rijal_entry_id uuid REFERENCES rijal_entry(id),
  -- Rangfolge der Namensnaehe. exact_name > name_prefix > name_contains > biography_mention.
  match_kind text NOT NULL DEFAULT 'name_contains'
    CHECK (match_kind IN ('exact_name', 'name_prefix', 'name_contains', 'biography_mention')),
  confidence_score numeric(4,3) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  confidence_level confidence_level NOT NULL DEFAULT 'low',
  matching_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflicting_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  extraction_method extraction_method NOT NULL DEFAULT 'entity_resolution_model',
  resolver_version text NOT NULL,
  weight_profile_version text,
  origin assertion_origin NOT NULL DEFAULT 'machine',
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  data_version text NOT NULL,
  CONSTRAINT identity_candidate_one_target CHECK (
    (candidate_narrator_id IS NOT NULL AND candidate_rijal_entry_id IS NULL)
    OR (candidate_narrator_id IS NULL AND candidate_rijal_entry_id IS NOT NULL)
  ),
  CONSTRAINT identity_candidate_level_threshold CHECK (
    confidence_level IN ('verified', 'unresolved', 'conflict')
    OR (confidence_level = 'high' AND confidence_score >= 0.90)
    OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
    OR (confidence_level = 'low' AND confidence_score < 0.70)
  ),
  -- Ein maschineller Kandidat ist niemals 'verified'.
  CONSTRAINT identity_candidate_never_machine_verified CHECK (
    confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT identity_candidate_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT identity_candidate_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  )
);

-- Reimport-Schutz je Zielart (Vorbild: alte UNIQUE auf identity_candidate).
CREATE UNIQUE INDEX identity_candidate_narrator_key
  ON identity_candidate (occurrence_id, candidate_narrator_id, resolver_version)
  WHERE candidate_narrator_id IS NOT NULL;
CREATE UNIQUE INDEX identity_candidate_rijal_key
  ON identity_candidate (occurrence_id, candidate_rijal_entry_id, resolver_version)
  WHERE candidate_rijal_entry_id IS NOT NULL;

CREATE TABLE identity_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES narrator_occurrence(id),
  chosen_narrator_id uuid REFERENCES narrator(id),
  action text NOT NULL CHECK (action IN ('confirm', 'reject', 'merge', 'split', 'unresolve')),
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 12),
  -- Quellenpflicht: keine redaktionelle Entscheidung ohne mindestens eine Quelle.
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  editor_id uuid NOT NULL REFERENCES editor(id),
  -- Vier-Augen-Freigabe. Merge und Split verlangen zwei verschiedene Editoren.
  approved_by uuid REFERENCES editor(id),
  approved_at timestamptz,
  supersedes_id uuid REFERENCES identity_decision(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_decision_four_eyes CHECK (
    action NOT IN ('merge', 'split') OR (approved_by IS NOT NULL AND approved_by <> editor_id)
  ),
  CONSTRAINT identity_decision_approval_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT identity_decision_confirm_needs_target CHECK (
    action <> 'confirm' OR chosen_narrator_id IS NOT NULL
  )
);

-- ---------------------------------------------------------------------------
-- 9. Merge und Split: mechanisch reversibel  (Abschnitt 9)
-- ---------------------------------------------------------------------------

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
  -- Alles, was zur Ruecknahme gebraucht wird: Zustand der Zielperson, der
  -- absorbierten Personen und der umgehaengten Occurrences vor dem Merge.
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
  -- Ein Split kann die Ruecknahme eines konkreten Merges sein.
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
  -- Explizit ausgewaehltes Ziel. NULL bedeutet: Position wird bewusst wieder
  -- auf 'unresolved' zurueckgestellt.
  target_narrator_id uuid REFERENCES narrator(id),
  previous_narrator_id uuid REFERENCES narrator(id),
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 4),
  UNIQUE (split_id, occurrence_id)
);

-- Aufloesung absorbierter kanonischer IDs. Aufloesung folgt der Kette, bis kein
-- Redirect mehr existiert; maximal acht Schritte.
CREATE TABLE narrator_id_redirect (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nicht global UNIQUE: nach einem rueckgaengig gemachten Merge muss dieselbe
  -- stabile ID spaeter erneut absorbiert werden koennen. Eindeutig ist nur die
  -- aktive Zuordnung (partieller Index in Abschnitt 14).
  absorbed_stable_key text NOT NULL,
  absorbed_narrator_id uuid NOT NULL REFERENCES narrator(id),
  target_narrator_id uuid NOT NULL REFERENCES narrator(id),
  target_stable_key text NOT NULL,
  merge_id uuid REFERENCES narrator_merge(id),
  split_id uuid REFERENCES narrator_split(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT narrator_id_redirect_no_self CHECK (absorbed_narrator_id <> target_narrator_id),
  CONSTRAINT narrator_id_redirect_one_cause CHECK ((merge_id IS NULL) <> (split_id IS NULL)),
  CONSTRAINT narrator_id_redirect_absorbed_key_fk
    FOREIGN KEY (absorbed_narrator_id, absorbed_stable_key)
    REFERENCES narrator(id, stable_key),
  CONSTRAINT narrator_id_redirect_target_key_fk
    FOREIGN KEY (target_narrator_id, target_stable_key)
    REFERENCES narrator(id, stable_key)
);

-- Oeffentlich verwendete Alt-IDs DERSELBEN Person (Migration 0007, P4.5).
-- Abgrenzung zu narrator_id_redirect eine Zeile hoeher:
--   narrator_id_redirect  -- welche ANDERE Person hat diese ID absorbiert?
--                            (verlangt darum absorbed <> target und einen
--                            Merge oder Split als Ursache)
--   narrator_public_alias -- unter welchen IDs war DIESE Person jemals
--                            oeffentlich adressierbar?
-- Die zweite Frage entsteht, weil die Knoten-IDs des Vertrags bis P4.5
-- Occurrence-Cluster-IDs (UNC-<sha1(12)>) waren. Eine ID, die einmal in einem
-- Zitat stand, darf nicht ins Leere zeigen -- auch dann nicht, wenn die
-- Namensform im naechsten Korpusstand nicht mehr vorkommt.
-- Positionsgebundene Rueckverweisformen (UNC-REL-) bekommen KEINEN Alias:
-- sie sind keine globale Person (siehe narrator_occurrence.is_relative_form).
CREATE TABLE narrator_public_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Historische Aliaszeilen bleiben nach Split/Undo erhalten. Nur eine aktive
  -- Zuordnung je alias_key ist erlaubt (partieller Index in Abschnitt 14).
  alias_key text NOT NULL,
  narrator_id uuid NOT NULL REFERENCES narrator(id),
  narrator_stable_key text NOT NULL,
  alias_kind text NOT NULL DEFAULT 'occurrence_cluster' CHECK (
    alias_kind IN ('occurrence_cluster', 'legacy_public_id', 'superseded_revision')
  ),
  first_seen_data_version text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT narrator_public_alias_not_canonical CHECK (alias_key <> narrator_stable_key),
  CONSTRAINT narrator_public_alias_occurrence_kind CHECK (
    alias_kind <> 'occurrence_cluster'
    OR (alias_key LIKE 'UNC-%' AND alias_key NOT LIKE 'UNC-REL-%')
  ),
  CONSTRAINT narrator_public_alias_narrator_key_fk
    FOREIGN KEY (narrator_id, narrator_stable_key)
    REFERENCES narrator(id, stable_key)
);

-- ---------------------------------------------------------------------------
-- 10. Datierungen
-- ---------------------------------------------------------------------------

CREATE TABLE date_assertion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  narrator_id uuid NOT NULL REFERENCES narrator(id),
  event_type text NOT NULL CHECK (event_type IN ('birth', 'death', 'residence', 'travel')),
  -- SQLITE-TRANSLATE: 'precision' ist in SQLite ein Schluesselwort, daher date_precision.
  date_precision precision_kind NOT NULL,
  year_min_ah integer,
  year_max_ah integer,
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
  data_version text NOT NULL,
  -- Abgeleitete Datierungen muessen sichtbar abgeleitet sein.
  is_derived boolean NOT NULL DEFAULT false,
  derived_from_id uuid REFERENCES date_assertion(id),
  derivation_rule text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT date_assertion_range CHECK (
    year_min_ah IS NULL OR year_max_ah IS NULL OR year_min_ah <= year_max_ah
  ),
  CONSTRAINT date_assertion_derivation CHECK (
    is_derived = false OR (derived_from_id IS NOT NULL AND derivation_rule IS NOT NULL)
  ),
  -- "Fehlende Geburtsjahre duerfen nicht heimlich aus Todesjahren geschaetzt
  -- werden." Ein Geburtsjahr ist deshalb niemals abgeleitet.
  CONSTRAINT date_assertion_birth_never_derived CHECK (event_type <> 'birth' OR is_derived = false),
  CONSTRAINT date_assertion_level_threshold CHECK (
    confidence_score IS NULL
    OR confidence_level IN ('verified', 'unresolved', 'conflict')
    OR (confidence_level = 'high' AND confidence_score >= 0.90)
    OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
    OR (confidence_level = 'low' AND confidence_score < 0.70)
  ),
  CONSTRAINT date_assertion_verified_is_editorial CHECK (
    confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT date_assertion_score_is_machine CHECK (
    confidence_score IS NULL OR extraction_method <> 'manual'
  ),
  CONSTRAINT date_assertion_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT date_assertion_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  ),
  -- Reimport-Schutz: dieselbe Aussage aus derselben Passage nur einmal.
  UNIQUE (narrator_id, event_type, year_min_ah, year_max_ah, source_passage_id, parser_version)
);

-- ---------------------------------------------------------------------------
-- 11. Beziehungen, Begegnungen, Bewertungen, Orte
-- ---------------------------------------------------------------------------

CREATE TABLE relationship_assertion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_narrator_id uuid NOT NULL REFERENCES narrator(id),
  object_narrator_id uuid NOT NULL REFERENCES narrator(id),
  relationship_type text NOT NULL CHECK (
    relationship_type IN ('teacher', 'student', 'transmitted_from', 'transmitted_to', 'contemporary')
  ),
  evidence_kind evidence_kind NOT NULL,

  -- Positionsbindung. Ohne den Occurrence-Bezug sind positionsgebundene Formen
  -- wie ابيه nicht rekonstruierbar (Luecke 6).
  chain_id uuid REFERENCES isnad_chain(id),
  subject_occurrence_id uuid REFERENCES narrator_occurrence(id),
  object_occurrence_id uuid REFERENCES narrator_occurrence(id),

  -- Keine Aussage ohne Quelle. Auch eine Isnad-Kante haengt an der Passage des
  -- Hadithdatensatzes, aus dem sie stammt.
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  rijal_entry_id uuid REFERENCES rijal_entry(id),
  original_phrase text,

  chronology chronology_result NOT NULL DEFAULT 'insufficient',
  -- Eine chronologische Moeglichkeit muss angeben, auf welchen Datierungen sie
  -- beruht (Luecke 7). Die vollstaendige Liste steht in chronology_basis.
  chronology_subject_date_id uuid REFERENCES date_assertion(id),
  chronology_object_date_id uuid REFERENCES date_assertion(id),

  extraction_method extraction_method NOT NULL DEFAULT 'parser',
  parser_version text,
  origin assertion_origin NOT NULL DEFAULT 'machine',
  confidence_level confidence_level NOT NULL DEFAULT 'low',
  confidence_score numeric(4,3) CHECK (confidence_score BETWEEN 0 AND 1),
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  -- Gueltigkeitszeitraum der Kante in AH (docs/04-GRAPH-SCHEMA.md:33).
  valid_from_ah integer,
  valid_to_ah integer,
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT relationship_distinct_persons CHECK (subject_narrator_id <> object_narrator_id),
  CONSTRAINT relationship_valid_range CHECK (
    valid_from_ah IS NULL OR valid_to_ah IS NULL OR valid_from_ah <= valid_to_ah
  ),
  -- Evidenzklassen strikt getrennt.
  CONSTRAINT relationship_isnad_needs_positions CHECK (
    evidence_kind <> 'isnad_link'
    OR (chain_id IS NOT NULL AND subject_occurrence_id IS NOT NULL AND object_occurrence_id IS NOT NULL)
  ),
  CONSTRAINT relationship_rijal_needs_passage CHECK (
    evidence_kind <> 'rijal_statement' OR rijal_entry_id IS NOT NULL OR original_phrase IS NOT NULL
  ),
  CONSTRAINT relationship_chronology_has_no_chain CHECK (
    evidence_kind <> 'chronology_only' OR (chain_id IS NULL AND subject_occurrence_id IS NULL AND object_occurrence_id IS NULL)
  ),
  -- Eine chronologische Moeglichkeit nennt die beiden tragenden Datierungen.
  CONSTRAINT relationship_chronology_needs_dates CHECK (
    evidence_kind <> 'chronology_only'
    OR (chronology_subject_date_id IS NOT NULL AND chronology_object_date_id IS NOT NULL)
  ),
  -- Eine chronologische Moeglichkeit ist niemals ein Beleg fuer Hoeren oder
  -- Ueberlieferung. Sie darf ausschliesslich als 'contemporary' auftreten.
  CONSTRAINT relationship_chronology_is_never_transmission CHECK (
    evidence_kind <> 'chronology_only' OR relationship_type = 'contemporary'
  ),
  CONSTRAINT relationship_distinct_occurrences CHECK (
    subject_occurrence_id IS NULL OR object_occurrence_id IS NULL
    OR subject_occurrence_id <> object_occurrence_id
  ),
  CONSTRAINT relationship_level_threshold CHECK (
    confidence_score IS NULL
    OR confidence_level IN ('verified', 'unresolved', 'conflict')
    OR (confidence_level = 'high' AND confidence_score >= 0.90)
    OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
    OR (confidence_level = 'low' AND confidence_score < 0.70)
  ),
  CONSTRAINT relationship_verified_is_editorial CHECK (
    confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT relationship_score_is_machine CHECK (
    confidence_score IS NULL OR extraction_method <> 'manual'
  ),
  CONSTRAINT relationship_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT relationship_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  )
);

-- Reimport-Schutz je Evidenzklasse. Vorbild: der alte UNIQUE-Schluessel auf
-- identity_candidate mit Resolver-Version.
CREATE UNIQUE INDEX relationship_isnad_key
  ON relationship_assertion (subject_occurrence_id, object_occurrence_id, relationship_type, parser_version)
  WHERE evidence_kind = 'isnad_link';
CREATE UNIQUE INDEX relationship_rijal_key
  ON relationship_assertion (subject_narrator_id, object_narrator_id, relationship_type, source_passage_id, parser_version)
  WHERE evidence_kind = 'rijal_statement';
CREATE UNIQUE INDEX relationship_chronology_key
  ON relationship_assertion (subject_narrator_id, object_narrator_id, chronology_subject_date_id, chronology_object_date_id)
  WHERE evidence_kind = 'chronology_only';

CREATE TABLE meeting_assertion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_narrator_id uuid NOT NULL REFERENCES narrator(id),
  object_narrator_id uuid NOT NULL REFERENCES narrator(id),
  assertion_type text NOT NULL CHECK (
    assertion_type IN ('met', 'heard_from', 'contemporary_only', 'impossible')
  ),
  source_passage_id uuid REFERENCES source_passage(id),
  chain_id uuid REFERENCES isnad_chain(id),
  subject_occurrence_id uuid REFERENCES narrator_occurrence(id),
  object_occurrence_id uuid REFERENCES narrator_occurrence(id),
  original_phrase text,
  chronology_subject_date_id uuid REFERENCES date_assertion(id),
  chronology_object_date_id uuid REFERENCES date_assertion(id),
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
  CONSTRAINT meeting_distinct_persons CHECK (subject_narrator_id <> object_narrator_id),
  -- "Begegnung", "Hoeren" und "Ueberlieferung von" nur mit tragender Stelle.
  CONSTRAINT meeting_claim_needs_evidence CHECK (
    assertion_type NOT IN ('met', 'heard_from')
    OR source_passage_id IS NOT NULL OR chain_id IS NOT NULL
  ),
  -- Eine blosse Gleichzeitigkeit oder Unmoeglichkeit nennt ihre Datierungen.
  CONSTRAINT meeting_chronology_needs_dates CHECK (
    assertion_type NOT IN ('contemporary_only', 'impossible')
    OR (chronology_subject_date_id IS NOT NULL AND chronology_object_date_id IS NOT NULL)
  ),
  -- Aus Chronologie darf niemals Hoeren werden.
  CONSTRAINT meeting_chronology_is_not_hearing CHECK (
    assertion_type NOT IN ('met', 'heard_from')
    OR extraction_method <> 'entity_resolution_model'
    OR source_passage_id IS NOT NULL
  ),
  CONSTRAINT meeting_level_threshold CHECK (
    confidence_score IS NULL
    OR confidence_level IN ('verified', 'unresolved', 'conflict')
    OR (confidence_level = 'high' AND confidence_score >= 0.90)
    OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
    OR (confidence_level = 'low' AND confidence_score < 0.70)
  ),
  CONSTRAINT meeting_verified_is_editorial CHECK (
    confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT meeting_score_is_machine CHECK (
    confidence_score IS NULL OR extraction_method <> 'manual'
  ),
  CONSTRAINT meeting_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT meeting_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  ),
  UNIQUE (subject_narrator_id, object_narrator_id, assertion_type, source_passage_id, chain_id, parser_version)
);

-- Vollstaendige Liste der Datierungen, auf denen eine chronologische Aussage beruht.
CREATE TABLE chronology_basis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_assertion_id uuid REFERENCES relationship_assertion(id) ON DELETE CASCADE,
  meeting_assertion_id uuid REFERENCES meeting_assertion(id) ON DELETE CASCADE,
  date_assertion_id uuid NOT NULL REFERENCES date_assertion(id),
  basis_role text NOT NULL CHECK (
    basis_role IN ('subject_birth', 'subject_death', 'object_birth', 'object_death', 'subject_residence', 'object_residence')
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

CREATE TABLE grade_assertion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  narrator_id uuid NOT NULL REFERENCES narrator(id),
  scholar_id uuid REFERENCES scholar(id),
  critic_narrator_id uuid REFERENCES narrator(id),
  original_phrase text NOT NULL,
  normalized_category text,
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  rijal_entry_id uuid REFERENCES rijal_entry(id),
  temporal_scope text,
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
  CONSTRAINT grade_level_threshold CHECK (
    confidence_score IS NULL
    OR confidence_level IN ('verified', 'unresolved', 'conflict')
    OR (confidence_level = 'high' AND confidence_score >= 0.90)
    OR (confidence_level = 'medium' AND confidence_score >= 0.70 AND confidence_score < 0.90)
    OR (confidence_level = 'low' AND confidence_score < 0.70)
  ),
  CONSTRAINT grade_verified_is_editorial CHECK (
    confidence_level <> 'verified' OR (origin = 'editorial' AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT grade_score_is_machine CHECK (
    confidence_score IS NULL OR extraction_method <> 'manual'
  ),
  CONSTRAINT grade_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT grade_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  ),
  UNIQUE (narrator_id, scholar_id, source_passage_id, original_phrase)
);

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

-- ---------------------------------------------------------------------------
-- 12. Zusaetzliche Quellenbelege
-- ---------------------------------------------------------------------------

-- Die erste, zwingende Quelle steht als NOT-NULL-Fremdschluessel auf der
-- jeweiligen Fachtabelle. Diese Tabelle nimmt jede weitere Quelle auf, damit
-- sourceReferences im API-Vertrag mehrere Stellen ausgeben kann. Absichtlich
-- polymorph; entity_type ist gegen eine geschlossene Liste geprueft.
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

-- ---------------------------------------------------------------------------
-- 13. Review-Queue und Audit
-- ---------------------------------------------------------------------------

CREATE TABLE parse_review_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES import_batch(id),
  queue_kind review_queue_kind NOT NULL DEFAULT 'parser_error',
  external_record_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  error_code text NOT NULL,
  error_detail text NOT NULL,
  review_status review_status NOT NULL DEFAULT 'machine_unreviewed',
  reviewed_by uuid REFERENCES editor(id),
  reviewed_at timestamptz,
  resolution_note text,
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_batch_id, queue_kind, external_record_id, error_code),
  CONSTRAINT parse_review_item_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT parse_review_item_decision_needs_reviewer CHECK (
    review_status IN ('machine_unreviewed', 'in_review') OR reviewed_by IS NOT NULL
  )
);

-- Append-only Audit. UPDATE und DELETE sind per Trigger gesperrt; eine Ruecknahme
-- ist eine neue Zeile mit reverts_revision_id.
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
  -- `before_value` wird vom Worker aus der aktuell wirksamen Revision oder
  -- dem Fachobjekt gelesen, nie vom Browser uebernommen.
  before_value jsonb NOT NULL,
  after_value jsonb NOT NULL,
  baseline_revision_id uuid,
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_proposal_changes_value CHECK (before_value <> after_value)
);

CREATE TABLE editorial_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_stable_key text,
  action text NOT NULL,
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 12),
  -- Quellenpflicht auch fuer die Historie.
  source_passage_id uuid NOT NULL REFERENCES source_passage(id),
  editor_id uuid NOT NULL REFERENCES editor(id),
  approved_by uuid REFERENCES editor(id),
  approved_at timestamptz,
  before_value jsonb NOT NULL,
  after_value jsonb NOT NULL,
  -- Genau eine wirksame Revision kann eine Proposal-Zeile finalisieren. Fuer
  -- historische Revisionen vor P5.8 bleibt die Spalte NULL.
  proposal_id uuid UNIQUE REFERENCES editorial_proposal(id),
  supersedes_id uuid REFERENCES editorial_revision(id),
  -- Ruecknahme statt Loeschung.
  reverts_revision_id uuid UNIQUE REFERENCES editorial_revision(id),
  revision_index integer NOT NULL DEFAULT 1 CHECK (revision_index >= 1),
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_revision_four_eyes CHECK (
    action NOT IN ('merge', 'split', 'verify') OR (approved_by IS NOT NULL AND approved_by <> editor_id)
  ),
  CONSTRAINT editorial_revision_approval_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT editorial_revision_no_self_revert CHECK (reverts_revision_id IS NULL OR reverts_revision_id <> id),
  UNIQUE (entity_type, entity_id, revision_index)
);

-- ---------------------------------------------------------------------------
-- 14. Indizes
-- ---------------------------------------------------------------------------

CREATE INDEX hadith_record_number_idx ON hadith_record (source_work_id, primary_number);
CREATE INDEX hadith_record_reviewed_idx ON hadith_record (reviewed_at);
-- >>> POSTGRES-ONLY BEGIN (SQLite translator: replace with FTS5 tables)
CREATE INDEX hadith_record_matn_trgm_idx ON hadith_record USING gin (normalized_matn gin_trgm_ops);
CREATE INDEX narrator_name_trgm_idx ON narrator USING gin (normalized_name gin_trgm_ops);
CREATE INDEX narrator_variant_trgm_idx ON narrator_name_variant USING gin (normalized_name gin_trgm_ops);
CREATE INDEX rijal_entry_name_trgm_idx ON rijal_entry USING gin (name_head_normalized gin_trgm_ops);
-- <<< POSTGRES-ONLY END
CREATE INDEX narrator_stable_key_idx ON narrator (stable_key, revision);
CREATE INDEX narrator_merged_idx ON narrator (merged_into_id);
CREATE INDEX narrator_occurrence_chain_idx ON narrator_occurrence (chain_id, position);
CREATE INDEX narrator_occurrence_narrator_idx ON narrator_occurrence (resolved_narrator_id);
CREATE INDEX narrator_occurrence_status_idx ON narrator_occurrence (identity_status);
CREATE INDEX narrator_occurrence_relative_idx ON narrator_occurrence (chain_id, position) WHERE is_relative_form;
CREATE INDEX narrator_occurrence_unresolved_idx ON narrator_occurrence (review_status) WHERE resolved_narrator_id IS NULL;
CREATE INDEX rijal_entry_number_idx ON rijal_entry (source_work_id, entry_number_int);
CREATE INDEX rijal_entry_name_head_idx ON rijal_entry (name_head_normalized);
CREATE INDEX rijal_entry_death_idx ON rijal_entry (death_year_ah);
CREATE INDEX rijal_entry_narrator_idx ON rijal_entry (resolved_narrator_id);
CREATE INDEX identity_candidate_occurrence_idx ON identity_candidate (occurrence_id, confidence_score DESC);
CREATE INDEX identity_decision_occurrence_idx ON identity_decision (occurrence_id, created_at DESC);
CREATE INDEX relationship_subject_idx ON relationship_assertion (subject_narrator_id, evidence_kind);
CREATE INDEX relationship_object_idx ON relationship_assertion (object_narrator_id, evidence_kind);
CREATE INDEX relationship_occurrence_idx ON relationship_assertion (subject_occurrence_id, object_occurrence_id);
CREATE INDEX relationship_chain_idx ON relationship_assertion (chain_id);
CREATE INDEX date_assertion_narrator_idx ON date_assertion (narrator_id, event_type);
CREATE INDEX meeting_subject_idx ON meeting_assertion (subject_narrator_id, assertion_type);
CREATE INDEX grade_narrator_idx ON grade_assertion (narrator_id);
CREATE INDEX cluster_membership_record_idx ON cluster_membership (hadith_record_id);
CREATE INDEX chronology_basis_date_idx ON chronology_basis (date_assertion_id);
CREATE INDEX evidence_link_entity_idx ON evidence_link (entity_type, entity_id);
CREATE INDEX review_queue_idx ON parse_review_item (queue_kind, review_status, created_at);
CREATE INDEX editorial_revision_entity_idx ON editorial_revision (entity_type, entity_id, created_at DESC);
CREATE INDEX editorial_proposal_entity_idx ON editorial_proposal (entity_type, entity_id, created_at DESC);
CREATE INDEX editor_api_credential_editor_idx ON editor_api_credential (editor_id, revoked_at, expires_at);
CREATE INDEX narrator_id_redirect_target_idx ON narrator_id_redirect (target_stable_key);
CREATE UNIQUE INDEX narrator_id_redirect_active_key_idx
  ON narrator_id_redirect (absorbed_stable_key) WHERE is_active;
CREATE INDEX narrator_public_alias_narrator_idx ON narrator_public_alias (narrator_id, alias_kind);
CREATE UNIQUE INDEX narrator_public_alias_active_key_idx
  ON narrator_public_alias (alias_key) WHERE is_active;
CREATE INDEX editor_role_lookup_idx ON editor_role (editor_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 15. Projektionen und Antwort-Huelle
-- ---------------------------------------------------------------------------
-- Projektionen muessen reproduzierbar sein und duerfen niemals eine eigene
-- Evidenzquelle werden.

CREATE VIEW relationship_projection AS
SELECT subject_narrator_id,
       object_narrator_id,
       relationship_type,
       evidence_kind,
       chronology,
       count(*) AS assertion_count,
       max(confidence_score) AS max_confidence_score,
       max(reviewed_at) AS last_reviewed_at
FROM relationship_assertion
WHERE review_status <> 'rejected'
GROUP BY subject_narrator_id, object_narrator_id, relationship_type, evidence_kind, chronology;

-- Nur belegte Ueberlieferung. Diese Sicht enthaelt bewusst keine
-- chronology_only-Kante, damit eine unachtsame Abfrage eine blosse Moeglichkeit
-- nicht als Beleg fuer Hoeren oder Ueberlieferung verwenden kann.
CREATE VIEW transmission_evidence AS
SELECT id, subject_narrator_id, object_narrator_id, relationship_type, evidence_kind,
       chain_id, subject_occurrence_id, object_occurrence_id, source_passage_id,
       confidence_level, confidence_score, review_status, reviewed_by, reviewed_at, data_version
FROM relationship_assertion
WHERE evidence_kind IN ('isnad_link', 'rijal_statement')
  AND review_status <> 'rejected';

-- Antwort-Huelle des API-Vertrags fuer die kanonische Person:
-- sourceReferences, confidenceLevel, confidenceScore, origin, reviewStatus,
-- dataVersion, lastReviewedAt.
CREATE VIEW narrator_envelope AS
SELECT n.id,
       n.stable_key,
       n.revision,
       n.canonical_arabic_name,
       n.identity_status AS confidence_level,
       n.identity_score AS confidence_score,
       n.origin,
       n.review_status,
       n.data_version,
       n.reviewed_at AS last_reviewed_at,
       n.merged_into_id,
       (SELECT count(*) FROM evidence_link e WHERE e.entity_type = 'narrator' AND e.entity_id = n.id)
         AS extra_source_count
FROM narrator n;

CREATE VIEW rijal_entry_envelope AS
SELECT r.id,
       r.source_work_id,
       r.entry_number,
       r.name_head_raw,
       r.name_head_normalized,
       r.death_year_ah,
       r.teacher_phrase,
       r.student_phrase,
       r.identity_status AS confidence_level,
       r.parse_confidence AS confidence_score,
       r.origin,
       r.review_status,
       r.data_version,
       r.reviewed_at AS last_reviewed_at,
       r.source_passage_id,
       r.publication_allowed
FROM rijal_entry r;

-- ---------------------------------------------------------------------------
-- 16. Rollen-Grundbestand
-- ---------------------------------------------------------------------------

INSERT INTO role (id, role_key, label_ar, may_review, may_approve_merge, may_verify) VALUES
  ('11111111-1111-1111-1111-111111111101', 'viewer',        'قارئ',              false, false, false),
  ('11111111-1111-1111-1111-111111111102', 'annotator',     'مُعلِّق',            false, false, false),
  ('11111111-1111-1111-1111-111111111103', 'editor',        'محرر علمي',         true,  false, false),
  ('11111111-1111-1111-1111-111111111104', 'senior_editor', 'محرر علمي أول',     true,  true,  true),
  ('11111111-1111-1111-1111-111111111105', 'admin',         'مسؤول النظام',      true,  true,  true)
ON CONFLICT (role_key) DO NOTHING;

-- Pipeline-Konto. is_machine = true schliesst es per Trigger von jeder Pruefung
-- und jeder Freigabe aus.
INSERT INTO editor (id, auth_subject, display_name, display_name_ar, is_machine) VALUES
  ('11111111-1111-1111-1111-1111111111f0', 'system:import-pipeline', 'Import Pipeline', 'خط الاستيراد', true)
ON CONFLICT (auth_subject) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 17. Funktionen und Trigger
-- ---------------------------------------------------------------------------
-- >>> POSTGRES-ONLY BEGIN (SQLite translator: skip this block)

-- Deterministische kanonische Schluessel im Format <prefix><base32(8)>.
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

-- Append-only: jede Aenderung an der Historie ist verboten. Eine Korrektur ist
-- eine neue Revision, eine Ruecknahme eine neue Zeile mit reverts_revision_id.
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

CREATE TRIGGER editorial_proposal_append_only
  BEFORE UPDATE OR DELETE ON editorial_proposal
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

CREATE FUNCTION sanad_split_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % auf narrator_split ist nicht erlaubt', TG_OP;
END;
$$;

CREATE TRIGGER narrator_split_append_only
  BEFORE UPDATE OR DELETE ON narrator_split
  FOR EACH STATEMENT EXECUTE FUNCTION sanad_split_guard();

-- Maschinelle Verarbeitung darf niemals pruefen, freigeben oder 'verified' setzen.
-- Der zugehoerige Spaltenname wird per Triggerargument uebergeben.
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

CREATE TRIGGER editorial_proposal_human_editor
  BEFORE INSERT ON editorial_proposal
  FOR EACH ROW EXECUTE FUNCTION sanad_reviewer_must_be_human('proposed_by');

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

-- <<< POSTGRES-ONLY END

INSERT INTO schema_migration (version, description) VALUES
  ('0000', 'baseline: database/schema.sql'),
  ('0001', 'ein Statusvokabular mit sechs Stufen'),
  ('0002', 'editor, role, editor_role und Vier-Augen-Freigabe'),
  ('0003', 'rijal_entry, scholar, place'),
  ('0004', 'stable_key, revision, Redirect, Merge und Split'),
  ('0005', 'Evidenzhuelle, Occurrence-Bezug, Chronologiebasis, Quellenpflicht'),
  ('0006', 'Append-only-Schutz und menschliche Pruefer'),
  ('0007', 'narrator_public_alias: Alt-IDs bleiben aufloesbar'),
  ('0008', 'persistente Redaktionsvorschlaege und gehashte API-Zugangsdaten')
ON CONFLICT (version) DO NOTHING;
