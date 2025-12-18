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
  Switch,
  Select,
  InputNumber,
} from "antd";
import {
  CloudServerOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LockOutlined,
  SafetyOutlined,
  SettingOutlined,
  KeyOutlined,
} from "@ant-design/icons";
import { api, ADConfig, ADConfigRequest, ADTestResult } from "../api";

const { Text, Paragraph } = Typography;

type ADSetupWizardProps = {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
};

export default function ADSetupWizard({ open, onClose, onComplete }: ADSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [form] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ADTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [existingSettings, setExistingSettings] = useState<ADConfig | null>(null);
  const [validatedConfig, setValidatedConfig] = useState<ADConfigRequest | null>(null);
  const [enableKerberos, setEnableKerberos] = useState(false);

  // Load existing settings when modal opens
  useEffect(() => {
    if (open) {
      api.settings.getAD().then((config) => {
        setExistingSettings(config);
        if (config && config.configured) {
          form.setFieldsValue({
            server: config.server,
            baseDn: config.base_dn,
            bindDn: config.bind_dn,
            userFilter: config.user_filter,
            groupFilter: config.group_filter,
            userSearchFilter: config.user_search_filter,
            groupMembershipAttr: config.group_membership_attr,
            useTls: config.use_tls,
            insecureSkipVerify: config.insecure_skip_verify,
            groupCacheTtl: config.group_cache_ttl,
          });
          setEnableKerberos(config.kerberos_enabled);
          if (config.kerberos_enabled) {
            form.setFieldsValue({
              kerberosKeytab: config.kerberos_keytab,
              kerberosService: config.kerberos_service,
              kerberosRealm: config.kerberos_realm,
            });
          }
        }
      }).catch(console.error);
      setCurrentStep(0);
      setTestResult(null);
      setValidatedConfig(null);
    }
  }, [open, form]);

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      setTesting(true);
      setTestResult(null);

      const config: ADConfigRequest = {
        enabled: false,
        server: values.server,
        base_dn: values.baseDn,
        bind_dn: values.bindDn,
        bind_password: values.bindPassword,
        user_filter: values.userFilter,
        group_filter: values.groupFilter,
        user_search_filter: values.userSearchFilter,
        group_membership_attr: values.groupMembershipAttr,
        use_tls: values.useTls || false,
        insecure_skip_verify: values.insecureSkipVerify || false,
        kerberos_enabled: enableKerberos,
        kerberos_keytab: values.kerberosKeytab,
        kerberos_service: values.kerberosService,
        kerberos_realm: values.kerberosRealm,
        group_cache_ttl: values.groupCacheTtl || "5m",
      };

      const result = await api.settings.testAD(config);
      setTestResult(result);

      if (result.success) {
        setValidatedConfig(config);
        setTimeout(() => setCurrentStep(4), 1000);
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
    if (!validatedConfig) {
      return;
    }

    setSaving(true);
    try {
      const configToSave: ADConfigRequest = {
        ...validatedConfig,
        enabled: true,
      };

      await api.settings.saveAD(configToSave);
      onComplete();
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err.message || "Failed to save configuration",
      });
    } finally {
      setSaving(false);
    }
  };

  const steps = [
    {
      title: "Introduction",
      icon: <CloudServerOutlined />,
    },
    {
      title: "Connection",
      icon: <LockOutlined />,
    },
    {
      title: "Search Filters",
      icon: <SettingOutlined />,
    },
    {
      title: "Test",
      icon: <SafetyOutlined />,
    },
    {
      title: "Complete",
      icon: <CheckCircleOutlined />,
    },
  ];

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return renderIntroduction();
      case 1:
        return renderConnectionConfig();
      case 2:
        return renderFilterConfig();
      case 3:
        return renderTestConnection();
      case 4:
        return renderComplete();
      default:
        return null;
    }
  };

  const renderIntroduction = () => (
    <div style={{ padding: "20px 0" }}>
      <Result
        icon={<CloudServerOutlined style={{ color: "#1890ff" }} />}
        title="Connect to Active Directory"
        subTitle="Configure LDAP integration with your Active Directory server for user authentication and group lookups."
      />

      {existingSettings?.configured && (
        <Alert
          message="Existing Configuration Detected"
          description={
            <Space direction="vertical">
              <Text>Server: {existingSettings.server}</Text>
              <Text>Base DN: {existingSettings.base_dn}</Text>
              <Text>
                Status: <Tag color={existingSettings.enabled ? "green" : "orange"}>
                  {existingSettings.enabled ? "Enabled" : "Disabled"}
                </Tag>
              </Text>
            </Space>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Card title="What you'll need" style={{ marginTop: 16 }}>
        <Space direction="vertical">
          <Text>• LDAP server URL (e.g., ldap://dc.example.com:389 or ldaps://dc.example.com:636)</Text>
          <Text>• Base DN for searches (e.g., DC=example,DC=com)</Text>
          <Text>• Service account credentials with read access to user and group objects</Text>
          <Text>• (Optional) Kerberos keytab file for SSO authentication</Text>
        </Space>
      </Card>

      <Divider />

      <Alert
        message="Security Note"
        description="Use LDAPS (port 636) or StartTLS for secure connections in production environments."
        type="warning"
        showIcon
      />
    </div>
  );

  const renderConnectionConfig = () => (
    <div style={{ padding: "20px 0" }}>
      <Form form={form} layout="vertical" preserve>
        <Form.Item
          name="server"
          label="LDAP Server URL"
          rules={[{ required: true, message: "Please enter the LDAP server URL" }]}
          tooltip="e.g., ldap://dc.example.com:389 or ldaps://dc.example.com:636"
        >
          <Input placeholder="ldap://dc.example.com:389" />
        </Form.Item>

        <Form.Item
          name="baseDn"
          label="Base DN"
          rules={[{ required: true, message: "Please enter the Base DN" }]}
          tooltip="The base Distinguished Name for LDAP searches"
        >
          <Input placeholder="DC=example,DC=com" />
        </Form.Item>

        <Form.Item
          name="bindDn"
          label="Bind DN (Service Account)"
          rules={[{ required: true, message: "Please enter the Bind DN" }]}
          tooltip="Distinguished Name of the service account for LDAP queries"
        >
          <Input placeholder="CN=svc_cedar,OU=Service Accounts,DC=example,DC=com" />
        </Form.Item>

        <Form.Item
          name="bindPassword"
          label="Bind Password"
          rules={[
            { required: !existingSettings?.has_bind_password, message: "Please enter the password" }
          ]}
          tooltip="Password for the service account"
        >
          <Input.Password
            placeholder={existingSettings?.has_bind_password ? "••••••••" : "Enter password"}
          />
        </Form.Item>

        <Divider>Security Options</Divider>

        <Form.Item name="useTls" valuePropName="checked">
          <Checkbox>Use StartTLS (upgrade connection to TLS)</Checkbox>
        </Form.Item>

        <Form.Item name="insecureSkipVerify" valuePropName="checked">
          <Checkbox>Skip TLS certificate verification (not recommended for production)</Checkbox>
        </Form.Item>
      </Form>
    </div>
  );

  const renderFilterConfig = () => (
    <div style={{ padding: "20px 0" }}>
      <Alert
        message="Search Filters"
        description="Customize LDAP search filters. Default values work for most Active Directory configurations."
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Form form={form} layout="vertical" preserve>
        <Form.Item
          name="userFilter"
          label="User Search Filter"
          tooltip="Filter for searching users by name/email. Use %s as placeholder for search term."
          initialValue="(&(objectClass=user)(|(sAMAccountName=*%s*)(displayName=*%s*)(mail=*%s*)))"
        >
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.Item
          name="groupFilter"
          label="Group Search Filter"
          tooltip="Filter for searching groups by name. Use %s as placeholder for search term."
          initialValue="(&(objectClass=group)(|(cn=*%s*)(description=*%s*)))"
        >
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.Item
          name="userSearchFilter"
          label="User Authentication Filter"
          tooltip="Filter for finding a specific user during authentication. Use %s as placeholder for username."
          initialValue="(&(objectClass=user)(sAMAccountName=%s))"
        >
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.Item
          name="groupMembershipAttr"
          label="Group Membership Attribute"
          tooltip="LDAP attribute that contains group memberships"
          initialValue="memberOf"
        >
          <Input />
        </Form.Item>

        <Form.Item
          name="groupCacheTtl"
          label="Group Cache TTL"
          tooltip="How long to cache group memberships (e.g., 5m, 1h)"
          initialValue="5m"
        >
          <Input placeholder="5m" />
        </Form.Item>

        <Divider>Kerberos SSO (Optional)</Divider>

        <Form.Item>
          <Checkbox
            checked={enableKerberos}
            onChange={(e) => setEnableKerberos(e.target.checked)}
          >
            Enable Kerberos/SPNEGO Single Sign-On
          </Checkbox>
        </Form.Item>

        {enableKerberos && (
          <>
            <Form.Item
              name="kerberosKeytab"
              label="Keytab File Path"
              rules={[{ required: enableKerberos }]}
            >
              <Input placeholder="/etc/cedar/cedar.keytab" />
            </Form.Item>

            <Form.Item
              name="kerberosService"
              label="Service Principal"
              rules={[{ required: enableKerberos }]}
            >
              <Input placeholder="HTTP/cedar.example.com" />
            </Form.Item>

            <Form.Item
              name="kerberosRealm"
              label="Kerberos Realm"
              rules={[{ required: enableKerberos }]}
            >
              <Input placeholder="EXAMPLE.COM" />
            </Form.Item>
          </>
        )}
      </Form>
    </div>
  );

  const renderTestConnection = () => (
    <div style={{ padding: "20px 0", textAlign: "center" }}>
      {testing && (
        <Spin size="large" tip="Testing connection...">
          <div style={{ padding: 50 }} />
        </Spin>
      )}

      {!testing && !testResult && (
        <>
          <Result
            icon={<SafetyOutlined style={{ color: "#1890ff" }} />}
            title="Test Your Connection"
            subTitle="We'll verify that the LDAP server is accessible and the credentials are correct."
          />
          <Button type="primary" size="large" onClick={handleTest}>
            Test Connection
          </Button>
        </>
      )}

      {testResult && (
        <Result
          status={testResult.success ? "success" : "error"}
          title={testResult.success ? "Connection Successful!" : "Connection Failed"}
          subTitle={testResult.success ? testResult.message : testResult.error}
          extra={
            !testResult.success && (
              <Button onClick={handleTest}>Retry Test</Button>
            )
          }
        />
      )}
    </div>
  );

  const renderComplete = () => (
    <div style={{ padding: "20px 0" }}>
      <Result
        status="success"
        icon={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
        title="Active Directory Configuration Complete!"
        subTitle="Your AD integration is configured and ready to use."
        extra={[
          <Button
            key="save"
            type="primary"
            size="large"
            onClick={handleSave}
            loading={saving}
          >
            Save and Enable
          </Button>,
        ]}
      />

      <Card title="Configuration Summary" style={{ marginTop: 24 }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <Text strong>Server: </Text>
            <Text>{validatedConfig?.server}</Text>
          </div>
          <div>
            <Text strong>Base DN: </Text>
            <Text>{validatedConfig?.base_dn}</Text>
          </div>
          <div>
            <Text strong>Bind DN: </Text>
            <Text>{validatedConfig?.bind_dn}</Text>
          </div>
          <div>
            <Text strong>Kerberos SSO: </Text>
            <Tag color={enableKerberos ? "green" : "default"}>
              {enableKerberos ? "Enabled" : "Disabled"}
            </Tag>
          </div>
        </Space>
      </Card>

      <Alert
        message="Important"
        description="Enabling Active Directory authentication will disable Microsoft Entra ID authentication. Users will need to authenticate using their AD credentials."
        type="warning"
        showIcon
        style={{ marginTop: 16 }}
      />
    </div>
  );

  return (
    <Modal
      title={
        <Space>
          <CloudServerOutlined />
          <span>Active Directory Setup</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={700}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Space>
            {currentStep > 0 && currentStep < 4 && (
              <Button onClick={() => setCurrentStep(currentStep - 1)}>
                Previous
              </Button>
            )}
            {currentStep < 3 && (
              <Button type="primary" onClick={() => setCurrentStep(currentStep + 1)}>
                Next
              </Button>
            )}
            {currentStep === 3 && !testResult?.success && (
              <Button type="primary" onClick={handleTest} loading={testing}>
                Test Connection
              </Button>
            )}
          </Space>
        </div>
      }
    >
      <Steps
        current={currentStep}
        items={steps}
        size="small"
        style={{ marginBottom: 24 }}
      />
      {renderStepContent()}
    </Modal>
  );
}


