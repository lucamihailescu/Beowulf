import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Col, Collapse, Input, Modal, Row, Select, Space, Steps, Table, Tag, Typography, message } from "antd";
import { PlusOutlined, RocketOutlined, UndoOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL, api, type Application, type Namespace } from "../api";

export default function Applications() {
  const navigate = useNavigate();
  const [apps, setApps] = useState<Application[]>([]);
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  const [creatingApp, setCreatingApp] = useState(false);
  const [upsertingEntity, setUpsertingEntity] = useState(false);

  const [createStep, setCreateStep] = useState(0);

  const [name, setName] = useState("");
  const [selectedNamespaceId, setSelectedNamespaceId] = useState<number | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);

  // New namespace modal
  const [newNamespaceModalOpen, setNewNamespaceModalOpen] = useState(false);
  const [newNamespaceName, setNewNamespaceName] = useState("");
  const [newNamespaceDesc, setNewNamespaceDesc] = useState("");
  const [creatingNamespace, setCreatingNamespace] = useState(false);

  const [selectedAppId, setSelectedAppId] = useState<number | "">("");
  const [entityType, setEntityType] = useState("User");
  const [entityId, setEntityId] = useState("");
  const [entityAttrs, setEntityAttrs] = useState("{}");
  const [entityParents, setEntityParents] = useState("[]");

  const selectedApp = useMemo(() => apps.find((a) => a.id === selectedAppId), [apps, selectedAppId]);
  const selectedNamespace = useMemo(() => namespaces.find((n) => n.id === selectedNamespaceId), [namespaces, selectedNamespaceId]);

  // Control which collapse panels are open
  const [activeCollapseKeys, setActiveCollapseKeys] = useState<string[]>([]);

  async function refresh() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const [appsData, namespacesData] = await Promise.all([
        api.listApps(showDeleted),
        api.listNamespaces(),
      ]);
      setApps(appsData);
      setNamespaces(namespacesData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [showDeleted]);

  async function onCreateNamespace() {
    setError("");
    setCreatingNamespace(true);
    try {
      const created = await api.createNamespace({ name: newNamespaceName, description: newNamespaceDesc });
      setNewNamespaceName("");
      setNewNamespaceDesc("");
      setNewNamespaceModalOpen(false);
      const updatedNamespaces = await api.listNamespaces();
      setNamespaces(updatedNamespaces);
      setSelectedNamespaceId(created.id);
      setNotice(`Namespace "${newNamespaceName}" created.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingNamespace(false);
    }
  }

  async function onCreateApp() {
    setError("");
    setNotice("");
    if (!selectedNamespaceId) {
      setError("Please select a namespace.");
      return;
    }
    setCreatingApp(true);
    try {
      const created = await api.createApp({ name, namespace_id: selectedNamespaceId, description, approval_required: approvalRequired });
      setName("");
      setSelectedNamespaceId(undefined);
      setDescription("");
      setApprovalRequired(false);
      setCreateStep(0);
      await refresh();
      setNotice(`Application "${name}" created successfully.`);
      // Navigate to the new application
      navigate(`/applications/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingApp(false);
    }
  }

  async function onUpsertEntity() {
    setError("");
    setNotice("");
    if (selectedAppId === "") {
      setError("Select an application first.");
      return;
    }
    setUpsertingEntity(true);
    try {
      const attrs = JSON.parse(entityAttrs) as Record<string, unknown>;
      const parents = JSON.parse(entityParents) as Array<{ type: string; id: string }>;
      await api.upsertEntity(selectedAppId, { type: entityType, id: entityId, attributes: attrs, parents });
      setEntityId("");
      setEntityAttrs("{}");
      setEntityParents("[]");
      setNotice("Entity saved.");
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("Unexpected") || msg.includes("JSON")) {
        setError(`Invalid JSON in Attributes/Parents: ${msg}`);
      } else {
        setError(msg);
      }
    } finally {
      setUpsertingEntity(false);
    }
  }

  async function handleRestoreApp(id: number) {
    try {
      await api.restoreApp(id);
      message.success("Application restored successfully");
      refresh();
    } catch (err: any) {
      message.error(err.message || "Failed to restore application");
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Applications
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Register applications and manage centrally stored entities.
        </Typography.Paragraph>
      </div>

      {error && <Alert type="error" showIcon message={error} closable onClose={() => setError("")} />}
      {notice && <Alert type="success" showIcon message={notice} closable onClose={() => setNotice("")} />}

      <Row gutter={[16, 16]}>
        {/* Main Content */}
        <Col xs={24} lg={16}>
          {/* Applications Table */}
          <Card 
            title="Registered Applications" 
            loading={loading}
            extra={
              <Space>
                <Checkbox checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)}>
                  Show Deleted
                </Checkbox>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                  // Expand the create section and scroll to it
                  setActiveCollapseKeys(prev => prev.includes("create") ? prev : [...prev, "create"]);
                  setTimeout(() => {
                    document.getElementById("create-app-section")?.scrollIntoView({ behavior: "smooth" });
                  }, 100);
                }}>
                  New Application
                </Button>
              </Space>
            }
          >
            {apps.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32 }}>
                <Typography.Paragraph type="secondary">
                  No applications registered yet. Create your first application to get started.
                </Typography.Paragraph>
              </div>
            ) : (
              <Table
                rowKey="id"
                loading={loading}
                pagination={false}
                dataSource={apps}
                columns={[
                  { title: "Name", dataIndex: "name", render: (v, record) => (
                    <Space>
                      <a onClick={() => navigate(`/applications/${record.id}`)}>{v}</a>
                      {record.deleted_at && <Tag color="red">Deleted</Tag>}
                    </Space>
                  )},
                  { title: "Namespace", dataIndex: "namespace_name", render: (v) => <Tag color="blue">{v}</Tag> },
                  { title: "Description", dataIndex: "description", ellipsis: true },
                  {
                    title: "Actions",
                    key: "actions",
                    render: (_, record) => (
                      record.deleted_at ? (
                        <Button 
                          size="small" 
                          icon={<UndoOutlined />} 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRestoreApp(record.id);
                          }}
                        >
                          Restore
                        </Button>
                      ) : null
                    )
                  }
                ]}
                onRow={(record) => ({
                  onClick: () => navigate(`/applications/${record.id}`),
                  style: { cursor: "pointer" },
                })}
              />
            )}
          </Card>

          {/* Namespaces (Collapsible) */}
          <div style={{ marginTop: 16 }}>
            <Collapse
              items={[
                {
                  key: "namespaces",
                  label: (
                    <Space>
                      <span>Namespaces</span>
                      <Tag>{namespaces.length}</Tag>
                    </Space>
                  ),
                  extra: (
                    <Button 
                      size="small" 
                      icon={<PlusOutlined />} 
                      onClick={(e) => { e.stopPropagation(); setNewNamespaceModalOpen(true); }}
                    >
                      New
                    </Button>
                  ),
                  children: (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                        Namespaces group applications that share authorization context.
                      </Typography.Paragraph>
                      <Table
                        rowKey="id"
                        size="small"
                        loading={loading}
                        pagination={false}
                        dataSource={namespaces}
                        columns={[
                          { title: "Name", dataIndex: "name", render: (v) => <Tag color="blue">{v}</Tag> },
                          { title: "Description", dataIndex: "description" },
                          { 
                            title: "Apps", 
                            key: "apps",
                            width: 80,
                            render: (_, record) => {
                              const count = apps.filter(a => a.namespace_name === record.name).length;
                              return <Tag>{count}</Tag>;
                            }
                          },
                        ]}
                        locale={{ emptyText: "No namespaces yet." }}
                      />
                    </Space>
                  ),
                },
              ]}
            />
          </div>

          {/* Create Application (Collapsible) */}
          <div id="create-app-section" style={{ marginTop: 16 }}>
            <Collapse
              activeKey={activeCollapseKeys.filter(k => k === "create")}
              onChange={(keys) => {
                const keysArr = Array.isArray(keys) ? keys : [keys];
                setActiveCollapseKeys(prev => {
                  const otherKeys = prev.filter(k => k !== "create");
                  return keysArr.includes("create") ? [...otherKeys, "create"] : otherKeys;
                });
              }}
              items={[
                {
                  key: "create",
                  label: (
                    <Space>
                      <PlusOutlined />
                      <span>Create New Application</span>
                    </Space>
                  ),
                  children: (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Steps
                        current={createStep}
                        size="small"
                        items={[{ title: "Namespace" }, { title: "Details" }, { title: "Create" }]}
                      />

                      {createStep === 0 && (
                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          <Typography.Text strong>Select a Namespace</Typography.Text>
                          <Space.Compact style={{ width: "100%" }}>
                            <Select
                              value={selectedNamespaceId}
                              onChange={(v) => setSelectedNamespaceId(v)}
                              placeholder="Select namespace…"
                              style={{ width: "100%" }}
                              showSearch
                              optionFilterProp="label"
                              options={namespaces.map((n) => ({ value: n.id, label: `${n.name}${n.description ? ` — ${n.description}` : ''}` }))}
                            />
                            <Button icon={<PlusOutlined />} onClick={() => setNewNamespaceModalOpen(true)}>
                              New
                            </Button>
                          </Space.Compact>
                          {selectedNamespace && (
                            <Alert
                              type="info"
                              showIcon
                              message={`Selected: ${selectedNamespace.name}`}
                              description={selectedNamespace.description || "No description"}
                            />
                          )}
                        </Space>
                      )}

                      {createStep === 1 && (
                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          <div>
                            <Typography.Text strong>Application Name</Typography.Text>
                            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" />
                          </div>
                          <div>
                            <Typography.Text strong>Description</Typography.Text>
                            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
                          </div>
                          <div>
                            <Checkbox checked={approvalRequired} onChange={(e) => setApprovalRequired(e.target.checked)}>
                              Require Approval for Policies
                            </Checkbox>
                          </div>
                        </Space>
                      )}

                      {createStep === 2 && (
                        <Alert
                          type="info"
                          showIcon
                          message="Ready to create"
                          description={`Application "${name}" will be created in the "${selectedNamespace?.name}" namespace.`}
                        />
                      )}

                      <Space>
                        <Button
                          onClick={() => setCreateStep((s) => Math.max(0, s - 1))}
                          disabled={createStep === 0 || creatingApp}
                        >
                          Back
                        </Button>
                        {createStep === 0 && (
                          <Button type="primary" onClick={() => setCreateStep(1)} disabled={!selectedNamespaceId}>
                            Next
                          </Button>
                        )}
                        {createStep === 1 && (
                          <Button type="primary" onClick={() => setCreateStep(2)} disabled={!name.trim()}>
                            Next
                          </Button>
                        )}
                        {createStep === 2 && (
                          <Button type="primary" onClick={onCreateApp} loading={creatingApp} disabled={!name.trim() || !selectedNamespaceId}>
                            Create Application
                          </Button>
                        )}
                      </Space>
                    </Space>
                  ),
                },
              ]}
            />
          </div>

          {/* Upsert Entity (Collapsible) */}
          <div style={{ marginTop: 16 }}>
            <Collapse
              items={[
                {
                  key: "entity",
                  label: "Add/Update Entity",
                  children: (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                        Create or update entities (users, groups, resources) for your applications.
                      </Typography.Paragraph>
                      <div>
                        <Typography.Text strong>Application</Typography.Text>
                        <Select
                          value={selectedAppId === "" ? undefined : selectedAppId}
                          onChange={(v) => setSelectedAppId(v)}
                          placeholder="Select application…"
                          style={{ width: "100%" }}
                          showSearch
                          optionFilterProp="label"
                          options={apps.map((a) => ({ value: a.id, label: `${a.name} (${a.namespace_name})` }))}
                        />
                      </div>
                      <Row gutter={12}>
                        <Col span={12}>
                          <Typography.Text strong>Type</Typography.Text>
                          <Input value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="User" />
                        </Col>
                        <Col span={12}>
                          <Typography.Text strong>ID</Typography.Text>
                          <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="alice" />
                        </Col>
                      </Row>
                      <div>
                        <Typography.Text strong>Attributes (JSON)</Typography.Text>
                        <Input.TextArea value={entityAttrs} onChange={(e) => setEntityAttrs(e.target.value)} rows={3} />
                      </div>
                      <div>
                        <Typography.Text strong>Parents (JSON)</Typography.Text>
                        <Input.TextArea 
                          value={entityParents} 
                          onChange={(e) => setEntityParents(e.target.value)} 
                          rows={2}
                          placeholder='[{"type":"Group","id":"admins"}]'
                        />
                      </div>
                      <Button
                        type="primary"
                        onClick={onUpsertEntity}
                        loading={upsertingEntity}
                        disabled={selectedAppId === "" || !entityType || !entityId}
                      >
                        Save Entity
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        </Col>

        {/* Sidebar - Quick Start Guide */}
        <Col xs={24} lg={8}>
          <Card 
            title={
              <Space>
                <RocketOutlined style={{ color: "#1890ff" }} />
                <span>Quick Start Guide</span>
              </Space>
            }
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <div>
                <Typography.Text strong style={{ color: "#1890ff" }}>Step 1: Create a Namespace</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                  Namespaces group related applications. Click "New" in the Namespaces section.
                </Typography.Paragraph>
              </div>
              <div>
                <Typography.Text strong style={{ color: "#1890ff" }}>Step 2: Create an Application</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                  Register your application by expanding "Create New Application" below.
                </Typography.Paragraph>
              </div>
              <div>
                <Typography.Text strong style={{ color: "#1890ff" }}>Step 3: Define a Schema</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                  Click on your application, then use the Schema Wizard to define entity types and actions.
                </Typography.Paragraph>
              </div>
              <div>
                <Typography.Text strong style={{ color: "#1890ff" }}>Step 4: Create Policies</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                  Use the Policy Template Wizard to create authorization rules for your application.
                </Typography.Paragraph>
              </div>
              <div>
                <Typography.Text strong style={{ color: "#1890ff" }}>Step 5: Test with "What If?"</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                  Go to Admin Tools to test authorization decisions using the simulator.
                </Typography.Paragraph>
              </div>
            </Space>
          </Card>

          <Card title="API Endpoint" size="small" style={{ marginTop: 16 }}>
            <Typography.Text code copyable>{API_BASE_URL}</Typography.Text>
          </Card>
        </Col>
      </Row>

      <Modal
        open={newNamespaceModalOpen}
        title="Create New Namespace"
        onCancel={() => setNewNamespaceModalOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setNewNamespaceModalOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              onClick={onCreateNamespace}
              loading={creatingNamespace}
              disabled={!newNamespaceName.trim()}
            >
              Create
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            Namespaces should use PascalCase (e.g., "Ecommerce", "HR", "Inventory").
          </Typography.Paragraph>
          <div>
            <Typography.Text strong>Name</Typography.Text>
            <Input
              value={newNamespaceName}
              onChange={(e) => setNewNamespaceName(e.target.value)}
              placeholder="Ecommerce"
            />
          </div>
          <div>
            <Typography.Text strong>Description</Typography.Text>
            <Input
              value={newNamespaceDesc}
              onChange={(e) => setNewNamespaceDesc(e.target.value)}
              placeholder="E-commerce platform services"
            />
          </div>
        </Space>
      </Modal>
    </Space>
  );
}
