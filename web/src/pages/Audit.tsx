import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Pagination, Select, Space, Table, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { api, type Application, type AuditLog } from "../api";

export default function Audit() {
  const [apps, setApps] = useState<Application[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filter state
  const [selectedAppId, setSelectedAppId] = useState<number | undefined>(undefined);
  const [actionFilter, setActionFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.listApps();
        setApps(data);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAppId, actionFilter, decisionFilter, page, pageSize]);

  async function fetchLogs() {
    setLoading(true);
    setError("");
    try {
      const res = await api.listAuditLogs({
        application_id: selectedAppId,
        action: actionFilter || undefined,
        decision: decisionFilter || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setLogs(res.items);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function getDecisionTag(decision: string | undefined) {
    if (!decision) return null;
    if (decision === "allow") return <Tag color="green">ALLOW</Tag>;
    if (decision === "deny") return <Tag color="red">DENY</Tag>;
    return <Tag>{decision}</Tag>;
  }

  function getActionTag(action: string) {
    const colors: Record<string, string> = {
      authorize: "blue",
      "policy.create": "purple",
      "entity.upsert": "cyan",
      "schema.create": "orange",
      "schema.activate": "gold",
      "mcp.gateway.register": "purple",
      "mcp.gateway.approve": "green",
      "mcp.gateway.reject": "red",
      "mcp.gateway.suspend": "orange",
      "mcp.gateway.unsuspend": "green",
      "mcp.gateway.delete": "red",
      "mcp.approval.create": "gold",
      "mcp.approval.approve": "green",
      "mcp.approval.reject": "red",
      "mcp.approval.expire": "default",
      "mcp.delegation.create": "blue",
      "mcp.delegation.revoke": "red",
      "mcp.gateway.decision": "geekblue",
      "auth.entra.login": "green",
      "auth.ldap.login": "green",
      "auth.kerberos.login": "green",
    };
    // Display friendly names for login events
    const displayNames: Record<string, string> = {
      "auth.entra.login": "Login (Entra)",
      "auth.ldap.login": "Login (LDAP)",
      "auth.kerberos.login": "Login (Kerberos)",
    };
    return <Tag color={colors[action] || "default"}>{displayNames[action] || action}</Tag>;
  }

  function formatContext(ctx: Record<string, unknown> | undefined) {
    if (!ctx) return null;
    return (
      <pre style={{ margin: 0, fontSize: 11, maxHeight: 120, overflow: "auto", background: "#f5f5f5", padding: 4, borderRadius: 4, color: "#333" }}>
        {JSON.stringify(ctx, null, 2)}
      </pre>
    );
  }

  const columns = [
    {
      title: "Time",
      dataIndex: "created_at",
      key: "created_at",
      width: 180,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: "Action",
      dataIndex: "action",
      key: "action",
      width: 140,
      render: getActionTag,
    },
    {
      title: "Actor",
      dataIndex: "actor",
      key: "actor",
      width: 160,
      ellipsis: true,
    },
    {
      title: "Target",
      dataIndex: "target",
      key: "target",
      width: 180,
      ellipsis: true,
    },
    {
      title: "Decision",
      dataIndex: "decision",
      key: "decision",
      width: 100,
      render: getDecisionTag,
    },
    {
      title: "App ID",
      dataIndex: "application_id",
      key: "application_id",
      width: 80,
      render: (v: number | undefined) => v ?? "—",
    },
    {
      title: "Details",
      dataIndex: "context",
      key: "context",
      render: formatContext,
    },
  ];

  const actionOptions = [
    { value: "", label: "All actions" },
    { value: "authorize", label: "authorize - Authorization" },
    { value: "auth.entra.login", label: "auth.entra.login - Login (Entra)" },
    { value: "auth.ldap.login", label: "auth.ldap.login - Login (LDAP)" },
    { value: "auth.kerberos.login", label: "auth.kerberos.login - Login (Kerberos)" },
    { value: "policy.create", label: "policy.create - Policy Created" },
    { value: "entity.upsert", label: "entity.upsert - Entity Updated" },
    { value: "schema.create", label: "schema.create - Schema Created" },
    { value: "schema.activate", label: "schema.activate - Schema Activated" },
    { value: "mcp.gateway.register", label: "mcp.gateway.register - MCP Gateway Registered" },
    { value: "mcp.gateway.approve", label: "mcp.gateway.approve - MCP Gateway Approved" },
    { value: "mcp.gateway.reject", label: "mcp.gateway.reject - MCP Gateway Rejected" },
    { value: "mcp.gateway.suspend", label: "mcp.gateway.suspend - MCP Gateway Suspended" },
    { value: "mcp.gateway.unsuspend", label: "mcp.gateway.unsuspend - MCP Gateway Unsuspended" },
    { value: "mcp.gateway.delete", label: "mcp.gateway.delete - MCP Gateway Deleted" },
    { value: "mcp.gateway.pending_approval", label: "mcp.gateway.pending_approval - MCP Pending Approval" },
    { value: "mcp.gateway.downstream_error", label: "mcp.gateway.downstream_error - MCP Downstream Error" },
    { value: "mcp.gateway.decision", label: "mcp.gateway.decision - MCP Tool Decision" },
    { value: "mcp.approval.create", label: "mcp.approval.create - MCP Approval Requested" },
    { value: "mcp.approval.approve", label: "mcp.approval.approve - MCP Approval Approved" },
    { value: "mcp.approval.reject", label: "mcp.approval.reject - MCP Approval Rejected" },
    { value: "mcp.approval.expire", label: "mcp.approval.expire - MCP Approval Expired" },
    { value: "mcp.delegation.create", label: "mcp.delegation.create - MCP Delegation Created" },
    { value: "mcp.delegation.revoke", label: "mcp.delegation.revoke - MCP Delegation Revoked" },
  ];

  const decisionOptions = [
    { value: "", label: "All decisions" },
    { value: "allow", label: "allow" },
    { value: "deny", label: "deny" },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Audit Trail
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          View authorization decisions and administrative changes across all applications.
        </Typography.Paragraph>
      </div>

      {error && <Alert type="error" showIcon message={error} />}

      <Card title="Filters" size="small">
        <Space wrap>
          <Select
            placeholder="Filter by application"
            allowClear
            style={{ width: 220 }}
            value={selectedAppId}
            onChange={(v) => {
              setSelectedAppId(v);
              setPage(1);
            }}
            options={apps.map((a) => ({ value: a.id, label: `${a.name} (id=${a.id})` }))}
          />
          <Select
            placeholder="Action"
            style={{ width: 320 }}
            value={actionFilter}
            onChange={(v) => {
              setActionFilter(v);
              setPage(1);
            }}
            showSearch
            optionFilterProp="label"
            options={actionOptions}
          />
          <Select
            placeholder="Decision"
            style={{ width: 140 }}
            value={decisionFilter}
            onChange={(v) => {
              setDecisionFilter(v);
              setPage(1);
            }}
            options={decisionOptions}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchLogs} loading={loading}>
            Refresh
          </Button>
        </Space>
      </Card>

      <Card>
        <Table
          rowKey="id"
          dataSource={logs}
          columns={columns}
          loading={loading}
          pagination={false}
          size="small"
          scroll={{ x: 1000 }}
          locale={{ emptyText: "No audit logs found." }}
        />
        <div style={{ marginTop: 16, textAlign: "right" }}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger
            showTotal={(total) => `Total ${total} entries`}
            pageSizeOptions={["10", "20", "50", "100"]}
            onChange={(p, ps) => {
              setPage(p);
              setPageSize(ps);
            }}
          />
        </div>
      </Card>
    </Space>
  );
}
