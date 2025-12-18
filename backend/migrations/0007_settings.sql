-- Settings table for storing configuration (like Entra credentials)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settings') THEN
        CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            encrypted BOOLEAN NOT NULL DEFAULT FALSE,
            description TEXT,
            updated_by TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Create trigger for updated_at
        CREATE TRIGGER set_settings_updated_at
        BEFORE UPDATE ON settings
        FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

        -- Create index for faster lookups
        CREATE INDEX idx_settings_key ON settings(key);
    END IF;
END $$;

