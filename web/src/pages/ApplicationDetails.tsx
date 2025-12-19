import { useEffect, useState, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Checkbox, Collapse, Descriptions, Dropdown, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined, PlusOutlined, EditOutlined, DownOutlined, FileTextOutlined, ThunderboltOutlined, DeleteOutlined } from "@ant-design/icons";
import { api, type Application, type PolicySummary, type PolicyDetails, type Schema, type AuthorizeResponse } from "../api";
import SchemaWizard from "../components/SchemaWizard";
import PolicyTemplateWizard from "../components/PolicyTemplateWizard";

export default function ApplicationDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const appId = Number(id);
  const [app, setApp] = useState<Application | null>(null);
  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Policy modal state
  const [selectedPolicy, setSelectedPolicy] = useState<PolicyDetails | null>(null);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [policyModalLoading, setPolicyModalLoading] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editPolicyText, setEditPolicyText] = useState("");
  const [editActivate, setEditActivate] = useState(true);
  const [savingExisting, setSavingExisting] = useState(false);

  // Schema modal state
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [schemaWizardOpen, setSchemaWizardOpen] = useState(false);
  const [newSchemaText, setNewSchemaText] = useState("");
  const [newSchemaActivate, setNewSchemaActivate] = useState(true);
  const [savingSchema, setSavingSchema] = useState(false);
  const [activatingSchema, setActivatingSchema] = useState<number | null>(null);

  // Policy template wizard state
  const [policyWizardOpen, setPolicyWizardOpen] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Access Simulator state
  const [simPrincipalType, setSimPrincipalType] = useState("User");
  const [simPrincipalId, setSimPrincipalId] = useState("");
  const [simAction, setSimAction] = useState("view");
  const [simResourceType, setSimResourceType] = useState("Document");
  const [simResourceId, setSimResourceId] = useState("");
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState("");
  const [simResult, setSimResult] = useState<AuthorizeResponse | null>(null);

  const commonActions = ["view", "edit", "delete", "create", "share", "admin", "read", "write"];
  const commonTypes = ["User", "Group", "Document", "Folder", "Resource"];

  // Resource Types & Actions manager state
  const [newResourceType, setNewResourceType] = useState("");
  const [newAction, setNewAction] = useState("");
  const [updatingSchema, setUpdatingSchema] = useState(false);

  // Parse entity types and actions from the active schema
  const activeSchema = useMemo(() => schemas.find(s => s.active), [schemas]);

  const schemaEntityTypes = useMemo(() => {
    if (!activeSchema?.schema_text) return [];
    try {
      const parsed = JSON.parse(activeSchema.schema_text);
      const namespace = parsed[""] || parsed;
      if (namespace?.entityTypes) {
        return Object.keys(namespace.entityTypes).sort();
      }
    } catch (e) {
      // Ignore parse errors
    }
    return [];
  }, [activeSchema]);

  const schemaActions = useMemo(() => {
    if (!activeSchema?.schema_text) return [];
    try {
      const parsed = JSON.parse(activeSchema.schema_text);
      const namespace = parsed[""] || parsed;
      if (namespace?.actions) {
        return Object.keys(namespace.actions).sort();
      }
    } catch (e) {
      // Ignore parse errors
    }
    return [];
  }, [activeSchema]);

  async function runSimulation() {
    if (!simPrincipalId || !simResourceId) {
      setSimError("Please fill in Principal ID and Resource ID");
      return;
    }
    setSimError("");
    setSimLoading(true);
    setSimResult(null);
    try {
      const response = await api.authorize({
        application_id: appId,
        principal: { type: simPrincipalType, id: simPrincipalId },
        action: { type: "Action", id: simAction },
        resource: { type: simResourceType, id: simResourceId },
      });
      setSimResult(response);
    } catch (e) {
      setSimError((e as Error).message);
    } finally {
      setSimLoading(false);
    }
  }

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError("");
      try {
        const apps = await api.listApps();
        const found = apps.find((a) => a.id === appId) || null;
        setApp(found);
        if (found) {
          const [policiesData, schemasData] = await Promise.all([
            api.listPolicies(appId),
            api.listSchemas(appId).catch(() => []),
          ]);
          setPolicies(policiesData);
          setSchemas(schemasData);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [appId]);

  async function openPolicyModal(policyId: number) {
    setPolicyModalOpen(true);
    setPolicyModalLoading(true);
    setError("");
    try {
      const item = await api.getPolicy(appId, policyId);
      setSelectedPolicy(item);
      setEditDescription(item.description ?? "");
      setEditPolicyText(item.latest_policy_text ?? "");
      setEditActivate(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPolicyModalLoading(false);
    }
  }

  function closePolicyModal() {
    setPolicyModalOpen(false);
    setSelectedPolicy(null);
    setPolicyModalLoading(false);
    setSavingExisting(false);
  }

  async function onApprovePolicy(policy: PolicySummary) {
    setError("");
    setNotice("");
    try {
      await api.approvePolicy(appId, policy.id, policy.latest_version);
      setNotice(`Policy "${policy.name}" v${policy.latest_version} approved.`);
      setPolicies(await api.listPolicies(appId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onActivatePolicy(policy: PolicySummary) {
    setError("");
    setNotice("");
    try {
      await api.activatePolicy(appId, policy.id, policy.latest_version);
      setNotice(`Policy "${policy.name}" v${policy.latest_version} activated.`);
      setPolicies(await api.listPolicies(appId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDeletePolicy(policy: PolicySummary) {
    if (!confirm(`Are you sure you want to delete policy "${policy.name}"?`)) return;
    setError("");
    setNotice("");
    try {
      const res = await api.deletePolicy(appId, policy.id);
      if (res.status === "pending_deletion") {
        setNotice(`Deletion of policy "${policy.name}" requested. Requires approval.`);
      } else {
        setNotice(`Policy "${policy.name}" deleted.`);
      }
      setPolicies(await api.listPolicies(appId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onApproveDeletePolicy(policy: PolicySummary) {
    setError("");
    setNotice("");
    try {
      await api.approveDeletePolicy(appId, policy.id);
      setNotice(`Deletion of policy "${policy.name}" approved.`);
      setPolicies(await api.listPolicies(appId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSaveExistingPolicy() {
    if (!selectedPolicy) return;
    setError("");
    setSavingExisting(true);
    try {
      const res = await api.createPolicy(appId, {
        name: selectedPolicy.name,
        description: editDescription,
        policy_text: editPolicyText,
        activate: editActivate,
      });
      setError("");
      setPolicyModalOpen(false);
      // Refresh policies list
      setPolicies(await api.listPolicies(appId));
      if (res.status === "pending_approval") {
        setNotice("Policy saved successfully but requires approval before it becomes active.");
      } else {
        setNotice("Policy saved successfully.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingExisting(false);
    }
  }

  async function onCreateSchema() {
    setError("");
    setNotice("");
    setSavingSchema(true);
    try {
      await api.createSchema(appId, {
        schema_text: newSchemaText,
        activate: newSchemaActivate,
      });
      setNotice("Schema created successfully.");
      setSchemaModalOpen(false);
      setNewSchemaText("");
      setSchemas(await api.listSchemas(appId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingSchema(false);
    }
  }

  async function onWizardSubmit(schemaText: string, activate: boolean) {
    setError("");
    setNotice("");
    setSavingSchema(true);
    try {
      await api.createSchema(appId, {
        schema_text: schemaText,
        activate,
      });
      setNotice("Schema created successfully via wizard.");
      setSchemaWizardOpen(false);
      setSchemas(await api.listSchemas(appId));
    } catch (e) {
      setError((e as Error).message);
      throw e; // Re-throw so wizard knows it failed
    } finally {
      setSavingSchema(false);
    }
  }

  async function onActivateSchema(version: number) {
    setError("");
    setNotice("");
    setActivatingSchema(version);
    try {
      await api.activateSchema(appId, version);
      setNotice(`Schema version ${version} activated.`);
      setSchemas(await api.listSchemas(appId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActivatingSchema(null);
    }
  }

  async function onPolicyWizardSubmit(name: string, description: string, policyText: string, activate: boolean) {
    setError("");
    setNotice("");
    setSavingPolicy(true);
    try {
      const res = await api.createPolicy(appId, {
        name,
        description,
        policy_text: policyText,
        activate,
      });
      if (res.status === "pending_approval") {
        setNotice(`Policy "${name}" created but requires approval.`);
      } else {
        setNotice(`Policy "${name}" created successfully.`);
      }
      setPolicyWizardOpen(false);
      setPolicies(await api.listPolicies(appId));
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setSavingPolicy(false);
    }
  }

  // Helper to build schema JSON from current types and actions
  function buildSchemaJson(entityTypes: string[], actions: string[]): string {
    const entityTypesObj: Record<string, object> = {};
    for (const t of entityTypes) {
      // Default: User and Group can be members of Group
      if (t === "User" || t === "Group") {
        entityTypesObj[t] = entityTypes.includes("Group") ? { memberOfTypes: ["Group"] } : {};
      } else {
        entityTypesObj[t] = {};
      }
    }

    const actionsObj: Record<string, object> = {};
    for (const a of actions) {
      // Default: any principal type, any resource type
      actionsObj[a] = {};
    }

    return JSON.stringify({ "": { entityTypes: entityTypesObj, actions: actionsObj } }, null, 2);
  }

  async function updateSchemaWithTypesAndActions(newEntityTypes: string[], newActions: string[]) {
    setUpdatingSchema(true);
    setError("");
    try {
      const schemaText = buildSchemaJson(newEntityTypes, newActions);
      await api.createSchema(appId, { schema_text: schemaText, activate: true });
      setSchemas(await api.listSchemas(appId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUpdatingSchema(false);
    }
  }

  async function addResourceType() {
    const trimmed = newResourceType.trim();
    if (!trimmed) return;
    if (schemaEntityTypes.includes(trimmed)) {
      setError(`Resource type "${trimmed}" already exists.`);
      return;
    }
    const updatedTypes = [...schemaEntityTypes, trimmed];
    await updateSchemaWithTypesAndActions(updatedTypes, schemaActions);
    setNewResourceType("");
    setNotice(`Resource type "${trimmed}" added.`);
  }

  async function removeResourceType(typeName: string) {
    const updatedTypes = schemaEntityTypes.filter(t => t !== typeName);
    await updateSchemaWithTypesAndActions(updatedTypes, schemaActions);
    setNotice(`Resource type "${typeName}" removed.`);
  }

  async function addAction() {
    const trimmed = newAction.trim();
    if (!trimmed) return;
    if (schemaActions.includes(trimmed)) {
      setError(`Action "${trimmed}" already exists.`);
      return;
    }
    const updatedActions = [...schemaActions, trimmed];
    await updateSchemaWithTypesAndActions(schemaEntityTypes, updatedActions);
    setNewAction("");
    setNotice(`Action "${trimmed}" added.`);
  }

  async function removeAction(actionName: string) {
    const updatedActions = schemaActions.filter(a => a !== actionName);
    await updateSchemaWithTypesAndActions(schemaEntityTypes, updatedActions);
    setNotice(`Action "${actionName}" removed.`);
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={2} style={{ margin: 0 }}>
        Application Details
      </Typography.Title>
      <Button type="link" onClick={() => navigate("/applications")}>← Back to applications</Button>
      {error && <Alert type="error" showIcon message={error} />}
      {notice && <Alert type="success" showIcon message={notice} closable onClose={() => setNotice("")} />}
      <Card loading={loading}>
        {app ? (
          <Descriptions title={app.name} bordered column={1} size="middle">
            <Descriptions.Item label="ID">{app.id}</Descriptions.Item>
            <Descriptions.Item label="Namespace"><Tag color="blue">{app.namespace_name}</Tag></Descriptions.Item>
            <Descriptions.Item label="Description">{app.description || <Tag color="default">None</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Approval">
              {app.approval_required ? <Tag color="orange">Required</Tag> : <Tag color="green">Not Required</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Created At">{app.created_at ? new Date(app.created_at).toLocaleString() : <Tag>Unknown</Tag>}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">No application found.</Typography.Text>
        )}
      </Card>
      <Card
        title="Policies"
        loading={loading}
        extra={
          <Dropdown
            menu={{
              items: [
                {
                  key: "wizard",
                  icon: <PlusOutlined />,
                  label: "Use Template Wizard (Recommended)",
                  onClick: () => setPolicyWizardOpen(true),
                },
                {
                  key: "manual",
                  icon: <FileTextOutlined />,
                  label: "Write Cedar Policy Manually",
                  onClick: () => {
                    setSelectedPolicy({ id: 0, name: "", description: "", active_version: 0, latest_version: 0, active_policy_text: "", latest_policy_text: "", active_status: "", latest_status: "", created_at: "", updated_at: "" });
                    setEditDescription("");
                    setEditPolicyText("");
                    setPolicyModalOpen(true);
                  },
                },
              ],
            }}
          >
            <Button type="primary">
              <Space>
                Add Policy
                <DownOutlined />
              </Space>
            </Button>
          </Dropdown>
        }
      >
        <Table
          rowKey="id"
          dataSource={policies}
          columns={[
            { title: "Name", dataIndex: "name" },
            { title: "Description", dataIndex: "description" },
            { title: "Active", dataIndex: "active_version", width: 80, render: (v) => v || "—" },
            { title: "Latest", dataIndex: "latest_version", width: 80, render: (v) => v || "—" },
            {
              title: "Status",
              dataIndex: "latest_status",
              width: 120,
              render: (v: string) => {
                const color = v === "approved" ? "green" : v === "pending_approval" ? "orange" : v === "pending_deletion" ? "red" : "blue";
                return <Tag color={color}>{v ? v.toUpperCase().replace("_", " ") : "UNKNOWN"}</Tag>;
              },
            },
            {
              title: "Actions",
              key: "actions",
              width: 160,
              render: (_: any, record: PolicySummary) => (
                <Space size="small" onClick={(e) => e.stopPropagation()}>
                  {record.latest_status === "pending_approval" && (
                    <Button size="small" type="primary" ghost onClick={() => onApprovePolicy(record)}>
                      Approve
                    </Button>
                  )}
                  {record.latest_status === "pending_deletion" && (
                    <Button size="small" type="primary" danger onClick={() => onApproveDeletePolicy(record)}>
                      Approve Delete
                    </Button>
                  )}
                  {record.latest_status === "approved" && record.latest_version > record.active_version && (
                    <Button size="small" onClick={() => onActivatePolicy(record)}>
                      Activate
                    </Button>
                  )}
                  {record.latest_status !== "pending_deletion" && (
                    <Button size="small" danger onClick={() => onDeletePolicy(record)}>
                      Delete
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
          pagination={false}
          locale={{ emptyText: "No policies for this application. Click 'Add Policy' to create one." }}
          onRow={(record) => ({
            onClick: () => openPolicyModal(record.id),
            style: { cursor: "pointer" },
          })}
        />
      </Card>

      <Card
        title="Schemas"
        loading={loading}
        extra={
          <Dropdown
            menu={{
              items: [
                {
                  key: "wizard",
                  icon: <PlusOutlined />,
                  label: "Use Wizard (Recommended)",
                  onClick: () => setSchemaWizardOpen(true),
                },
                {
                  key: "manual",
                  icon: <EditOutlined />,
                  label: "Write JSON Manually",
                  onClick: () => setSchemaModalOpen(true),
                },
              ],
            }}
          >
            <Button type="primary">
              <Space>
                Add Schema
                <DownOutlined />
              </Space>
            </Button>
          </Dropdown>
        }
      >
        <Table
          rowKey="id"
          dataSource={schemas}
          columns={[
            { title: "Version", dataIndex: "version", width: 100 },
            {
              title: "Status",
              dataIndex: "active",
              width: 120,
              render: (active: boolean) =>
                active ? (
                  <Tag icon={<CheckCircleOutlined />} color="success">
                    Active
                  </Tag>
                ) : (
                  <Tag>Inactive</Tag>
                ),
            },
            {
              title: "Created",
              dataIndex: "created_at",
              width: 180,
              render: (v: string) => (v ? new Date(v).toLocaleString() : "—"),
            },
            {
              title: "Actions",
              key: "actions",
              width: 120,
              render: (_: any, record: Schema) =>
                !record.active ? (
                  <Button
                    size="small"
                    loading={activatingSchema === record.version}
                    onClick={() => onActivateSchema(record.version)}
                  >
                    Activate
                  </Button>
                ) : null,
            },
          ]}
          pagination={false}
          locale={{ emptyText: "No schemas defined for this application." }}
          expandable={{
            expandedRowRender: (record: Schema) => (
              <pre style={{ margin: 0, maxHeight: 300, overflow: "auto", fontSize: 12 }}>
                {record.schema_text}
              </pre>
            ),
          }}
        />
      </Card>

      {/* Resource Types & Actions Manager */}
      <Card
        title="Resource Types & Actions"
        loading={loading || updatingSchema}
        extra={
          activeSchema ? (
            <Tag color="green">Schema v{activeSchema.version} active</Tag>
          ) : (
            <Tag color="orange">No active schema</Tag>
          )
        }
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            Define the resource types (entities) and actions for your application. These will be available in the Policy Template Wizard.
          </Typography.Paragraph>

          {/* Resource Types Section */}
          <div>
            <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
              Resource Types
            </Typography.Text>
            <Space wrap style={{ marginBottom: 8 }}>
              {schemaEntityTypes.length > 0 ? (
                schemaEntityTypes.map((t) => (
                  <Tag
                    key={t}
                    color="green"
                    closable
                    onClose={(e) => {
                      e.preventDefault();
                      removeResourceType(t);
                    }}
                    style={{ marginBottom: 4 }}
                  >
                    {t}
                  </Tag>
                ))
              ) : (
                <Typography.Text type="secondary">No resource types defined yet.</Typography.Text>
              )}
            </Space>
            <Space.Compact style={{ width: "100%", maxWidth: 400 }}>
              <Select
                style={{ width: 180 }}
                value={newResourceType || undefined}
                onChange={setNewResourceType}
                placeholder="Quick add..."
                allowClear
                options={commonTypes
                  .filter((t) => !schemaEntityTypes.includes(t))
                  .map((t) => ({ value: t, label: t }))}
              />
              <Input
                style={{ flex: 1 }}
                value={newResourceType}
                onChange={(e) => setNewResourceType(e.target.value)}
                placeholder="Or type custom (PascalCase)..."
                onPressEnter={addResourceType}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={addResourceType}
                disabled={!newResourceType.trim() || updatingSchema}
                loading={updatingSchema}
              >
                Add
              </Button>
            </Space.Compact>
          </div>

          {/* Actions Section */}
          <div>
            <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
              Actions
            </Typography.Text>
            <Space wrap style={{ marginBottom: 8 }}>
              {schemaActions.length > 0 ? (
                schemaActions.map((a) => (
                  <Tag
                    key={a}
                    color="purple"
                    closable
                    onClose={(e) => {
                      e.preventDefault();
                      removeAction(a);
                    }}
                    style={{ marginBottom: 4 }}
                  >
                    {a}
                  </Tag>
                ))
              ) : (
                <Typography.Text type="secondary">No actions defined yet.</Typography.Text>
              )}
            </Space>
            <Space.Compact style={{ width: "100%", maxWidth: 400 }}>
              <Select
                style={{ width: 180 }}
                value={newAction || undefined}
                onChange={setNewAction}
                placeholder="Quick add..."
                allowClear
                options={commonActions
                  .filter((a) => !schemaActions.includes(a))
                  .map((a) => ({ value: a, label: a }))}
              />
              <Input
                style={{ flex: 1 }}
                value={newAction}
                onChange={(e) => setNewAction(e.target.value)}
                placeholder="Or type custom (camelCase)..."
                onPressEnter={addAction}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={addAction}
                disabled={!newAction.trim() || updatingSchema}
                loading={updatingSchema}
              >
                Add
              </Button>
            </Space.Compact>
          </div>

          {/* Info about Policy Wizard integration */}
          {(schemaEntityTypes.length > 0 || schemaActions.length > 0) && (
            <Alert
              type="info"
              showIcon
              message="Policy Wizard Integration"
              description="These resource types and actions will be available as dropdown options when creating policies via the Template Wizard."
            />
          )}
        </Space>
      </Card>

      {/* Access Simulator - Application Specific (Collapsible) */}
      <Collapse
        items={[
          {
            key: "simulator",
            label: (
              <Space>
                <ThunderboltOutlined />
                <span>What If? Access Simulator</span>
                {app && <Tag color="blue">{app.name}</Tag>}
              </Space>
            ),
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                  Test authorization decisions for this application. Check if a principal can perform an action on a resource.
                </Typography.Paragraph>

                {simError && <Alert type="error" showIcon message={simError} />}

                {/* Application - locked to current app */}
                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>Application</Typography.Text>
                  <Input 
                    value={app ? `${app.name} (${app.namespace_name})` : "Loading..."} 
                    disabled 
                    style={{ background: "#f5f5f5" }}
                  />
                </div>

                {/* Principal */}
                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>Principal (Who?)</Typography.Text>
                  <Space.Compact style={{ width: "100%" }}>
                    <Select
                      style={{ width: 120 }}
                      value={simPrincipalType}
                      onChange={setSimPrincipalType}
                      options={commonTypes.map((t) => ({ value: t, label: t }))}
                    />
                    <Input
                      style={{ width: "calc(100% - 120px)" }}
                      value={simPrincipalId}
                      onChange={(e) => setSimPrincipalId(e.target.value)}
                      placeholder="Enter principal ID (e.g., alice)"
                    />
                  </Space.Compact>
                </div>

                {/* Action */}
                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>Action (What?)</Typography.Text>
                  <Select
                    style={{ width: "100%" }}
                    value={simAction}
                    onChange={setSimAction}
                    showSearch
                    options={commonActions.map((a) => ({ value: a, label: a }))}
                  />
                </div>

                {/* Resource */}
                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>Resource (On What?)</Typography.Text>
                  <Space.Compact style={{ width: "100%" }}>
                    <Select
                      style={{ width: 120 }}
                      value={simResourceType}
                      onChange={setSimResourceType}
                      options={commonTypes.map((t) => ({ value: t, label: t }))}
                    />
                    <Input
                      style={{ width: "calc(100% - 120px)" }}
                      value={simResourceId}
                      onChange={(e) => setSimResourceId(e.target.value)}
                      placeholder="Enter resource ID (e.g., doc-123)"
                    />
                  </Space.Compact>
                </div>

                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  onClick={runSimulation}
                  loading={simLoading}
                  disabled={!simPrincipalId || !simResourceId}
                  size="large"
                  block
                >
                  Check Access
                </Button>

                {simResult && (
                  <div
                    style={{
                      padding: 24,
                      textAlign: "center",
                      background: simResult.decision === "allow" ? "#f6ffed" : "#fff2f0",
                      borderRadius: 8,
                      border: `2px solid ${simResult.decision === "allow" ? "#52c41a" : "#ff4d4f"}`,
                    }}
                  >
                    {simResult.decision === "allow" ? (
                      <>
                        <CheckCircleOutlined style={{ fontSize: 48, color: "#52c41a" }} />
                        <Typography.Title level={3} style={{ margin: "16px 0 0", color: "#52c41a" }}>
                          ALLOWED
                        </Typography.Title>
                      </>
                    ) : (
                      <>
                        <CloseCircleOutlined style={{ fontSize: 48, color: "#ff4d4f" }} />
                        <Typography.Title level={3} style={{ margin: "16px 0 0", color: "#ff4d4f" }}>
                          DENIED
                        </Typography.Title>
                      </>
                    )}
                    {simResult.reasons && simResult.reasons.length > 0 && (
                      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                        Reasons: {simResult.reasons.join(", ")}
                      </Typography.Paragraph>
                    )}
                  </div>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={schemaModalOpen}
        title="Create New Schema"
        onCancel={() => setSchemaModalOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setSchemaModalOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              onClick={onCreateSchema}
              loading={savingSchema}
              disabled={!newSchemaText.trim()}
            >
              Create Schema
            </Button>
          </Space>
        }
        width={700}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            Enter the Cedar schema in JSON format. This schema will be used to validate policies.
          </Typography.Paragraph>
          <Input.TextArea
            value={newSchemaText}
            onChange={(e) => setNewSchemaText(e.target.value)}
            rows={16}
            placeholder={`{
  "": {
    "entityTypes": {
      "User": {},
      "Document": {
        "memberOfTypes": ["Folder"]
      },
      "Folder": {}
    },
    "actions": {
      "view": {
        "appliesTo": {
          "principalTypes": ["User"],
          "resourceTypes": ["Document", "Folder"]
        }
      },
      "edit": {
        "appliesTo": {
          "principalTypes": ["User"],
          "resourceTypes": ["Document"]
        }
      }
    }
  }
}`}
          />
          <Checkbox checked={newSchemaActivate} onChange={(e) => setNewSchemaActivate(e.target.checked)}>
            Activate this schema version
          </Checkbox>
        </Space>
      </Modal>

      <Modal
        open={policyModalOpen}
        title={selectedPolicy?.name ? `Policy: ${selectedPolicy.name}` : "Create New Policy"}
        onCancel={closePolicyModal}
        footer={
          <Space>
            <Button onClick={closePolicyModal}>Close</Button>
            {selectedPolicy?.active_policy_text && (
              <Button
                onClick={() => setEditPolicyText(selectedPolicy.active_policy_text || "")}
              >
                Load active text
              </Button>
            )}
            <Button
              type="primary"
              onClick={onSaveExistingPolicy}
              loading={savingExisting}
              disabled={!selectedPolicy || !editPolicyText.trim() || (selectedPolicy.id === 0 && !selectedPolicy.name)}
            >
              {selectedPolicy?.id === 0 ? "Create Policy" : "Save new version"}
            </Button>
          </Space>
        }
        width={700}
      >
        {policyModalLoading ? (
          <Typography.Paragraph style={{ margin: 0 }}>Loading policy…</Typography.Paragraph>
        ) : !selectedPolicy ? (
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            No policy selected.
          </Typography.Paragraph>
        ) : (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {selectedPolicy.id !== 0 && (
              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                Active v{selectedPolicy.active_version || "—"} · Latest v{selectedPolicy.latest_version || "—"}
              </Typography.Paragraph>
            )}

            <div>
              <Typography.Text>Name</Typography.Text>
              <Input
                value={selectedPolicy.name}
                readOnly={selectedPolicy.id !== 0}
                onChange={(e) => {
                  if (selectedPolicy.id === 0) {
                    setSelectedPolicy({ ...selectedPolicy, name: e.target.value });
                  }
                }}
                placeholder="my-policy-name"
              />
            </div>
            <div>
              <Typography.Text>Description</Typography.Text>
              <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Optional description" />
            </div>
            <div>
              <Typography.Text>Policy text (Cedar)</Typography.Text>
              <Input.TextArea
                value={editPolicyText}
                onChange={(e) => setEditPolicyText(e.target.value)}
                rows={14}
                placeholder={`// Example policy
permit (
  principal in Group::"admins",
  action,
  resource
);`}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </div>
            {app?.approval_required && (
              <Alert
                type="info"
                showIcon
                message="Approval Required"
                description="This application requires approval for policy changes. Checking the box below will submit the policy for approval. Unchecking it will save as Draft."
                style={{ marginBottom: 12 }}
              />
            )}
            <Checkbox checked={editActivate} onChange={(e) => setEditActivate(e.target.checked)}>
              {app?.approval_required
                ? "Submit for approval"
                : `Activate ${selectedPolicy.id === 0 ? "this policy" : "new version"}`}
            </Checkbox>
          </Space>
        )}
      </Modal>

      <SchemaWizard
        open={schemaWizardOpen}
        onClose={() => setSchemaWizardOpen(false)}
        onSubmit={onWizardSubmit}
        saving={savingSchema}
      />

      <PolicyTemplateWizard
        open={policyWizardOpen}
        onClose={() => setPolicyWizardOpen(false)}
        onSubmit={onPolicyWizardSubmit}
        saving={savingPolicy}
        approvalRequired={app?.approval_required}
        entityTypes={schemaEntityTypes.length > 0 ? schemaEntityTypes : commonTypes}
        actions={schemaActions.length > 0 ? schemaActions : commonActions}
      />
    </Space>
  );
}
