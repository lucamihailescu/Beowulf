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
  CloudServerOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SettingOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { api, EntraSettings, ADConfig, IdentityProvider } from "../api";
import { EntraSetupWizard } from "../components/EntraSetupWizard";
import ADSetupWizard from "../components/ADSetupWizard";
import BackendAuthSettings from "../components/BackendAuthSettings";

const { Title, Paragraph } = Typography;

export default function Settings() {
  const [entraSettings, setEntraSettings] = useState<EntraSettings | null>(null);
  const [adSettings, setAdSettings] = useState<ADConfig | null>(null);
  const [identityProvider, setIdentityProvider] = useState<IdentityProvider | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEntraWizard, setShowEntraWizard] = useState(false);
  const [showADWizard, setShowADWizard] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const [entra, ad, idp] = await Promise.all([
        api.settings.getEntra().catch(() => null),
        api.settings.getAD().catch(() => null),
        api.getIdentityProvider().catch(() => ({ provider: "none" as const })),
      ]);
      setEntraSettings(entra);
      setAdSettings(ad);
      setIdentityProvider(idp);
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleDeleteEntra = async () => {
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

  const handleDeleteAD = async () => {
    setDeleting(true);
    try {
      await api.settings.deleteAD();
      message.success("Active Directory settings deleted");
      loadSettings();
    } catch (err: any) {
      message.error(err.message || "Failed to delete settings");
    } finally {
      setDeleting(false);
    }
  };

  const tabItems = [
    {
      key: "identity",
      label: (
        <Space>
          <SettingOutlined />
          Identity Provider
        </Space>
      ),
      children: (
        <Card
          title="Active Identity Provider"
          loading={loading}
          extra={
            <Button icon={<ReloadOutlined />} onClick={loadSettings} loading={loading}>
              Refresh
            </Button>
          }
        >
          {identityProvider?.provider === "none" ? (
            <Alert
              type="info"
              showIcon
              message="No Identity Provider Configured"
              description="Configure Microsoft Entra ID or Active Directory to enable user authentication and policy management."
            />
          ) : identityProvider?.provider === "entra" ? (
            <Alert
              type="success"
              showIcon
              icon={<CloudOutlined style={{ color: "#0078d4" }} />}
              message="Microsoft Entra ID is the active identity provider"
              description={`Tenant ID: ${identityProvider.tenant_id}`}
            />
          ) : identityProvider?.provider === "ad" ? (
            <Alert
              type="success"
              showIcon
              icon={<CloudServerOutlined />}
              message="Active Directory is the active identity provider"
              description={
                <>
                  Server: {identityProvider.server}
                  <br />
                  Auth Method: {identityProvider.auth_method}
                </>
              }
            />
          ) : null}
        </Card>
      ),
    },
    {
      key: "entra",
      label: (
        <Space>
          <CloudOutlined style={{ color: "#0078d4" }} />
          Microsoft Entra ID
          {identityProvider?.provider === "entra" && (
            <Tag color="green" style={{ marginLeft: 4 }}>Active</Tag>
          )}
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
                    onConfirm={handleDeleteEntra}
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
                  onClick={() => setShowEntraWizard(true)}
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
                  <Button type="primary" onClick={() => setShowEntraWizard(true)}>
                    Set Up Entra ID
                  </Button>
                }
              />
            ) : (
              <Space direction="vertical" style={{ width: "100%" }} size={16}>
                <Alert
                  type={identityProvider?.provider === "entra" ? "success" : "warning"}
                  showIcon
                  icon={<CheckCircleOutlined />}
                  message={identityProvider?.provider === "entra" 
                    ? "Entra ID is configured and active" 
                    : "Entra ID is configured but not active (AD is currently active)"}
                />

                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Status">
                    <Tag color={identityProvider?.provider === "entra" ? "success" : "warning"} icon={<CheckCircleOutlined />}>
                      {identityProvider?.provider === "entra" ? "Active" : "Configured"}
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
      key: "ad",
      label: (
        <Space>
          <CloudServerOutlined />
          Active Directory
          {identityProvider?.provider === "ad" && (
            <Tag color="green" style={{ marginLeft: 4 }}>Active</Tag>
          )}
        </Space>
      ),
      children: (
        <Card
          title={
            <Space>
              <CloudServerOutlined />
              <span>Active Directory (LDAP) Integration</span>
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
              {adSettings?.configured && (
                <Popconfirm
                  title="Delete AD Settings"
                  description="Are you sure you want to remove the Active Directory configuration?"
                  onConfirm={handleDeleteAD}
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
                onClick={() => setShowADWizard(true)}
              >
                {adSettings?.configured ? "Reconfigure" : "Set Up"}
              </Button>
            </Space>
          }
        >
          {!adSettings?.configured ? (
            <Alert
              type="info"
              showIcon
              icon={<CloudServerOutlined />}
              message="Active Directory Not Configured"
              description="Connect to Active Directory via LDAP to enable user authentication and searching users/groups when creating policies."
              action={
                <Button type="primary" onClick={() => setShowADWizard(true)}>
                  Set Up Active Directory
                </Button>
              }
            />
          ) : (
            <Space direction="vertical" style={{ width: "100%" }} size={16}>
              <Alert
                type={identityProvider?.provider === "ad" ? "success" : "warning"}
                showIcon
                icon={<CheckCircleOutlined />}
                message={identityProvider?.provider === "ad" 
                  ? "Active Directory is configured and active" 
                  : "Active Directory is configured but not active (Entra ID is currently active)"}
              />

              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="Status">
                  <Tag color={identityProvider?.provider === "ad" ? "success" : "warning"} icon={<CheckCircleOutlined />}>
                    {identityProvider?.provider === "ad" ? "Active" : "Configured"}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Server">
                  <Typography.Text code>{adSettings.server}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Base DN">
                  <Typography.Text code>{adSettings.base_dn}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Bind DN">
                  <Typography.Text code>{adSettings.bind_dn}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Bind Password">
                  {adSettings.has_bind_password ? (
                    <Tag color="success">Configured</Tag>
                  ) : (
                    <Tag color="error" icon={<CloseCircleOutlined />}>
                      Not Set
                    </Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="TLS">
                  <Tag color={adSettings.use_tls ? "success" : "default"}>
                    {adSettings.use_tls ? "Enabled" : "Disabled"}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Kerberos SSO">
                  <Tag color={adSettings.kerberos_enabled ? "success" : "default"}>
                    {adSettings.kerberos_enabled ? "Enabled" : "Disabled"}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Group Cache TTL">
                  <Typography.Text>{adSettings.group_cache_ttl}</Typography.Text>
                </Descriptions.Item>
              </Descriptions>
            </Space>
          )}
        </Card>
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

      <Tabs items={tabItems} defaultActiveKey="identity" />

      <EntraSetupWizard
        open={showEntraWizard}
        onClose={() => setShowEntraWizard(false)}
        onComplete={() => {
          setShowEntraWizard(false);
          loadSettings();
          message.success("Entra settings saved successfully");
        }}
      />

      <ADSetupWizard
        open={showADWizard}
        onClose={() => setShowADWizard(false)}
        onComplete={() => {
          setShowADWizard(false);
          loadSettings();
          message.success("Active Directory settings saved successfully");
        }}
      />
    </div>
  );
}

