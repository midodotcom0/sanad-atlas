CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE review_status AS ENUM ('unreviewed', 'accepted', 'rejected', 'superseded');
CREATE TYPE identity_status AS ENUM ('verified', 'high', 'medium', 'low', 'unresolved', 'conflict');

CREATE TABLE narrator (
  canonical_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_arabic_name text NOT NULL,
  full_nasab text,
  kunya text,
  nisba text,
  birth_year_ah int4range,
  death_year_ah int4range,
  generation text,
  primary_region text,
  identity_status identity_status NOT NULL DEFAULT 'unresolved',
  editorial_status review_status NOT NULL DEFAULT 'unreviewed',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE narrator_name_variant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  narrator_id uuid REFERENCES narrator(canonical_id),
  raw_name text NOT NULL,
  normalized_name text NOT NULL,
  transliteration text,
  source_context jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE source_passage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_work text NOT NULL,
  edition text,
  volume text,
  page text,
  original_text text,
  stable_reference text,
  license_status text NOT NULL DEFAULT 'unresolved',
  provenance jsonb NOT NULL
);

CREATE TABLE hadith_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_book text NOT NULL,
  chapter text,
  source_number text,
  arabic_matn text,
  full_raw_text text NOT NULL,
  edition text,
  provenance jsonb NOT NULL
);

CREATE TABLE isnad_chain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hadith_record_id uuid NOT NULL REFERENCES hadith_record(id),
  raw_isnad text NOT NULL,
  parsed_isnad jsonb NOT NULL,
  parser_version text NOT NULL,
  parse_confidence numeric(4,3) CHECK (parse_confidence BETWEEN 0 AND 1)
);

CREATE TABLE narrator_occurrence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES isnad_chain(id),
  position integer NOT NULL CHECK (position >= 0),
  raw_surface_form text NOT NULL,
  transmission_term text,
  resolved_narrator_id uuid REFERENCES narrator(canonical_id),
  resolution_confidence numeric(4,3) CHECK (resolution_confidence BETWEEN 0 AND 1),
  source_span int4range,
  UNIQUE (chain_id, position)
);

CREATE TABLE assertion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assertion_type text NOT NULL,
  subject_id uuid NOT NULL,
  object_id uuid,
  original_phrase text,
  normalized_category text,
  source_passage_id uuid REFERENCES source_passage(id),
  confidence numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  extraction_method text NOT NULL,
  parser_version text,
  review_status review_status NOT NULL DEFAULT 'unreviewed',
  reviewed_by uuid,
  valid_time_range int4range,
  data_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX narrator_name_variant_normalized_idx ON narrator_name_variant (normalized_name);
CREATE INDEX narrator_occurrence_chain_idx ON narrator_occurrence (chain_id, position);
CREATE INDEX assertion_subject_idx ON assertion (subject_id, assertion_type);
