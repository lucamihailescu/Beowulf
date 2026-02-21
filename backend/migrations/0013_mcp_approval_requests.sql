-- MCP tool-call approval workflow records (HITL).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mcp_approval_requests') THEN
        CREATE TABLE mcp_approval_requests (
            id BIGSERIAL PRIMARY KEY,
            request_id TEXT NOT NULL UNIQUE,
            application_id BIGINT REFERENCES applications(id) ON DELETE SET NULL,
            gateway_id TEXT NOT NULL,

            principal_type TEXT NOT NULL,
            principal_id TEXT NOT NULL,
            action TEXT NOT NULL,
            resource TEXT NOT NULL,
            tool_server TEXT NOT NULL,
            tool_name TEXT NOT NULL,

            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
            requested_by TEXT,
            reason TEXT,
            decision_context JSONB NOT NULL DEFAULT '{}'::jsonb,
            expires_at TIMESTAMPTZ,

            approved_at TIMESTAMPTZ,
            approved_by TEXT,
            rejected_at TIMESTAMPTZ,
            rejected_by TEXT,
            rejection_reason TEXT,

            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mcp_approval_requests_status
    ON mcp_approval_requests(status);

CREATE INDEX IF NOT EXISTS idx_mcp_approval_requests_gateway
    ON mcp_approval_requests(gateway_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_approval_requests_app
    ON mcp_approval_requests(application_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_mcp_approval_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'set_mcp_approval_requests_updated_at'
    ) THEN
        CREATE TRIGGER set_mcp_approval_requests_updated_at
        BEFORE UPDATE ON mcp_approval_requests
        FOR EACH ROW EXECUTE FUNCTION set_mcp_approval_requests_updated_at();
    END IF;
END $$;
