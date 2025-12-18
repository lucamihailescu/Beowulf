-- Backend instances table for tracking and approving cluster members
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backend_instances') THEN
        CREATE TABLE backend_instances (
            id SERIAL PRIMARY KEY,
            instance_id TEXT UNIQUE NOT NULL,
            hostname TEXT NOT NULL,
            ip_address TEXT,
            status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
            
            -- Certificate/auth info for verification
            cert_fingerprint TEXT,
            cluster_secret_verified BOOLEAN DEFAULT FALSE,
            
            -- Approval workflow
            requested_at TIMESTAMPTZ DEFAULT NOW(),
            approved_at TIMESTAMPTZ,
            approved_by TEXT,
            rejected_at TIMESTAMPTZ,
            rejected_by TEXT,
            rejection_reason TEXT,
            
            -- Instance metadata
            cedar_version TEXT,
            os_info TEXT,
            arch TEXT,
            last_heartbeat TIMESTAMPTZ,
            metadata JSONB,
            
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX idx_backend_instances_status ON backend_instances(status);
        CREATE INDEX idx_backend_instances_instance_id ON backend_instances(instance_id);
    END IF;
END $$;

-- Add approval_required setting to backend_auth_config if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backend_auth_config' AND column_name = 'approval_required'
    ) THEN
        ALTER TABLE backend_auth_config ADD COLUMN approval_required BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION set_backend_instances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'set_backend_instances_updated_at'
    ) THEN
        CREATE TRIGGER set_backend_instances_updated_at
        BEFORE UPDATE ON backend_instances
        FOR EACH ROW EXECUTE FUNCTION set_backend_instances_updated_at();
    END IF;
END $$;

