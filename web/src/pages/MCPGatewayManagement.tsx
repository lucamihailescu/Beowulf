import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CloudServerOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import { api, type Application, type MCPDelegationGrant, type MCPGateway } from "../api";

const { Title, Paragraph, Text } = Typography;

function statusTag(status: string) {
  switch (status) {
    case "approved":
      return <Tag color="green">Approved</Tag>;
    case "pending":
      return <Tag color="gold">Pending</Tag>;
    case "rejected":
      return <Tag color="red">Rejected</Tag>;
    case "suspended":
      return <Tag color="orange">Suspended</Tag>;
    case "active":
      return <Tag color="green">Active</Tag>;
    case "revoked":
      return <Tag color="red">Revoked</Tag>;
    case "expired":
      return <Tag color="default">Expired</Tag>;
    default:
      return <Tag>{status}</Tag>;
  }
}

export default function MCPGatewayManagement() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [gateways, setGateways] = useState<MCPGateway[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [delegations, setDelegations] = useState<MCPDelegationGrant[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [busyGateway, setBusyGateway] = useState<string | null>(null);
  const [createDelegationOpen, setCreateDelegationOpen] = useState(false);
  const [delegationToken, setDelegationToken] = useState<string>("");
  const [delegationForm] = Form.useForm();

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [gates, dels, appList] = await Promise.all([
        api.mcpGateways.list(),
        api.mcpDelegations.list({ limit: 20 }),
        api.listApps(),
      ]);
      setGateways(gates.items ?? []);
      setCounts(gates.counts ?? {});
      setDelegations(dels.items ?? []);
      setApps(appList ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const gatewayColumns = useMemo(
    () => [
      {
        title: "Gateway",
        key: "gateway",
        render: (_: unknown, row: MCPGateway) => (
          <Space direction="vertical" size={0}>
            <Text strong>{row.name}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.gateway_id}
            </Text>
          </Space>
        ),
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        render: (v: string) => statusTag(v),
      },
      {
        title: "Endpoint",
        dataIndex: "endpoint",
        key: "endpoint",
        render: (v: string | undefined) => (v ? <Text code>{v}</Text> : "—"),
      },
      {
        title: "Heartbeat",
        dataIndex: "last_heartbeat",
        key: "last_heartbeat",
        render: (v: string | undefined) => (v ? new Date(v).toLocaleString() : "—"),
      },
      {
        title: "Actions",
        key: "actions",
        render: (_: unknown, row: MCPGateway) => {
          const busy = busyGateway === row.gateway_id;
          return (
            <Space>
              {row.status === "pending" && (
                <>
                  <Button size="small" loading={busy} onClick={() => runGatewayAction(row.gateway_id, "approve")}>
                    Approve
                  </Button>
                  <Button size="small" danger loading={busy} onClick={() => runGatewayAction(row.gateway_id, "reject")}>
                    Reject
                  </Button>
                </>
              )}
              {row.status === "approved" && (
                <Button
                  size="small"
                  icon={<PauseCircleOutlined />}
                  loading={busy}
                  onClick={() => runGatewayAction(row.gateway_id, "suspend")}
                >
                  Suspend
                </Button>
              )}
              {row.status === "suspended" && (
                <Button
                  size="small"
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={busy}
                  onClick={() => runGatewayAction(row.gateway_id, "unsuspend")}
                >
                  Resume
                </Button>
              )}
              <Popconfirm title="Remove gateway?" onConfirm={() => runGatewayAction(row.gateway_id, "delete")}>
                <Button size="small" danger icon={<DeleteOutlined />} loading={busy} />
              </Popconfirm>
            </Space>
          );
        },
      },
    ],
    [busyGateway]
  );

  const delegationColumns = useMemo(
    () => [
      {
        title: "Grant",
        key: "grant",
        render: (_: unknown, row: MCPDelegationGrant) => (
          <Space direction="vertical" size={0}>
            <Text code>{row.grant_id}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.delegator_type}::{row.delegator_id} {"->"} {row.delegate_type}::{row.delegate_id}
            </Text>
          </Space>
        ),
      },
      {
        title: "Scope",
        key: "scope",
        render: (_: unknown, row: MCPDelegationGrant) => (
          <Text>
            {row.scope_action}
            {row.scope_resource_prefix ? ` (${row.scope_resource_prefix}*)` : ""}
          </Text>
        ),
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        render: (v: string) => statusTag(v),
      },
      {
        title: "Expires",
        dataIndex: "expires_at",
        key: "expires_at",
        render: (v: string) => new Date(v).toLocaleString(),
      },
      {
        title: "Actions",
        key: "actions",
        render: (_: unknown, row: MCPDelegationGrant) => (
          <Popconfirm
            title="Revoke this delegation?"
            onConfirm={async () => {
              try {
                await api.mcpDelegations.revoke(row.grant_id);
                message.success("Delegation revoked");
                loadData();
              } catch (e) {
                message.error((e as Error).message);
              }
            }}
            disabled={row.status !== "active"}
          >
            <Button size="small" danger disabled={row.status !== "active"}>
              Revoke
            </Button>
          </Popconfirm>
        ),
      },
    ],
    []
  );

  async function runGatewayAction(gatewayId: string, action: "approve" | "reject" | "suspend" | "unsuspend" | "delete") {
    setBusyGateway(gatewayId);
    try {
      if (action === "approve") await api.mcpGateways.approve(gatewayId);
      if (action === "reject") await api.mcpGateways.reject(gatewayId, "Rejected by admin");
      if (action === "suspend") await api.mcpGateways.suspend(gatewayId);
      if (action === "unsuspend") await api.mcpGateways.unsuspend(gatewayId);
      if (action === "delete") await api.mcpGateways.delete(gatewayId);
      message.success(`Gateway ${action}d`);
      await loadData();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusyGateway(null);
    }
  }

  async function createDelegation(values: any) {
    try {
      const expiresAt = new Date(Date.now() + Number(values.ttl_hours || 1) * 60 * 60 * 1000).toISOString();
      const result = await api.mcpDelegations.create({
        application_id: Number(values.application_id),
        gateway_id: values.gateway_id || undefined,
        delegator_type: values.delegator_type,
        delegator_id: values.delegator_id,
        delegate_type: values.delegate_type,
        delegate_id: values.delegate_id,
        scope_action: values.scope_action || "tool.invoke",
        scope_resource_prefix: values.scope_resource_prefix || undefined,
        expires_at: expiresAt,
      });
      setDelegationToken(result.token);
      message.success("Delegation grant issued");
      await loadData();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <div>
        <Title level={2} style={{ margin: 0 }}>
          <CloudServerOutlined /> MCP Gateway Management
        </Title>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Manage MCP gateway lifecycle and issue delegation (OBO) grants.
        </Paragraph>
      </div>

      {error && <Alert type="error" showIcon message={error} />}

      <Row gutter={12}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Total" value={gateways.length} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Pending" value={counts.pending || 0} valueStyle={{ color: "#faad14" }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Approved" value={counts.approved || 0} valueStyle={{ color: "#52c41a" }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Suspended" value={counts.suspended || 0} valueStyle={{ color: "#fa8c16" }} />
          </Card>
        </Col>
      </Row>

      <Card
        title="Registered Gateways"
        extra={
          <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>
            Refresh
          </Button>
        }
      >
        <Table<MCPGateway>
          rowKey="gateway_id"
          loading={loading}
          dataSource={gateways}
          columns={gatewayColumns}
          pagination={{ pageSize: 8 }}
        />
      </Card>

      <Card
        title={
          <Space>
            <UserSwitchOutlined />
            Delegation Grants
          </Space>
        }
        extra={
          <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setCreateDelegationOpen(true)}>
            New Delegation
          </Button>
        }
      >
        <Table<MCPDelegationGrant>
          rowKey="grant_id"
          loading={loading}
          dataSource={delegations}
          columns={delegationColumns}
          pagination={{ pageSize: 6 }}
        />
      </Card>

      <Modal
        title="Create Delegation Grant"
        open={createDelegationOpen}
        onCancel={() => {
          setCreateDelegationOpen(false);
          setDelegationToken("");
          delegationForm.resetFields();
        }}
        footer={null}
      >
        <Form
          form={delegationForm}
          layout="vertical"
          initialValues={{
            delegator_type: "User",
            delegate_type: "Agent",
            scope_action: "tool.invoke",
            ttl_hours: 1,
          }}
          onFinish={createDelegation}
        >
          <Form.Item name="application_id" label="Application" rules={[{ required: true }]}>
            <Select options={apps.map((a) => ({ value: a.id, label: `${a.name} (id=${a.id})` }))} showSearch />
          </Form.Item>
          <Form.Item name="gateway_id" label="Gateway (optional)">
            <Select allowClear options={gateways.map((g) => ({ value: g.gateway_id, label: g.name }))} />
          </Form.Item>
          <Form.Item name="delegator_type" label="Delegator Type" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="delegator_id" label="Delegator ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="delegate_type" label="Delegate Type" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="delegate_id" label="Delegate ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="scope_action" label="Scope Action">
            <Input />
          </Form.Item>
          <Form.Item name="scope_resource_prefix" label="Scope Resource Prefix">
            <Input placeholder="server:tool-prefix" />
          </Form.Item>
          <Form.Item name="ttl_hours" label="TTL (hours)">
            <InputNumber min={1} max={24} style={{ width: "100%" }} />
          </Form.Item>
          {delegationToken && (
            <Alert
              type="success"
              showIcon
              message="Delegation token issued (copy now)"
              description={<Typography.Text code>{delegationToken}</Typography.Text>}
              style={{ marginBottom: 12 }}
            />
          )}
          <Button type="primary" htmlType="submit" block>
            Create Delegation
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
