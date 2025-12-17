DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='policies' AND column_name='status') THEN 
        ALTER TABLE policies ADD COLUMN status TEXT NOT NULL DEFAULT 'active'; 
    END IF; 
END $$;
