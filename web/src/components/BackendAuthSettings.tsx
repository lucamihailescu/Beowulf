import React, { useState, useEffect } from 'react';
import {
  Card,
  Form,
  Select,
  Input,
  Button,
  Alert,
  Space,
  Typography,
  Upload,
  Descriptions,
  Tag,
  Popconfirm,
  Spin,
  message,
} from 'antd';
import {
  SafetyCertificateOutlined,
  KeyOutlined,
  UnlockOutlined,
  UploadOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { api, BackendAuthConfig, BackendAuthMode } from '../api';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const BackendAuthSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<BackendAuthConfig | null>(null);
  const [form] = Form.useForm();
  const [certForm] = Form.useForm();
  const [showCertUpload, setShowCertUpload] = useState(false);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const data = await api.settings.getBackendAuth();
      setConfig(data);
      form.setFieldsValue({
        auth_mode: data.auth_mode,
      });
    } catch (err) {
      message.error('Failed to load backend auth configuration');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSave = async (values: { auth_mode: BackendAuthMode; shared_secret?: string }) => {
    try {
      setSaving(true);
      const data = await api.settings.updateBackendAuth({
        auth_mode: values.auth_mode,
        shared_secret: values.shared_secret,
      });
      setConfig(data);
      form.setFieldValue('shared_secret', undefined);
      message.success('Backend authentication settings saved');
    } catch (err) {
      message.error('Failed to save settings');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleUploadCA = async (values: { ca_certificate: string; ca_private_key?: string }) => {
    try {
      setSaving(true);
      const data = await api.settings.uploadCACertificate({
        ca_certificate: values.ca_certificate,
        ca_private_key: values.ca_private_key,
      });
      setConfig(data);
      certForm.resetFields();
      setShowCertUpload(false);
      message.success('CA certificate uploaded successfully');
    } catch (err: any) {
      message.error(err?.message || 'Failed to upload CA certificate');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCA = async () => {
    try {
      setSaving(true);
      const data = await api.settings.removeCACertificate();
      setConfig(data);
      message.success('CA certificate removed');
    } catch (err) {
      message.error('Failed to remove CA certificate');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const authMode = Form.useWatch('auth_mode', form);

  if (loading) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <Spin size="large" />
          <p style={{ marginTop: '16px' }}>Loading backend authentication settings...</p>
        </div>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Title level={4}>
          <SafetyCertificateOutlined style={{ marginRight: 8 }} />
          Backend Authentication
        </Title>
        <Paragraph type="secondary">
          Configure how backend instances authenticate when joining the cluster.
          This ensures only authorized backends can register and participate in policy evaluation.
        </Paragraph>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={{ auth_mode: config?.auth_mode || 'none' }}
        >
          <Form.Item
            name="auth_mode"
            label="Authentication Mode"
            rules={[{ required: true }]}
          >
            <Select style={{ maxWidth: 400 }}>
              <Option value="none">
                <Space>
                  <UnlockOutlined />
                  <span>None (Development Only)</span>
                </Space>
              </Option>
              <Option value="shared_secret">
                <Space>
                  <KeyOutlined />
                  <span>Shared Secret</span>
                </Space>
              </Option>
              <Option value="mtls">
                <Space>
                  <SafetyCertificateOutlined />
                  <span>Mutual TLS (mTLS)</span>
                </Space>
              </Option>
            </Select>
          </Form.Item>

          {authMode === 'none' && (
            <Alert
              message="No Authentication"
              description="Any backend with network access can register with the cluster. Only use this mode for development."
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          {authMode === 'shared_secret' && (
            <>
              <Alert
                message="Shared Secret Authentication"
                description="Backends must provide a secret token via the CLUSTER_SECRET environment variable to register."
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              {config?.secret_configured && (
                <Alert
                  message="Secret Configured"
                  description="A shared secret is already configured. Enter a new secret below to change it, or leave blank to keep the existing one."
                  type="success"
                  showIcon
                  icon={<CheckCircleOutlined />}
                  style={{ marginBottom: 16 }}
                />
              )}
              <Form.Item
                name="shared_secret"
                label="Cluster Secret"
                help="Minimum 16 characters. This secret must be set as CLUSTER_SECRET on all backend instances."
                rules={[
                  {
                    min: 16,
                    message: 'Secret must be at least 16 characters',
                  },
                ]}
              >
                <Input.Password
                  placeholder={config?.secret_configured ? '••••••••••••••••' : 'Enter cluster secret'}
                  style={{ maxWidth: 400 }}
                />
              </Form.Item>
            </>
          )}

          {authMode === 'mtls' && (
            <>
              <Alert
                message="Mutual TLS Authentication"
                description="Backends must present a client certificate signed by the trusted CA to register."
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
            </>
          )}

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>
              Save Authentication Mode
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {authMode === 'mtls' && (
        <Card>
          <Title level={5}>
            <SafetyCertificateOutlined style={{ marginRight: 8 }} />
            Trusted CA Certificate
          </Title>
          <Paragraph type="secondary">
            Upload the public CA certificate that will be used to verify backend client certificates.
            All backend instances must present a certificate signed by this CA.
          </Paragraph>

          {config?.ca_configured ? (
            <>
              <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="Status">
                  <Tag color="green" icon={<CheckCircleOutlined />}>
                    Configured
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Subject">{config.ca_subject}</Descriptions.Item>
                <Descriptions.Item label="Issuer">{config.ca_issuer}</Descriptions.Item>
                <Descriptions.Item label="Expires">
                  {config.ca_not_after ? (
                    new Date(config.ca_not_after) < new Date() ? (
                      <Text type="danger">
                        <WarningOutlined /> Expired: {new Date(config.ca_not_after).toLocaleDateString()}
                      </Text>
                    ) : (
                      new Date(config.ca_not_after).toLocaleDateString()
                    )
                  ) : (
                    'Unknown'
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Fingerprint (SHA256)">
                  <Text code copyable style={{ fontSize: '12px' }}>
                    {config.ca_fingerprint}
                  </Text>
                </Descriptions.Item>
              </Descriptions>

              <Space>
                <Button
                  icon={<UploadOutlined />}
                  onClick={() => setShowCertUpload(!showCertUpload)}
                >
                  {showCertUpload ? 'Cancel' : 'Replace Certificate'}
                </Button>
                <Popconfirm
                  title="Remove CA Certificate?"
                  description="This will prevent new backends from registering until a new CA is uploaded."
                  onConfirm={handleRemoveCA}
                  okText="Remove"
                  okType="danger"
                  cancelText="Cancel"
                >
                  <Button danger icon={<DeleteOutlined />} loading={saving}>
                    Remove Certificate
                  </Button>
                </Popconfirm>
              </Space>
            </>
          ) : (
            <Alert
              message="No CA Certificate Configured"
              description="Upload a CA certificate to enable mTLS authentication for backend instances."
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          {(!config?.ca_configured || showCertUpload) && (
            <Form
              form={certForm}
              layout="vertical"
              onFinish={handleUploadCA}
              style={{ marginTop: 16 }}
            >
              <Form.Item
                name="ca_certificate"
                label="CA Certificate (PEM format)"
                rules={[
                  { required: true, message: 'CA certificate is required' },
                  {
                    validator: (_, value) => {
                      if (!value) return Promise.resolve();
                      if (!value.includes('-----BEGIN CERTIFICATE-----')) {
                        return Promise.reject('Invalid PEM format. Must start with -----BEGIN CERTIFICATE-----');
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <TextArea
                  rows={10}
                  placeholder={`-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAJ...
-----END CERTIFICATE-----`}
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>

              <Form.Item
                name="ca_private_key"
                label="CA Private Key (PEM format) - Required for signing backend certificates"
                rules={[
                  {
                    validator: (_, value) => {
                      if (!value) return Promise.resolve();
                      if (!value.includes('-----BEGIN') || !value.includes('PRIVATE KEY-----')) {
                        return Promise.reject('Invalid PEM format. Must be a private key.');
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
                help="The private key is stored securely and used to sign certificates for approved backend instances."
              >
                <TextArea
                  rows={10}
                  placeholder={`-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----`}
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>

              <Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" loading={saving} icon={<UploadOutlined />}>
                    Upload CA Certificate
                  </Button>
                  {showCertUpload && (
                    <Button onClick={() => setShowCertUpload(false)}>Cancel</Button>
                  )}
                </Space>
              </Form.Item>
            </Form>
          )}
        </Card>
      )}

      <Card>
        <Title level={5}>Backend Configuration</Title>
        <Paragraph type="secondary">
          Configure backend instances with the following environment variables based on the selected authentication mode:
        </Paragraph>

        {authMode === 'none' && (
          <Alert
            message="No additional configuration required"
            description="Backends will automatically register when they start."
            type="info"
            showIcon
          />
        )}

        {authMode === 'shared_secret' && (
          <div style={{ background: '#1e1e1e', padding: 16, borderRadius: 4 }}>
            <Text code style={{ color: '#d4d4d4', display: 'block' }}>
              # Set on each backend instance
            </Text>
            <Text code style={{ color: '#9cdcfe', display: 'block' }}>
              CLUSTER_SECRET=your-secret-here
            </Text>
          </div>
        )}

        {authMode === 'mtls' && (
          <div style={{ background: '#1e1e1e', padding: 16, borderRadius: 4 }}>
            <Text code style={{ color: '#d4d4d4', display: 'block' }}>
              # Set on each backend instance
            </Text>
            <Text code style={{ color: '#9cdcfe', display: 'block' }}>
              MTLS_CERT_FILE=/path/to/client.crt
            </Text>
            <Text code style={{ color: '#9cdcfe', display: 'block' }}>
              MTLS_KEY_FILE=/path/to/client.key
            </Text>
            <Text code style={{ color: '#9cdcfe', display: 'block' }}>
              MTLS_CA_FILE=/path/to/ca.crt
            </Text>
          </div>
        )}
      </Card>
    </Space>
  );
};

export default BackendAuthSettings;

