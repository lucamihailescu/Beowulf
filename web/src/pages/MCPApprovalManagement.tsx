import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { api, type Application, type MCPApprovalRequest, type MCPApprovalStatus } from "../api";

const { Title, Paragraph, Text } = Typography;

function renderStatus(status: MCPApprovalStatus) {
  if (status === "pending") return <Tag color="gold" icon={<ClockCircleOutlined />}>Pending</Tag>;
  if (status === "approved") return <Tag color="green" icon={<CheckCircleOutlined />}>Approved</Tag>;
  if (status === "rejected") return <Tag color="red" icon={<CloseCircleOutlined />}>Rejected</Tag>;
  return <Tag>Expired</Tag>;
}

export default function MCPApprovalManagement() {
  const [apps, setApps] = useState<Application[]>([]);
  const [items, setItems] = useState<MCPApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<MCPApprovalStatus | undefined>();
  const [gatewayFilter, setGatewayFilter] = useState("");
  const [appFilter, setAppFilter] = useState<number | undefined>();

  useEffect(() => {
    api.listApps().then(setApps).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [statusFilter, gatewayFilter, appFilter]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.mcpApprovals.list({
        status: statusFilter,
        gateway_id: gatewayFilter || undefined,
        application_id: appFilter,
        limit: 100,
      });
      setItems(res.items ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function transition(requestId: string, action: "approve" | "reject" | "expire") {
    setBusyId(requestId);
    try {
      if (action === "approve") await api.mcpApprovals.approve(requestId);
      if (action === "reject") await api.mcpApprovals.reject(requestId, "Rejected by admin");
      if (action === "expire") await api.mcpApprovals.expire(requestId);
      message.success(`Request ${action}d`);
      await load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const columns = [
    {
      title: "Request",
      key: "request",
      render: (_: unknown, row: MCPApprovalRequest) => (
        <Space direction="vertical" size={0}>
          <Text code>{row.request_id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.gateway_id} | {row.tool_server}:{row.tool_name}
          </Text>
        </Space>
      ),
    },
    {
      title: "Principal",
      key: "principal",
      render: (_: unknown, row: MCPApprovalRequest) => (
        <Text>
          {row.principal_type}::{row.principal_id}
        </Text>
      ),
    },
    {
      title: "Action/Resource",
      key: "action-resource",
      render: (_: unknown, row: MCPApprovalRequest) => (
        <Space direction="vertical" size={0}>
          <Text>{row.action}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.resource}
          </Text>
        </Space>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: renderStatus,
    },
    {
      title: "Created",
      dataIndex: "created_at",
      key: "created_at",
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: unknown, row: MCPApprovalRequest) => {
        if (row.status !== "pending") return <Text type="secondary">No actions</Text>;
        const busy = busyId === row.request_id;
        return (
          <Space>
            <Button size="small" type="primary" loading={busy} onClick={() => transition(row.request_id, "approve")}>
              Approve
            </Button>
            <Button size="small" danger loading={busy} onClick={() => transition(row.request_id, "reject")}>
              Reject
            </Button>
            <Popconfirm title="Expire this request?" onConfirm={() => transition(row.request_id, "expire")}>
              <Button size="small" loading={busy}>
                Expire
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <div>
        <Title level={2} style={{ margin: 0 }}>
          MCP Approval Management
        </Title>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Review and resolve pending MCP tool-call approvals.
        </Paragraph>
      </div>

      {error && <Alert type="error" showIcon message={error} />}

      <Card title="Filters" size="small">
        <Space wrap>
          <Select
            allowClear
            placeholder="Status"
            style={{ width: 180 }}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            options={[
              { value: "pending", label: "Pending" },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "expired", label: "Expired" },
            ]}
          />
          <Input
            placeholder="Gateway ID"
            style={{ width: 220 }}
            value={gatewayFilter}
            onChange={(e) => setGatewayFilter(e.target.value)}
          />
          <Select
            allowClear
            placeholder="Application"
            style={{ width: 260 }}
            value={appFilter}
            onChange={(v) => setAppFilter(v)}
            options={apps.map((a) => ({ value: a.id, label: `${a.name} (id=${a.id})` }))}
          />
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            Refresh
          </Button>
        </Space>
      </Card>

      <Card>
        <Table<MCPApprovalRequest>
          rowKey="request_id"
          loading={loading}
          dataSource={items}
          columns={columns}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </Space>
  );
}
