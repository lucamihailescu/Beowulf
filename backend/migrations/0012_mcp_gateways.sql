-- MCP gateway registry for standalone gateway instances.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mcp_gateways') THEN
        CREATE TABLE mcp_gateways (
            id BIGSERIAL PRIMARY KEY,
            gateway_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            endpoint TEXT,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
            auth_mode TEXT NOT NULL DEFAULT 'none',

            requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            approved_at TIMESTAMPTZ,
            approved_by TEXT,
            rejected_at TIMESTAMPTZ,
            rejected_by TEXT,
            rejection_reason TEXT,
            last_heartbeat TIMESTAMPTZ,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mcp_gateways_status
    ON mcp_gateways(status);

CREATE INDEX IF NOT EXISTS idx_mcp_gateways_last_heartbeat
    ON mcp_gateways(last_heartbeat DESC);

CREATE OR REPLACE FUNCTION set_mcp_gateways_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'set_mcp_gateways_updated_at'
    ) THEN
        CREATE TRIGGER set_mcp_gateways_updated_at
        BEFORE UPDATE ON mcp_gateways
        FOR EACH ROW EXECUTE FUNCTION set_mcp_gateways_updated_at();
    END IF;
END $$;
