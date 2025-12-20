import { useState, useEffect } from "react";
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Typography,
  Alert,
  Modal,
  Input,
  Switch,
  Tooltip,
  Badge,
  Popconfirm,
  message,
  Descriptions,
  Statistic,
  Row,
  Col,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CloudServerOutlined,
  SafetyCertificateOutlined,
  ExclamationCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { api, BackendInstance, BackendInstanceStatus, BackendAuthConfig } from "../api";

const { Title, Paragraph, Text } = Typography;

export default function ClusterManagement() {
  const [instances, setInstances] = useState<BackendInstance[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [authConfig, setAuthConfig] = useState<BackendAuthConfig | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectingInstance, setRejectingInstance] = useState<BackendInstance | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [instancesRes, configRes] = await Promise.all([
        api.backends.list(),
        api.settings.getBackendAuth(),
      ]);
      setInstances(instancesRes.instances || []);
      setCounts(instancesRes.counts || {});
      setAuthConfig(configRes);
    } catch (err) {
      console.error("Failed to fetch data:", err);
      message.error("Failed to load cluster data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleApprove = async (instance: BackendInstance) => {
    setActionLoading(instance.instance_id);
    try {
      await api.backends.approve(instance.instance_id);
      message.success(`Backend ${instance.hostname} approved`);
      fetchData();
    } catch (err: any) {
      message.error(err.message || "Failed to approve backend");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!rejectingInstance) return;
    setActionLoading(rejectingInstance.instance_id);
    try {
      await api.backends.reject(rejectingInstance.instance_id, rejectReason);
      message.success(`Backend ${rejectingInstance.hostname} rejected`);
      setRejectModalOpen(false);
      setRejectingInstance(null);
      setRejectReason("");
      fetchData();
    } catch (err: any) {
      message.error(err.message || "Failed to reject backend");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (instance: BackendInstance) => {
    setActionLoading(instance.instance_id);
    try {
      await api.backends.delete(instance.instance_id);
      message.success(`Backend ${instance.hostname} removed`);
      fetchData();
    } catch (err: any) {
      message.error(err.message || "Failed to remove backend");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSuspend = async (instance: BackendInstance) => {
    setActionLoading(instance.instance_id);
    try {
      await api.backends.suspend(instance.instance_id);
      message.success(`Backend ${instance.hostname} suspended`);
      fetchData();
    } catch (err: any) {
      message.error(err.message || "Failed to suspend backend");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnsuspend = async (instance: BackendInstance) => {
    setActionLoading(instance.instance_id);
    try {
      await api.backends.unsuspend(instance.instance_id);
      message.success(`Backend ${instance.hostname} resumed`);
      fetchData();
    } catch (err: any) {
      message.error(err.message || "Failed to resume backend");
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprovalToggle = async (checked: boolean) => {
    try {
      const updated = await api.settings.updateApprovalRequired(checked);
      setAuthConfig(updated);
      message.success(checked ? "Backend approval enabled" : "Backend approval disabled");
    } catch (err: any) {
      message.error(err.message || "Failed to update setting");
    }
  };

  const getStatusTag = (status: BackendInstanceStatus, instance?: BackendInstance) => {
    switch (status) {
      case "pending":
        return (
          <Tooltip title="This backend is waiting for admin approval before it can join the cluster">
            <Tag color="gold" icon={<ClockCircleOutlined />}>
              Pending Approval
            </Tag>
          </Tooltip>
        );
      case "approved":
        return (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            Approved
          </Tag>
        );
      case "rejected":
        return (
          <Tag color="error" icon={<CloseCircleOutlined />}>
            Rejected
          </Tag>
        );
      case "suspended":
        if (instance && isSuspendedDueToMissedHeartbeat(instance)) {
          return (
            <Tooltip title="This backend was automatically suspended because it stopped sending heartbeats for 5+ minutes. It may have crashed or been shut down.">
              <Tag color="red" icon={<ExclamationCircleOutlined />}>
                Suspended (No Heartbeat)
              </Tag>
            </Tooltip>
          );
        }
        return (
          <Tooltip title="This backend was manually suspended or suspended during graceful shutdown">
            <Tag color="orange" icon={<PauseCircleOutlined />}>
              Suspended
            </Tag>
          </Tooltip>
        );
      default:
        return <Tag>{status}</Tag>;
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString();
  };

  const isStale = (lastHeartbeat?: string) => {
    if (!lastHeartbeat) return true;
    const diff = Date.now() - new Date(lastHeartbeat).getTime();
    return diff > 60000; // More than 1 minute
  };

  // Check if suspended due to missed heartbeats (5+ minutes without heartbeat)
  const isSuspendedDueToMissedHeartbeat = (instance: BackendInstance) => {
    if (instance.status !== "suspended") return false;
    if (!instance.last_heartbeat) return true;
    const diff = Date.now() - new Date(instance.last_heartbeat).getTime();
    return diff > 5 * 60 * 1000; // More than 5 minutes
  };

  const pendingInstances = instances.filter((i) => i.status === "pending");
  const approvedInstances = instances.filter((i) => i.status === "approved");
  const suspendedInstances = instances.filter((i) => i.status === "suspended");
  const rejectedInstances = instances.filter((i) => i.status === "rejected");
  
  // Separate suspended backends by reason
  const suspendedDueToHeartbeat = suspendedInstances.filter(isSuspendedDueToMissedHeartbeat);
  const suspendedManually = suspendedInstances.filter((i) => !isSuspendedDueToMissedHeartbeat(i));
  
  // Count active backends (approved and not stale)
  const activeBackends = approvedInstances.filter((i) => !isStale(i.last_heartbeat));
  const isLastActiveBackend = activeBackends.length === 1;

  const columns = [
    {
      title: "Instance",
      key: "instance",
      render: (_: unknown, record: BackendInstance) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.hostname}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.instance_id}
          </Text>
        </Space>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: BackendInstanceStatus, record: BackendInstance) => (
        <Space>
          {getStatusTag(status, record)}
          {status === "approved" && isStale(record.last_heartbeat) && (
            <Tooltip title="No heartbeat in the last minute - this backend may be unresponsive">
              <Tag color="warning" icon={<ExclamationCircleOutlined />}>Stale</Tag>
            </Tooltip>
          )}
          {status === "pending" && isStale(record.last_heartbeat) && (
            <Tooltip title="This backend has not sent a heartbeat in over a minute. It may have crashed or been shut down before approval. Approving it now would have no effect.">
              <Tag color="error" icon={<ExclamationCircleOutlined />}>Stale</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: "IP Address",
      dataIndex: "ip_address",
      key: "ip_address",
      render: (ip: string) => ip || "-",
    },
    {
      title: "Version",
      dataIndex: "cedar_version",
      key: "cedar_version",
      render: (ver: string) => ver || "-",
    },
    {
      title: "Requests",
      dataIndex: "requests",
      key: "requests",
      render: (requests: number) => requests?.toLocaleString() || "0",
    },
    {
      title: "Last Heartbeat",
      dataIndex: "last_heartbeat",
      key: "last_heartbeat",
      render: (hb: string) => (hb ? formatDate(hb) : "-"),
    },
    {
      title: "Requested",
      dataIndex: "requested_at",
      key: "requested_at",
      render: formatDate,
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: unknown, record: BackendInstance) => {
        const isLoading = actionLoading === record.instance_id;

        if (record.status === "pending") {
          const isPendingStale = isStale(record.last_heartbeat);
          return (
            <Space>
              {isPendingStale ? (
                <Popconfirm
                  title="⚠️ Warning: Stale Backend"
                  description={
                    <div style={{ maxWidth: 300 }}>
                      This backend hasn't sent a heartbeat in over a minute. 
                      It may have crashed or been shut down. Approving it now will have no effect 
                      since it's not online to receive the approval.
                    </div>
                  }
                  onConfirm={() => handleApprove(record)}
                  okText="Approve Anyway"
                  okType="default"
                >
                  <Button
                    size="small"
                    icon={<CheckCircleOutlined />}
                    loading={isLoading}
                  >
                    Approve
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckCircleOutlined />}
                  loading={isLoading}
                  onClick={() => handleApprove(record)}
                >
                  Approve
                </Button>
              )}
              <Button
                danger
                size="small"
                icon={<CloseCircleOutlined />}
                loading={isLoading}
                onClick={() => {
                  setRejectingInstance(record);
                  setRejectModalOpen(true);
                }}
              >
                Reject
              </Button>
              {isPendingStale && (
                <Popconfirm
                  title="Remove Stale Backend"
                  description="This backend is stale and can be safely removed."
                  onConfirm={() => handleDelete(record)}
                  okText="Remove"
                  okType="danger"
                >
                  <Button
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    loading={isLoading}
                  >
                    Remove
                  </Button>
                </Popconfirm>
              )}
            </Space>
          );
        }

        if (record.status === "approved") {
          const isThisLastActive = isLastActiveBackend && !isStale(record.last_heartbeat);
          const lastActiveWarning = (
            <span style={{ color: "#ff4d4f", fontWeight: 500 }}>
              ⚠️ This is the last active backend! No nodes will be available to service requests.
            </span>
          );
          
          return (
            <Space>
              <Popconfirm
                title={isThisLastActive ? "⚠️ Warning: Last Active Backend" : "Suspend Backend"}
                description={
                  isThisLastActive ? (
                    <div>
                      {lastActiveWarning}
                      <br /><br />
                      This will stop the backend from receiving traffic. You can resume it later.
                    </div>
                  ) : (
                    "This will stop the backend from receiving traffic. You can resume it later."
                  )
                }
                onConfirm={() => handleSuspend(record)}
                okText="Suspend Anyway"
                okType={isThisLastActive ? "danger" : "primary"}
              >
                <Button
                  size="small"
                  icon={<PauseCircleOutlined />}
                  loading={isLoading}
                >
                  Suspend
                </Button>
              </Popconfirm>
              <Popconfirm
                title={isThisLastActive ? "⚠️ Warning: Last Active Backend" : "Remove Backend"}
                description={
                  isThisLastActive ? (
                    <div>
                      {lastActiveWarning}
                      <br /><br />
                      Are you sure you want to remove this backend from the cluster?
                    </div>
                  ) : (
                    "Are you sure you want to remove this backend from the cluster?"
                  )
                }
                onConfirm={() => handleDelete(record)}
                okText={isThisLastActive ? "Remove Anyway" : "Remove"}
                okType="danger"
              >
                <Button
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  loading={isLoading}
                >
                  Remove
                </Button>
              </Popconfirm>
            </Space>
          );
        }

        if (record.status === "suspended") {
          return (
            <Space>
              <Button
                type="primary"
                size="small"
                icon={<PlayCircleOutlined />}
                loading={isLoading}
                onClick={() => handleUnsuspend(record)}
              >
                Resume
              </Button>
              <Popconfirm
                title="Remove Backend"
                description="Are you sure you want to remove this backend from the cluster?"
                onConfirm={() => handleDelete(record)}
                okText="Remove"
                okType="danger"
              >
                <Button
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  loading={isLoading}
                >
                  Remove
                </Button>
              </Popconfirm>
            </Space>
          );
        }

        // For rejected or other statuses, just show remove
        return (
          <Popconfirm
            title="Remove Backend"
            description="Are you sure you want to remove this backend from the cluster?"
            onConfirm={() => handleDelete(record)}
            okText="Remove"
            okType="danger"
          >
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
              loading={isLoading}
            >
              Remove
            </Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <Title level={2} style={{ margin: 0 }}>
          <CloudServerOutlined /> Cluster Management
        </Title>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Manage backend instances in the Cedar cluster.
        </Paragraph>
      </div>

      {/* Stats Cards */}
      <Row gutter={16}>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="Total Backends"
              value={instances.length}
              prefix={<CloudServerOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="Pending"
              value={counts["pending"] || 0}
              valueStyle={{ color: counts["pending"] ? "#faad14" : undefined }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="Approved"
              value={counts["approved"] || 0}
              valueStyle={{ color: "#52c41a" }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title={
                <Tooltip title={suspendedDueToHeartbeat.length > 0 
                  ? `${suspendedDueToHeartbeat.length} suspended due to missed heartbeats, ${suspendedManually.length} manually suspended`
                  : "Backends that are suspended and not receiving traffic"
                }>
                  <span>Suspended</span>
                </Tooltip>
              }
              value={counts["suspended"] || 0}
              valueStyle={{ color: suspendedDueToHeartbeat.length > 0 ? "#ff4d4f" : (counts["suspended"] ? "#fa8c16" : undefined) }}
              prefix={suspendedDueToHeartbeat.length > 0 ? <ExclamationCircleOutlined /> : <PauseCircleOutlined />}
              suffix={suspendedDueToHeartbeat.length > 0 ? <Text type="danger" style={{ fontSize: 12 }}>({suspendedDueToHeartbeat.length} stale)</Text> : null}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="Rejected"
              value={counts["rejected"] || 0}
              valueStyle={{ color: counts["rejected"] ? "#ff4d4f" : undefined }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Approval Setting */}
      <Card
        title={
          <Space>
            <SafetyCertificateOutlined />
            Backend Approval Settings
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space>
            <Switch
              checked={authConfig?.approval_required}
              onChange={handleApprovalToggle}
            />
            <Text>Require approval for new backends</Text>
          </Space>
          <Text type="secondary">
            When enabled, new backend instances must be approved by an admin before they can receive
            policies and participate in authorization decisions.
          </Text>
        </Space>
      </Card>

      {/* Suspended due to heartbeat Alert */}
      {suspendedDueToHeartbeat.length > 0 && (
        <Alert
          message={`${suspendedDueToHeartbeat.length} backend${suspendedDueToHeartbeat.length > 1 ? "s" : ""} suspended due to missed heartbeats`}
          description={
            <span>
              These backends stopped sending heartbeats for 5+ minutes and were automatically suspended. 
              They may have crashed, been shut down, or lost network connectivity. 
              You can resume them once they start sending heartbeats again, or remove them from the cluster.
            </span>
          }
          type="error"
          showIcon
          icon={<ExclamationCircleOutlined />}
        />
      )}

      {/* Pending Backends Alert */}
      {pendingInstances.length > 0 && (
        <Alert
          message={`${pendingInstances.length} backend${pendingInstances.length > 1 ? "s" : ""} pending approval`}
          description="Review and approve pending backends to allow them to join the cluster."
          type="warning"
          showIcon
          icon={<ClockCircleOutlined />}
        />
      )}

      {/* Backends Table */}
      <Card
        title="Backend Instances"
        extra={
          <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
            Refresh
          </Button>
        }
      >
        <Table
          dataSource={instances}
          columns={columns}
          rowKey="instance_id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          expandable={{
            expandedRowRender: (record) => (
              <Descriptions size="small" column={2}>
                <Descriptions.Item label="OS">{record.os_info || "-"}</Descriptions.Item>
                <Descriptions.Item label="Architecture">{record.arch || "-"}</Descriptions.Item>
                <Descriptions.Item label="Certificate Fingerprint">
                  {record.cert_fingerprint ? (
                    <Text code style={{ fontSize: 11 }}>
                      {record.cert_fingerprint.substring(0, 32)}...
                    </Text>
                  ) : (
                    "-"
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Secret Verified">
                  {record.cluster_secret_verified ? (
                    <Tag color="success">Yes</Tag>
                  ) : (
                    <Tag>No</Tag>
                  )}
                </Descriptions.Item>
                {record.status === "approved" && (
                  <>
                    <Descriptions.Item label="Approved At">
                      {formatDate(record.approved_at)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Approved By">
                      {record.approved_by || "-"}
                    </Descriptions.Item>
                  </>
                )}
                {record.status === "rejected" && (
                  <>
                    <Descriptions.Item label="Rejected At">
                      {formatDate(record.rejected_at)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Rejected By">
                      {record.rejected_by || "-"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Reason" span={2}>
                      {record.rejection_reason || "-"}
                    </Descriptions.Item>
                  </>
                )}
              </Descriptions>
            ),
          }}
        />
      </Card>

      {/* Reject Modal */}
      <Modal
        title="Reject Backend"
        open={rejectModalOpen}
        onOk={handleReject}
        onCancel={() => {
          setRejectModalOpen(false);
          setRejectingInstance(null);
          setRejectReason("");
        }}
        okText="Reject"
        okType="danger"
        okButtonProps={{ loading: actionLoading === rejectingInstance?.instance_id }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text>
            Are you sure you want to reject <Text strong>{rejectingInstance?.hostname}</Text>?
          </Text>
          <Text type="secondary">
            This backend will not be able to receive policies or participate in authorization.
          </Text>
          <Input.TextArea
            placeholder="Reason for rejection (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
        </Space>
      </Modal>
    </div>
  );
}

