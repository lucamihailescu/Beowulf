-- Per-application API keys for runtime authorization calls.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'application_api_keys') THEN
        CREATE TABLE application_api_keys (
            id BIGSERIAL PRIMARY KEY,
            application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            key_prefix TEXT NOT NULL UNIQUE,
            key_hash TEXT NOT NULL,
            created_by TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            revoked_by TEXT
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_application_api_keys_app_revoked
    ON application_api_keys(application_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_application_api_keys_key_prefix
    ON application_api_keys(key_prefix);

