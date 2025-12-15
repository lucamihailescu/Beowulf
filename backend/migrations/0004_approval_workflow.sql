-- Add approval_required flag to applications
ALTER TABLE applications ADD COLUMN approval_required BOOLEAN NOT NULL DEFAULT FALSE;

-- Add approval workflow columns to policy_versions
ALTER TABLE policy_versions ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE policy_versions ADD COLUMN approver TEXT;
ALTER TABLE policy_versions ADD COLUMN approved_at TIMESTAMP WITH TIME ZONE;

-- Add check constraint for status values
ALTER TABLE policy_versions ADD CONSTRAINT check_status CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected'));

