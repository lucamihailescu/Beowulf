-- Add PKI support for backend instances
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backend_instances' AND column_name = 'csr') THEN
        ALTER TABLE backend_instances ADD COLUMN csr TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backend_instances' AND column_name = 'signed_certificate') THEN
        ALTER TABLE backend_instances ADD COLUMN signed_certificate TEXT;
    END IF;
END $$;

-- Add CA private key storage to backend auth config
-- Note: In a production environment, this should be encrypted or stored in a KMS
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backend_auth_config' AND column_name = 'ca_private_key') THEN
        ALTER TABLE backend_auth_config ADD COLUMN ca_private_key TEXT;
    END IF;
END $$;
