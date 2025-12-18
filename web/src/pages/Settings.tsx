import { useState, useEffect } from "react";
import {
  Card,
  Typography,
  Space,
  Button,
  Descriptions,
  Tag,
  Alert,
  Popconfirm,
  message,
  Tabs,
} from "antd";
import {
  CloudOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SettingOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { api, EntraSettings } from "../api";
import { EntraSetupWizard } from "../components/EntraSetupWizard";
import BackendAuthSettings from "../components/BackendAuthSettings";

const { Title, Paragraph } = Typography;

export default function Settings() {
  const [entraSettings, setEntraSettings] = useState<EntraSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const settings = await api.settings.getEntra();
      setEntraSettings(settings);
    } catch (err) {
      console.error("Failed to load Entra settings:", err);
      setEntraSettings(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.settings.deleteEntra();
      message.success("Entra settings deleted");
      loadSettings();
    } catch (err: any) {
      message.error(err.message || "Failed to delete settings");
    } finally {
      setDeleting(false);
    }
  };

  const tabItems = [
    {
      key: "entra",
      label: (
        <Space>
          <CloudOutlined style={{ color: "#0078d4" }} />
          Microsoft Entra ID
        </Space>
      ),
      children: (
        <>
          <Card
            title={
              <Space>
                <CloudOutlined style={{ color: "#0078d4" }} />
                <span>Microsoft Entra ID Integration</span>
              </Space>
            }
            loading={loading}
            extra={
              <Space>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={loadSettings}
                  loading={loading}
                >
                  Refresh
                </Button>
                {entraSettings?.configured && !entraSettings?.configured_from_env && (
                  <Popconfirm
                    title="Delete Entra Settings"
                    description="Are you sure you want to remove the Entra configuration?"
                    onConfirm={handleDelete}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      loading={deleting}
                    >
                      Remove
                    </Button>
                  </Popconfirm>
                )}
                <Button
                  type="primary"
                  onClick={() => setShowWizard(true)}
                >
                  {entraSettings?.configured ? "Reconfigure" : "Set Up"}
                </Button>
              </Space>
            }
          >
            {!entraSettings?.configured ? (
              <Alert
                type="info"
                showIcon
                icon={<CloudOutlined />}
                message="Entra ID Not Configured"
                description="Connect to Microsoft Entra ID to enable searching users and groups when creating policies."
                action={
                  <Button type="primary" onClick={() => setShowWizard(true)}>
                    Set Up Entra ID
                  </Button>
                }
              />
            ) : (
              <Space direction="vertical" style={{ width: "100%" }} size={16}>
                <Alert
                  type="success"
                  showIcon
                  icon={<CheckCircleOutlined />}
                  message="Entra ID is configured and active"
                />

                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Status">
                    <Tag color="success" icon={<CheckCircleOutlined />}>
                      Connected
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Tenant ID">
                    <Typography.Text code>{entraSettings.tenant_id}</Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Client ID">
                    <Typography.Text code>{entraSettings.client_id}</Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Client Secret">
                    {entraSettings.has_client_secret ? (
                      <Tag color="success">Configured</Tag>
                    ) : (
                      <Tag color="error" icon={<CloseCircleOutlined />}>
                        Not Set
                      </Tag>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Configuration Source">
                    {entraSettings.configured_from_env ? (
                      <Tag color="blue">Environment Variables</Tag>
                    ) : (
                      <Tag color="purple">Database Settings</Tag>
                    )}
                  </Descriptions.Item>
                </Descriptions>

                {entraSettings.configured_from_env && (
                  <Alert
                    type="warning"
                    showIcon
                    message="Configured via Environment Variables"
                    description="Entra settings are currently loaded from environment variables. You can override them by saving new settings through this interface, which will take precedence."
                  />
                )}
              </Space>
            )}
          </Card>
        </>
      ),
    },
    {
      key: "backend-auth",
      label: (
        <Space>
          <SafetyCertificateOutlined />
          Backend Authentication
        </Space>
      ),
      children: <BackendAuthSettings />,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <Title level={2} style={{ margin: 0 }}>
          <SettingOutlined /> Settings
        </Title>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Manage integrations and system configuration.
        </Paragraph>
      </div>

      <Tabs items={tabItems} defaultActiveKey="entra" />

      <EntraSetupWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
        onComplete={() => {
          setShowWizard(false);
          loadSettings();
          message.success("Entra settings saved successfully");
        }}
      />
    </div>
  );
}

