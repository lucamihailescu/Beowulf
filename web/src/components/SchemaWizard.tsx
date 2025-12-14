import { useState, useMemo } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Input,
  Modal,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";

type EntityType = {
  name: string;
  memberOfTypes: string[];
};

type ActionDef = {
  name: string;
  principalTypes: string[];
  resourceTypes: string[];
};

type SchemaWizardProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (schemaText: string, activate: boolean) => Promise<void>;
  saving: boolean;
};

const COMMON_ENTITY_TYPES = [
  { name: "User", description: "End users of your application" },
  { name: "Group", description: "Groups of users (e.g., teams, roles)" },
  { name: "Document", description: "Files, documents, or content" },
  { name: "Folder", description: "Containers for documents" },
  { name: "Project", description: "Projects or workspaces" },
  { name: "Organization", description: "Top-level organizational unit" },
  { name: "Resource", description: "Generic protected resource" },
  { name: "Service", description: "Backend services or APIs" },
];

const COMMON_ACTIONS = [
  { name: "view", description: "Read or view the resource" },
  { name: "edit", description: "Modify the resource" },
  { name: "delete", description: "Remove the resource" },
  { name: "create", description: "Create new resources" },
  { name: "share", description: "Share with others" },
  { name: "admin", description: "Full administrative access" },
  { name: "read", description: "Read access" },
  { name: "write", description: "Write access" },
];

export default function SchemaWizard({ open, onClose, onSubmit, saving }: SchemaWizardProps) {
  const [step, setStep] = useState(0);
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [actions, setActions] = useState<ActionDef[]>([]);
  const [activate, setActivate] = useState(true);

  // Entity input state
  const [newEntityName, setNewEntityName] = useState("");

  // Action input state
  const [newActionName, setNewActionName] = useState("");

  // Reset wizard state
  function resetWizard() {
    setStep(0);
    setEntityTypes([]);
    setActions([]);
    setActivate(true);
    setNewEntityName("");
    setNewActionName("");
  }

  function handleClose() {
    resetWizard();
    onClose();
  }

  // Add entity type
  function addEntityType(name: string) {
    const trimmed = name.trim();
    if (!trimmed || entityTypes.some((e) => e.name === trimmed)) return;
    setEntityTypes([...entityTypes, { name: trimmed, memberOfTypes: [] }]);
    setNewEntityName("");
  }

  // Remove entity type
  function removeEntityType(name: string) {
    setEntityTypes(entityTypes.filter((e) => e.name !== name));
    // Also remove from actions
    setActions(
      actions.map((a) => ({
        ...a,
        principalTypes: a.principalTypes.filter((p) => p !== name),
        resourceTypes: a.resourceTypes.filter((r) => r !== name),
      }))
    );
  }

  // Update entity memberOfTypes
  function updateEntityMemberOf(name: string, memberOfTypes: string[]) {
    setEntityTypes(
      entityTypes.map((e) => (e.name === name ? { ...e, memberOfTypes } : e))
    );
  }

  // Add action
  function addAction(name: string) {
    const trimmed = name.trim();
    if (!trimmed || actions.some((a) => a.name === trimmed)) return;
    setActions([...actions, { name: trimmed, principalTypes: [], resourceTypes: [] }]);
    setNewActionName("");
  }

  // Remove action
  function removeAction(name: string) {
    setActions(actions.filter((a) => a.name !== name));
  }

  // Update action principal types
  function updateActionPrincipals(name: string, principalTypes: string[]) {
    setActions(
      actions.map((a) => (a.name === name ? { ...a, principalTypes } : a))
    );
  }

  // Update action resource types
  function updateActionResources(name: string, resourceTypes: string[]) {
    setActions(
      actions.map((a) => (a.name === name ? { ...a, resourceTypes } : a))
    );
  }

  // Generate Cedar schema JSON
  const generatedSchema = useMemo(() => {
    const entityTypesObj: Record<string, any> = {};
    for (const et of entityTypes) {
      entityTypesObj[et.name] = et.memberOfTypes.length > 0
        ? { memberOfTypes: et.memberOfTypes }
        : {};
    }

    const actionsObj: Record<string, any> = {};
    for (const action of actions) {
      const appliesTo: any = {};
      if (action.principalTypes.length > 0) {
        appliesTo.principalTypes = action.principalTypes;
      }
      if (action.resourceTypes.length > 0) {
        appliesTo.resourceTypes = action.resourceTypes;
      }
      actionsObj[action.name] = Object.keys(appliesTo).length > 0
        ? { appliesTo }
        : {};
    }

    const schema = {
      "": {
        entityTypes: entityTypesObj,
        actions: actionsObj,
      },
    };

    return JSON.stringify(schema, null, 2);
  }, [entityTypes, actions]);

  // Validation
  const canProceedStep1 = entityTypes.length > 0;
  const canProceedStep2 = true; // Relationships are optional
  const canProceedStep3 = actions.length > 0;
  const canProceedStep4 = actions.every(
    (a) => a.principalTypes.length > 0 && a.resourceTypes.length > 0
  );

  async function handleSubmit() {
    await onSubmit(generatedSchema, activate);
    resetWizard();
  }

  const entityTypeOptions = entityTypes.map((e) => ({ value: e.name, label: e.name }));

  return (
    <Modal
      open={open}
      title={
        <Space>
          <span>Schema Wizard</span>
          <Tag color="blue">Step {step + 1} of 5</Tag>
        </Space>
      }
      onCancel={handleClose}
      footer={null}
      width={800}
      destroyOnClose
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: "Entities" },
          { title: "Relationships" },
          { title: "Actions" },
          { title: "Permissions" },
          { title: "Review" },
        ]}
      />

      {/* Step 0: Entity Types */}
      {step === 0 && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="Define Entity Types"
            description="Entity types represent the nouns in your authorization model — users, groups, resources, and other objects that policies reference."
          />

          <Card size="small" title="Quick Add Common Types">
            <Space wrap>
              {COMMON_ENTITY_TYPES.filter(
                (c) => !entityTypes.some((e) => e.name === c.name)
              ).map((c) => (
                <Tooltip key={c.name} title={c.description}>
                  <Button size="small" onClick={() => addEntityType(c.name)}>
                    + {c.name}
                  </Button>
                </Tooltip>
              ))}
              {COMMON_ENTITY_TYPES.every((c) =>
                entityTypes.some((e) => e.name === c.name)
              ) && (
                <Typography.Text type="secondary">
                  All common types added
                </Typography.Text>
              )}
            </Space>
          </Card>

          <Card size="small" title="Add Custom Type">
            <Space.Compact style={{ width: "100%" }}>
              <Input
                placeholder="CustomType (PascalCase)"
                value={newEntityName}
                onChange={(e) => setNewEntityName(e.target.value)}
                onPressEnter={() => addEntityType(newEntityName)}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => addEntityType(newEntityName)}
                disabled={!newEntityName.trim()}
              >
                Add
              </Button>
            </Space.Compact>
          </Card>

          <Card size="small" title={`Your Entity Types (${entityTypes.length})`}>
            {entityTypes.length === 0 ? (
              <Typography.Text type="secondary">
                No entity types added yet. Add at least one to continue.
              </Typography.Text>
            ) : (
              <Space wrap>
                {entityTypes.map((et) => (
                  <Tag
                    key={et.name}
                    closable
                    onClose={() => removeEntityType(et.name)}
                    color="green"
                  >
                    {et.name}
                  </Tag>
                ))}
              </Space>
            )}
          </Card>
        </Space>
      )}

      {/* Step 1: Relationships */}
      {step === 1 && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="Define Relationships (Optional)"
            description="Relationships define hierarchy between entities. For example, a User can be a member of a Group, or a Document can belong to a Folder."
          />

          <Table
            dataSource={entityTypes}
            rowKey="name"
            pagination={false}
            size="small"
            columns={[
              {
                title: "Entity Type",
                dataIndex: "name",
                width: 150,
                render: (name: string) => <Tag color="green">{name}</Tag>,
              },
              {
                title: (
                  <Space>
                    <span>Can be member of</span>
                    <Tooltip title="Select which entity types this entity can be a member of. Example: User can be member of Group.">
                      <InfoCircleOutlined />
                    </Tooltip>
                  </Space>
                ),
                dataIndex: "memberOfTypes",
                render: (_: any, record: EntityType) => (
                  <Select
                    mode="multiple"
                    style={{ width: "100%" }}
                    placeholder="Select parent types..."
                    value={record.memberOfTypes}
                    onChange={(values) => updateEntityMemberOf(record.name, values)}
                    options={entityTypes
                      .filter((e) => e.name !== record.name)
                      .map((e) => ({ value: e.name, label: e.name }))}
                  />
                ),
              },
            ]}
          />

          {entityTypes.some((e) => e.memberOfTypes.length > 0) && (
            <Card size="small" title="Relationship Summary">
              <Space direction="vertical" size={4}>
                {entityTypes
                  .filter((e) => e.memberOfTypes.length > 0)
                  .map((e) => (
                    <Typography.Text key={e.name}>
                      <Tag color="green">{e.name}</Tag>
                      <ArrowRightOutlined style={{ margin: "0 8px", color: "#999" }} />
                      {e.memberOfTypes.map((m) => (
                        <Tag key={m} color="blue">
                          {m}
                        </Tag>
                      ))}
                    </Typography.Text>
                  ))}
              </Space>
            </Card>
          )}
        </Space>
      )}

      {/* Step 2: Actions */}
      {step === 2 && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="Define Actions"
            description="Actions are the verbs in your authorization model — what users can do. Examples: view, edit, delete, share."
          />

          <Card size="small" title="Quick Add Common Actions">
            <Space wrap>
              {COMMON_ACTIONS.filter(
                (c) => !actions.some((a) => a.name === c.name)
              ).map((c) => (
                <Tooltip key={c.name} title={c.description}>
                  <Button size="small" onClick={() => addAction(c.name)}>
                    + {c.name}
                  </Button>
                </Tooltip>
              ))}
              {COMMON_ACTIONS.every((c) =>
                actions.some((a) => a.name === c.name)
              ) && (
                <Typography.Text type="secondary">
                  All common actions added
                </Typography.Text>
              )}
            </Space>
          </Card>

          <Card size="small" title="Add Custom Action">
            <Space.Compact style={{ width: "100%" }}>
              <Input
                placeholder="customAction (camelCase)"
                value={newActionName}
                onChange={(e) => setNewActionName(e.target.value)}
                onPressEnter={() => addAction(newActionName)}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => addAction(newActionName)}
                disabled={!newActionName.trim()}
              >
                Add
              </Button>
            </Space.Compact>
          </Card>

          <Card size="small" title={`Your Actions (${actions.length})`}>
            {actions.length === 0 ? (
              <Typography.Text type="secondary">
                No actions added yet. Add at least one to continue.
              </Typography.Text>
            ) : (
              <Space wrap>
                {actions.map((a) => (
                  <Tag
                    key={a.name}
                    closable
                    onClose={() => removeAction(a.name)}
                    color="purple"
                  >
                    {a.name}
                  </Tag>
                ))}
              </Space>
            )}
          </Card>
        </Space>
      )}

      {/* Step 3: Permissions (Action Configuration) */}
      {step === 3 && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="Configure Action Permissions"
            description="For each action, specify which entity types can perform it (principals) and which entity types it can be performed on (resources)."
          />

          <Table
            dataSource={actions}
            rowKey="name"
            pagination={false}
            size="small"
            columns={[
              {
                title: "Action",
                dataIndex: "name",
                width: 120,
                render: (name: string) => <Tag color="purple">{name}</Tag>,
              },
              {
                title: (
                  <Space>
                    <span>Who can perform? (Principals)</span>
                    <Tooltip title="Select entity types that can perform this action. Usually User or Group.">
                      <InfoCircleOutlined />
                    </Tooltip>
                  </Space>
                ),
                render: (_: any, record: ActionDef) => (
                  <Select
                    mode="multiple"
                    style={{ width: "100%" }}
                    placeholder="Select principal types..."
                    value={record.principalTypes}
                    onChange={(values) => updateActionPrincipals(record.name, values)}
                    options={entityTypeOptions}
                    status={record.principalTypes.length === 0 ? "warning" : undefined}
                  />
                ),
              },
              {
                title: (
                  <Space>
                    <span>On what? (Resources)</span>
                    <Tooltip title="Select entity types this action can be performed on. Usually Document, Folder, etc.">
                      <InfoCircleOutlined />
                    </Tooltip>
                  </Space>
                ),
                render: (_: any, record: ActionDef) => (
                  <Select
                    mode="multiple"
                    style={{ width: "100%" }}
                    placeholder="Select resource types..."
                    value={record.resourceTypes}
                    onChange={(values) => updateActionResources(record.name, values)}
                    options={entityTypeOptions}
                    status={record.resourceTypes.length === 0 ? "warning" : undefined}
                  />
                ),
              },
            ]}
          />

          {!canProceedStep4 && (
            <Alert
              type="warning"
              showIcon
              message="Incomplete Configuration"
              description="Each action must have at least one principal type and one resource type."
            />
          )}
        </Space>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="success"
            showIcon
            message="Review Your Schema"
            description="Review the generated Cedar schema below. You can edit it manually if needed, or go back to modify the wizard inputs."
          />

          <Card size="small" title="Summary">
            <Space direction="vertical" size={8}>
              <Typography.Text>
                <strong>Entity Types:</strong>{" "}
                {entityTypes.map((e) => (
                  <Tag key={e.name} color="green">
                    {e.name}
                  </Tag>
                ))}
              </Typography.Text>
              <Typography.Text>
                <strong>Actions:</strong>{" "}
                {actions.map((a) => (
                  <Tag key={a.name} color="purple">
                    {a.name}
                  </Tag>
                ))}
              </Typography.Text>
            </Space>
          </Card>

          <Card size="small" title="Generated Cedar Schema (JSON)">
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: "#f5f5f5",
                borderRadius: 4,
                maxHeight: 300,
                overflow: "auto",
                fontSize: 12,
              }}
            >
              {generatedSchema}
            </pre>
          </Card>

          <Checkbox checked={activate} onChange={(e) => setActivate(e.target.checked)}>
            Activate this schema immediately
          </Checkbox>
        </Space>
      )}

      <Divider />

      {/* Navigation */}
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Button onClick={handleClose}>Cancel</Button>
        <Space>
          {step > 0 && (
            <Button onClick={() => setStep(step - 1)}>Back</Button>
          )}
          {step === 0 && (
            <Button type="primary" onClick={() => setStep(1)} disabled={!canProceedStep1}>
              Next: Relationships
            </Button>
          )}
          {step === 1 && (
            <Button type="primary" onClick={() => setStep(2)}>
              Next: Actions
            </Button>
          )}
          {step === 2 && (
            <Button type="primary" onClick={() => setStep(3)} disabled={!canProceedStep3}>
              Next: Permissions
            </Button>
          )}
          {step === 3 && (
            <Button type="primary" onClick={() => setStep(4)} disabled={!canProceedStep4}>
              Next: Review
            </Button>
          )}
          {step === 4 && (
            <Button type="primary" onClick={handleSubmit} loading={saving}>
              Create Schema
            </Button>
          )}
        </Space>
      </Space>
    </Modal>
  );
}

