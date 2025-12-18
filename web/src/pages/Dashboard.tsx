import { useState, useEffect } from "react";
import { Card, Col, Row, Statistic, Typography, Alert, Button, Space } from "antd";
import { AppstoreOutlined, FileProtectOutlined, AuditOutlined, SettingOutlined, SafetyOutlined, TeamOutlined, CloudOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { api, type Application, type EntraSettings } from "../api";
import { EntraSetupWizard } from "../components/EntraSetupWizard";
import ClusterStatus from "../components/ClusterStatus";

export default function Dashboard() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [cedarVersion, setCedarVersion] = useState<string>("Unknown");
  const [entraSettings, setEntraSettings] = useState<EntraSettings | null>(null);
  const [showEntraWizard, setShowEntraWizard] = useState(false);

  const loadEntraSettings = () => {
    api.settings.getEntra()
      .then(setEntraSettings)
      .catch(() => setEntraSettings(null));
  };

  useEffect(() => {
    setLoading(true);
    // Fetch apps
    api.listApps()
      .then(setApps)
      .catch(() => {})
      .finally(() => setLoading(false));

    // Fetch health/version
    api.checkHealth()
      .then((res) => {
        if (res.cedar_version) {
          setCedarVersion(res.cedar_version);
        }
      })
      .catch(() => {});

    // Fetch Entra settings
    loadEntraSettings();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Dashboard
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Welcome to the Enterprise Policy Management portal. Manage applications, policies, and test authorization decisions.
        </Typography.Paragraph>
      </div>

      {/* Entra Setup Notification */}
      {entraSettings && !entraSettings.configured && (
        <Alert
          type="info"
          showIcon
          icon={<CloudOutlined />}
          message="Microsoft Entra ID Integration Available"
          description="Connect to Microsoft Entra ID (Azure AD) to easily search and select users and groups when creating policies."
          action={
            <Button type="primary" size="small" onClick={() => setShowEntraWizard(true)}>
              Set Up Entra ID
            </Button>
          }
        />
      )}

      {/* Entra Setup Wizard */}
      <EntraSetupWizard
        open={showEntraWizard}
        onClose={() => setShowEntraWizard(false)}
        onComplete={() => {
          setShowEntraWizard(false);
          loadEntraSettings();
        }}
      />

      {/* Stats */}
      <Row gutter={[16, 16]}>
        <Col xs={12} md={8}>
          <Card loading={loading}>
            <Statistic
              title="Applications"
              value={apps.length}
              prefix={<AppstoreOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card loading={loading}>
            <Statistic
              title="Namespaces"
              value={new Set(apps.map((a) => a.namespace_name)).size}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic
              title="Cedar Version"
              value={cedarVersion}
              prefix={<FileProtectOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Cluster Status */}
      <ClusterStatus refreshInterval={30000} />

      {/* Navigation Cards */}
      <Typography.Title level={4} style={{ margin: 0 }}>
        Quick Access
      </Typography.Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={6}>
          <Link to="/applications" style={{ textDecoration: "none" }}>
            <Card hoverable style={{ height: "100%" }}>
              <Card.Meta
                avatar={<AppstoreOutlined style={{ fontSize: 32, color: "#1890ff" }} />}
                title="Applications"
                description="Register and manage applications"
              />
            </Card>
          </Link>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Link to="/policies" style={{ textDecoration: "none" }}>
            <Card hoverable style={{ height: "100%" }}>
              <Card.Meta
                avatar={<FileProtectOutlined style={{ fontSize: 32, color: "#52c41a" }} />}
                title="Policies"
                description="Create and manage policies"
              />
            </Card>
          </Link>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Link to="/audit" style={{ textDecoration: "none" }}>
            <Card hoverable style={{ height: "100%" }}>
              <Card.Meta
                avatar={<AuditOutlined style={{ fontSize: 32, color: "#722ed1" }} />}
                title="Audit"
                description="View authorization logs"
              />
            </Card>
          </Link>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Link to="/admin" style={{ textDecoration: "none" }}>
            <Card hoverable style={{ height: "100%" }}>
              <Card.Meta
                avatar={<SettingOutlined style={{ fontSize: 32, color: "#fa8c16" }} />}
                title="Admin Tools"
                description="Test with 'What If?' simulator"
              />
            </Card>
          </Link>
        </Col>
      </Row>

      {/* Recent Applications */}
      {apps.length > 0 && (
        <>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Recent Applications
          </Typography.Title>
          <Row gutter={[16, 16]}>
            {apps.slice(0, 4).map((app) => (
              <Col xs={24} sm={12} md={6} key={app.id}>
                <Link to={`/applications/${app.id}`} style={{ textDecoration: "none" }}>
                  <Card hoverable size="small">
                    <Card.Meta
                      title={app.name}
                      description={app.namespace_name}
                    />
                  </Card>
                </Link>
              </Col>
            ))}
          </Row>
        </>
      )}
    </div>
  );
}
