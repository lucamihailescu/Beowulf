import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
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
  const [selected, setSelected] = useState<MCPApprovalRequest | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [statusFilter, setStatusFilter] = useState<MCPApprovalStatus | undefined>();
  const [gatewayFilter, setGatewayFilter] = useState("");
  const [appFilter, setAppFilter] = useState<number | undefined>();

  useEffect(() => {
    api.listApps().then(setApps).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [statusFilter, gatewayFilter, appFilter]);

  const appNameById = useMemo(() => {
    const out = new Map<number, string>();
    for (const app of apps) {
      out.set(app.id, app.name);
    }
    return out;
  }, [apps]);

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

  async function transition(requestId: string, action: "approve" | "reject" | "expire", reason?: string) {
    setBusyId(requestId);
    try {
      if (action === "approve") await api.mcpApprovals.approve(requestId);
      if (action === "reject") await api.mcpApprovals.reject(requestId, reason || "Rejected by admin");
      if (action === "expire") await api.mcpApprovals.expire(requestId);
      message.success(`Request ${action}d`);
      await load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function openReview(row: MCPApprovalRequest) {
    setSelected(row);
    setRejectReason("");
    setReviewOpen(true);
  }

  function closeReview() {
    setReviewOpen(false);
    setSelected(null);
    setRejectReason("");
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
        if (row.status !== "pending") {
          return (
            <Button size="small" onClick={() => openReview(row)}>
              View
            </Button>
          );
        }
        const busy = busyId === row.request_id;
        return (
          <Space>
            <Button size="small" type="primary" loading={busy} onClick={() => openReview(row)}>
              Review
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

      <Modal
        title="Authorize MCP Request"
        open={reviewOpen}
        onCancel={closeReview}
        destroyOnClose
        width={900}
        footer={
          selected?.status === "pending" ? (
            <Space>
              <Button onClick={closeReview}>Cancel</Button>
              <Button
                danger
                loading={busyId === selected.request_id}
                onClick={async () => {
                  await transition(selected.request_id, "reject", rejectReason.trim() || "Rejected by admin");
                  closeReview();
                }}
              >
                Reject
              </Button>
              <Button
                type="primary"
                loading={busyId === selected.request_id}
                onClick={async () => {
                  await transition(selected.request_id, "approve");
                  closeReview();
                }}
              >
                Approve
              </Button>
            </Space>
          ) : (
            <Button onClick={closeReview}>Close</Button>
          )
        }
      >
        {selected && (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions title="Request Details" bordered size="small" column={2}>
              <Descriptions.Item label="Request ID">
                <Text code>{selected.request_id}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Status">{renderStatus(selected.status)}</Descriptions.Item>
              <Descriptions.Item label="Gateway ID">{selected.gateway_id}</Descriptions.Item>
              <Descriptions.Item label="Requested By">{selected.requested_by || "—"}</Descriptions.Item>
              <Descriptions.Item label="Application" span={2}>
                {selected.application_id
                  ? `${appNameById.get(selected.application_id) || "Unknown app"} (id=${selected.application_id})`
                  : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Created">{new Date(selected.created_at).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="Expires">
                {selected.expires_at ? new Date(selected.expires_at).toLocaleString() : "—"}
              </Descriptions.Item>
            </Descriptions>

            <Descriptions title="Authorization Input" bordered size="small" column={1}>
              <Descriptions.Item label="Principal">
                {selected.principal_type}::{selected.principal_id}
              </Descriptions.Item>
              <Descriptions.Item label="Action">{selected.action}</Descriptions.Item>
              <Descriptions.Item label="Resource">
                <Text code>{selected.resource}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Tool">
                {selected.tool_server}:{selected.tool_name}
              </Descriptions.Item>
              <Descriptions.Item label="Reason">{selected.reason || "—"}</Descriptions.Item>
            </Descriptions>

            <Descriptions title="Decision Context" bordered size="small" column={1}>
              <Descriptions.Item label="Context JSON">
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(selected.decision_context ?? {}, null, 2)}
                </pre>
              </Descriptions.Item>
            </Descriptions>

            {selected.status === "pending" && (
              <div>
                <Text strong>Rejection reason (optional)</Text>
                <Input.TextArea
                  placeholder="Provide reason for rejection"
                  rows={3}
                  style={{ marginTop: 8 }}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
            )}
          </Space>
        )}
      </Modal>
    </Space>
  );
}
