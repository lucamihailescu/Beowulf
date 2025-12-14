import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Descriptions, Space, Table, Tag, Typography } from "antd";
import { ArrowLeftOutlined, AppstoreOutlined } from "@ant-design/icons";
import { api, type Namespace, type Application } from "../api";

export default function NamespaceDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const namespaceId = Number(id);

  const [namespace, setNamespace] = useState<Namespace | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError("");
      try {
        const [namespacesData, appsData] = await Promise.all([
          api.listNamespaces(),
          api.listApps(),
        ]);
        
        const found = namespacesData.find((n) => n.id === namespaceId) || null;
        setNamespace(found);
        
        // Filter applications belonging to this namespace
        const namespaceApps = appsData.filter((app) => app.namespace_id === namespaceId);
        setApplications(namespaceApps);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [namespaceId]);

  const appColumns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (text: string, record: Application) => (
        <a onClick={() => navigate(`/applications/${record.id}`)}>{text}</a>
      ),
    },
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
      render: (text: string) => text || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: "Created",
      dataIndex: "created_at",
      key: "created_at",
      width: 180,
      render: (text: string) => new Date(text).toLocaleString(),
    },
  ];

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <div>
        <Button 
          type="link" 
          icon={<ArrowLeftOutlined />} 
          onClick={() => navigate("/admin")}
          style={{ padding: 0, marginBottom: 8 }}
        >
          Back to Admin
        </Button>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Namespace Details
        </Typography.Title>
      </div>

      {error && <Alert type="error" showIcon message={error} />}

      <Card loading={loading}>
        {namespace ? (
          <Descriptions 
            title={
              <Space>
                <Tag color="purple" style={{ fontSize: 16, padding: "4px 12px" }}>
                  {namespace.name}
                </Tag>
              </Space>
            } 
            bordered 
            column={1} 
            size="middle"
          >
            <Descriptions.Item label="ID">{namespace.id}</Descriptions.Item>
            <Descriptions.Item label="Name">{namespace.name}</Descriptions.Item>
            <Descriptions.Item label="Description">
              {namespace.description || <Typography.Text type="secondary">No description</Typography.Text>}
            </Descriptions.Item>
            <Descriptions.Item label="Created">
              {new Date(namespace.created_at).toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="Updated">
              {new Date(namespace.updated_at).toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="Applications">
              <Tag color="blue">{applications.length}</Tag>
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">Namespace not found.</Typography.Text>
        )}
      </Card>

      <Card
        title={
          <Space>
            <AppstoreOutlined style={{ color: "#1890ff" }} />
            <span>Applications in this Namespace</span>
            <Tag>{applications.length}</Tag>
          </Space>
        }
        loading={loading}
        extra={
          <Button 
            type="primary" 
            onClick={() => navigate("/applications")}
          >
            Manage Applications
          </Button>
        }
      >
        <Table
          dataSource={applications}
          columns={appColumns}
          rowKey="id"
          pagination={false}
          locale={{ emptyText: "No applications in this namespace yet." }}
          onRow={(record) => ({
            onClick: () => navigate(`/applications/${record.id}`),
            style: { cursor: "pointer" },
          })}
        />
      </Card>
    </Space>
  );
}

