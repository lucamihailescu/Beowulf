export type HealthCheck = {
  status: string;
  latency?: string;
  error?: string;
};

export type HealthResponse = {
  status: string;
  cedar_version?: string;
  checks?: Record<string, HealthCheck>;
};

export type CacheStats = {
  enabled: boolean;
  l1_size?: number;
  l2_enabled: boolean;
  hit_rate?: string;
};

export type ClusterStatusResponse = {
  instance_id: string;
  status: string;
  uptime: string;
  cedar_version: string;
  checks: Record<string, HealthCheck>;
  cache?: CacheStats;
  sse_clients: number;
  requests: number;
  started_at: string;
};

export type InstanceInfo = {
  instance_id: string;
  status: string;
  uptime: string;
  cedar_version: string;
  started_at: string;
  last_heartbeat: string;
  checks: Record<string, HealthCheck>;
  cache?: CacheStats;
  sse_clients: number;
  requests: number;
};

export type ListInstancesResponse = {
  instances: InstanceInfo[];
  total: number;
};

export type Namespace = {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type CreateNamespaceRequest = {
  name: string;
  description?: string;
};

export type Application = {
  id: number;
  name: string;
  namespace_id: number;
  namespace_name: string;
  description: string;
  approval_required: boolean;
  created_at: string;
  deleted_at?: string;
};

export type CreateApplicationRequest = {
  name: string;
  namespace_id: number;
  description?: string;
  approval_required?: boolean;
};

export type EntityRef = { type: string; id: string };

export type CedarEntity = {
  uid: EntityRef;
  parents?: EntityRef[];
  attrs?: Record<string, unknown>;
  tags?: Record<string, unknown>;
};

export type CreatePolicyRequest = {
  name: string;
  description?: string;
  policy_text: string;
  activate?: boolean;
};

export type PolicySummary = {
  id: number;
  name: string;
  description: string;
  active_version: number;
  latest_version: number;
  latest_status: string;
  created_at: string;
  updated_at: string;
};

export type PolicyDetails = {
  id: number;
  name: string;
  description: string;
  active_version: number;
  latest_version: number;
  active_policy_text: string;
  latest_policy_text: string;
  active_status: string;
  latest_status: string;
  created_at: string;
  updated_at: string;
};

export type UpsertEntityRequest = {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
  parents?: Array<{ type: string; id: string }>;
};

export type AuthorizeRequest = {
  application_id: number;
  principal: EntityRef;
  action: EntityRef;
  resource: EntityRef;
  context?: Record<string, unknown>;
};

export type AuthorizeResponse = {
  decision: "allow" | "deny";
  reasons: string[];
  errors: string[];
};

export type Schema = {
  id: number;
  application_id: number;
  version: number;
  schema_text: string;
  active: boolean;
  created_at: string;
};

export type CreateSchemaRequest = {
  schema_text: string;
  activate?: boolean;
};

export type AuditLog = {
  id: number;
  application_id?: number;
  actor: string;
  action: string;
  target?: string;
  decision?: string;
  context?: Record<string, unknown>;
  created_at: string;
};

export type AuditListResponse = {
  items: AuditLog[];
  total: number;
};

export type AuditFilter = {
  application_id?: number;
  action?: string;
  decision?: string;
  limit?: number;
  offset?: number;
};

// Entra ID (Azure AD) types
export type EntraUser = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  mail: string;
  jobTitle?: string;
  department?: string;
};

export type EntraGroup = {
  id: string;
  displayName: string;
  description?: string;
  mail?: string;
  groupTypes?: string[];
};

export type EntraSearchUsersResult = {
  users: EntraUser[];
  total_count: number;
};

export type EntraSearchGroupsResult = {
  groups: EntraGroup[];
  total_count: number;
};

export type EntraStatus = {
  configured: boolean;
  tenant_id: string;
};

// Active Directory (LDAP) types
export type ADUser = {
  dn: string;
  sAMAccountName: string;
  userPrincipalName: string;
  displayName: string;
  mail: string;
  givenName?: string;
  sn?: string;
  department?: string;
  title?: string;
  groups?: string[];
};

export type ADGroup = {
  dn: string;
  cn: string;
  displayName?: string;
  description?: string;
  mail?: string;
};

export type ADSearchUsersResult = {
  users: ADUser[];
  total_count: number;
};

export type ADSearchGroupsResult = {
  groups: ADGroup[];
  total_count: number;
};

export type ADStatus = {
  configured: boolean;
  enabled: boolean;
  auth_method: string;
  server?: string;
};

export type ADConfig = {
  enabled: boolean;
  server: string;
  base_dn: string;
  bind_dn: string;
  has_bind_password: boolean;
  user_filter: string;
  group_filter: string;
  user_search_filter: string;
  group_membership_attr: string;
  use_tls: boolean;
  insecure_skip_verify: boolean;
  kerberos_enabled: boolean;
  kerberos_keytab?: string;
  kerberos_service?: string;
  kerberos_realm?: string;
  group_cache_ttl: string;
  configured: boolean;
};

export type ADConfigRequest = {
  enabled: boolean;
  server: string;
  base_dn: string;
  bind_dn: string;
  bind_password?: string;
  user_filter?: string;
  group_filter?: string;
  user_search_filter?: string;
  group_membership_attr?: string;
  use_tls?: boolean;
  insecure_skip_verify?: boolean;
  kerberos_enabled?: boolean;
  kerberos_keytab?: string;
  kerberos_service?: string;
  kerberos_realm?: string;
  group_cache_ttl?: string;
};

export type ADTestResult = {
  success: boolean;
  message?: string;
  error?: string;
};

export type IdentityProvider = {
  provider: "ad" | "entra" | "none";
  auth_method?: string;
  server?: string;
  tenant_id?: string;
  client_id?: string;
};

export type LDAPAuthRequest = {
  username: string;
  password: string;
};

export type LDAPAuthResponse = {
  token: string;
  expires_at: number;
  user: {
    id: string;
    username: string;
    display_name: string;
    email: string;
    groups: string[];
  };
};

export type SessionInfo = {
  user_id: string;
  name: string;
  email: string;
  groups: string[];
  auth_type: "entra" | "ldap" | "kerberos" | "anonymous";
  logged_in: boolean;
};

// Settings types
export type EntraSettings = {
  tenant_id: string;
  client_id: string;
  has_client_secret: boolean;
  redirect_uri: string;
  auth_enabled: boolean;
  configured: boolean;
  configured_from_env: boolean;
};

export type EntraSettingsRequest = {
  tenant_id: string;
  client_id: string;
  client_secret: string;
  redirect_uri?: string;
  auth_enabled?: boolean;
};

export type EntraTestResult = {
  success: boolean;
  message?: string;
  error?: string;
  users_found?: number;
};

// Auth configuration (public, no secrets)
export type EntraAuthConfig = {
  enabled: boolean;
  tenant_id?: string;
  client_id?: string;
  redirect_uri?: string;
  authority?: string;
};

// Backend Authentication types
export type BackendAuthMode = 'none' | 'shared_secret' | 'mtls';

export type BackendAuthConfig = {
  auth_mode: BackendAuthMode;
  approval_required?: boolean;
  ca_configured?: boolean;
  ca_subject?: string;
  ca_issuer?: string;
  ca_not_after?: string;
  ca_fingerprint?: string;
  secret_configured?: boolean;
  updated_at: string;
};

export type BackendAuthConfigRequest = {
  auth_mode: BackendAuthMode;
  ca_certificate?: string;
  shared_secret?: string;
};

export type CACertificateRequest = {
  ca_certificate: string;
};

// Backend Instance types
export type BackendInstanceStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export type BackendInstance = {
  id: number;
  instance_id: string;
  hostname: string;
  ip_address?: string;
  status: BackendInstanceStatus;
  cert_fingerprint?: string;
  cluster_secret_verified: boolean;
  requested_at: string;
  approved_at?: string;
  approved_by?: string;
  rejected_at?: string;
  rejected_by?: string;
  rejection_reason?: string;
  cedar_version?: string;
  os_info?: string;
  arch?: string;
  last_heartbeat?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type BackendInstancesListResponse = {
  instances: BackendInstance[];
  total: number;
  counts: Record<string, number>;
};

export type BackendInstanceRegisterRequest = {
  instance_id: string;
  hostname: string;
  ip_address?: string;
  cert_fingerprint?: string;
  cluster_secret_verified?: boolean;
  cedar_version?: string;
  os_info?: string;
  arch?: string;
  metadata?: Record<string, unknown>;
};

export type BackendInstanceRejectRequest = {
  reason?: string;
};

export type ObservabilityConfig = {
  enabled: boolean;
  endpoint: string;
};

// Simulation types
export type SimulationMode = 'production_replay' | 'sample_data' | 'custom';

export type SimulateRequest = {
  new_policy_text: string;
  current_policy_text?: string; // If provided, compare against this instead of the active DB version
  mode?: SimulationMode;
  time_range?: string;
  sample_size?: number;
  custom_scenarios?: AuthRequest[];
};

export type AuthRequest = {
  principal: string;
  action: string;
  resource: string;
  context?: Record<string, unknown>;
};

export type DecisionSummary = {
  allow_count: number;
  deny_count: number;
};

export type AffectedPrincipal = {
  principal: string;
  current_decision: string;
  new_decision: string;
  affected_actions: string[];
  request_count: number;
};

export type SimulatedRequest = {
  principal: string;
  action: string;
  resource: string;
  current_decision: string;
  new_decision: string;
  determining_policy?: string;
  determining_reasons?: string;
};

export type SimulationImpact = {
  newly_denied: number;
  newly_allowed: number;
  affected_principals: AffectedPrincipal[];
  sample_requests: SimulatedRequest[];
};

export type SimulateResponse = {
  simulation_id: number;
  requests_analyzed: number;
  current_policy: DecisionSummary;
  new_policy: DecisionSummary;
  impact: SimulationImpact;
  status: string;
};

export type Simulation = {
  id: number;
  application_id: number;
  policy_id: number;
  policy_version: number;
  mode: SimulationMode;
  time_range?: string;
  sample_size?: number;
  requests_analyzed: number;
  current_allows: number;
  current_denies: number;
  new_allows: number;
  new_denies: number;
  impact_details?: SimulationImpact;
  status: string;
  error_message?: string;
  created_by: string;
  created_at: string;
  completed_at?: string;
};

export type SimulationListResponse = {
  simulations: Simulation[];
  total: number;
};

function defaultApiBaseUrl(): string {
  // Use relative /api path - nginx will proxy to the backend
  // This works regardless of how the frontend is accessed (localhost, tunnel, LAN IP, etc.)
  return '/api';
}

export const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || defaultApiBaseUrl();

// Token getter function - will be set by AuthProvider
let tokenGetter: (() => Promise<string | null>) | null = null;

// Callback for authentication failures
let onAuthError: (() => void) | null = null;

/**
 * Configure the API client with authentication functions.
 * Call this from the AuthProvider after initialization.
 */
export function configureAuth(options: {
  getToken: () => Promise<string | null>;
  onAuthError?: () => void;
}) {
  tokenGetter = options.getToken;
  onAuthError = options.onAuthError ?? null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Get auth token if available
  let authHeaders: Record<string, string> = {};
  if (tokenGetter) {
    try {
      const token = await tokenGetter();
      if (token) {
        authHeaders['Authorization'] = `Bearer ${token}`;
      }
    } catch (e) {
      console.warn('Failed to get auth token:', e);
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include', // Include cookies for Kerberos/SPNEGO
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (e) {
    // Browser network error (often CORS or backend unreachable)
    const msg = (e as Error)?.message || "Failed to fetch";
    throw new Error(`${msg}. Check that the backend is reachable at ${API_BASE_URL} and that CORS is enabled.`);
  }

  // Handle authentication errors
  // NOTE: We do NOT automatically trigger onAuthError here because it can cause redirect loops
  // when MSAL is still processing the auth response. Instead, we just throw the error and
  // let the UI handle it (show login button, error message, etc.)
  if (res.status === 401) {
    throw new Error('Authentication required. Please sign in.');
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  const text = await res.text();
  let body: any = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!res.ok) {
    const message = body?.error ?? body?.message ?? (body?.raw ? `HTTP ${res.status}: ${String(body.raw).slice(0, 200)}` : `HTTP ${res.status}`);
    throw new Error(message);
  }

  return body as T;
}

/**
 * Get current user information from the backend.
 */
export async function getCurrentUser(): Promise<{ id: string; name: string; email: string; groups: string[] } | null> {
  try {
    return await request<{ id: string; name: string; email: string; groups: string[] }>('/v1/me');
  } catch {
    return null;
  }
}

export const api = {
  // Namespace endpoints
  listNamespaces(): Promise<Namespace[]> {
    return request<Namespace[]>("/v1/namespaces/");
  },

  createNamespace(payload: CreateNamespaceRequest): Promise<{ id: number }> {
    return request<{ id: number }>("/v1/namespaces/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // Application endpoints
  listApps(includeDeleted = false): Promise<Application[]> {
    const query = includeDeleted ? "?include_deleted=true" : "";
    return request<Application[]>(`/v1/apps/${query}`);
  },

  createApp(payload: CreateApplicationRequest): Promise<{ id: number }> {
    return request<{ id: number }>("/v1/apps/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getApp(id: number): Promise<Application> {
    return request<Application>(`/v1/apps/${id}`);
  },

  deleteApp(id: number): Promise<void> {
    return request<void>(`/v1/apps/${id}`, {
      method: "DELETE",
    });
  },

  restoreApp(id: number): Promise<void> {
    return request<void>(`/v1/apps/${id}/restore`, {
      method: "POST",
    });
  },

  createPolicy(appId: number, payload: CreatePolicyRequest): Promise<{ policy_id: number; version: number; status: string }> {
    return request<{ policy_id: number; version: number; status: string }>(`/v1/apps/${appId}/policies`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  approvePolicy(appId: number, policyId: number, version: number): Promise<void> {
    return request<void>(`/v1/apps/${appId}/policies/${policyId}/versions/${version}/approve`, {
      method: "POST",
    });
  },

  activatePolicy(appId: number, policyId: number, version: number): Promise<void> {
    return request<void>(`/v1/apps/${appId}/policies/${policyId}/versions/${version}/activate`, {
      method: "POST",
    });
  },

  deletePolicy(appId: number, policyId: number): Promise<{ status: string }> {
    return request<{ status: string }>(`/v1/apps/${appId}/policies/${policyId}`, {
      method: "DELETE",
    });
  },

  approveDeletePolicy(appId: number, policyId: number): Promise<void> {
    return request<void>(`/v1/apps/${appId}/policies/${policyId}/approve-delete`, {
      method: "POST",
    });
  },

  listPolicies(appId: number): Promise<PolicySummary[]> {
    return request<PolicySummary[]>(`/v1/apps/${appId}/policies`);
  },

  getPolicy(appId: number, policyId: number): Promise<PolicyDetails> {
    return request<PolicyDetails>(`/v1/apps/${appId}/policies/${policyId}`);
  },

  listEntities(appId: number): Promise<CedarEntity[]> {
    return request<CedarEntity[]>(`/v1/apps/${appId}/entities`);
  },

  upsertEntity(appId: number, payload: UpsertEntityRequest): Promise<void> {
    return request<void>(`/v1/apps/${appId}/entities`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  authorize(payload: AuthorizeRequest): Promise<AuthorizeResponse> {
    return request<AuthorizeResponse>("/v1/authorize", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // Schema endpoints
  listSchemas(appId: number): Promise<Schema[]> {
    return request<Schema[]>(`/v1/apps/${appId}/schemas/`);
  },

  createSchema(appId: number, payload: CreateSchemaRequest): Promise<{ schema_id: number; version: number }> {
    return request<{ schema_id: number; version: number }>(`/v1/apps/${appId}/schemas/`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getActiveSchema(appId: number): Promise<Schema> {
    return request<Schema>(`/v1/apps/${appId}/schemas/active`);
  },

  activateSchema(appId: number, version: number): Promise<void> {
    return request<void>(`/v1/apps/${appId}/schemas/activate`, {
      method: "POST",
      body: JSON.stringify({ version }),
    });
  },

  // Audit endpoints
  listAuditLogs(filter?: AuditFilter): Promise<AuditListResponse> {
    const params = new URLSearchParams();
    if (filter?.application_id !== undefined) params.set("application_id", String(filter.application_id));
    if (filter?.action) params.set("action", filter.action);
    if (filter?.decision) params.set("decision", filter.decision);
    if (filter?.limit) params.set("limit", String(filter.limit));
    if (filter?.offset) params.set("offset", String(filter.offset));
    const qs = params.toString();
    return request<AuditListResponse>(`/v1/audit/${qs ? `?${qs}` : ""}`);
  },

  checkHealth(): Promise<HealthResponse> {
    return request<HealthResponse>("/health");
  },

  getClusterStatus(): Promise<ClusterStatusResponse> {
    return request<ClusterStatusResponse>("/v1/cluster/status");
  },

  getClusterInstances(): Promise<ListInstancesResponse> {
    return request<ListInstancesResponse>("/v1/cluster/instances");
  },

  // Entra ID (Azure AD) endpoints
  entra: {
    getStatus(): Promise<EntraStatus> {
      return request<EntraStatus>("/v1/entra/status");
    },

    searchUsers(query?: string, limit?: number): Promise<EntraSearchUsersResult> {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (limit) params.set("limit", String(limit));
      const qs = params.toString();
      return request<EntraSearchUsersResult>(`/v1/entra/users${qs ? `?${qs}` : ""}`);
    },

    getUser(id: string): Promise<EntraUser> {
      return request<EntraUser>(`/v1/entra/users/${encodeURIComponent(id)}`);
    },

    searchGroups(query?: string, limit?: number): Promise<EntraSearchGroupsResult> {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (limit) params.set("limit", String(limit));
      const qs = params.toString();
      return request<EntraSearchGroupsResult>(`/v1/entra/groups${qs ? `?${qs}` : ""}`);
    },

    getGroup(id: string): Promise<EntraGroup> {
      return request<EntraGroup>(`/v1/entra/groups/${encodeURIComponent(id)}`);
    },
  },

  // Active Directory (LDAP) endpoints
  ad: {
    getStatus(): Promise<ADStatus> {
      return request<ADStatus>("/v1/ad/status");
    },

    searchUsers(query?: string, limit?: number): Promise<ADSearchUsersResult> {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (limit) params.set("limit", String(limit));
      const qs = params.toString();
      return request<ADSearchUsersResult>(`/v1/ad/users${qs ? `?${qs}` : ""}`);
    },

    searchGroups(query?: string, limit?: number): Promise<ADSearchGroupsResult> {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (limit) params.set("limit", String(limit));
      const qs = params.toString();
      return request<ADSearchGroupsResult>(`/v1/ad/groups${qs ? `?${qs}` : ""}`);
    },
  },

  // Identity Provider status
  getIdentityProvider(): Promise<IdentityProvider> {
    return request<IdentityProvider>("/v1/identity-provider");
  },

  // LDAP authentication
  ldapAuth(credentials: LDAPAuthRequest): Promise<LDAPAuthResponse> {
    return request<LDAPAuthResponse>("/v1/auth/ldap", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
  },

  // Get session info and log login event
  getSession(): Promise<SessionInfo> {
    return request<SessionInfo>("/v1/auth/session");
  },

  // Settings endpoints
  settings: {
    getEntra(): Promise<EntraSettings> {
      return request<EntraSettings>("/v1/settings/entra");
    },

    saveEntra(settings: EntraSettingsRequest): Promise<{ status: string }> {
      return request<{ status: string }>("/v1/settings/entra", {
        method: "POST",
        body: JSON.stringify(settings),
      });
    },

    testEntra(settings?: EntraSettingsRequest): Promise<EntraTestResult> {
      return request<EntraTestResult>("/v1/settings/entra/test", {
        method: "POST",
        body: settings ? JSON.stringify(settings) : "{}",
      });
    },

    deleteEntra(): Promise<{ status: string }> {
      return request<{ status: string }>("/v1/settings/entra", {
        method: "DELETE",
      });
    },

    // Active Directory settings
    getAD(): Promise<ADConfig> {
      return request<ADConfig>("/v1/settings/ad");
    },

    saveAD(config: ADConfigRequest): Promise<ADConfig> {
      return request<ADConfig>("/v1/settings/ad", {
        method: "PUT",
        body: JSON.stringify(config),
      });
    },

    testAD(config?: ADConfigRequest): Promise<ADTestResult> {
      return request<ADTestResult>("/v1/settings/ad/test", {
        method: "POST",
        body: config ? JSON.stringify(config) : "{}",
      });
    },

    deleteAD(): Promise<{ status: string }> {
      return request<{ status: string }>("/v1/settings/ad", {
        method: "DELETE",
      });
    },

    // Backend Authentication settings
    getBackendAuth(): Promise<BackendAuthConfig> {
      return request<BackendAuthConfig>("/v1/settings/backend-auth");
    },

    updateBackendAuth(config: BackendAuthConfigRequest): Promise<BackendAuthConfig> {
      return request<BackendAuthConfig>("/v1/settings/backend-auth", {
        method: "PUT",
        body: JSON.stringify(config),
      });
    },

    uploadCACertificate(cert: CACertificateRequest): Promise<BackendAuthConfig> {
      return request<BackendAuthConfig>("/v1/settings/backend-auth/ca", {
        method: "POST",
        body: JSON.stringify(cert),
      });
    },

    removeCACertificate(): Promise<BackendAuthConfig> {
      return request<BackendAuthConfig>("/v1/settings/backend-auth/ca", {
        method: "DELETE",
      });
    },

    updateApprovalRequired(required: boolean): Promise<BackendAuthConfig> {
      return request<BackendAuthConfig>("/v1/settings/backend-auth/approval", {
        method: "PUT",
        body: JSON.stringify({ approval_required: required }),
      });
    },

    // Observability settings
    getObservability(): Promise<ObservabilityConfig> {
      return request<ObservabilityConfig>("/v1/settings/observability");
    },

    updateObservability(config: ObservabilityConfig): Promise<ObservabilityConfig> {
      return request<ObservabilityConfig>("/v1/settings/observability", {
        method: "PUT",
        body: JSON.stringify(config),
      });
    },
  },

  // Backend instance management
  backends: {
    list(status?: BackendInstanceStatus): Promise<BackendInstancesListResponse> {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const qs = params.toString();
      return request<BackendInstancesListResponse>(`/v1/cluster/backends${qs ? `?${qs}` : ""}`);
    },

    listPending(): Promise<{ instances: BackendInstance[]; total: number }> {
      return request<{ instances: BackendInstance[]; total: number }>("/v1/cluster/backends/pending");
    },

    get(instanceId: string): Promise<BackendInstance> {
      return request<BackendInstance>(`/v1/cluster/backends/${encodeURIComponent(instanceId)}`);
    },

    approve(instanceId: string): Promise<BackendInstance> {
      return request<BackendInstance>(`/v1/cluster/backends/${encodeURIComponent(instanceId)}/approve`, {
        method: "POST",
      });
    },

    reject(instanceId: string, reason?: string): Promise<BackendInstance> {
      return request<BackendInstance>(`/v1/cluster/backends/${encodeURIComponent(instanceId)}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },

    suspend(instanceId: string): Promise<BackendInstance> {
      return request<BackendInstance>(`/v1/cluster/backends/${encodeURIComponent(instanceId)}/suspend`, {
        method: "POST",
      });
    },

    unsuspend(instanceId: string): Promise<BackendInstance> {
      return request<BackendInstance>(`/v1/cluster/backends/${encodeURIComponent(instanceId)}/unsuspend`, {
        method: "POST",
      });
    },

    delete(instanceId: string): Promise<{ status: string }> {
      return request<{ status: string }>(`/v1/cluster/backends/${encodeURIComponent(instanceId)}`, {
        method: "DELETE",
      });
    },
  },

  // Auth configuration (public endpoint)
  auth: {
    getConfig(): Promise<EntraAuthConfig> {
      return request<EntraAuthConfig>("/v1/auth/config");
    },
  },

  // Simulation endpoints
  simulation: {
    /**
     * Run a policy simulation to see the impact of changes before activating.
     * @param appId Application ID
     * @param policyId Policy ID
     * @param request Simulation parameters including the new policy text
     */
    simulate(appId: number, policyId: number, req: SimulateRequest): Promise<SimulateResponse> {
      return request<SimulateResponse>(`/v1/apps/${appId}/policies/${policyId}/simulate`, {
        method: "POST",
        body: JSON.stringify(req),
      });
    },

    /**
     * List previous simulations for a policy.
     */
    list(appId: number, policyId: number, limit?: number): Promise<SimulationListResponse> {
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      const qs = params.toString();
      return request<SimulationListResponse>(`/v1/apps/${appId}/policies/${policyId}/simulations${qs ? `?${qs}` : ""}`);
    },

    /**
     * Get details of a specific simulation.
     */
    get(appId: number, policyId: number, simId: number): Promise<Simulation> {
      return request<Simulation>(`/v1/apps/${appId}/policies/${policyId}/simulations/${simId}`);
    },
  },
};
