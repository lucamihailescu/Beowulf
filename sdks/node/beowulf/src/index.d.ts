export interface EntityRef {
  type: string;
  id: string;
}

export interface AuthorizationDecisionInput {
  decision?: string;
  reasons?: unknown[];
  errors?: unknown[];
}

export class AuthorizationDecision {
  constructor(input?: AuthorizationDecisionInput);
  decision: string;
  reasons: unknown[];
  errors: unknown[];
  get allowed(): boolean;
}

export class BeowulfError extends Error {}

export class BeowulfConfigurationError extends BeowulfError {}

export class BeowulfApiError extends BeowulfError {
  constructor(
    message: string,
    options?: {
      statusCode?: number;
      responseBody?: string;
      cause?: unknown;
    }
  );
  statusCode?: number;
  responseBody?: string;
}

export interface BeowulfConfig {
  token?: string;
  pdp?: string;
  applicationId?: number;
  timeout?: number;
  headers?: Record<string, string>;
  tokenHeader?: string;
  fetchImpl?: typeof fetch;
}

export interface AuthorizeOptions {
  context?: Record<string, unknown>;
  applicationId?: number;
  principalType?: string;
  actionType?: string;
  resourceType?: string;
}

export interface EntitlementsOptions {
  groups?: string[];
  includeInherited?: boolean;
  applicationId?: number;
}

export class Beowulf {
  constructor(config?: BeowulfConfig);
  static fromEnv(): Beowulf;

  baseUrl: string;
  applicationId: number | null;
  timeout: number;

  check(
    user: string | Record<string, unknown>,
    action: string | Record<string, unknown>,
    resource: string | Record<string, unknown>,
    options?: AuthorizeOptions
  ): Promise<boolean>;

  authorize(
    user: string | Record<string, unknown>,
    action: string | Record<string, unknown>,
    resource: string | Record<string, unknown>,
    options?: AuthorizeOptions
  ): Promise<AuthorizationDecision>;

  getEntitlements(username: string, options?: EntitlementsOptions): Promise<Record<string, unknown>>;
  close(): void;
}
