import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Col, Collapse, Input, Modal, Row, Select, Space, Table, Tabs, Tag, Typography, theme } from "antd";
import { FileTextOutlined, PlusOutlined, ThunderboltOutlined, EyeOutlined } from "@ant-design/icons";
import { api, type Application, type AuthorizeResponse, type CedarEntity, type PolicyDetails, type PolicySummary } from "../api";
import PolicyDragDropBuilder from "../components/PolicyDragDropBuilder";

const DEFAULT_POLICY = `permit (
  principal == User::"alice",
  action == Action::"view",
  resource == Document::"demo-doc"
);`;

export default function Policies() {
  const { token } = theme.useToken();
  const [apps, setApps] = useState<Application[]>([]);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  const [savingPolicy, setSavingPolicy] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);

  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);

  const [selectedPolicy, setSelectedPolicy] = useState<PolicyDetails | null>(null);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [policyModalLoading, setPolicyModalLoading] = useState(false);

  const [editDescription, setEditDescription] = useState("");
  const [editPolicyText, setEditPolicyText] = useState("");
  const [editActivate, setEditActivate] = useState(true);
  const [savingExisting, setSavingExisting] = useState(false);

  const [entities, setEntities] = useState<CedarEntity[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);

  const [selectedAppId, setSelectedAppId] = useState<number | "">("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [policyText, setPolicyText] = useState(DEFAULT_POLICY);
  const [activate, setActivate] = useState(true);

  const [authzPrincipal, setAuthzPrincipal] = useState("User:alice");
  const [authzAction, setAuthzAction] = useState("Action:view");
  const [authzResource, setAuthzResource] = useState("Document:demo-doc");
  const [authzResult, setAuthzResult] = useState<AuthorizeResponse | null>(null);

  const [activeTab, setActiveTab] = useState("view");

  const selectedApp = useMemo(() => apps.find((a) => a.id === selectedAppId), [apps, selectedAppId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      setNotice("");
      try {
        const data = await api.listApps();
        setApps(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedAppId === "" && apps.length > 0) {
      setSelectedAppId(apps[0].id);
    }
  }, [apps, selectedAppId]);

  useEffect(() => {
    if (selectedAppId === "") {
      setPolicies([]);
      return;
    }

    (async () => {
      setPoliciesLoading(true);
      try {
        const items = await api.listPolicies(selectedAppId);
        setPolicies(Array.isArray(items) ? items : []);
      } catch (e) {
        setError((e as Error).message);
        setPolicies([]);
      } finally {
        setPoliciesLoading(false);
      }
    })();
  }, [selectedAppId]);

  useEffect(() => {
    if (selectedAppId === "") {
      setEntities([]);
      return;
    }

    (async () => {
      setEntitiesLoading(true);
      try {
        const items = await api.listEntities(selectedAppId);
        setEntities(Array.isArray(items) ? items : []);
      } catch (e) {
        setEntities([]);
      } finally {
        setEntitiesLoading(false);
      }
    })();
  }, [selectedAppId]);

  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    const safeEntities = Array.isArray(entities) ? entities : [];
    for (const e of safeEntities) {
      if (e?.uid?.type) set.add(e.uid.type);
    }
    return Array.from(set).sort();
  }, [entities]);

  const entityIdsByType = useMemo(() => {
    const map = new Map<string, string[]>();
    const safeEntities = Array.isArray(entities) ? entities : [];
    for (const e of safeEntities) {
      const t = e?.uid?.type;
      const id = e?.uid?.id;
      if (!t || !id) continue;
      const arr = map.get(t) ?? [];
      arr.push(id);
      map.set(t, arr);
    }
    for (const [k, v] of map.entries()) {
      map.set(k, Array.from(new Set(v)).sort());
    }
    return map;
  }, [entities]);

  async function onCreatePolicy() {
    setError("");
    setNotice("");
    setAuthzResult(null);
    if (selectedAppId === "") {
      setError("Select an application first.");
      return;
    }
    if (!name.trim()) {
      setError("Please enter a policy name.");
      return;
    }
    setSavingPolicy(true);
    try {
      await api.createPolicy(selectedAppId, { name, description, policy_text: policyText, activate });
      setNotice("Policy saved successfully!");
      setName("");
      setDescription("");
      setPolicyText(DEFAULT_POLICY);
      const items = await api.listPolicies(selectedAppId);
      setPolicies(items);
      setActiveTab("view");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingPolicy(false);
    }
  }

  async function openPolicyModal(policyId: number) {
    if (selectedAppId === "") return;
    setError("");
    setNotice("");
    setPolicyModalOpen(true);
    setPolicyModalLoading(true);
    try {
      const item = await api.getPolicy(selectedAppId, policyId);
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

  async function onSaveExistingPolicy() {
    if (!selectedPolicy || selectedAppId === "") return;
    setError("");
    setNotice("");
    setSavingExisting(true);
    try {
      await api.createPolicy(selectedAppId, {
        name: selectedPolicy.name,
        description: editDescription,
        policy_text: editPolicyText,
        activate: editActivate,
      });
      setNotice("Policy updated (new version created).");
      const items = await api.listPolicies(selectedAppId);
      setPolicies(items);
      closePolicyModal();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingExisting(false);
    }
  }

  function parseRef(v: string): { type: string; id: string } {
    const [type, id] = v.split(":");
    return { type: type ?? "", id: id ?? "" };
  }

  async function onAuthorize() {
    setError("");
    setNotice("");
    if (selectedAppId === "") {
      setError("Select an application first.");
      return;
    }
    setAuthorizing(true);
    try {
      const res = await api.authorize({
        application_id: selectedAppId,
        principal: parseRef(authzPrincipal),
        action: parseRef(authzAction),
        resource: parseRef(authzResource),
        context: {},
      });
      setAuthzResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAuthorizing(false);
    }
  }

  const tabItems = [
    {
      key: "view",
      label: (
        <span>
          <EyeOutlined />
          View Policies
        </span>
      ),
      children: (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {policies.length === 0 ? (
            <div style={{ textAlign: "center", padding: 48 }}>
              <FileTextOutlined style={{ fontSize: 48, color: token.colorTextSecondary, opacity: 0.5 }} />
              <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
                No policies yet for this application.
              </Typography.Paragraph>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setActiveTab("create")}>
                Create Your First Policy
              </Button>
            </div>
          ) : (
            <Table
              rowKey="id"
              loading={policiesLoading}
              pagination={false}
              dataSource={policies}
              onRow={(record) => ({
                onClick: () => openPolicyModal(record.id),
                style: { cursor: "pointer" },
              })}
              columns={[
                { title: "Name", dataIndex: "name", render: (v) => <Typography.Text strong>{v}</Typography.Text> },
                { title: "Description", dataIndex: "description", render: (v) => <Typography.Text type="secondary">{v || "—"}</Typography.Text> },
                { 
                  title: "Active Version", 
                  dataIndex: "active_version", 
                  width: 120, 
                  render: (v) => v ? <Tag color="green">v{v}</Tag> : <Tag>—</Tag>
                },
                { 
                  title: "Latest Version", 
                  dataIndex: "latest_version", 
                  width: 120, 
                  render: (v) => v ? <Tag>v{v}</Tag> : "—"
                },
              ]}
            />
          )}
        </Space>
      ),
    },
    {
      key: "create",
      label: (
        <span>
          <PlusOutlined />
          Create Policy
        </span>
      ),
      children: (
        <Row gutter={[24, 24]}>
          <Col xs={24} lg={14}>
            <Space direction="vertical" size={24} style={{ width: "100%" }}>
              {/* Visual Policy Builder */}
              <PolicyDragDropBuilder
                onPolicyGenerated={(generatedPolicy) => setPolicyText(generatedPolicy)}
                entityTypes={entityTypes}
                entityIdsByType={entityIdsByType}
              />
            </Space>
          </Col>
          
          <Col xs={24} lg={10}>
            <Card title="Save Policy" style={{ position: "sticky", top: 24 }}>
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Policy Name <span style={{ color: token.colorError }}>*</span>
                  </Typography.Text>
                  <Input 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                    placeholder="e.g., allow-users-view-documents"
                  />
                </div>
                
                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Description
                  </Typography.Text>
                  <Input 
                    value={description} 
                    onChange={(e) => setDescription(e.target.value)} 
                    placeholder="Optional description"
                  />
                </div>
                
                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Policy Text (Cedar)
                  </Typography.Text>
                  <Input.TextArea 
                    value={policyText} 
                    onChange={(e) => setPolicyText(e.target.value)} 
                    rows={8}
                    style={{ fontFamily: "'Fira Code', 'Monaco', monospace", fontSize: 12 }}
                  />
                </div>

                <Checkbox checked={activate} onChange={(e) => setActivate(e.target.checked)}>
                  Activate this policy immediately
                </Checkbox>

                <Button 
                  type="primary" 
                  onClick={onCreatePolicy} 
                  loading={savingPolicy} 
                  disabled={selectedAppId === "" || !name.trim() || !policyText.trim()}
                  block
                  size="large"
                >
                  Save Policy
                </Button>
              </Space>
            </Card>
          </Col>
        </Row>
      ),
    },
    {
      key: "test",
      label: (
        <span>
          <ThunderboltOutlined />
          Test Authorization
        </span>
      ),
      children: (
        <Row gutter={[24, 24]}>
          <Col xs={24} lg={12}>
            <Card title="Authorization Request">
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert
                  type="info"
                  showIcon
                  message="Test your policies"
                  description="Enter a principal, action, and resource to check if the request would be allowed or denied."
                />

                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Principal (Who is making the request?)
                  </Typography.Text>
                  <Input 
                    value={authzPrincipal} 
                    onChange={(e) => setAuthzPrincipal(e.target.value)} 
                    placeholder="Type:id (e.g., User:alice)"
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    Format: Type:id (e.g., User:alice, Group:admins)
                  </Typography.Text>
                </div>
                
                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Action (What do they want to do?)
                  </Typography.Text>
                  <Input 
                    value={authzAction} 
                    onChange={(e) => setAuthzAction(e.target.value)}
                    placeholder="Action:view"
                  />
                </div>
                
                <div>
                  <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
                    Resource (On what?)
                  </Typography.Text>
                  <Input 
                    value={authzResource} 
                    onChange={(e) => setAuthzResource(e.target.value)}
                    placeholder="Document:doc-123"
                  />
                </div>
                
                <Button 
                  type="primary" 
                  onClick={onAuthorize} 
                  loading={authorizing} 
                  disabled={selectedAppId === ""}
                  icon={<ThunderboltOutlined />}
                  block
                  size="large"
                >
                  Check Authorization
                </Button>
              </Space>
            </Card>
          </Col>
          
          <Col xs={24} lg={12}>
            <Card title="Result" style={{ height: "100%" }}>
              {!authzResult ? (
                <div style={{ textAlign: "center", padding: 48, color: token.colorTextSecondary }}>
                  <ThunderboltOutlined style={{ fontSize: 48, opacity: 0.3 }} />
                  <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
                    Run an authorization check to see the result here
                  </Typography.Paragraph>
                </div>
              ) : (
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      padding: 32,
                      background: authzResult.decision === "allow" ? "#f6ffed" : "#fff2f0",
                      borderRadius: 8,
                      border: `2px solid ${authzResult.decision === "allow" ? "#52c41a" : "#ff4d4f"}`,
                      marginBottom: 16,
                    }}
                  >
                    <Typography.Title 
                      level={2} 
                      style={{ margin: 0, color: authzResult.decision === "allow" ? "#52c41a" : "#ff4d4f" }}
                    >
                      {authzResult.decision === "allow" ? "✓ ALLOWED" : "✗ DENIED"}
                    </Typography.Title>
                  </div>
                  
                  {authzResult.reasons && authzResult.reasons.length > 0 && (
                    <div style={{ textAlign: "left" }}>
                      <Typography.Text strong>Reasons:</Typography.Text>
                      <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                        {authzResult.reasons.map((r, i) => (
                          <li key={i}><Typography.Text code>{r}</Typography.Text></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </Col>
        </Row>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      {/* Header */}
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Policies
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Create and manage Cedar authorization policies for your applications.
        </Typography.Paragraph>
      </div>

      {/* Alerts */}
      {error && <Alert type="error" showIcon message={error} closable onClose={() => setError("")} />}
      {notice && <Alert type="success" showIcon message={notice} closable onClose={() => setNotice("")} />}

      {/* Application Selector */}
      <Card size="small">
        <Space style={{ width: "100%", justifyContent: "space-between", flexWrap: "wrap" }}>
          <Space>
            <Typography.Text strong>Application:</Typography.Text>
            <Select
              value={selectedAppId === "" ? undefined : selectedAppId}
              onChange={(v) => setSelectedAppId(v)}
              placeholder="Select an application..."
              style={{ minWidth: 250 }}
              loading={loading}
              showSearch
              optionFilterProp="label"
              options={apps.map((a) => ({ 
                value: a.id, 
                label: `${a.name} (${a.namespace_name})` 
              }))}
            />
          </Space>
          {selectedApp && (
            <Tag color="blue">{policies.length} {policies.length === 1 ? 'policy' : 'policies'}</Tag>
          )}
        </Space>
      </Card>

      {/* Main Content Tabs */}
      {selectedAppId !== "" ? (
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab} 
          items={tabItems}
          type="card"
        />
      ) : (
        <Card>
          <div style={{ textAlign: "center", padding: 48 }}>
            <Typography.Paragraph type="secondary">
              Select an application above to manage its policies.
            </Typography.Paragraph>
          </div>
        </Card>
      )}

      {/* Policy Edit Modal */}
      <Modal
        open={policyModalOpen}
        title={selectedPolicy ? `Edit Policy: ${selectedPolicy.name}` : "Policy"}
        onCancel={closePolicyModal}
        width={700}
        footer={
          <Space>
            <Button onClick={closePolicyModal}>Cancel</Button>
            <Button
              onClick={() => setEditPolicyText(selectedPolicy?.active_policy_text || "")}
              disabled={!selectedPolicy?.active_policy_text}
            >
              Load Active Version
            </Button>
            <Button
              type="primary"
              onClick={onSaveExistingPolicy}
              loading={savingExisting}
              disabled={!selectedPolicy || !editPolicyText.trim()}
            >
              Save New Version
            </Button>
          </Space>
        }
      >
        {policyModalLoading ? (
          <Typography.Paragraph style={{ margin: 0 }}>Loading policy…</Typography.Paragraph>
        ) : !selectedPolicy ? (
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            No policy selected.
          </Typography.Paragraph>
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Space>
              <Tag color="green">Active: v{selectedPolicy.active_version || "—"}</Tag>
              <Tag>Latest: v{selectedPolicy.latest_version || "—"}</Tag>
            </Space>

            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>Name</Typography.Text>
              <Input value={selectedPolicy.name} readOnly disabled />
            </div>
            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>Description</Typography.Text>
              <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </div>
            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>Policy Text</Typography.Text>
              <Input.TextArea 
                value={editPolicyText} 
                onChange={(e) => setEditPolicyText(e.target.value)} 
                rows={12}
                style={{ fontFamily: "'Fira Code', 'Monaco', monospace", fontSize: 12 }}
              />
            </div>
            <Checkbox checked={editActivate} onChange={(e) => setEditActivate(e.target.checked)}>
              Activate this version immediately
            </Checkbox>
          </Space>
        )}
      </Modal>
    </Space>
  );
}
