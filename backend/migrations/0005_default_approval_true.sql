-- Change default approval_required to TRUE for new applications
ALTER TABLE applications ALTER COLUMN approval_required SET DEFAULT TRUE;

