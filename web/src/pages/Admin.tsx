import { useState, useEffect } from "react";
import { Alert, Button, Card, Col, Input, Row, Select, Space, Typography } from "antd";
import { ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { api, type Application, type AuthorizeResponse } from "../api";

export default function Admin() {
  const [apps, setApps] = useState<Application[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<number | undefined>(undefined);
  const [principalType, setPrincipalType] = useState("User");
  const [principalId, setPrincipalId] = useState("");
  const [actionName, setActionName] = useState("view");
  const [resourceType, setResourceType] = useState("Document");
  const [resourceId, setResourceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AuthorizeResponse | null>(null);

  useEffect(() => {
    api.listApps().then(setApps).catch(() => {});
  }, []);

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

  const selectedApp = apps.find((a) => a.id === selectedAppId);

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

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <ThunderboltOutlined style={{ color: "#1890ff" }} />
                <span>What If? Access Simulator</span>
              </Space>
            }
          >
            <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
              Test authorization decisions without making real changes. Check if a principal can perform an action on a resource.
            </Typography.Paragraph>

            <Space direction="vertical" size={16} style={{ width: "100%" }}>
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
          </Card>
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
    </Space>
  );
}

