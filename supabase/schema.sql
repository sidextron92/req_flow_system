-- ============================================================
-- ReqFlow Schema
-- Run this in the Supabase SQL Editor (top to bottom, once)
-- ============================================================


-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE requirement_type AS ENUM (
  'RESTOCK',
  'NEW_LABEL',
  'NEW_VARIETY'
);

CREATE TYPE requirement_status AS ENUM (
  'DRAFT',
  'OPEN',
  'IN_PROCESS',
  'REVIEW_FOR_COMPLETION',
  'COMPLETED',
  'INCOMPLETE',
  'PARTIALLY_COMPLETE'
);

CREATE TYPE status_change_type AS ENUM (
  'STATUS_CHANGE',
  'ASSIGNMENT_CHANGE',
  'FIELD_UPDATE'
);


-- ============================================================
-- USERS
-- id is an external integer ID passed via URL param
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  phone         TEXT,
  darkstore_id  TEXT,
  darkstore_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- CATEGORIES
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL UNIQUE
);

-- Seed dummy categories
INSERT INTO categories (name) VALUES
  ('Fresh Produce'),
  ('Dairy & Eggs'),
  ('Bakery'),
  ('Meat & Seafood'),
  ('Beverages'),
  ('Snacks & Confectionery'),
  ('Frozen Foods'),
  ('Household & Cleaning'),
  ('Personal Care'),
  ('Baby & Kids')
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- REQUIREMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS requirements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                requirement_type NOT NULL,
  status              requirement_status NOT NULL DEFAULT 'DRAFT',

  -- Label info
  label_name          TEXT,
  label_id            TEXT,

  -- Category (denormalized name stored alongside FK for query convenience)
  category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
  category_name       TEXT,

  -- Dates
  expiry_date         DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Quantity required (mandatory for NEW_LABEL and NEW_VARIETY)
  qty_required        VARCHAR,

  -- Free text
  remarks             TEXT,

  -- JSON fields
  -- attachments: array of { url: string, file_name: string, storage_path: string }
  attachments         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- comment_log: array of { user_id, user_name, message, timestamp }
  comment_log         JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Creator
  created_by          BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Assignment (done post-creation)
  assigned_to_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  assigned_date       TIMESTAMPTZ
);

-- Indexes for common query patterns
CREATE INDEX idx_requirements_created_by   ON requirements(created_by);
CREATE INDEX idx_requirements_status       ON requirements(status);
CREATE INDEX idx_requirements_type         ON requirements(type);
CREATE INDEX idx_requirements_assigned_to  ON requirements(assigned_to_user_id);
CREATE INDEX idx_requirements_created_at   ON requirements(created_at DESC);


-- ============================================================
-- REQUIREMENT PRODUCTS (Restock only; max 1 row for others)
-- ============================================================

CREATE TABLE IF NOT EXISTS requirement_products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id   UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  product_id       TEXT,
  product_name     TEXT NOT NULL,
  notes            TEXT
);

CREATE INDEX idx_req_products_requirement_id ON requirement_products(requirement_id);


-- ============================================================
-- STATUS UPDATE LOG
-- Tracks status changes, assignment changes, and field updates
-- ============================================================

CREATE TABLE IF NOT EXISTS status_update_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id   UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  changed_by       BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  change_type      status_change_type NOT NULL,
  old_value        TEXT,
  new_value        TEXT NOT NULL,
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_status_log_requirement_id ON status_update_log(requirement_id);
CREATE INDEX idx_status_log_changed_at     ON status_update_log(changed_at DESC);


-- ============================================================
-- AI EXTRACTIONS
-- Stores structured JSON output from AI processing per requirement
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_extractions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id   UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  extracted_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_used       TEXT,
  extracted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_extractions_requirement_id ON ai_extractions(requirement_id);


-- ============================================================
-- AUTO-UPDATE updated_at ON requirements
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER requirements_updated_at
  BEFORE UPDATE ON requirements
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- MIGRATIONS (run if applying to an existing DB)
-- ============================================================

-- Add qty_required field (mandatory for NEW_LABEL and NEW_VARIETY)
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS qty_required VARCHAR;
