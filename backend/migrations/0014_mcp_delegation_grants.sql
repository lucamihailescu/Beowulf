-- Delegation/OBO grants for MCP tool invocations.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mcp_delegation_grants') THEN
        CREATE TABLE mcp_delegation_grants (
            id BIGSERIAL PRIMARY KEY,
            grant_id TEXT NOT NULL UNIQUE,
            token_hash TEXT NOT NULL UNIQUE,
            application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
            gateway_id TEXT,

            delegator_type TEXT NOT NULL,
            delegator_id TEXT NOT NULL,
            delegate_type TEXT NOT NULL,
            delegate_id TEXT NOT NULL,

            scope_action TEXT NOT NULL DEFAULT 'tool.invoke',
            scope_resource_prefix TEXT,
            status TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'revoked', 'expired')),

            issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            revoked_by TEXT,

            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mcp_delegation_grants_status
    ON mcp_delegation_grants(status);

CREATE INDEX IF NOT EXISTS idx_mcp_delegation_grants_expires_at
    ON mcp_delegation_grants(expires_at);

CREATE OR REPLACE FUNCTION set_mcp_delegation_grants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'set_mcp_delegation_grants_updated_at'
    ) THEN
        CREATE TRIGGER set_mcp_delegation_grants_updated_at
        BEFORE UPDATE ON mcp_delegation_grants
        FOR EACH ROW EXECUTE FUNCTION set_mcp_delegation_grants_updated_at();
    END IF;
END $$;
