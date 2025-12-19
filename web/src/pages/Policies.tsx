import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Alert, Button, Card, Checkbox, Col, Collapse, Input, Modal, Row, Select, Space, Table, Tabs, Tag, Typography, theme, message } from "antd";
import { FileTextOutlined, PlusOutlined, ThunderboltOutlined, EyeOutlined, AppstoreOutlined, WifiOutlined, ExperimentOutlined } from "@ant-design/icons";
import { api, type Application, type AuthorizeResponse, type CedarEntity, type PolicyDetails, type PolicySummary, type Schema } from "../api";
import PolicyDragDropBuilder from "../components/PolicyDragDropBuilder";
import PolicyTemplateWizard from "../components/PolicyTemplateWizard";
import PolicySimulator from "../components/PolicySimulator";
import { usePolicyUpdates, useSSEContext } from "../contexts/SSEContext";

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

  const [activeSchema, setActiveSchema] = useState<Schema | null>(null);

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
  const [templateWizardOpen, setTemplateWizardOpen] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  // Debug logging for simulator
  console.log('[Policies] simulatorOpen:', simulatorOpen, 'selectedPolicy:', selectedPolicy?.id, 'editPolicyText length:', editPolicyText.length);

  const selectedApp = useMemo(() => apps.find((a) => a.id === selectedAppId), [apps, selectedAppId]);

  // Get SSE connection status
  const { connected: sseConnected } = useSSEContext();

  // Load policies function that can be called from SSE handler
  const loadPolicies = useCallback(async () => {
    if (selectedAppId === "") {
      setPolicies([]);
      return;
    }
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
  }, [selectedAppId]);

  // Track last SSE refresh to debounce
  const lastSSERefresh = useRef<number>(0);

  // Subscribe to policy updates via SSE
  usePolicyUpdates(useCallback((event) => {
    // Only refresh if the update is for the currently selected app
    if (selectedAppId !== "" && (event.data?.application_id === selectedAppId || !event.data?.application_id)) {
      // Debounce: Don't refresh more than once per 3 seconds
      const now = Date.now();
      if (now - lastSSERefresh.current < 3000) {
        console.log('[Policies] Skipping SSE refresh - too soon');
        return;
      }
      lastSSERefresh.current = now;
      
      console.log('[Policies] Received policy update via SSE, refreshing...');
      message.info({ content: 'Policy updated - refreshing list...', key: 'sse-refresh', duration: 2 });
      loadPolicies();
    }
  }, [selectedAppId, loadPolicies]));

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
    loadPolicies();
  }, [loadPolicies]);

  useEffect(() => {
    if (selectedAppId === "") {
      setEntities([]);
      setActiveSchema(null);
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

    // Fetch active schema to get entity types and actions
    (async () => {
      try {
        const schema = await api.getActiveSchema(selectedAppId as number);
        setActiveSchema(schema);
      } catch (e) {
        setActiveSchema(null);
      }
    })();
  }, [selectedAppId]);

  // Parse entity types from both schema and actual entities
  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    
    // Add types from actual entities
    const safeEntities = Array.isArray(entities) ? entities : [];
    for (const e of safeEntities) {
      if (e?.uid?.type) set.add(e.uid.type);
    }
    
    // Add types from active schema
    if (activeSchema?.schema_text) {
      try {
        const parsed = JSON.parse(activeSchema.schema_text);
        // Cedar schema format: { "": { entityTypes: {...}, actions: {...} } }
        const namespace = parsed[""] || parsed;
        if (namespace?.entityTypes) {
          for (const typeName of Object.keys(namespace.entityTypes)) {
            set.add(typeName);
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    return Array.from(set).sort();
  }, [entities, activeSchema]);

  // Parse actions from active schema
  const schemaActions = useMemo(() => {
    if (!activeSchema?.schema_text) return [];
    
    try {
      const parsed = JSON.parse(activeSchema.schema_text);
      // Cedar schema format: { "": { entityTypes: {...}, actions: {...} } }
      const namespace = parsed[""] || parsed;
      if (namespace?.actions) {
        return Object.keys(namespace.actions).sort();
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    return [];
  }, [activeSchema]);

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
      const res = await api.createPolicy(selectedAppId, { name, description, policy_text: policyText, activate });
      if (res.status === "pending_approval") {
        setNotice("Policy saved but requires approval before activation.");
      } else if (res.status === "draft") {
        setNotice("Policy saved as draft.");
      } else {
        setNotice("Policy saved successfully!");
      }
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

  async function onTemplateSubmit(policyName: string, policyDescription: string, policyTextContent: string, activatePolicy: boolean) {
    if (selectedAppId === "") {
      throw new Error("Select an application first.");
    }
    const res = await api.createPolicy(selectedAppId, {
      name: policyName,
      description: policyDescription,
      policy_text: policyTextContent,
      activate: activatePolicy,
    });
    if (res.status === "pending_approval") {
      setNotice("Policy saved but requires approval before activation.");
    } else if (res.status === "draft") {
      setNotice("Policy saved as draft.");
    } else {
      setNotice("Policy saved successfully!");
    }
    const items = await api.listPolicies(selectedAppId);
    setPolicies(items);
    setActiveTab("view");
    setTemplateWizardOpen(false);
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

  async function onApprovePolicy(policy: PolicySummary) {
    if (selectedAppId === "") return;
    setError("");
    setNotice("");
    try {
      await api.approvePolicy(selectedAppId, policy.id, policy.latest_version);
      setNotice(`Policy "${policy.name}" v${policy.latest_version} approved.`);
      setPolicies(await api.listPolicies(selectedAppId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onActivatePolicy(policy: PolicySummary) {
    if (selectedAppId === "") return;
    setError("");
    setNotice("");
    try {
      await api.activatePolicy(selectedAppId, policy.id, policy.latest_version);
      setNotice(`Policy "${policy.name}" v${policy.latest_version} activated.`);
      setPolicies(await api.listPolicies(selectedAppId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDeletePolicy(policy: PolicySummary) {
    if (selectedAppId === "") return;
    if (!confirm(`Are you sure you want to delete policy "${policy.name}"?`)) return;
    setError("");
    setNotice("");
    try {
      const res = await api.deletePolicy(selectedAppId, policy.id);
      if (res.status === "pending_deletion") {
        setNotice(`Deletion of policy "${policy.name}" requested. Requires approval.`);
      } else {
        setNotice(`Policy "${policy.name}" deleted.`);
      }
      setPolicies(await api.listPolicies(selectedAppId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onApproveDeletePolicy(policy: PolicySummary) {
    if (selectedAppId === "") return;
    setError("");
    setNotice("");
    try {
      await api.approveDeletePolicy(selectedAppId, policy.id);
      setNotice(`Deletion of policy "${policy.name}" approved.`);
      setPolicies(await api.listPolicies(selectedAppId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSaveExistingPolicy() {
    if (!selectedPolicy || selectedAppId === "") return;
    setError("");
    setNotice("");
    setSavingExisting(true);
    try {
      const res = await api.createPolicy(selectedAppId, {
        name: selectedPolicy.name,
        description: editDescription,
        policy_text: editPolicyText,
        activate: editActivate,
      });
      if (res.status === "pending_approval") {
        setNotice("Policy updated but requires approval before activation.");
      } else {
        setNotice("Policy updated (new version created).");
      }
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
                  title: "Active", 
                  dataIndex: "active_version", 
                  width: 80, 
                  render: (v) => v ? <Tag color="green">v{v}</Tag> : <Tag>—</Tag>
                },
                { 
                  title: "Latest", 
                  dataIndex: "latest_version", 
                  width: 80, 
                  render: (v) => v ? <Tag>v{v}</Tag> : "—"
                },
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
            <Card 
              title="Save Policy" 
              style={{ position: "sticky", top: 24 }}
              extra={
                <Button 
                  icon={<AppstoreOutlined />}
                  onClick={() => setTemplateWizardOpen(true)}
                  disabled={selectedAppId === ""}
                >
                  Use Template
                </Button>
              }
            >
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

                {selectedApp?.approval_required && (
                  <Alert
                    type="info"
                    showIcon
                    message="Approval Required"
                    description="This application requires approval for policy changes. Checking the box below will submit the policy for approval."
                    style={{ marginBottom: 12 }}
                  />
                )}
                <Checkbox checked={activate} onChange={(e) => setActivate(e.target.checked)}>
                  {selectedApp?.approval_required ? "Submit for approval" : "Activate this policy immediately"}
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
          <Space style={{ width: "100%", justifyContent: "space-between" }}>
            <Button
              icon={<ExperimentOutlined />}
              onClick={() => {
                console.log('[Policies] Simulate Impact clicked, opening simulator');
                setSimulatorOpen(true);
              }}
              disabled={!selectedPolicy || !editPolicyText.trim()}
            >
              Simulate Impact
            </Button>
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
            {selectedApp?.approval_required && (
              <Alert
                type="info"
                showIcon
                message="Approval Required"
                description="This application requires approval for policy changes."
                style={{ marginBottom: 12 }}
              />
            )}
            <Checkbox checked={editActivate} onChange={(e) => setEditActivate(e.target.checked)}>
              {selectedApp?.approval_required ? "Submit for approval" : "Activate this version immediately"}
            </Checkbox>
          </Space>
        )}
      </Modal>

      {/* Policy Template Wizard */}
      <PolicyTemplateWizard
        open={templateWizardOpen}
        onClose={() => setTemplateWizardOpen(false)}
        onSubmit={onTemplateSubmit}
        saving={savingPolicy}
        approvalRequired={selectedApp?.approval_required}
        entityTypes={entityTypes}
        actions={schemaActions}
      />

      {/* Policy Simulator */}
      {selectedPolicy && selectedAppId !== "" && (
        <PolicySimulator
          appId={selectedAppId}
          policyId={selectedPolicy.id}
          policyName={selectedPolicy.name}
          currentPolicyText={selectedPolicy.active_policy_text || selectedPolicy.latest_policy_text || ""}
          newPolicyText={editPolicyText}
          visible={simulatorOpen}
          onClose={() => setSimulatorOpen(false)}
        />
      )}
    </Space>
  );
}
