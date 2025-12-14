import { useState, useEffect } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Divider,
  Input,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  Tooltip,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  ThunderboltOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { api, type Application, type AuthorizeResponse, type CedarEntity } from "../api";

type AccessSimulatorProps = {
  /** If provided, restricts simulator to this application */
  applicationId?: number;
  /** Compact mode for embedding in cards */
  compact?: boolean;
};

type SimulationResult = {
  decision: "allow" | "deny";
  reasons: string[];
  errors: string[];
  timestamp: Date;
  request: {
    principal: string;
    action: string;
    resource: string;
  };
};

export default function AccessSimulator({ applicationId, compact = false }: AccessSimulatorProps) {
  const [apps, setApps] = useState<Application[]>([]);
  const [entities, setEntities] = useState<CedarEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [selectedAppId, setSelectedAppId] = useState<number | undefined>(applicationId);
  const [principalType, setPrincipalType] = useState("User");
  const [principalId, setPrincipalId] = useState("");
  const [actionName, setActionName] = useState("view");
  const [resourceType, setResourceType] = useState("Document");
  const [resourceId, setResourceId] = useState("");
  const [contextJson, setContextJson] = useState("{}");

  // Results
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [history, setHistory] = useState<SimulationResult[]>([]);

  // Load applications
  useEffect(() => {
    async function loadApps() {
      try {
        const data = await api.listApps();
        setApps(data);
        if (applicationId) {
          setSelectedAppId(applicationId);
        } else if (data.length > 0 && !selectedAppId) {
          setSelectedAppId(data[0].id);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
    loadApps();
  }, [applicationId]);

  // Load entities when app changes
  useEffect(() => {
    async function loadEntities() {
      if (!selectedAppId) {
        setEntities([]);
        return;
      }
      setLoadingEntities(true);
      try {
        const data = await api.listEntities(selectedAppId);
        setEntities(data);
      } catch (e) {
        // Entities endpoint might fail if no entities exist
        setEntities([]);
      } finally {
        setLoadingEntities(false);
      }
    }
    loadEntities();
  }, [selectedAppId]);

  // Extract unique types from entities
  const entityTypes = [...new Set(entities.map((e) => e.uid.type))];
  const principalTypes = entityTypes.length > 0 ? entityTypes : ["User", "Group"];
  const resourceTypes = entityTypes.length > 0 ? entityTypes : ["Document", "Folder", "Resource"];

  // Get entities of a specific type
  const getEntitiesOfType = (type: string) => entities.filter((e) => e.uid.type === type);

  // Common actions
  const commonActions = ["view", "edit", "delete", "create", "share", "admin", "read", "write"];

  async function runSimulation() {
    if (!selectedAppId || !principalId || !resourceId) {
      setError("Please fill in all required fields");
      return;
    }

    setError("");
    setLoading(true);
    setResult(null);

    try {
      let context = {};
      try {
        context = JSON.parse(contextJson);
      } catch {
        setError("Invalid JSON in context field");
        setLoading(false);
        return;
      }

      const response = await api.authorize({
        application_id: selectedAppId,
        principal: { type: principalType, id: principalId },
        action: { type: "Action", id: actionName },
        resource: { type: resourceType, id: resourceId },
        context,
      });

      const simResult: SimulationResult = {
        decision: response.decision,
        reasons: response.reasons,
        errors: response.errors,
        timestamp: new Date(),
        request: {
          principal: `${principalType}::"${principalId}"`,
          action: `Action::"${actionName}"`,
          resource: `${resourceType}::"${resourceId}"`,
        },
      };

      setResult(simResult);
      setHistory((prev) => [simResult, ...prev.slice(0, 9)]); // Keep last 10
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function clearResults() {
    setResult(null);
    setHistory([]);
  }

  const selectedApp = apps.find((a) => a.id === selectedAppId);

  if (compact) {
    return (
      <Card
        title={
          <Space>
            <ThunderboltOutlined />
            <span>What If? Access Simulator</span>
          </Space>
        }
        size="small"
      >
        <CompactSimulator
          apps={apps}
          selectedAppId={selectedAppId}
          onAppChange={setSelectedAppId}
          principalType={principalType}
          onPrincipalTypeChange={setPrincipalType}
          principalId={principalId}
          onPrincipalIdChange={setPrincipalId}
          actionName={actionName}
          onActionChange={setActionName}
          resourceType={resourceType}
          onResourceTypeChange={setResourceType}
          resourceId={resourceId}
          onResourceIdChange={setResourceId}
          principalTypes={principalTypes}
          resourceTypes={resourceTypes}
          commonActions={commonActions}
          getEntitiesOfType={getEntitiesOfType}
          loading={loading}
          error={error}
          result={result}
          onSimulate={runSimulation}
          applicationId={applicationId}
        />
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <ThunderboltOutlined style={{ marginRight: 8 }} />
          What If? Access Simulator
        </Typography.Title>
        <Typography.Text type="secondary">
          Test authorization decisions without making real changes. See if a principal can perform an action on a resource.
        </Typography.Text>
      </div>

      {error && <Alert type="error" showIcon message={error} closable onClose={() => setError("")} />}

      <Card title="Simulation Request">
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {/* Application selector (if not fixed) */}
          {!applicationId && (
            <div>
              <Typography.Text strong>Application</Typography.Text>
              <Select
                style={{ width: "100%", marginTop: 4 }}
                value={selectedAppId}
                onChange={setSelectedAppId}
                placeholder="Select application..."
                options={apps.map((a) => ({
                  value: a.id,
                  label: `${a.name} (${a.namespace_name})`,
                }))}
              />
            </div>
          )}

          {/* Principal */}
          <div>
            <Space style={{ marginBottom: 4 }}>
              <Typography.Text strong>Principal (Who?)</Typography.Text>
              <Tooltip title="The user or entity attempting the action">
                <InfoCircleOutlined style={{ color: "#999" }} />
              </Tooltip>
            </Space>
            <Space.Compact style={{ width: "100%" }}>
              <Select
                style={{ width: 150 }}
                value={principalType}
                onChange={setPrincipalType}
                options={principalTypes.map((t) => ({ value: t, label: t }))}
              />
              <Select
                style={{ width: "calc(100% - 150px)" }}
                value={principalId || undefined}
                onChange={setPrincipalId}
                placeholder="Select or type principal ID..."
                showSearch
                allowClear
                options={getEntitiesOfType(principalType).map((e) => ({
                  value: e.uid.id,
                  label: e.uid.id,
                }))}
                notFoundContent={
                  loadingEntities ? <Spin size="small" /> : "No entities found. Type a custom ID."
                }
                onSearch={setPrincipalId}
              />
            </Space.Compact>
          </div>

          {/* Action */}
          <div>
            <Space style={{ marginBottom: 4 }}>
              <Typography.Text strong>Action (What?)</Typography.Text>
              <Tooltip title="The action being attempted">
                <InfoCircleOutlined style={{ color: "#999" }} />
              </Tooltip>
            </Space>
            <Select
              style={{ width: "100%" }}
              value={actionName}
              onChange={setActionName}
              showSearch
              options={commonActions.map((a) => ({ value: a, label: a }))}
              placeholder="Select or type action..."
            />
          </div>

          {/* Resource */}
          <div>
            <Space style={{ marginBottom: 4 }}>
              <Typography.Text strong>Resource (On What?)</Typography.Text>
              <Tooltip title="The resource being accessed">
                <InfoCircleOutlined style={{ color: "#999" }} />
              </Tooltip>
            </Space>
            <Space.Compact style={{ width: "100%" }}>
              <Select
                style={{ width: 150 }}
                value={resourceType}
                onChange={setResourceType}
                options={resourceTypes.map((t) => ({ value: t, label: t }))}
              />
              <Select
                style={{ width: "calc(100% - 150px)" }}
                value={resourceId || undefined}
                onChange={setResourceId}
                placeholder="Select or type resource ID..."
                showSearch
                allowClear
                options={getEntitiesOfType(resourceType).map((e) => ({
                  value: e.uid.id,
                  label: e.uid.id,
                }))}
                notFoundContent={
                  loadingEntities ? <Spin size="small" /> : "No entities found. Type a custom ID."
                }
                onSearch={setResourceId}
              />
            </Space.Compact>
          </div>

          {/* Context (collapsible) */}
          <Collapse
            size="small"
            items={[
              {
                key: "context",
                label: (
                  <Space>
                    <span>Context (Optional)</span>
                    <Tag>Advanced</Tag>
                  </Space>
                ),
                children: (
                  <div>
                    <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                      Additional context data passed to the authorization request (JSON format)
                    </Typography.Text>
                    <Input.TextArea
                      value={contextJson}
                      onChange={(e) => setContextJson(e.target.value)}
                      rows={3}
                      placeholder='{"isBusinessHours": true, "ipAddress": "192.168.1.1"}'
                      style={{ fontFamily: "monospace", fontSize: 12 }}
                    />
                  </div>
                ),
              },
            ]}
          />

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

      {/* Result */}
      {result && (
        <Card
          title="Result"
          extra={
            <Button size="small" icon={<ReloadOutlined />} onClick={clearResults}>
              Clear
            </Button>
          }
        >
          <ResultDisplay result={result} />
        </Card>
      )}

      {/* History */}
      {history.length > 1 && (
        <Card title="Recent Simulations" size="small">
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {history.slice(1).map((h, i) => (
              <div
                key={i}
                style={{
                  padding: 8,
                  background: "#fafafa",
                  borderRadius: 4,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Space size={8}>
                  {h.decision === "allow" ? (
                    <CheckCircleOutlined style={{ color: "#52c41a" }} />
                  ) : (
                    <CloseCircleOutlined style={{ color: "#ff4d4f" }} />
                  )}
                  <Typography.Text code style={{ fontSize: 11 }}>
                    {h.request.principal}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    →
                  </Typography.Text>
                  <Typography.Text code style={{ fontSize: 11 }}>
                    {h.request.action}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    →
                  </Typography.Text>
                  <Typography.Text code style={{ fontSize: 11 }}>
                    {h.request.resource}
                  </Typography.Text>
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                  {h.timestamp.toLocaleTimeString()}
                </Typography.Text>
              </div>
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
}

function ResultDisplay({ result }: { result: SimulationResult }) {
  const isAllow = result.decision === "allow";

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div
        style={{
          padding: 24,
          textAlign: "center",
          background: isAllow ? "#f6ffed" : "#fff2f0",
          borderRadius: 8,
          border: `2px solid ${isAllow ? "#52c41a" : "#ff4d4f"}`,
        }}
      >
        {isAllow ? (
          <CheckCircleOutlined style={{ fontSize: 48, color: "#52c41a" }} />
        ) : (
          <CloseCircleOutlined style={{ fontSize: 48, color: "#ff4d4f" }} />
        )}
        <Typography.Title level={3} style={{ margin: "16px 0 0", color: isAllow ? "#52c41a" : "#ff4d4f" }}>
          {isAllow ? "ALLOWED" : "DENIED"}
        </Typography.Title>
      </div>

      <div>
        <Typography.Text strong>Request:</Typography.Text>
        <div style={{ marginTop: 8, padding: 12, background: "#f5f5f5", borderRadius: 4 }}>
          <Space direction="vertical" size={4}>
            <Typography.Text>
              <Typography.Text type="secondary">Principal:</Typography.Text>{" "}
              <Typography.Text code>{result.request.principal}</Typography.Text>
            </Typography.Text>
            <Typography.Text>
              <Typography.Text type="secondary">Action:</Typography.Text>{" "}
              <Typography.Text code>{result.request.action}</Typography.Text>
            </Typography.Text>
            <Typography.Text>
              <Typography.Text type="secondary">Resource:</Typography.Text>{" "}
              <Typography.Text code>{result.request.resource}</Typography.Text>
            </Typography.Text>
          </Space>
        </div>
      </div>

      {result.reasons.length > 0 && (
        <div>
          <Typography.Text strong>Reasons:</Typography.Text>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {result.reasons.map((r, i) => (
              <li key={i}>
                <Typography.Text>{r}</Typography.Text>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.errors.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Evaluation Errors"
          description={
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          }
        />
      )}
    </Space>
  );
}

function CompactSimulator({
  apps,
  selectedAppId,
  onAppChange,
  principalType,
  onPrincipalTypeChange,
  principalId,
  onPrincipalIdChange,
  actionName,
  onActionChange,
  resourceType,
  onResourceTypeChange,
  resourceId,
  onResourceIdChange,
  principalTypes,
  resourceTypes,
  commonActions,
  getEntitiesOfType,
  loading,
  error,
  result,
  onSimulate,
  applicationId,
}: any) {
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {error && <Alert type="error" showIcon message={error} />}

      {!applicationId && (
        <Select
          size="small"
          style={{ width: "100%" }}
          value={selectedAppId}
          onChange={onAppChange}
          placeholder="Select application..."
          options={apps.map((a: Application) => ({
            value: a.id,
            label: `${a.name} (${a.namespace_name})`,
          }))}
        />
      )}

      <Space.Compact style={{ width: "100%" }}>
        <Select
          size="small"
          style={{ width: 100 }}
          value={principalType}
          onChange={onPrincipalTypeChange}
          options={principalTypes.map((t: string) => ({ value: t, label: t }))}
        />
        <Input
          size="small"
          style={{ width: "calc(100% - 100px)" }}
          value={principalId}
          onChange={(e) => onPrincipalIdChange(e.target.value)}
          placeholder="Principal ID (e.g., alice)"
        />
      </Space.Compact>

      <Select
        size="small"
        style={{ width: "100%" }}
        value={actionName}
        onChange={onActionChange}
        options={commonActions.map((a: string) => ({ value: a, label: a }))}
      />

      <Space.Compact style={{ width: "100%" }}>
        <Select
          size="small"
          style={{ width: 100 }}
          value={resourceType}
          onChange={onResourceTypeChange}
          options={resourceTypes.map((t: string) => ({ value: t, label: t }))}
        />
        <Input
          size="small"
          style={{ width: "calc(100% - 100px)" }}
          value={resourceId}
          onChange={(e) => onResourceIdChange(e.target.value)}
          placeholder="Resource ID (e.g., doc-123)"
        />
      </Space.Compact>

      <Button
        type="primary"
        icon={<ThunderboltOutlined />}
        onClick={onSimulate}
        loading={loading}
        disabled={!selectedAppId || !principalId || !resourceId}
        block
        size="small"
      >
        Check Access
      </Button>

      {result && (
        <div
          style={{
            padding: 12,
            textAlign: "center",
            background: result.decision === "allow" ? "#f6ffed" : "#fff2f0",
            borderRadius: 4,
          }}
        >
          {result.decision === "allow" ? (
            <Space>
              <CheckCircleOutlined style={{ color: "#52c41a" }} />
              <Typography.Text strong style={{ color: "#52c41a" }}>
                ALLOWED
              </Typography.Text>
            </Space>
          ) : (
            <Space>
              <CloseCircleOutlined style={{ color: "#ff4d4f" }} />
              <Typography.Text strong style={{ color: "#ff4d4f" }}>
                DENIED
              </Typography.Text>
            </Space>
          )}
        </div>
      )}
    </Space>
  );
}

