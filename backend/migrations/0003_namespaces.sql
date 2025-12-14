-- Create namespaces table for shared namespace management
CREATE TABLE IF NOT EXISTS namespaces (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrate existing namespaces from applications to the new table
INSERT INTO namespaces (name, description, created_at)
SELECT DISTINCT namespace, 'Migrated from application', NOW()
FROM applications
WHERE namespace IS NOT NULL AND namespace != ''
ON CONFLICT (name) DO NOTHING;

-- Add namespace_id column to applications
ALTER TABLE applications ADD COLUMN IF NOT EXISTS namespace_id BIGINT;

-- Populate namespace_id from existing namespace values
UPDATE applications a
SET namespace_id = n.id
FROM namespaces n
WHERE a.namespace = n.name;

-- Add foreign key constraint (drop first if exists to make idempotent)
ALTER TABLE applications DROP CONSTRAINT IF EXISTS fk_applications_namespace;
ALTER TABLE applications
ADD CONSTRAINT fk_applications_namespace
FOREIGN KEY (namespace_id) REFERENCES namespaces(id);

-- Drop the old unique constraint on namespace column (if exists)
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_namespace_key;

-- Keep namespace column for backward compatibility but make it nullable
ALTER TABLE applications ALTER COLUMN namespace DROP NOT NULL;

-- Create trigger for namespaces updated_at
DROP TRIGGER IF EXISTS set_namespaces_updated_at ON namespaces;
CREATE TRIGGER set_namespaces_updated_at
BEFORE UPDATE ON namespaces
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_applications_namespace_id ON applications(namespace_id);

