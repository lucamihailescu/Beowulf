import { useState, useCallback } from "react";
import {
  Modal,
  Button,
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Tag,
  Space,
  Typography,
  Radio,
  InputNumber,
  Alert,
  Spin,
  Divider,
  Progress,
  Tooltip,
  Collapse,
} from "antd";
import {
  ExperimentOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  UserOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import {
  api,
  SimulateRequest,
  SimulateResponse,
  AffectedPrincipal,
  SimulatedRequest,
  SimulationMode,
} from "../api";

const { Text, Title, Paragraph } = Typography;
const { Panel } = Collapse;

type PolicySimulatorProps = {
  appId: number;
  policyId: number;
  policyName: string;
  currentPolicyText: string;
  newPolicyText: string;
  onClose: () => void;
  visible: boolean;
};

export default function PolicySimulator({
  appId,
  policyId,
  policyName,
  currentPolicyText,
  newPolicyText,
  onClose,
  visible,
}: PolicySimulatorProps) {
  console.log('[PolicySimulator] Rendering, visible:', visible, 'appId:', appId, 'policyId:', policyId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulateResponse | null>(null);
  
  // Configuration state
  const [mode, setMode] = useState<SimulationMode>("sample_data");
  const [sampleSize, setSampleSize] = useState(100);
  const [timeRange, setTimeRange] = useState("24h");

  const runSimulation = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const request: SimulateRequest = {
        new_policy_text: newPolicyText,
        current_policy_text: currentPolicyText, // Compare against the text shown in the UI
        mode,
        sample_size: mode === "sample_data" ? sampleSize : undefined,
        time_range: mode === "production_replay" ? timeRange : undefined,
      };

      const response = await api.simulation.simulate(appId, policyId, request);
      setResult(response);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [appId, policyId, newPolicyText, mode, sampleSize, timeRange]);

  const renderConfigSection = () => (
    <Card size="small" title="Simulation Configuration" className="mb-4">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <Text strong>Simulation Mode</Text>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            style={{ marginTop: 8, display: "block" }}
          >
            <Space direction="vertical">
              <Radio value="sample_data">
                <Space>
                  <ThunderboltOutlined />
                  <span>Sample Data</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Generate synthetic test requests
                  </Text>
                </Space>
              </Radio>
              <Radio value="production_replay">
                <Space>
                  <FileTextOutlined />
                  <span>Production Replay</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Replay recent authorization requests from audit logs
                  </Text>
                </Space>
              </Radio>
            </Space>
          </Radio.Group>
        </div>

        {mode === "sample_data" && (
          <div>
            <Text strong>Sample Size</Text>
            <div style={{ marginTop: 8 }}>
              <InputNumber
                min={10}
                max={10000}
                value={sampleSize}
                onChange={(v) => setSampleSize(v || 100)}
                addonAfter="requests"
              />
            </div>
          </div>
        )}

        {mode === "production_replay" && (
          <div>
            <Text strong>Time Range</Text>
            <Radio.Group
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              style={{ marginTop: 8, display: "block" }}
            >
              <Radio.Button value="24h">24 hours</Radio.Button>
              <Radio.Button value="7d">7 days</Radio.Button>
              <Radio.Button value="30d">30 days</Radio.Button>
            </Radio.Group>
          </div>
        )}

        <Button
          type="primary"
          icon={<ExperimentOutlined />}
          onClick={runSimulation}
          loading={loading}
          size="large"
          style={{ marginTop: 8 }}
        >
          Run Simulation
        </Button>
      </Space>
    </Card>
  );

  const renderImpactSummary = () => {
    if (!result) return null;

    const { requests_analyzed, current_policy, new_policy, impact } = result;
    const newlyDenied = impact.newly_denied;
    const newlyAllowed = impact.newly_allowed;
    const unchanged = requests_analyzed - newlyDenied - newlyAllowed;

    const deniedPercent = requests_analyzed > 0 
      ? ((newlyDenied / requests_analyzed) * 100).toFixed(1) 
      : "0";
    const allowedPercent = requests_analyzed > 0 
      ? ((newlyAllowed / requests_analyzed) * 100).toFixed(1) 
      : "0";

    const hasSignificantImpact = newlyDenied > 0 || newlyAllowed > 0;

    return (
      <Card 
        size="small" 
        title={
          <Space>
            <span>Impact Preview</span>
            {hasSignificantImpact ? (
              <Tag color="warning" icon={<WarningOutlined />}>
                {newlyDenied + newlyAllowed} changes
              </Tag>
            ) : (
              <Tag color="success" icon={<CheckCircleOutlined />}>
                No impact
              </Tag>
            )}
          </Space>
        }
        className="mb-4"
      >
        <Row gutter={[16, 16]}>
          <Col span={6}>
            <Statistic
              title="Requests Analyzed"
              value={requests_analyzed}
              prefix={<FileTextOutlined />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="Current Allows"
              value={current_policy.allow_count}
              valueStyle={{ color: "#52c41a" }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="New Allows"
              value={new_policy.allow_count}
              valueStyle={{ color: "#52c41a" }}
              prefix={
                new_policy.allow_count > current_policy.allow_count ? (
                  <ArrowUpOutlined />
                ) : new_policy.allow_count < current_policy.allow_count ? (
                  <ArrowDownOutlined />
                ) : null
              }
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="New Denies"
              value={new_policy.deny_count}
              valueStyle={{ color: "#ff4d4f" }}
              prefix={
                new_policy.deny_count > current_policy.deny_count ? (
                  <ArrowUpOutlined />
                ) : new_policy.deny_count < current_policy.deny_count ? (
                  <ArrowDownOutlined />
                ) : null
              }
            />
          </Col>
        </Row>

        <Divider />

        <Row gutter={[16, 16]}>
          <Col span={8}>
            <Card size="small" style={{ backgroundColor: "#fff7e6", border: "1px solid #ffd591" }}>
              <Statistic
                title="Newly Denied"
                value={newlyDenied}
                suffix={`(${deniedPercent}%)`}
                valueStyle={{ color: "#d46b08" }}
                prefix={<CloseCircleOutlined />}
              />
              <Progress 
                percent={parseFloat(deniedPercent)} 
                showInfo={false} 
                strokeColor="#d46b08" 
                size="small"
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" style={{ backgroundColor: "#f6ffed", border: "1px solid #b7eb8f" }}>
              <Statistic
                title="Newly Allowed"
                value={newlyAllowed}
                suffix={`(${allowedPercent}%)`}
                valueStyle={{ color: "#389e0d" }}
                prefix={<CheckCircleOutlined />}
              />
              <Progress 
                percent={parseFloat(allowedPercent)} 
                showInfo={false} 
                strokeColor="#389e0d" 
                size="small"
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" style={{ backgroundColor: "#f5f5f5", border: "1px solid #d9d9d9" }}>
              <Statistic
                title="Unchanged"
                value={unchanged}
                suffix={`(${(100 - parseFloat(deniedPercent) - parseFloat(allowedPercent)).toFixed(1)}%)`}
                valueStyle={{ color: "#595959" }}
              />
              <Progress 
                percent={100 - parseFloat(deniedPercent) - parseFloat(allowedPercent)} 
                showInfo={false} 
                strokeColor="#595959" 
                size="small"
              />
            </Card>
          </Col>
        </Row>

        {newlyDenied > 0 && (
          <Alert
            style={{ marginTop: 16 }}
            type="warning"
            showIcon
            message={`${newlyDenied} previously-allowed requests will be denied`}
            description="Review the affected principals below before activating this policy."
          />
        )}
      </Card>
    );
  };

  const renderAffectedPrincipals = () => {
    if (!result || result.impact.affected_principals.length === 0) return null;

    const columns = [
      {
        title: "Principal",
        dataIndex: "principal",
        key: "principal",
        render: (text: string) => (
          <Space>
            <UserOutlined />
            <Text code style={{ fontSize: 12 }}>{text}</Text>
          </Space>
        ),
      },
      {
        title: "Decision Change",
        key: "change",
        render: (_: unknown, record: AffectedPrincipal) => (
          <Space>
            <Tag color={record.current_decision === "allow" ? "green" : "red"}>
              {record.current_decision}
            </Tag>
            <span>→</span>
            <Tag color={record.new_decision === "allow" ? "green" : "red"}>
              {record.new_decision}
            </Tag>
          </Space>
        ),
      },
      {
        title: "Affected Actions",
        dataIndex: "affected_actions",
        key: "affected_actions",
        render: (actions: string[]) => (
          <Space size={4} wrap>
            {actions.map((action) => (
              <Tag key={action}>{action}</Tag>
            ))}
          </Space>
        ),
      },
      {
        title: "Requests",
        dataIndex: "request_count",
        key: "request_count",
        width: 100,
        render: (count: number) => <Text strong>{count}</Text>,
      },
    ];

    return (
      <Collapse defaultActiveKey={["principals"]}>
        <Panel
          header={
            <Space>
              <UserOutlined />
              <span>Affected Principals</span>
              <Tag>{result.impact.affected_principals.length}</Tag>
            </Space>
          }
          key="principals"
        >
          <Table
            dataSource={result.impact.affected_principals}
            columns={columns}
            rowKey="principal"
            size="small"
            pagination={{ pageSize: 10 }}
          />
        </Panel>
      </Collapse>
    );
  };

  const renderSampleRequests = () => {
    if (!result || result.impact.sample_requests.length === 0) return null;

    const columns = [
      {
        title: "Principal",
        dataIndex: "principal",
        key: "principal",
        width: 200,
        render: (text: string) => (
          <Tooltip title={text}>
            <Text code style={{ fontSize: 11 }} ellipsis>
              {text}
            </Text>
          </Tooltip>
        ),
      },
      {
        title: "Action",
        dataIndex: "action",
        key: "action",
        width: 120,
        render: (text: string) => <Tag>{text.replace(/^Action::"?|"?$/g, "")}</Tag>,
      },
      {
        title: "Resource",
        dataIndex: "resource",
        key: "resource",
        width: 200,
        render: (text: string) => (
          <Tooltip title={text}>
            <Text code style={{ fontSize: 11 }} ellipsis>
              {text}
            </Text>
          </Tooltip>
        ),
      },
      {
        title: "Current",
        dataIndex: "current_decision",
        key: "current",
        width: 80,
        render: (decision: string) => (
          <Tag color={decision === "allow" ? "green" : "red"}>{decision}</Tag>
        ),
      },
      {
        title: "New",
        dataIndex: "new_decision",
        key: "new",
        width: 80,
        render: (decision: string) => (
          <Tag color={decision === "allow" ? "green" : "red"}>{decision}</Tag>
        ),
      },
    ];

    return (
      <Collapse style={{ marginTop: 16 }}>
        <Panel
          header={
            <Space>
              <FileTextOutlined />
              <span>Sample Requests</span>
              <Tag>{result.impact.sample_requests.length}</Tag>
            </Space>
          }
          key="requests"
        >
          <Table
            dataSource={result.impact.sample_requests}
            columns={columns}
            rowKey={(record, index) => `${record.principal}-${record.action}-${record.resource}-${index}`}
            size="small"
            pagination={{ pageSize: 10 }}
            scroll={{ x: 700 }}
          />
        </Panel>
      </Collapse>
    );
  };

  return (
    <Modal
      title={
        <Space>
          <ExperimentOutlined style={{ color: "#1890ff" }} />
          <span>Policy Simulator</span>
          <Text type="secondary">- {policyName}</Text>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      width={1000}
      zIndex={1100}
      footer={[
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
      ]}
    >
      {error && (
        <Alert
          type="error"
          message="Simulation Failed"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {!result && renderConfigSection()}

      {loading && (
        <div style={{ textAlign: "center", padding: 48 }}>
          <Spin size="large" />
          <Paragraph style={{ marginTop: 16 }}>
            Running simulation...
          </Paragraph>
        </div>
      )}

      {result && (
        <>
          {renderImpactSummary()}
          {renderAffectedPrincipals()}
          {renderSampleRequests()}
          
          <Divider />
          
          <Space>
            <Button onClick={() => setResult(null)}>
              Run New Simulation
            </Button>
          </Space>
        </>
      )}
    </Modal>
  );
}

