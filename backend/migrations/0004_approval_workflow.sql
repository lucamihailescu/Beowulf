DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='applications' AND column_name='approval_required') THEN
        ALTER TABLE applications ADD COLUMN approval_required BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='policy_versions' AND column_name='status') THEN
        ALTER TABLE policy_versions ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
        ALTER TABLE policy_versions ADD COLUMN approver TEXT;
        ALTER TABLE policy_versions ADD COLUMN approved_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE policy_versions ADD CONSTRAINT check_status CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected'));
    END IF;
END $$;
