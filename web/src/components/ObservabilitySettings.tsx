import { useState, useEffect } from "react";
import { Card, Form, Switch, Input, Button, message, Alert, Typography } from "antd";
import { api, ObservabilityConfig } from "../api";

const { Paragraph } = Typography;

export default function ObservabilitySettings() {
  const [config, setConfig] = useState<ObservabilityConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await api.settings.getObservability();
      setConfig(data);
      form.setFieldsValue(data);
    } catch (error) {
      console.error("Failed to load observability config:", error);
      message.error("Failed to load observability configuration");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (values: ObservabilityConfig) => {
    setSaving(true);
    try {
      const updated = await api.settings.updateObservability(values);
      setConfig(updated);
      message.success("Observability configuration updated");
    } catch (error) {
      console.error("Failed to save observability config:", error);
      message.error("Failed to save observability configuration");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Observability & Tracing" loading={loading}>
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Configure OpenTelemetry (OTEL) integration for distributed tracing. 
        When enabled, the backend will export traces to the specified OTLP endpoint.
      </Paragraph>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        initialValues={{ enabled: false, endpoint: "" }}
      >
        <Form.Item
          name="enabled"
          label="Enable Tracing"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prev, curr) => prev.enabled !== curr.enabled}
        >
          {({ getFieldValue }) => {
            const enabled = getFieldValue("enabled");
            return (
              <Form.Item
                name="endpoint"
                label="OTLP Endpoint"
                rules={[
                  { required: enabled, message: "Endpoint is required when tracing is enabled" },
                ]}
                help="e.g., otel-collector:4317 or http://jaeger:4318"
              >
                <Input disabled={!enabled} placeholder="otel-collector:4317" />
              </Form.Item>
            );
          }}
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            Save Changes
          </Button>
        </Form.Item>
      </Form>

      {config?.enabled && (
        <Alert
          message="Tracing Active"
          description={`Traces are being exported to ${config.endpoint}`}
          type="success"
          showIcon
          style={{ marginTop: 16 }}
        />
      )}
    </Card>
  );
}
