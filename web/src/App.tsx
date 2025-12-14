import { useMemo, useState } from "react";
import { Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { Layout, Menu, Space, Tag, Typography, theme, Button, Avatar, Dropdown, Spin, Result, Tooltip } from "antd";
import {
  AuditOutlined,
  FileTextOutlined,
  HomeOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  LoginOutlined,
  SunOutlined,
  MoonOutlined,
} from "@ant-design/icons";
import Dashboard from "./pages/Dashboard";
import Applications from "./pages/Applications";
import ApplicationDetails from "./pages/ApplicationDetails";
import NamespaceDetails from "./pages/NamespaceDetails";
import Policies from "./pages/Policies";
import Audit from "./pages/Audit";
import Admin from "./pages/Admin";
import { AuthProvider, useAuth, isAuthEnabled } from "./auth";
import { useTheme } from "./ThemeProvider";

// Theme toggle component
function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  const { token } = theme.useToken();

  return (
    <Tooltip title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
      <Button
        type="text"
        icon={isDark ? <SunOutlined /> : <MoonOutlined />}
        onClick={toggleTheme}
        style={{
          fontSize: 18,
          color: token.colorTextSecondary,
        }}
      />
    </Tooltip>
  );
}

// Login page component
function LoginPage() {
  const { login, isLoading } = useAuth();
  const { token } = theme.useToken();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      background: token.colorBgLayout 
    }}>
      <Result
        icon={<SafetyCertificateOutlined style={{ color: token.colorPrimary }} />}
        title="Cedar Authorization Portal"
        subTitle="Please sign in to continue"
        extra={
          <Space direction="vertical" size={16}>
            <Button type="primary" icon={<LoginOutlined />} onClick={login} size="large">
              Sign In
            </Button>
            <ThemeToggle />
          </Space>
        }
      />
    </div>
  );
}

// User menu component
function UserMenu() {
  const { user, logout, authMode } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  if (!user || authMode === 'none') {
    return null;
  }

  const menuItems = [
    {
      key: 'user-info',
      label: (
        <div style={{ padding: '4px 0' }}>
          <Typography.Text strong>{user.name}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {user.email || user.id}
          </Typography.Text>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' as const },
    {
      key: 'theme',
      icon: isDark ? <SunOutlined /> : <MoonOutlined />,
      label: isDark ? 'Light Mode' : 'Dark Mode',
      onClick: toggleTheme,
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Sign Out',
      onClick: logout,
    },
  ];

  return (
    <Dropdown menu={{ items: menuItems }} placement="bottomRight">
      <Space style={{ cursor: 'pointer' }}>
        <Avatar icon={<UserOutlined />} />
        <Typography.Text>{user.name}</Typography.Text>
      </Space>
    </Dropdown>
  );
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const { token } = theme.useToken();
  const { isAuthenticated, isLoading, authMode } = useAuth();

  const selectedKey = location.pathname === "/" ? "/" : location.pathname;

  const menuItems = useMemo(
    () => [
      { key: "/", icon: <HomeOutlined />, label: "Dashboard" },
      { key: "/applications", icon: <SafetyCertificateOutlined />, label: "Applications" },
      { key: "/policies", icon: <FileTextOutlined />, label: "Policies" },
      { key: "/audit", icon: <AuditOutlined />, label: "Audit" },
      { key: "/admin", icon: <SettingOutlined />, label: "Admin" },
    ],
    []
  );

  // Show loading state
  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  // Show login page if authentication is enabled and user is not authenticated
  if (isAuthEnabled() && !isAuthenticated && authMode !== 'none') {
    return <LoginPage />;
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={260}
        style={{
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div style={{ padding: collapsed ? 12 : 16 }}>
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              <Link to="/" style={{ color: "inherit" }}>
                {collapsed ? "Cedar" : "Cedar Auth Portal"}
              </Link>
            </Typography.Title>
            {collapsed ? null : (
              <Space size={8} wrap>
                <Tag color="blue">Portal</Tag>
                <Tag color="purple">PDP</Tag>
                <Tag color="green">Cedar</Tag>
              </Space>
            )}
          </Space>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(String(key))}
          style={{ borderRight: 0 }}
        />
      </Layout.Sider>

      <Layout>
        <Layout.Header
          style={{
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            padding: "0 16px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Space size={12} style={{ width: "100%", justifyContent: "space-between" }}>
            <Typography.Text strong>
              {selectedKey === "/" ? "Dashboard" : selectedKey.replace("/", "").replace(/\b\w/g, (c) => c.toUpperCase())}
            </Typography.Text>
            <Space size={8}>
              <ThemeToggle />
              {authMode !== 'none' && <UserMenu />}
              {authMode === 'none' && (
                <Space size={8} wrap>
                  <Tag color="geekblue">Anonymous</Tag>
                  <Tag color="gold">Dev</Tag>
                </Space>
              )}
            </Space>
          </Space>
        </Layout.Header>

        <Layout.Content style={{ padding: 24 }}>
          <div className="page">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/applications" element={<Applications />} />
              <Route path="/applications/:id" element={<ApplicationDetails />} />
              <Route path="/namespaces/:id" element={<NamespaceDetails />} />
              <Route path="/policies" element={<Policies />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/admin" element={<Admin />} />
            </Routes>
          </div>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
