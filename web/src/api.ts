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
  created_at: string;
};

export type CreateApplicationRequest = {
  name: string;
  namespace_id: number;
  description?: string;
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
  if (res.status === 401) {
    if (onAuthError) {
      onAuthError();
    }
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
  listApps(): Promise<Application[]> {
    return request<Application[]>("/v1/apps/");
  },

  createApp(payload: CreateApplicationRequest): Promise<{ id: number }> {
    return request<{ id: number }>("/v1/apps/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  createPolicy(appId: number, payload: CreatePolicyRequest): Promise<{ policy_id: number; version: number }> {
    return request<{ policy_id: number; version: number }>(`/v1/apps/${appId}/policies`, {
      method: "POST",
      body: JSON.stringify(payload),
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
};
