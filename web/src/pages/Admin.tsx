import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Col, Collapse, Input, Row, Select, Space, Table, Typography, Form, Modal, message } from "antd";
import { ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined, PlusOutlined, FolderOutlined } from "@ant-design/icons";
import { api, type Application, type AuthorizeResponse, type Namespace } from "../api";

export default function Admin() {
  const navigate = useNavigate();
  const [apps, setApps] = useState<Application[]>([]);
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<number | undefined>(undefined);
  const [principalType, setPrincipalType] = useState("User");
  const [principalId, setPrincipalId] = useState("");
  const [actionName, setActionName] = useState("view");
  const [resourceType, setResourceType] = useState("Document");
  const [resourceId, setResourceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AuthorizeResponse | null>(null);

  // Namespace creation state
  const [namespaceModalOpen, setNamespaceModalOpen] = useState(false);
  const [namespaceLoading, setNamespaceLoading] = useState(false);
  const [namespaceForm] = Form.useForm();

  useEffect(() => {
    api.listApps().then(setApps).catch(() => {});
    loadNamespaces();
  }, []);

  async function loadNamespaces() {
    try {
      const data = await api.listNamespaces();
      setNamespaces(data);
    } catch {
      // Ignore errors
    }
  }

  const commonActions = ["view", "edit", "delete", "create", "share", "admin", "read", "write"];
  const commonTypes = ["User", "Group", "Document", "Folder", "Resource"];

  async function runSimulation() {
    if (!selectedAppId || !principalId || !resourceId) {
      setError("Please fill in all required fields");
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const response = await api.authorize({
        application_id: selectedAppId,
        principal: { type: principalType, id: principalId },
        action: { type: "Action", id: actionName },
        resource: { type: resourceType, id: resourceId },
      });
      setResult(response);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function clearResults() {
    setResult(null);
    setError("");
  }

  async function handleCreateNamespace(values: { name: string; description?: string }) {
    setNamespaceLoading(true);
    try {
      await api.createNamespace({
        name: values.name,
        description: values.description,
      });
      message.success(`Namespace "${values.name}" created successfully`);
      setNamespaceModalOpen(false);
      namespaceForm.resetFields();
      loadNamespaces();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setNamespaceLoading(false);
    }
  }

  const selectedApp = apps.find((a) => a.id === selectedAppId);

  const namespaceColumns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (text: string, record: Namespace) => (
        <a onClick={(e) => { e.stopPropagation(); navigate(`/namespaces/${record.id}`); }}>{text}</a>
      ),
    },
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
      render: (text: string) => text || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: "Apps",
      key: "apps",
      width: 80,
      render: (_: unknown, record: Namespace) => {
        const count = apps.filter((a) => a.namespace_id === record.id).length;
        return count;
      },
    },
    {
      title: "Created",
      dataIndex: "created_at",
      key: "created_at",
      render: (text: string) => new Date(text).toLocaleDateString(),
    },
  ];

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Admin Tools
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Administrative tools for testing and debugging authorization policies.
        </Typography.Paragraph>
      </div>

      {/* Namespace Management Section */}
      <Card
        title={
          <Space>
            <FolderOutlined style={{ color: "#722ed1" }} />
            <span>Namespace Management</span>
          </Space>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setNamespaceModalOpen(true)}>
            Create Namespace
          </Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Namespaces group related applications together. Click on a namespace to view its details and applications.
        </Typography.Paragraph>

        <Table
          dataSource={namespaces}
          columns={namespaceColumns}
          rowKey="id"
          pagination={false}
          size="small"
          locale={{ emptyText: "No namespaces yet. Create one to get started." }}
          onRow={(record) => ({
            onClick: () => navigate(`/namespaces/${record.id}`),
            style: { cursor: "pointer" },
          })}
        />
      </Card>

      {/* What If? Access Simulator - Collapsed by default */}
      <Collapse
        items={[
          {
            key: "simulator",
            label: (
              <Space>
                <ThunderboltOutlined style={{ color: "#1890ff" }} />
                <span>What If? Access Simulator</span>
              </Space>
            ),
            children: (
              <Row gutter={[24, 24]}>
                <Col xs={24} lg={12}>
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                      Test authorization decisions without making real changes. Check if a principal can perform an action on a resource.
                    </Typography.Paragraph>

                    {error && <Alert type="error" showIcon message={error} closable onClose={() => setError("")} />}

                    <div>
                      <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                        Application
                      </Typography.Text>
                      <Select
                        style={{ width: "100%" }}
                        value={selectedAppId}
                        onChange={(v) => { setSelectedAppId(v); clearResults(); }}
                        placeholder="Select application..."
                        showSearch
                        optionFilterProp="label"
                        options={apps.map((a) => ({
                          value: a.id,
                          label: `${a.name} (${a.namespace_name})`,
                        }))}
                      />
                    </div>

                    <div>
                      <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                        Principal (Who?)
                      </Typography.Text>
                      <Space.Compact style={{ width: "100%" }}>
                        <Select
                          style={{ width: 120 }}
                          value={principalType}
                          onChange={setPrincipalType}
                          options={commonTypes.map((t) => ({ value: t, label: t }))}
                        />
                        <Input
                          style={{ width: "calc(100% - 120px)" }}
                          value={principalId}
                          onChange={(e) => setPrincipalId(e.target.value)}
                          placeholder="Enter ID (e.g., alice)"
                        />
                      </Space.Compact>
                    </div>

                    <div>
                      <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                        Action (What?)
                      </Typography.Text>
                      <Select
                        style={{ width: "100%" }}
                        value={actionName}
                        onChange={setActionName}
                        showSearch
                        options={commonActions.map((a) => ({ value: a, label: a }))}
                      />
                    </div>

                    <div>
                      <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                        Resource (On What?)
                      </Typography.Text>
                      <Space.Compact style={{ width: "100%" }}>
                        <Select
                          style={{ width: 120 }}
                          value={resourceType}
                          onChange={setResourceType}
                          options={commonTypes.map((t) => ({ value: t, label: t }))}
                        />
                        <Input
                          style={{ width: "calc(100% - 120px)" }}
                          value={resourceId}
                          onChange={(e) => setResourceId(e.target.value)}
                          placeholder="Enter ID (e.g., doc-123)"
                        />
                      </Space.Compact>
                    </div>

                    <Button
                      type="primary"
                      icon={<ThunderboltOutlined />}
                      onClick={runSimulation}
                      loading={loading}
                      disabled={!selectedAppId || !principalId || !resourceId}
                      size="large"
                      block
                    >
                      Check Access
                    </Button>
                  </Space>
                </Col>

                <Col xs={24} lg={12}>
                  <Card title="Result" style={{ height: "100%" }}>
                    {!result ? (
                      <div style={{ textAlign: "center", padding: 48, color: "#999" }}>
                        <ThunderboltOutlined style={{ fontSize: 48, opacity: 0.3 }} />
                        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
                          Run a simulation to see the result here
                        </Typography.Paragraph>
                      </div>
                    ) : (
                      <div style={{ textAlign: "center" }}>
                        <div
                          style={{
                            padding: 32,
                            background: result.decision === "allow" ? "#f6ffed" : "#fff2f0",
                            borderRadius: 8,
                            border: `2px solid ${result.decision === "allow" ? "#52c41a" : "#ff4d4f"}`,
                            marginBottom: 16,
                          }}
                        >
                          {result.decision === "allow" ? (
                            <>
                              <CheckCircleOutlined style={{ fontSize: 64, color: "#52c41a" }} />
                              <Typography.Title level={2} style={{ margin: "16px 0 0", color: "#52c41a" }}>
                                ALLOWED
                              </Typography.Title>
                            </>
                          ) : (
                            <>
                              <CloseCircleOutlined style={{ fontSize: 64, color: "#ff4d4f" }} />
                              <Typography.Title level={2} style={{ margin: "16px 0 0", color: "#ff4d4f" }}>
                                DENIED
                              </Typography.Title>
                            </>
                          )}
                        </div>

                        <Card size="small" title="Request Details" style={{ textAlign: "left" }}>
                          <Typography.Paragraph style={{ margin: 0 }}>
                            <strong>Application:</strong> {selectedApp?.name} ({selectedApp?.namespace_name})
                          </Typography.Paragraph>
                          <Typography.Paragraph style={{ margin: "8px 0 0" }}>
                            <strong>Principal:</strong> {principalType}::"{principalId}"
                          </Typography.Paragraph>
                          <Typography.Paragraph style={{ margin: "8px 0 0" }}>
                            <strong>Action:</strong> Action::"{actionName}"
                          </Typography.Paragraph>
                          <Typography.Paragraph style={{ margin: "8px 0 0" }}>
                            <strong>Resource:</strong> {resourceType}::"{resourceId}"
                          </Typography.Paragraph>
                        </Card>

                        {result.reasons && result.reasons.length > 0 && (
                          <Card size="small" title="Reasons" style={{ textAlign: "left", marginTop: 12 }}>
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                              {result.reasons.map((r, i) => (
                                <li key={i}><Typography.Text code>{r}</Typography.Text></li>
                              ))}
                            </ul>
                          </Card>
                        )}
                      </div>
                    )}
                  </Card>
                </Col>
              </Row>
            ),
          },
        ]}
      />

      {/* Create Namespace Modal */}
      <Modal
        title="Create Namespace"
        open={namespaceModalOpen}
        onCancel={() => {
          setNamespaceModalOpen(false);
          namespaceForm.resetFields();
        }}
        footer={null}
      >
        <Form
          form={namespaceForm}
          layout="vertical"
          onFinish={handleCreateNamespace}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="name"
            label="Namespace Name"
            rules={[
              { required: true, message: "Please enter a namespace name" },
              { pattern: /^[a-zA-Z0-9_-]+$/, message: "Only letters, numbers, hyphens, and underscores allowed" },
            ]}
          >
            <Input placeholder="e.g., production, staging, team-alpha" />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description"
          >
            <Input.TextArea
              placeholder="Optional description for this namespace"
              rows={3}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={() => {
                setNamespaceModalOpen(false);
                namespaceForm.resetFields();
              }}>
                Cancel
              </Button>
              <Button type="primary" htmlType="submit" loading={namespaceLoading}>
                Create Namespace
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
