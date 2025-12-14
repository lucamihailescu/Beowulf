-- Store parent relationships per entity (type/id references, not foreign keys to allow external parents)
CREATE TABLE IF NOT EXISTS entity_parents (
    child_entity_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    parent_type TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    PRIMARY KEY (child_entity_id, parent_type, parent_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_parents_child ON entity_parents (child_entity_id);
