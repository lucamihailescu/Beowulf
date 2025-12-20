-- Add deleted_at column to applications table for soft delete support
ALTER TABLE applications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Create index for faster filtering of non-deleted apps
CREATE INDEX IF NOT EXISTS idx_applications_deleted_at ON applications(deleted_at) WHERE deleted_at IS NULL;
