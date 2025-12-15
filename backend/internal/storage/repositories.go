package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"cedar/internal/authz"

	cedar "github.com/cedar-policy/cedar-go"
	"github.com/jackc/pgx/v5/pgconn"
)

// Namespace represents a Cedar namespace that can be shared across applications.
type Namespace struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// NamespaceRepo manages namespace records.
type NamespaceRepo struct {
	db *DB
}

// NewNamespaceRepo constructs a namespace repository.
func NewNamespaceRepo(db *DB) *NamespaceRepo {
	return &NamespaceRepo{db: db}
}

// Create inserts a new namespace.
func (r *NamespaceRepo) Create(ctx context.Context, name, description string) (int64, error) {
	row := r.db.Writer().QueryRow(ctx, `
		INSERT INTO namespaces (name, description)
		VALUES ($1, $2)
		RETURNING id
	`, name, description)
	var id int64
	if err := row.Scan(&id); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return 0, fmt.Errorf("namespace '%s' already exists", name)
		}
		return 0, fmt.Errorf("create namespace: %w", err)
	}
	return id, nil
}

// List returns all namespaces.
func (r *NamespaceRepo) List(ctx context.Context) ([]Namespace, error) {
	rows, err := r.db.Reader().Query(ctx, `
		SELECT id, name, COALESCE(description, ''), created_at, updated_at
		FROM namespaces
		ORDER BY name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list namespaces: %w", err)
	}
	defer rows.Close()

	var out []Namespace
	for rows.Next() {
		var n Namespace
		if err := rows.Scan(&n.ID, &n.Name, &n.Description, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan namespace: %w", err)
		}
		out = append(out, n)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate namespaces: %w", rows.Err())
	}
	return out, nil
}

// GetByID returns a namespace by ID.
func (r *NamespaceRepo) GetByID(ctx context.Context, id int64) (*Namespace, error) {
	row := r.db.Reader().QueryRow(ctx, `
		SELECT id, name, COALESCE(description, ''), created_at, updated_at
		FROM namespaces WHERE id = $1
	`, id)
	var n Namespace
	if err := row.Scan(&n.ID, &n.Name, &n.Description, &n.CreatedAt, &n.UpdatedAt); err != nil {
		return nil, fmt.Errorf("get namespace: %w", err)
	}
	return &n, nil
}

// GetByName returns a namespace by name.
func (r *NamespaceRepo) GetByName(ctx context.Context, name string) (*Namespace, error) {
	row := r.db.Reader().QueryRow(ctx, `
		SELECT id, name, COALESCE(description, ''), created_at, updated_at
		FROM namespaces WHERE name = $1
	`, name)
	var n Namespace
	if err := row.Scan(&n.ID, &n.Name, &n.Description, &n.CreatedAt, &n.UpdatedAt); err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("get namespace by name: %w", err)
	}
	return &n, nil
}

// Application models an onboarded application.
type Application struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	NamespaceID   int64     `json:"namespace_id"`
	NamespaceName string    `json:"namespace_name"`
	Description   string    `json:"description"`
	CreatedAt     time.Time `json:"created_at"`
}

// ApplicationRepo manages application records.
type ApplicationRepo struct {
	db *DB
}

// NewApplicationRepo constructs an application repository.
func NewApplicationRepo(db *DB) *ApplicationRepo {
	return &ApplicationRepo{db: db}
}

// Create inserts a new application with a namespace reference.
func (r *ApplicationRepo) Create(ctx context.Context, name string, namespaceID int64, description string) (int64, error) {
	row := r.db.Writer().QueryRow(ctx, `
		INSERT INTO applications (name, namespace_id, description)
		VALUES ($1, $2, $3)
		ON CONFLICT (name) DO UPDATE SET namespace_id = EXCLUDED.namespace_id, description = EXCLUDED.description
		RETURNING id
	`, name, namespaceID, description)
	var id int64
	if err := row.Scan(&id); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			if strings.Contains(pgErr.ConstraintName, "name") {
				return 0, fmt.Errorf("application name '%s' already exists", name)
			}
		}
		if errors.As(err, &pgErr) && pgErr.Code == "23503" { // foreign_key_violation
			return 0, fmt.Errorf("namespace with ID %d does not exist", namespaceID)
		}
		return 0, fmt.Errorf("create application: %w", err)
	}
	return id, nil
}

// List returns all applications with their namespace names.
func (r *ApplicationRepo) List(ctx context.Context) ([]Application, error) {
	rows, err := r.db.Reader().Query(ctx, `
		SELECT a.id, a.name, COALESCE(a.namespace_id, 0), COALESCE(n.name, a.namespace, ''), COALESCE(a.description, ''), a.created_at
		FROM applications a
		LEFT JOIN namespaces n ON a.namespace_id = n.id
		ORDER BY a.created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list applications: %w", err)
	}
	defer rows.Close()

	var apps []Application
	for rows.Next() {
		var a Application
		if err := rows.Scan(&a.ID, &a.Name, &a.NamespaceID, &a.NamespaceName, &a.Description, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan application: %w", err)
		}
		apps = append(apps, a)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate applications: %w", rows.Err())
	}
	return apps, nil
}

// PolicyRepo fetches active policies for applications.
type PolicyRepo struct {
	db *DB
}

// PolicySummary is a compact view of a policy and its version status.
type PolicySummary struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	ActiveVersion int       `json:"active_version"`
	LatestVersion int       `json:"latest_version"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// PolicyDetails includes text for active and latest versions.
type PolicyDetails struct {
	ID               int64     `json:"id"`
	Name             string    `json:"name"`
	Description      string    `json:"description"`
	ActiveVersion    int       `json:"active_version"`
	LatestVersion    int       `json:"latest_version"`
	ActivePolicyText string    `json:"active_policy_text"`
	LatestPolicyText string    `json:"latest_policy_text"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// NewPolicyRepo constructs a policy repository.
func NewPolicyRepo(db *DB) *PolicyRepo {
	return &PolicyRepo{db: db}
}

// ListPolicies returns policies for an application with active/latest version info.
func (r *PolicyRepo) ListPolicies(ctx context.Context, applicationID int64) ([]PolicySummary, error) {
	rows, err := r.db.Reader().Query(ctx, `
		SELECT
			p.id,
			p.name,
			COALESCE(p.description, ''),
			COALESCE(MAX(pv.version), 0) AS latest_version,
			COALESCE(MAX(CASE WHEN pv.is_active THEN pv.version END), 0) AS active_version,
			p.created_at,
			p.updated_at
		FROM policies p
		LEFT JOIN policy_versions pv ON pv.policy_id = p.id
		WHERE p.application_id = $1
		GROUP BY p.id, p.name, p.description, p.created_at, p.updated_at
		ORDER BY p.updated_at DESC
	`, applicationID)
	if err != nil {
		return nil, fmt.Errorf("list policies: %w", err)
	}
	defer rows.Close()

	var out []PolicySummary
	for rows.Next() {
		var p PolicySummary
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.LatestVersion, &p.ActiveVersion, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan policy: %w", err)
		}
		out = append(out, p)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate policies: %w", rows.Err())
	}
	return out, nil
}

// GetPolicy returns policy details including the active and latest policy text.
func (r *PolicyRepo) GetPolicy(ctx context.Context, applicationID, policyID int64) (PolicyDetails, error) {
	row := r.db.Reader().QueryRow(ctx, `
		SELECT
			p.id,
			p.name,
			COALESCE(p.description, ''),
			COALESCE((SELECT pv.version FROM policy_versions pv WHERE pv.policy_id = p.id AND pv.is_active = TRUE ORDER BY pv.version DESC LIMIT 1), 0) AS active_version,
			COALESCE((SELECT pv.version FROM policy_versions pv WHERE pv.policy_id = p.id ORDER BY pv.version DESC LIMIT 1), 0) AS latest_version,
			COALESCE((SELECT pv.policy_text FROM policy_versions pv WHERE pv.policy_id = p.id AND pv.is_active = TRUE ORDER BY pv.version DESC LIMIT 1), '') AS active_policy_text,
			COALESCE((SELECT pv.policy_text FROM policy_versions pv WHERE pv.policy_id = p.id ORDER BY pv.version DESC LIMIT 1), '') AS latest_policy_text,
			p.created_at,
			p.updated_at
		FROM policies p
		WHERE p.application_id = $1 AND p.id = $2
	`, applicationID, policyID)

	var out PolicyDetails
	if err := row.Scan(&out.ID, &out.Name, &out.Description, &out.ActiveVersion, &out.LatestVersion, &out.ActivePolicyText, &out.LatestPolicyText, &out.CreatedAt, &out.UpdatedAt); err != nil {
		return PolicyDetails{}, fmt.Errorf("get policy: %w", err)
	}
	return out, nil
}

// UpsertPolicyWithVersion adds a policy version and optionally activates it.
func (r *PolicyRepo) UpsertPolicyWithVersion(ctx context.Context, applicationID int64, name, description, policyText string, activate bool) (int64, int, error) {
	tx, err := r.db.Writer().Begin(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var policyID int64
	err = tx.QueryRow(ctx, `
		INSERT INTO policies (application_id, name, description)
		VALUES ($1, $2, $3)
		ON CONFLICT (application_id, name) DO UPDATE SET description = EXCLUDED.description, updated_at = NOW()
		RETURNING id
	`, applicationID, name, description).Scan(&policyID)
	if err != nil {
		return 0, 0, fmt.Errorf("upsert policy: %w", err)
	}

	var nextVersion int
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(version), 0) + 1 FROM policy_versions WHERE policy_id = $1
	`, policyID).Scan(&nextVersion)
	if err != nil {
		return 0, 0, fmt.Errorf("next version: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO policy_versions (policy_id, version, policy_text, is_active)
		VALUES ($1, $2, $3, $4)
	`, policyID, nextVersion, policyText, activate); err != nil {
		return 0, 0, fmt.Errorf("insert policy version: %w", err)
	}

	if activate {
		if _, err := tx.Exec(ctx, `UPDATE policy_versions SET is_active = FALSE WHERE policy_id = $1`, policyID); err != nil {
			return 0, 0, fmt.Errorf("deactivate policy versions: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE policy_versions SET is_active = TRUE WHERE policy_id = $1 AND version = $2`, policyID, nextVersion); err != nil {
			return 0, 0, fmt.Errorf("activate policy version: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, fmt.Errorf("commit tx: %w", err)
	}
	return policyID, nextVersion, nil
}

// ActivePolicies returns active policy texts for the application.
func (r *PolicyRepo) ActivePolicies(ctx context.Context, applicationID int64) ([]authz.PolicyText, error) {
	rows, err := r.db.Reader().Query(ctx, `
		SELECT pv.id::text AS id, pv.policy_text
		FROM policy_versions pv
		JOIN policies p ON pv.policy_id = p.id
		WHERE pv.is_active = TRUE AND p.application_id = $1
	`, applicationID)
	if err != nil {
		return nil, fmt.Errorf("query active policies: %w", err)
	}
	defer rows.Close()

	var out []authz.PolicyText
	for rows.Next() {
		var rec authz.PolicyText
		if err := rows.Scan(&rec.ID, &rec.Text); err != nil {
			return nil, fmt.Errorf("scan policy: %w", err)
		}
		out = append(out, rec)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate policies: %w", rows.Err())
	}
	return out, nil
}

// EntityRepo fetches entities for applications.
type EntityRepo struct {
	db *DB
}

// NewEntityRepo constructs an entity repository.
func NewEntityRepo(db *DB) *EntityRepo {
	return &EntityRepo{db: db}
}

// ParentRef links a child entity to a parent reference.
type ParentRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// Entities loads all entities for an application as cedar.EntityMap.
func (r *EntityRepo) Entities(ctx context.Context, applicationID int64) (cedar.EntityMap, error) {
	rows, err := r.db.Reader().Query(ctx, `
		SELECT e.entity_type, e.entity_id, e.attributes,
		       COALESCE(json_agg(json_build_object('type', ep.parent_type, 'id', ep.parent_id)) FILTER (WHERE ep.parent_type IS NOT NULL), '[]') AS parents
		FROM entities e
		LEFT JOIN entity_parents ep ON ep.child_entity_id = e.id
		WHERE e.application_id = $1
		GROUP BY e.id, e.entity_type, e.entity_id, e.attributes
	`, applicationID)
	if err != nil {
		return nil, fmt.Errorf("query entities: %w", err)
	}
	defer rows.Close()

	var rawEntities []map[string]any
	for rows.Next() {
		var entityType, entityID string
		var attrsJSON []byte
		var parentsJSON []byte
		if err := rows.Scan(&entityType, &entityID, &attrsJSON, &parentsJSON); err != nil {
			return nil, fmt.Errorf("scan entity: %w", err)
		}

		var attrs map[string]any
		if len(attrsJSON) > 0 {
			if err := json.Unmarshal(attrsJSON, &attrs); err != nil {
				return nil, fmt.Errorf("parse entity attrs: %w", err)
			}
		}
		if attrs == nil {
			attrs = map[string]any{}
		}

		var parents []map[string]string
		if len(parentsJSON) > 0 {
			if err := json.Unmarshal(parentsJSON, &parents); err != nil {
				return nil, fmt.Errorf("parse parents: %w", err)
			}
		}

		rawEntities = append(rawEntities, map[string]any{
			"uid": map[string]string{
				"type": entityType,
				"id":   entityID,
			},
			"attrs":   attrs,
			"parents": parents,
		})
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate entities: %w", rows.Err())
	}

	if len(rawEntities) == 0 {
		return cedar.EntityMap{}, nil
	}

	data, err := json.Marshal(rawEntities)
	if err != nil {
		return nil, fmt.Errorf("marshal entities: %w", err)
	}

	var entities cedar.EntityMap
	if err := json.Unmarshal(data, &entities); err != nil {
		return nil, fmt.Errorf("unmarshal entities: %w", err)
	}
	return entities, nil
}

// UpsertEntity inserts or updates an entity and its parents.
func (r *EntityRepo) UpsertEntity(ctx context.Context, applicationID int64, entityType, entityID string, attrs json.RawMessage, parents []ParentRef) error {
	if attrs == nil {
		attrs = json.RawMessage("{}")
	}

	tx, err := r.db.Writer().Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var id int64
	err = tx.QueryRow(ctx, `
		INSERT INTO entities (application_id, entity_type, entity_id, attributes)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (application_id, entity_type, entity_id)
		DO UPDATE SET attributes = EXCLUDED.attributes, updated_at = NOW()
		RETURNING id
	`, applicationID, entityType, entityID, attrs).Scan(&id)
	if err != nil {
		return fmt.Errorf("upsert entity: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM entity_parents WHERE child_entity_id = $1`, id); err != nil {
		return fmt.Errorf("clear parents: %w", err)
	}

	for _, p := range parents {
		if _, err := tx.Exec(ctx, `
			INSERT INTO entity_parents (child_entity_id, parent_type, parent_id)
			VALUES ($1, $2, $3)
		`, id, p.Type, p.ID); err != nil {
			return fmt.Errorf("insert parent: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

// SearchEntities returns IDs of entities of a specific type.
func (r *EntityRepo) SearchEntities(ctx context.Context, applicationID int64, entityType string) ([]string, error) {
	rows, err := r.db.Reader().Query(ctx, `
		SELECT entity_id
		FROM entities
		WHERE application_id = $1 AND entity_type = $2
	`, applicationID, entityType)
	if err != nil {
		return nil, fmt.Errorf("search entities: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan entity id: %w", err)
		}
		ids = append(ids, id)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate entity ids: %w", rows.Err())
	}
	return ids, nil
}

// GetGroupMemberships returns all groups (parent entities) that a given entity belongs to.
// This recursively traverses the parent hierarchy to find all group memberships.
func (r *EntityRepo) GetGroupMemberships(ctx context.Context, applicationID int64, entityType, entityID string) ([]ParentRef, error) {
	// Use a recursive CTE to find all parent groups
	rows, err := r.db.Reader().Query(ctx, `
		WITH RECURSIVE parent_tree AS (
			-- Base case: direct parents of the entity
			SELECT ep.parent_type, ep.parent_id, 1 AS depth
			FROM entity_parents ep
			JOIN entities e ON ep.child_entity_id = e.id
			WHERE e.application_id = $1 AND e.entity_type = $2 AND e.entity_id = $3
			
			UNION
			
			-- Recursive case: parents of parents
			SELECT ep.parent_type, ep.parent_id, pt.depth + 1
			FROM entity_parents ep
			JOIN entities e ON ep.child_entity_id = e.id
			JOIN parent_tree pt ON e.entity_type = pt.parent_type AND e.entity_id = pt.parent_id
			WHERE e.application_id = $1 AND pt.depth < 10  -- Prevent infinite loops
		)
		SELECT DISTINCT parent_type, parent_id FROM parent_tree
	`, applicationID, entityType, entityID)
	if err != nil {
		return nil, fmt.Errorf("query group memberships: %w", err)
	}
	defer rows.Close()

	var groups []ParentRef
	for rows.Next() {
		var g ParentRef
		if err := rows.Scan(&g.Type, &g.ID); err != nil {
			return nil, fmt.Errorf("scan group: %w", err)
		}
		groups = append(groups, g)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate groups: %w", rows.Err())
	}
	return groups, nil
}

// ListEntitiesRaw returns all entities for an application as a list of EntityRecord.
func (r *EntityRepo) ListEntitiesRaw(ctx context.Context, applicationID int64) ([]EntityRecord, error) {
	rows, err := r.db.Reader().Query(ctx, `
		SELECT e.entity_type, e.entity_id, e.attributes,
		       COALESCE(json_agg(json_build_object('type', ep.parent_type, 'id', ep.parent_id)) FILTER (WHERE ep.parent_type IS NOT NULL), '[]') AS parents
		FROM entities e
		LEFT JOIN entity_parents ep ON ep.child_entity_id = e.id
		WHERE e.application_id = $1
		GROUP BY e.id, e.entity_type, e.entity_id, e.attributes
	`, applicationID)
	if err != nil {
		return nil, fmt.Errorf("query entities: %w", err)
	}
	defer rows.Close()

	var entities []EntityRecord
	for rows.Next() {
		var e EntityRecord
		var attrsJSON, parentsJSON []byte
		if err := rows.Scan(&e.Type, &e.ID, &attrsJSON, &parentsJSON); err != nil {
			return nil, fmt.Errorf("scan entity: %w", err)
		}
		if len(attrsJSON) > 0 {
			if err := json.Unmarshal(attrsJSON, &e.Attributes); err != nil {
				return nil, fmt.Errorf("parse attrs: %w", err)
			}
		}
		if len(parentsJSON) > 0 {
			if err := json.Unmarshal(parentsJSON, &e.Parents); err != nil {
				return nil, fmt.Errorf("parse parents: %w", err)
			}
		}
		entities = append(entities, e)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate entities: %w", rows.Err())
	}
	return entities, nil
}

// EntityRecord represents an entity with its type, ID, attributes, and parents.
type EntityRecord struct {
	Type       string         `json:"type"`
	ID         string         `json:"id"`
	Attributes map[string]any `json:"attributes,omitempty"`
	Parents    []ParentRef    `json:"parents,omitempty"`
}

// SchemaRepo manages Cedar schema records per application.
type SchemaRepo struct {
	db *DB
}

// Schema represents a Cedar schema version.
type Schema struct {
	ID            int64     `json:"id"`
	ApplicationID int64     `json:"application_id"`
	Version       int       `json:"version"`
	SchemaText    string    `json:"schema_text"`
	Active        bool      `json:"active"`
	CreatedAt     time.Time `json:"created_at"`
}

// NewSchemaRepo constructs a schema repository.
func NewSchemaRepo(db *DB) *SchemaRepo {
	return &SchemaRepo{db: db}
}

// CreateSchema inserts a new schema version for an application.
func (r *SchemaRepo) CreateSchema(ctx context.Context, applicationID int64, schemaText string, activate bool) (int64, int, error) {
	tx, err := r.db.Writer().Begin(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var nextVersion int
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(version), 0) + 1 FROM schemas WHERE application_id = $1
	`, applicationID).Scan(&nextVersion)
	if err != nil {
		return 0, 0, fmt.Errorf("next version: %w", err)
	}

	var schemaID int64
	err = tx.QueryRow(ctx, `
		INSERT INTO schemas (application_id, version, schema_text, active)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, applicationID, nextVersion, schemaText, activate).Scan(&schemaID)
	if err != nil {
		return 0, 0, fmt.Errorf("insert schema: %w", err)
	}

	if activate {
		if _, err := tx.Exec(ctx, `UPDATE schemas SET active = FALSE WHERE application_id = $1 AND id != $2`, applicationID, schemaID); err != nil {
			return 0, 0, fmt.Errorf("deactivate schemas: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, fmt.Errorf("commit tx: %w", err)
	}
	return schemaID, nextVersion, nil
}

// GetActiveSchema returns the currently active schema for an application.
func (r *SchemaRepo) GetActiveSchema(ctx context.Context, applicationID int64) (*Schema, error) {
	row := r.db.Reader().QueryRow(ctx, `
		SELECT id, application_id, version, schema_text, active, created_at
		FROM schemas
		WHERE application_id = $1 AND active = TRUE
		ORDER BY version DESC
		LIMIT 1
	`, applicationID)

	var s Schema
	if err := row.Scan(&s.ID, &s.ApplicationID, &s.Version, &s.SchemaText, &s.Active, &s.CreatedAt); err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("get active schema: %w", err)
	}
	return &s, nil
}

// ListSchemas returns all schema versions for an application.
func (r *SchemaRepo) ListSchemas(ctx context.Context, applicationID int64) ([]Schema, error) {
	rows, err := r.db.Reader().Query(ctx, `
		SELECT id, application_id, version, schema_text, active, created_at
		FROM schemas
		WHERE application_id = $1
		ORDER BY version DESC
	`, applicationID)
	if err != nil {
		return nil, fmt.Errorf("list schemas: %w", err)
	}
	defer rows.Close()

	var out []Schema
	for rows.Next() {
		var s Schema
		if err := rows.Scan(&s.ID, &s.ApplicationID, &s.Version, &s.SchemaText, &s.Active, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan schema: %w", err)
		}
		out = append(out, s)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate schemas: %w", rows.Err())
	}
	return out, nil
}

// ActivateSchema activates a specific schema version.
func (r *SchemaRepo) ActivateSchema(ctx context.Context, applicationID int64, version int) error {
	tx, err := r.db.Writer().Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `UPDATE schemas SET active = FALSE WHERE application_id = $1`, applicationID); err != nil {
		return fmt.Errorf("deactivate schemas: %w", err)
	}

	result, err := tx.Exec(ctx, `UPDATE schemas SET active = TRUE WHERE application_id = $1 AND version = $2`, applicationID, version)
	if err != nil {
		return fmt.Errorf("activate schema: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("schema version %d not found", version)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

// AuditRepo manages audit log records.
type AuditRepo struct {
	db *DB
}

// AuditLog represents an audit log entry.
type AuditLog struct {
	ID            int64           `json:"id"`
	ApplicationID *int64          `json:"application_id,omitempty"`
	Actor         string          `json:"actor"`
	Action        string          `json:"action"`
	Target        string          `json:"target,omitempty"`
	Decision      string          `json:"decision,omitempty"`
	Context       json.RawMessage `json:"context,omitempty" swaggertype:"object"`
	CreatedAt     time.Time       `json:"created_at"`
}

// AuditFilter specifies query filters for audit logs.
type AuditFilter struct {
	ApplicationID *int64
	Action        string
	Decision      string
	Limit         int
	Offset        int
}

// NewAuditRepo constructs an audit repository.
func NewAuditRepo(db *DB) *AuditRepo {
	return &AuditRepo{db: db}
}

// Log inserts an audit log entry.
func (r *AuditRepo) Log(ctx context.Context, applicationID *int64, actor, action, target, decision string, auditContext map[string]any) error {
	var ctxJSON []byte
	var err error
	if auditContext != nil {
		ctxJSON, err = json.Marshal(auditContext)
		if err != nil {
			return fmt.Errorf("marshal context: %w", err)
		}
	}

	_, err = r.db.Writer().Exec(ctx, `
		INSERT INTO audit_logs (application_id, actor, action, target, decision, context)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, applicationID, actor, action, target, decision, ctxJSON)
	if err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

// List returns audit logs matching the filter.
func (r *AuditRepo) List(ctx context.Context, filter AuditFilter) ([]AuditLog, int, error) {
	// Build query with filters
	baseQuery := `FROM audit_logs WHERE 1=1`
	args := []any{}
	argIdx := 1

	if filter.ApplicationID != nil {
		baseQuery += fmt.Sprintf(" AND application_id = $%d", argIdx)
		args = append(args, *filter.ApplicationID)
		argIdx++
	}
	if filter.Action != "" {
		baseQuery += fmt.Sprintf(" AND action = $%d", argIdx)
		args = append(args, filter.Action)
		argIdx++
	}
	if filter.Decision != "" {
		baseQuery += fmt.Sprintf(" AND decision = $%d", argIdx)
		args = append(args, filter.Decision)
		argIdx++
	}

	// Count total
	var total int
	countQuery := "SELECT COUNT(*) " + baseQuery
	if err := r.db.Reader().QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count audit logs: %w", err)
	}

	// Fetch page
	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}

	selectQuery := fmt.Sprintf(`SELECT id, application_id, COALESCE(actor, ''), action, COALESCE(target, ''), COALESCE(decision, ''), context, created_at %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, baseQuery, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := r.db.Reader().Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query audit logs: %w", err)
	}
	defer rows.Close()

	var out []AuditLog
	for rows.Next() {
		var a AuditLog
		if err := rows.Scan(&a.ID, &a.ApplicationID, &a.Actor, &a.Action, &a.Target, &a.Decision, &a.Context, &a.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("scan audit log: %w", err)
		}
		out = append(out, a)
	}
	if rows.Err() != nil {
		return nil, 0, fmt.Errorf("iterate audit logs: %w", rows.Err())
	}
	return out, total, nil
}
