import { useEffect, useState, useCallback, useRef } from "react";
import { Card, Space, Tag, Typography, Tooltip, Spin, Alert, Statistic, Row, Col, Progress, Badge, Divider, List, Button } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  ClockCircleOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  SyncOutlined,
  WarningOutlined,
  ReloadOutlined,
  ClusterOutlined,
  WifiOutlined,
  DisconnectOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import { api, ListInstancesResponse, InstanceInfo, HealthCheck } from "../api";
import { useSSEContext, usePolicyUpdates, useEntityUpdates } from "../contexts/SSEContext";

const { Text, Title } = Typography;

type ClusterStatusProps = {
  refreshInterval?: number; // in milliseconds, default 60000 (60s)
  compact?: boolean; // Show compact version
};

export default function ClusterStatus({ refreshInterval = 60000, compact = false }: ClusterStatusProps) {
  const [data, setData] = useState<ListInstancesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const lastFetchRef = useRef<number>(0);

  // Get SSE connection state
  const { connected: sseConnected, error: sseError, reconnect: sseReconnect, reconnectAttempts } = useSSEContext();

  const fetchStatus = useCallback(async (force = false) => {
    // Debounce: Don't fetch more than once per 5 seconds unless forced
    const now = Date.now();
    if (!force && now - lastFetchRef.current < 5000) {
      console.log('[ClusterStatus] Skipping fetch - too soon since last fetch');
      return;
    }
    lastFetchRef.current = now;

    try {
      const result = await api.getClusterInstances();
      setData(result);
      setError(null);
      setRateLimited(false);
      setLastUpdated(new Date());
    } catch (err) {
      const errorMsg = (err as Error).message;
      // Handle rate limit gracefully
      if (errorMsg.toLowerCase().includes('rate limit')) {
        setRateLimited(true);
        setError(null); // Don't show as error, we have data
        console.log('[ClusterStatus] Rate limited, will retry later');
      } else {
        setError(errorMsg);
        setRateLimited(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh on policy updates (debounced)
  usePolicyUpdates(useCallback(() => {
    console.log('[ClusterStatus] Policy update received via SSE');
    // Don't auto-refresh ClusterStatus on policy updates - not needed
  }, []));

  // Refresh on entity updates (debounced)
  useEntityUpdates(useCallback(() => {
    console.log('[ClusterStatus] Entity update received via SSE');
    // Don't auto-refresh ClusterStatus on entity updates - not needed
  }, []));

  useEffect(() => {
    // Initial fetch
    fetchStatus(true);
    
    // Set up polling - use longer interval when SSE is connected
    const interval = sseConnected ? refreshInterval * 2 : refreshInterval;
    const timer = setInterval(() => fetchStatus(false), interval);
    return () => clearInterval(timer);
  }, [refreshInterval, fetchStatus, sseConnected]);

  const getStatusColor = (s: string) => {
    switch (s) {
      case "healthy":
        return "success";
      case "degraded":
        return "warning";
      case "error":
        return "error";
      default:
        return "default";
    }
  };

  const getStatusIcon = (s: string) => {
    switch (s) {
      case "healthy":
        return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
      case "degraded":
        return <WarningOutlined style={{ color: "#faad14" }} />;
      case "error":
        return <CloseCircleOutlined style={{ color: "#ff4d4f" }} />;
      default:
        return <SyncOutlined spin />;
    }
  };

  if (loading && !data) {
    return (
      <Card>
        <Space direction="vertical" align="center" style={{ width: "100%", padding: 24 }}>
          <Spin size="large" />
          <Text type="secondary">Loading cluster status...</Text>
        </Space>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Alert
        type="error"
        showIcon
        message="Failed to load cluster status"
        description={error}
        action={
          <Button size="small" onClick={() => fetchStatus(true)}>
            Retry
          </Button>
        }
      />
    );
  }

  if (!data || data.instances.length === 0) return null;

  // Calculate overall cluster health
  const overallStatus = data.instances.every(i => i.status === "healthy") 
    ? "healthy" 
    : data.instances.some(i => i.status === "error") 
      ? "error" 
      : "degraded";

  // Calculate total SSE clients across all instances
  const totalSSEClients = data.instances.reduce((sum, i) => sum + i.sse_clients, 0);

  if (compact) {
    return (
      <Card size="small" bodyStyle={{ padding: 12 }}>
        <Space>
          <Badge status={overallStatus === "healthy" ? "success" : overallStatus === "degraded" ? "warning" : "error"} />
          <Text strong>
            <ClusterOutlined /> {data.total} Instance{data.total !== 1 ? "s" : ""}
          </Text>
          <Divider type="vertical" />
          <Tooltip title={sseConnected ? "Real-time updates active" : sseError || "Connecting..."}>
            <Space size={4}>
              {sseConnected ? (
                <WifiOutlined style={{ color: "#52c41a" }} />
              ) : (
                <DisconnectOutlined style={{ color: "#faad14" }} />
              )}
              <Text style={{ color: sseConnected ? "#52c41a" : "#faad14" }}>
                {sseConnected ? "Live" : "..."}
              </Text>
            </Space>
          </Tooltip>
          <Divider type="vertical" />
          <Tooltip title="Total SSE Clients">
            <Space size={4}>
              <ApiOutlined />
              <Text>{totalSSEClients}</Text>
            </Space>
          </Tooltip>
          {data.instances[0] && (
            <>
              <Divider type="vertical" />
              <Text type="secondary">v{data.instances[0].cedar_version}</Text>
            </>
          )}
        </Space>
      </Card>
    );
  }

  return (
    <Card
      title={
        <Space>
          <ClusterOutlined style={{ color: "#1890ff" }} />
          <span>Cluster Status</span>
          <Tag color={getStatusColor(overallStatus)}>{overallStatus.toUpperCase()}</Tag>
          <Tag>{data.total} instance{data.total !== 1 ? "s" : ""}</Tag>
          <Tooltip title={sseConnected ? "Real-time updates active - UI will refresh automatically when policies change" : sseError || "Connecting to real-time updates..."}>
            <Tag 
              icon={sseConnected ? <WifiOutlined /> : <DisconnectOutlined />}
              color={sseConnected ? "success" : "warning"}
            >
              {sseConnected ? "Live" : "Connecting..."}
            </Tag>
          </Tooltip>
        </Space>
      }
      extra={
        <Space>
          {!sseConnected && reconnectAttempts > 0 && (
            <Tooltip title="Reconnect to real-time updates">
              <Button
                type="text"
                size="small"
                icon={<LinkOutlined />}
                onClick={sseReconnect}
              >
                Reconnect
              </Button>
            </Tooltip>
          )}
          <Tooltip title={`Last updated: ${lastUpdated?.toLocaleTimeString()}`}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              <SyncOutlined spin={loading} /> {sseConnected ? "Live + " : ""}Polling {refreshInterval / 1000}s
            </Text>
          </Tooltip>
          <Button 
            type="text" 
            icon={<ReloadOutlined />} 
            onClick={() => fetchStatus(true)} 
            loading={loading}
            size="small"
          />
        </Space>
      }
    >
      {/* Summary Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Statistic
            title="Active Instances"
            value={data.total}
            prefix={<CloudServerOutlined />}
            valueStyle={{ color: "#1890ff" }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="Healthy"
            value={data.instances.filter(i => i.status === "healthy").length}
            prefix={<CheckCircleOutlined />}
            valueStyle={{ color: "#52c41a" }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="Degraded"
            value={data.instances.filter(i => i.status === "degraded").length}
            prefix={<WarningOutlined />}
            valueStyle={{ color: data.instances.some(i => i.status === "degraded") ? "#faad14" : undefined }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="Total SSE Clients"
            value={totalSSEClients}
            prefix={<ApiOutlined />}
          />
        </Col>
      </Row>

      <Divider>Instances</Divider>

      {/* Instance List */}
      <List
        dataSource={data.instances}
        renderItem={(instance: InstanceInfo) => (
          <List.Item>
            <Card 
              size="small" 
              style={{ width: "100%" }}
              bodyStyle={{ padding: 12 }}
            >
              <Row gutter={[16, 8]}>
                {/* Instance Header */}
                <Col span={24}>
                  <Space>
                    {getStatusIcon(instance.status)}
                    <Text strong code>{instance.instance_id}</Text>
                    <Tag color={getStatusColor(instance.status)}>{instance.status}</Tag>
                    <Text type="secondary">v{instance.cedar_version}</Text>
                  </Space>
                </Col>

                {/* Instance Details */}
                <Col xs={24} sm={12} md={6}>
                  <Space direction="vertical" size={0}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Uptime</Text>
                    <Space size={4}>
                      <ClockCircleOutlined />
                      <Text>{instance.uptime}</Text>
                    </Space>
                  </Space>
                </Col>

                <Col xs={24} sm={12} md={6}>
                  <Space direction="vertical" size={0}>
                    <Text type="secondary" style={{ fontSize: 11 }}>SSE Clients</Text>
                    <Space size={4}>
                      <ApiOutlined />
                      <Text>{instance.sse_clients}</Text>
                    </Space>
                  </Space>
                </Col>

                <Col xs={24} sm={12} md={6}>
                  <Space direction="vertical" size={0}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Database</Text>
                    <Space size={4}>
                      <DatabaseOutlined />
                      {instance.checks.database ? (
                        <Tooltip title={instance.checks.database.latency || instance.checks.database.error}>
                          <Tag 
                            color={getStatusColor(instance.checks.database.status)} 
                            style={{ margin: 0 }}
                          >
                            {instance.checks.database.status}
                            {instance.checks.database.latency && ` (${instance.checks.database.latency})`}
                          </Tag>
                        </Tooltip>
                      ) : (
                        <Text type="secondary">N/A</Text>
                      )}
                    </Space>
                  </Space>
                </Col>

                <Col xs={24} sm={12} md={6}>
                  <Space direction="vertical" size={0}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Redis</Text>
                    <Space size={4}>
                      <ThunderboltOutlined />
                      {instance.checks.redis ? (
                        <Tooltip title={instance.checks.redis.latency || instance.checks.redis.error}>
                          <Tag 
                            color={getStatusColor(instance.checks.redis.status)} 
                            style={{ margin: 0 }}
                          >
                            {instance.checks.redis.status}
                            {instance.checks.redis.latency && ` (${instance.checks.redis.latency})`}
                          </Tag>
                        </Tooltip>
                      ) : (
                        <Text type="secondary">N/A</Text>
                      )}
                    </Space>
                  </Space>
                </Col>

                {/* Cache Stats */}
                {instance.cache && (
                  <Col span={24} style={{ marginTop: 8 }}>
                    <Space split={<Divider type="vertical" />}>
                      <Text type="secondary">
                        Cache: {instance.cache.enabled ? "Enabled" : "Disabled"}
                      </Text>
                      {instance.cache.l1_size !== undefined && (
                        <Text type="secondary">
                          L1 Size: {instance.cache.l1_size}
                        </Text>
                      )}
                      {instance.cache.l2_enabled !== undefined && (
                        <Text type="secondary">
                          L2 (Redis): {instance.cache.l2_enabled ? "Yes" : "No"}
                        </Text>
                      )}
                      {instance.cache.hit_rate && instance.cache.hit_rate !== "0.0%" && (
                        <Text type="secondary">
                          Hit Rate: {instance.cache.hit_rate}
                        </Text>
                      )}
                    </Space>
                  </Col>
                )}
              </Row>
            </Card>
          </List.Item>
        )}
      />

      {error && (
        <Alert
          type="warning"
          message="Update failed"
          description={`Last error: ${error}. Showing cached data.`}
          style={{ marginTop: 16 }}
          showIcon
        />
      )}
    </Card>
  );
}
