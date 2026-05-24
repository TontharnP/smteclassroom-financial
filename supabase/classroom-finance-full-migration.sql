-- Classroom Finance 5 full consolidated migration
-- Generated from supabase/migrations/*.sql in numeric order.
-- Use this file for a fresh Supabase database only.
-- Do not run this on a database that already has the numbered migrations applied.
-- Generated: 2026-05-24



-- ============================================================
-- Source: supabase/migrations/001_initial_schema.sql
-- ============================================================

-- Classroom Finance 5.0 Database Schema
-- Created: 2025-11-08
-- Description: Initial schema for students, schedules, and transactions

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- TABLE: students
-- ==========================================
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prefix VARCHAR(20) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  nick_name VARCHAR(50),
  number INTEGER NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  
  -- Constraints
  CONSTRAINT students_number_unique UNIQUE (number),
  CONSTRAINT students_number_positive CHECK (number > 0)
);

-- Index for faster queries
CREATE INDEX idx_students_number ON students(number);
CREATE INDEX idx_students_created_at ON students(created_at DESC);

-- ==========================================
-- TABLE: schedules
-- ==========================================
CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  amount_per_item DECIMAL(10,2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  description TEXT,
  student_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  
  -- Constraints
  CONSTRAINT schedules_amount_positive CHECK (amount_per_item > 0),
  CONSTRAINT schedules_dates_valid CHECK (end_date IS NULL OR end_date >= start_date)
);

-- Index for date queries
CREATE INDEX idx_schedules_start_date ON schedules(start_date DESC);
CREATE INDEX idx_schedules_end_date ON schedules(end_date) WHERE end_date IS NOT NULL;
CREATE INDEX idx_schedules_created_at ON schedules(created_at DESC);

-- ==========================================
-- TABLE: transactions
-- ==========================================
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('income', 'expense')),
  amount DECIMAL(10,2) NOT NULL,
  method VARCHAR(20) CHECK (method IN ('kplus', 'cash', 'truemoney')),
  category VARCHAR(100),
  description TEXT,
  source VARCHAR(20) NOT NULL CHECK (source IN ('transaction', 'schedule')),
  schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  
  -- Constraints
  CONSTRAINT transactions_amount_positive CHECK (amount > 0),
  CONSTRAINT transactions_schedule_consistency CHECK (
    (source = 'schedule' AND schedule_id IS NOT NULL AND student_id IS NOT NULL) OR
    (source = 'transaction' AND schedule_id IS NULL AND student_id IS NULL)
  )
);

-- Indexes for faster queries
CREATE INDEX idx_transactions_kind ON transactions(kind);
CREATE INDEX idx_transactions_source ON transactions(source);
CREATE INDEX idx_transactions_method ON transactions(method) WHERE method IS NOT NULL;
CREATE INDEX idx_transactions_schedule_id ON transactions(schedule_id) WHERE schedule_id IS NOT NULL;
CREATE INDEX idx_transactions_student_id ON transactions(student_id) WHERE student_id IS NOT NULL;
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX idx_transactions_category ON transactions(category) WHERE category IS NOT NULL;

-- ==========================================
-- FUNCTIONS: Auto-update updated_at
-- ==========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================

-- Enable RLS
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Students policies (public read, authenticated write)
CREATE POLICY "Allow public read access on students"
  ON students FOR SELECT
  USING (true);

CREATE POLICY "Allow authenticated insert on students"
  ON students FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update on students"
  ON students FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete on students"
  ON students FOR DELETE
  USING (true);

-- Schedules policies
CREATE POLICY "Allow public read access on schedules"
  ON schedules FOR SELECT
  USING (true);

CREATE POLICY "Allow authenticated insert on schedules"
  ON schedules FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update on schedules"
  ON schedules FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete on schedules"
  ON schedules FOR DELETE
  USING (true);

-- Transactions policies
CREATE POLICY "Allow public read access on transactions"
  ON transactions FOR SELECT
  USING (true);

CREATE POLICY "Allow authenticated insert on transactions"
  ON transactions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update on transactions"
  ON transactions FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete on transactions"
  ON transactions FOR DELETE
  USING (true);

-- ==========================================
-- HELPER VIEWS
-- ==========================================

-- View: Student payment summary
CREATE VIEW student_payment_summary AS
SELECT 
  s.id,
  s.first_name,
  s.last_name,
  s.number,
  COUNT(DISTINCT t.schedule_id) as schedules_paid,
  COALESCE(SUM(t.amount), 0) as total_paid
FROM students s
LEFT JOIN transactions t ON s.id = t.student_id AND t.source = 'schedule'
GROUP BY s.id, s.first_name, s.last_name, s.number;

-- View: Schedule collection summary
CREATE VIEW schedule_collection_summary AS
SELECT 
  sch.id,
  sch.name,
  sch.amount_per_item,
  CARDINALITY(sch.student_ids) as total_students,
  COUNT(DISTINCT t.student_id) as students_paid,
  COALESCE(SUM(t.amount), 0) as total_collected,
  (sch.amount_per_item * CARDINALITY(sch.student_ids)) as total_target
FROM schedules sch
LEFT JOIN transactions t ON sch.id = t.schedule_id
GROUP BY sch.id, sch.name, sch.amount_per_item, sch.student_ids;

-- ==========================================
-- COMMENTS
-- ==========================================
COMMENT ON TABLE students IS 'Student profiles with personal information';
COMMENT ON TABLE schedules IS 'Payment schedules for collecting money from students';
COMMENT ON TABLE transactions IS 'Financial transactions (income/expense) including schedule-based payments';
COMMENT ON VIEW student_payment_summary IS 'Summary of payment status for each student';
COMMENT ON VIEW schedule_collection_summary IS 'Summary of collection status for each schedule';



-- ============================================================
-- Source: supabase/migrations/002_change_bank_to_kplus.sql
-- ============================================================

-- Migration: Change payment method from 'bank' to 'kplus'
-- This updates the CHECK constraint and existing data

-- Step 1: Remove the old CHECK constraint
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_method_check;

-- Step 2: Update existing 'bank' records to 'kplus'
UPDATE transactions SET method = 'kplus' WHERE method = 'bank';

-- Step 3: Add new CHECK constraint with 'kplus' instead of 'bank'
ALTER TABLE transactions 
  ADD CONSTRAINT transactions_method_check 
  CHECK (method IN ('kplus', 'cash', 'truemoney'));

-- Verification: Check that no 'bank' records remain
-- SELECT COUNT(*) FROM transactions WHERE method = 'bank';
-- Expected result: 0



-- ============================================================
-- Source: supabase/migrations/003_create_categories_table.sql
-- ============================================================

-- Migration: Create categories table
-- Description: Adds a categories table for organizing transactions

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on name for faster lookups
CREATE INDEX idx_categories_name ON categories(name);

-- Add RLS policies
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Categories policies (public read, authenticated write)
CREATE POLICY "Allow public read access on categories"
  ON categories FOR SELECT
  USING (true);

CREATE POLICY "Allow authenticated insert on categories"
  ON categories FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update on categories"
  ON categories FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete on categories"
  ON categories FOR DELETE
  USING (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add category_id column to transactions table
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

-- Create index on category_id for faster joins
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);

-- Migrate existing category data
-- This will create categories from existing transaction.category text values
INSERT INTO categories (name)
SELECT DISTINCT category
FROM transactions
WHERE category IS NOT NULL 
  AND category != ''
  AND source = 'transaction'
ON CONFLICT (name) DO NOTHING;

-- Update transactions to reference category_id
UPDATE transactions t
SET category_id = c.id
FROM categories c
WHERE t.category = c.name
  AND t.source = 'transaction'
  AND t.category_id IS NULL;

-- Note: Keep the old 'category' column for backward compatibility
-- It can be removed in a future migration after ensuring all code uses category_id



-- ============================================================
-- Source: supabase/migrations/004_add_pockets_columns.sql
-- ============================================================

-- Migration: Add pocket columns and support 'transfer' kind in transactions table
-- Description: Adds pocket_id, source_pocket_id, and destination_pocket_id, and updates kind CHECK constraint

-- Add columns
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS pocket_id TEXT,
ADD COLUMN IF NOT EXISTS source_pocket_id TEXT,
ADD COLUMN IF NOT EXISTS destination_pocket_id TEXT;

-- Update kind CHECK constraint to allow 'transfer'
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK (kind IN ('income', 'expense', 'transfer'));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_pocket_id ON transactions(pocket_id) WHERE pocket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_source_pocket_id ON transactions(source_pocket_id) WHERE source_pocket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_destination_pocket_id ON transactions(destination_pocket_id) WHERE destination_pocket_id IS NOT NULL;

-- Comment on columns
COMMENT ON COLUMN transactions.pocket_id IS 'ID of the pocket/wallet this transaction affects (for income/expense)';
COMMENT ON COLUMN transactions.source_pocket_id IS 'ID of the source pocket (for transfers)';
COMMENT ON COLUMN transactions.destination_pocket_id IS 'ID of the destination pocket (for transfers)';




-- ============================================================
-- Source: supabase/migrations/005_add_schedule_folders.sql
-- ============================================================

-- Add nested folders for schedule organization.

CREATE TABLE IF NOT EXISTS schedule_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  parent_id UUID REFERENCES schedule_folders(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_folders_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_folders_parent_sort
  ON schedule_folders(parent_id, sort_order, name);

DROP TRIGGER IF EXISTS update_schedule_folders_updated_at ON schedule_folders;
CREATE TRIGGER update_schedule_folders_updated_at
  BEFORE UPDATE ON schedule_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

INSERT INTO schedule_folders (name, parent_id, sort_order)
SELECT 'Default', NULL, 0
WHERE NOT EXISTS (SELECT 1 FROM schedule_folders);

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES schedule_folders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE schedules
SET folder_id = (SELECT id FROM schedule_folders ORDER BY sort_order, created_at LIMIT 1)
WHERE folder_id IS NULL;

ALTER TABLE schedules
  ALTER COLUMN folder_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schedules_folder_sort
  ON schedules(folder_id, sort_order, start_date DESC);



-- ============================================================
-- Source: supabase/migrations/006_add_projects_table.sql
-- ============================================================

-- Add projects table
-- Created: 2026-05-08

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();



-- ============================================================
-- Source: supabase/migrations/007_add_student_line_user_id.sql
-- ============================================================

-- Store LINE Messaging API recipient IDs for individual student reminders.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS line_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_students_line_user_id
  ON students(line_user_id)
  WHERE line_user_id IS NOT NULL;



-- ============================================================
-- Source: supabase/migrations/008_add_line_payment_requests.sql
-- ============================================================

-- Payment requests created from LINE rich menu / webhook flows.

CREATE TABLE IF NOT EXISTS line_payment_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  line_user_id TEXT NOT NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  method VARCHAR(20) CHECK (method IN ('kplus', 'cash', 'truemoney')),
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  status VARCHAR(30) NOT NULL DEFAULT 'selecting' CHECK (
    status IN ('selecting', 'awaiting_slip', 'pending_review', 'cash_pending', 'approved', 'rejected', 'expired')
  ),
  slip_url TEXT,
  slip_pathname TEXT,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_line_payment_requests_line_status
  ON line_payment_requests(line_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_line_payment_requests_schedule_status
  ON line_payment_requests(schedule_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_line_payment_requests_student_schedule
  ON line_payment_requests(student_id, schedule_id, created_at DESC);

DROP TRIGGER IF EXISTS update_line_payment_requests_updated_at ON line_payment_requests;
CREATE TRIGGER update_line_payment_requests_updated_at
  BEFORE UPDATE ON line_payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();



-- ============================================================
-- Source: supabase/migrations/009_add_slip_review_fields.sql
-- ============================================================

-- Semi-automatic LINE slip review metadata.
-- Keeps existing line_payment_requests rows compatible while adding helper
-- checks for treasurer review. These checks are advisory only.

ALTER TABLE line_payment_requests
  ADD COLUMN IF NOT EXISTS slip_status TEXT,
  ADD COLUMN IF NOT EXISTS slip_qr_payload TEXT,
  ADD COLUMN IF NOT EXISTS slip_image_hash TEXT,
  ADD COLUMN IF NOT EXISTS slip_ocr_text TEXT,
  ADD COLUMN IF NOT EXISTS slip_auto_check_result TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE line_payment_requests
  DROP CONSTRAINT IF EXISTS line_payment_requests_status_check;

ALTER TABLE line_payment_requests
  ADD CONSTRAINT line_payment_requests_status_check CHECK (
    status IN (
      'selecting',
      'awaiting_slip',
      'pending_review',
      'pending_slip_review',
      'cash_pending',
      'approved',
      'rejected',
      'expired'
    )
  );

ALTER TABLE line_payment_requests
  DROP CONSTRAINT IF EXISTS line_payment_requests_slip_status_check;

ALTER TABLE line_payment_requests
  ADD CONSTRAINT line_payment_requests_slip_status_check CHECK (
    slip_status IS NULL OR slip_status IN (
      'pending_slip_review',
      'approved',
      'rejected',
      'duplicate_suspected',
      'wrong_amount'
    )
  );

CREATE INDEX IF NOT EXISTS idx_line_payment_requests_slip_qr_payload
  ON line_payment_requests(slip_qr_payload)
  WHERE slip_qr_payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_line_payment_requests_slip_image_hash
  ON line_payment_requests(slip_image_hash)
  WHERE slip_image_hash IS NOT NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-slips', 'payment-slips', false)
ON CONFLICT (id) DO UPDATE SET public = false;



-- ============================================================
-- Source: supabase/migrations/010_add_slip_transaction_id.sql
-- ============================================================

-- Tracks the bank slip transaction/reference number for duplicate detection.

ALTER TABLE line_payment_requests
  ADD COLUMN IF NOT EXISTS slip_transaction_id TEXT;

CREATE INDEX IF NOT EXISTS idx_line_payment_requests_slip_transaction_id
  ON line_payment_requests(slip_transaction_id)
  WHERE slip_transaction_id IS NOT NULL;



-- ============================================================
-- Source: supabase/migrations/011_add_line_payment_slip_archives.sql
-- ============================================================

-- Keeps completed LINE payment request rows removable while preserving slip
-- metadata needed for duplicate checks and approved-slip retention.

CREATE TABLE IF NOT EXISTS line_payment_slip_archives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  line_user_id TEXT NOT NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  transaction_id UUID UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  method VARCHAR(20),
  amount DECIMAL(10,2) NOT NULL,
  slip_url TEXT,
  slip_pathname TEXT,
  slip_qr_payload TEXT,
  slip_image_hash TEXT,
  slip_transaction_id TEXT,
  slip_auto_check_result TEXT,
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_line_payment_slip_archives_line_paid
  ON line_payment_slip_archives(line_user_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_line_payment_slip_archives_slip_qr_payload
  ON line_payment_slip_archives(slip_qr_payload)
  WHERE slip_qr_payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_line_payment_slip_archives_slip_image_hash
  ON line_payment_slip_archives(slip_image_hash)
  WHERE slip_image_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_line_payment_slip_archives_slip_transaction_id
  ON line_payment_slip_archives(slip_transaction_id)
  WHERE slip_transaction_id IS NOT NULL;



-- ============================================================
-- Source: supabase/migrations/012_add_app_settings.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_app_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_app_settings_updated_at();

INSERT INTO app_settings (key, value, description)
VALUES (
  'public_config',
  '{}'::jsonb,
  'Editable runtime application settings for final handoff version.'
)
ON CONFLICT (key) DO NOTHING;

UPDATE app_settings
SET description = 'Editable runtime application settings for final handoff version.'
WHERE key = 'public_config';

