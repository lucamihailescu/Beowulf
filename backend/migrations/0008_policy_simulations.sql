-- Policy simulations table for "What-If" analysis
CREATE TABLE IF NOT EXISTS policy_simulations (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    policy_version INTEGER NOT NULL,
    
    -- Simulation configuration
    mode TEXT NOT NULL CHECK (mode IN ('production_replay', 'sample_data', 'custom')),
    time_range TEXT, -- e.g., '24h', '7d', '30d' for production_replay
    sample_size INTEGER, -- for sample_data mode
    
    -- Results summary
    requests_analyzed INTEGER NOT NULL DEFAULT 0,
    current_allows INTEGER NOT NULL DEFAULT 0,
    current_denies INTEGER NOT NULL DEFAULT 0,
    new_allows INTEGER NOT NULL DEFAULT 0,
    new_denies INTEGER NOT NULL DEFAULT 0,
    
    -- Detailed impact (JSON)
    -- Contains: affected_principals, sample_requests, determining_policies
    impact_details JSONB,
    
    -- Metadata
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    error_message TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Indexes for common queries
    CONSTRAINT valid_results CHECK (
        (status != 'completed') OR 
        (requests_analyzed >= 0 AND current_allows >= 0 AND current_denies >= 0)
    )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_policy_simulations_app ON policy_simulations(application_id);
CREATE INDEX IF NOT EXISTS idx_policy_simulations_policy ON policy_simulations(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_simulations_created ON policy_simulations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_simulations_status ON policy_simulations(status);

