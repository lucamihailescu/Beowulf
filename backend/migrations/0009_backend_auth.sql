-- Backend authentication configuration for cluster security
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backend_auth_config') THEN
        CREATE TABLE backend_auth_config (
            id SERIAL PRIMARY KEY,
            auth_mode TEXT NOT NULL DEFAULT 'none',  -- 'none', 'shared_secret', 'mtls'
            
            -- For shared_secret mode (stored as bcrypt hash)
            shared_secret_hash TEXT,
            
            -- For mTLS mode
            ca_certificate TEXT,       -- PEM encoded CA public cert
            ca_subject TEXT,           -- Extracted subject for display
            ca_issuer TEXT,            -- CA issuer
            ca_serial_number TEXT,     -- CA serial number
            ca_not_before TIMESTAMPTZ,
            ca_not_after TIMESTAMPTZ,
            ca_fingerprint TEXT,       -- SHA256 fingerprint
            
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            updated_by TEXT
        );
        
        -- Insert default configuration (no authentication)
        INSERT INTO backend_auth_config (auth_mode) VALUES ('none');
    END IF;
END $$;

-- Create or replace trigger function for updated_at
CREATE OR REPLACE FUNCTION set_backend_auth_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'set_backend_auth_config_updated_at'
    ) THEN
        CREATE TRIGGER set_backend_auth_config_updated_at
        BEFORE UPDATE ON backend_auth_config
        FOR EACH ROW EXECUTE FUNCTION set_backend_auth_updated_at();
    END IF;
END $$;

