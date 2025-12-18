import { useState, useEffect } from "react";
import {
  Modal,
  Steps,
  Button,
  Input,
  Form,
  Alert,
  Space,
  Typography,
  Result,
  Spin,
  Divider,
  Card,
  Tag,
  Checkbox,
} from "antd";
import {
  CloudOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CopyOutlined,
  LinkOutlined,
  LockOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import { api, EntraSettings, EntraSettingsRequest, EntraTestResult } from "../api";

const { Text, Paragraph, Link } = Typography;

type EntraSetupWizardProps = {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
};

export default function EntraSetupWizard({ open, onClose, onComplete }: EntraSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [form] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<EntraTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [existingSettings, setExistingSettings] = useState<EntraSettings | null>(null);
  // Store validated credentials for saving (form values don't persist across steps)
  const [validatedCredentials, setValidatedCredentials] = useState<{
    tenantId: string;
    clientId: string;
    clientSecret: string;
  } | null>(null);
  // Auth settings
  const [enableUserAuth, setEnableUserAuth] = useState(false);
  const [redirectUri, setRedirectUri] = useState(window.location.origin);

  // Load existing settings when modal opens
  useEffect(() => {
    if (open) {
      api.settings.getEntra().then((settings) => {
        setExistingSettings(settings);
        if (settings) {
          setEnableUserAuth(settings.auth_enabled || false);
          setRedirectUri(settings.redirect_uri || window.location.origin);
        }
      }).catch(console.error);
      setCurrentStep(0);
      setTestResult(null);
      setValidatedCredentials(null);
      form.resetFields();
    }
  }, [open, form]);

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      setTesting(true);
      setTestResult(null);

      const result = await api.settings.testEntra({
        tenant_id: values.tenantId,
        client_id: values.clientId,
        client_secret: values.clientSecret,
      });

      setTestResult(result);
      if (result.success) {
        // Store validated credentials for the save step
        setValidatedCredentials({
          tenantId: values.tenantId,
          clientId: values.clientId,
          clientSecret: values.clientSecret,
        });
        // Auto-advance to User Auth step on success
        setTimeout(() => setCurrentStep(3), 1000);
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err.message || "Test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      // Use the stored credentials from the successful test
      if (!validatedCredentials) {
        console.error("No validated credentials available");
        return;
      }
      
      setSaving(true);

      await api.settings.saveEntra({
        tenant_id: validatedCredentials.tenantId,
        client_id: validatedCredentials.clientId,
        client_secret: validatedCredentials.clientSecret,
        redirect_uri: redirectUri,
        auth_enabled: enableUserAuth,
      });

      onComplete();
      
      // If auth was enabled, reload the page to apply new auth settings
      if (enableUserAuth) {
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (err: any) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const steps = [
    {
      title: "Overview",
      content: (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            icon={<CloudOutlined />}
            message="Microsoft Entra ID Integration"
            description="Connect to Microsoft Entra ID (Azure AD) to search and select users and groups when creating policies."
          />

          <Card size="small">
            <Space direction="vertical" size={8}>
              <Text strong>What you'll need:</Text>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>Azure Portal access with admin permissions</li>
                <li>An App Registration in your Azure AD tenant</li>
                <li>API permissions: <Tag>User.Read.All</Tag> <Tag>Group.Read.All</Tag></li>
                <li>A client secret for the app registration</li>
              </ul>
            </Space>
          </Card>

          {existingSettings?.configured && (
            <Alert
              type="warning"
              showIcon
              icon={<ExclamationCircleOutlined />}
              message="Existing Configuration Detected"
              description={
                existingSettings.configured_from_env
                  ? "Entra is currently configured via environment variables. You can override it with database settings."
                  : "You already have Entra configured. Completing this wizard will update your settings."
              }
            />
          )}

          <Card size="small" title="Benefits">
            <Space direction="vertical" size={4}>
              <Text>✓ Search users and groups from your organization</Text>
              <Text>✓ Auto-complete principal IDs in policies</Text>
              <Text>✓ Ensure accurate user/group references</Text>
            </Space>
          </Card>
        </Space>
      ),
    },
    {
      title: "Azure Setup",
      content: (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="Follow these steps in the Azure Portal"
          />

          <Card size="small" title="Step 1: Create or Use an App Registration">
            <Space direction="vertical" size={8}>
              <Paragraph>
                <Link
                  href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                  target="_blank"
                >
                  Open Azure Portal - App Registrations <LinkOutlined />
                </Link>
              </Paragraph>
              <Text>1. Click "New registration" or select an existing app</Text>
              <Text>2. Give it a name like "Cedar Policy Management"</Text>
              <Text>3. Set "Supported account types" to your organization</Text>
              <Text>4. Click "Register"</Text>
            </Space>
          </Card>

          <Card size="small" title="Step 2: Add API Permissions">
            <Space direction="vertical" size={8}>
              <Text>1. Go to "API permissions" in your app</Text>
              <Text>2. Click "Add a permission" → "Microsoft Graph"</Text>
              <Text>3. Select "Application permissions"</Text>
              <Text>4. Add these permissions:</Text>
              <Space>
                <Tag color="blue">User.Read.All</Tag>
                <Tag color="blue">Group.Read.All</Tag>
              </Space>
              <Text>5. Click "Grant admin consent for [Your Org]"</Text>
            </Space>
          </Card>

          <Card size="small" title="Step 3: Create a Client Secret">
            <Space direction="vertical" size={8}>
              <Text>1. Go to "Certificates & secrets"</Text>
              <Text>2. Click "New client secret"</Text>
              <Text>3. Set a description and expiration</Text>
              <Text>4. Copy the secret value immediately (it won't be shown again)</Text>
            </Space>
          </Card>

          <Card size="small" title="Step 4: Copy Required Values">
            <Space direction="vertical" size={8}>
              <Text>From the "Overview" page, copy:</Text>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li><strong>Application (client) ID</strong></li>
                <li><strong>Directory (tenant) ID</strong></li>
              </ul>
            </Space>
          </Card>
        </Space>
      ),
    },
    {
      title: "Credentials",
      content: (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            icon={<SafetyOutlined />}
            message="Enter your Azure credentials"
            description="These values are from your Azure App Registration. The client secret will be encrypted before storage."
          />

          <Form.Item
            name="tenantId"
            label="Tenant ID (Directory ID)"
            rules={[{ required: true, message: "Tenant ID is required" }]}
            extra="Found on your App Registration's Overview page"
          >
            <Input
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              suffix={
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    const val = form.getFieldValue("tenantId");
                    if (val) copyToClipboard(val);
                  }}
                />
              }
            />
          </Form.Item>

          <Form.Item
            name="clientId"
            label="Client ID (Application ID)"
            rules={[{ required: true, message: "Client ID is required" }]}
            extra="Found on your App Registration's Overview page"
          >
            <Input
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              suffix={
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    const val = form.getFieldValue("clientId");
                    if (val) copyToClipboard(val);
                  }}
                />
              }
            />
          </Form.Item>

          <Form.Item
            name="clientSecret"
            label="Client Secret"
            rules={[{ required: true, message: "Client Secret is required" }]}
            extra="Created in Certificates & secrets (copy immediately after creation)"
          >
            <Input.Password
              placeholder="Enter the client secret value"
              prefix={<LockOutlined />}
            />
          </Form.Item>

          <Divider />

          <Space direction="vertical" style={{ width: "100%" }}>
            <Button
              type="primary"
              icon={testing ? <Spin size="small" /> : <CheckCircleOutlined />}
              onClick={handleTest}
              loading={testing}
              block
            >
              Test Connection
            </Button>

            {testResult && (
              <Alert
                type={testResult.success ? "success" : "error"}
                showIcon
                message={testResult.success ? "Connection Successful!" : "Connection Failed"}
                description={
                  testResult.success
                    ? `Successfully connected to Microsoft Graph API. Found ${testResult.users_found || 0} users.`
                    : testResult.error
                }
              />
            )}
          </Space>
        </Space>
      ),
    },
    {
      title: "User Auth",
      content: (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="Enable User Authentication"
            description="Optionally enable Entra ID for user authentication. When enabled, users will sign in with their Microsoft accounts."
          />

          <Card size="small">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Checkbox
                checked={enableUserAuth}
                onChange={(e) => setEnableUserAuth(e.target.checked)}
              >
                <Text strong>Enable Entra ID authentication for users</Text>
              </Checkbox>
              <Text type="secondary" style={{ marginLeft: 24 }}>
                When enabled, users must sign in with their Microsoft account to access the policy portal.
              </Text>
            </Space>
          </Card>

          {enableUserAuth && (
            <Card size="small" title="Redirect URI Configuration">
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Text type="secondary">
                  The Redirect URI must be registered in your Azure App Registration under "Single-page application".
                </Text>
                <Input
                  value={redirectUri}
                  onChange={(e) => setRedirectUri(e.target.value)}
                  placeholder={window.location.origin}
                  addonBefore="Redirect URI"
                />
                <Alert
                  type="warning"
                  showIcon
                  message="Important: Add this URI to Azure Portal"
                  description={
                    <span>
                      Go to your App Registration → Authentication → Add platform → Single-page application → Add URI: <Text code copyable>{redirectUri}</Text>
                    </span>
                  }
                />
              </Space>
            </Card>
          )}
        </Space>
      ),
    },
    {
      title: "Confirm",
      content: (
        <Result
          status="success"
          icon={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
          title="Ready to Save!"
          subTitle="Your Entra ID connection has been verified successfully."
          extra={
            <Space direction="vertical" style={{ width: "100%", maxWidth: 400 }}>
              <Card size="small">
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <Text type="secondary">Tenant ID:</Text>
                    <Text code>{validatedCredentials?.tenantId?.substring(0, 8)}...</Text>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <Text type="secondary">Client ID:</Text>
                    <Text code>{validatedCredentials?.clientId?.substring(0, 8)}...</Text>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <Text type="secondary">Client Secret:</Text>
                    <Text code>********</Text>
                  </div>
                  <Divider style={{ margin: "8px 0" }} />
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <Text type="secondary">User Auth:</Text>
                    <Text>{enableUserAuth ? "Enabled" : "Disabled"}</Text>
                  </div>
                  {enableUserAuth && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <Text type="secondary">Redirect URI:</Text>
                      <Text code style={{ fontSize: 11 }}>{redirectUri.substring(0, 25)}...</Text>
                    </div>
                  )}
                </Space>
              </Card>

              <Alert
                type="info"
                showIcon
                message="What happens next?"
                description={
                  enableUserAuth
                    ? "After saving, the page will reload and you'll be prompted to sign in with Microsoft."
                    : "After saving, you'll be able to search and select users/groups from Entra ID when creating policies."
                }
              />
            </Space>
          }
        />
      ),
    },
  ];

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return true;
      case 1:
        return true;
      case 2:
        return testResult?.success === true;
      case 3:
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  };

  return (
    <Modal
      open={open}
      title={
        <Space>
          <CloudOutlined style={{ color: "#0078d4" }} />
          <span>Set Up Microsoft Entra ID</span>
        </Space>
      }
      onCancel={onClose}
      width={700}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Space>
            {currentStep > 0 && (
              <Button onClick={() => setCurrentStep(currentStep - 1)}>Back</Button>
            )}
            {currentStep < steps.length - 1 ? (
              <Button
                type="primary"
                onClick={() => setCurrentStep(currentStep + 1)}
                disabled={!canProceed()}
              >
                Next
              </Button>
            ) : (
              <Button type="primary" onClick={handleSave} loading={saving}>
                Save & Finish
              </Button>
            )}
          </Space>
        </div>
      }
      destroyOnClose
    >
      <Steps
        current={currentStep}
        size="small"
        style={{ marginBottom: 24 }}
        items={steps.map((s) => ({ title: s.title }))}
      />

      <Form form={form} layout="vertical" requiredMark="optional" preserve={true}>
        <div style={{ minHeight: 350 }}>{steps[currentStep].content}</div>
      </Form>
    </Modal>
  );
}

export { EntraSetupWizard };

