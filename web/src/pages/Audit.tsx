import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Pagination, Select, Space, Table, Tag, Typography } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
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
      <pre style={{ margin: 0, fontSize: 11, maxHeight: 120, overflow: "auto", background: "#f5f5f5", padding: 4, borderRadius: 4 }}>
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
    { value: "authorize", label: "Authorization" },
    { value: "auth.entra.login", label: "Login (Entra)" },
    { value: "auth.ldap.login", label: "Login (LDAP)" },
    { value: "auth.kerberos.login", label: "Login (Kerberos)" },
    { value: "policy.create", label: "Policy Created" },
    { value: "entity.upsert", label: "Entity Updated" },
    { value: "schema.create", label: "Schema Created" },
    { value: "schema.activate", label: "Schema Activated" },
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
            style={{ width: 160 }}
            value={actionFilter}
            onChange={(v) => {
              setActionFilter(v);
              setPage(1);
            }}
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
