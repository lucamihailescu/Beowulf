import { BeowulfApiError, BeowulfConfigurationError } from "./errors.js";
import { AuthorizationDecision } from "./models.js";

/**
 * @typedef {{ type: string, id: string }} EntityRef
 */

/**
 * @typedef {{
 *   token?: string,
 *   pdp?: string,
 *   applicationId?: number,
 *   timeout?: number,
 *   headers?: Record<string, string>,
 *   tokenHeader?: string,
 *   fetchImpl?: typeof fetch
 * }} BeowulfConfig
 */

export class Beowulf {
  /**
   * @param {BeowulfConfig} [config]
   */
  constructor(config = {}) {
    this.baseUrl = (config.pdp ?? "http://localhost:8080").replace(/\/+$/, "");
    this.applicationId = config.applicationId ?? null;
    this.timeout = Number.isFinite(config.timeout) ? Number(config.timeout) : 5000;
    this.tokenHeader = config.tokenHeader ?? "X-API-Key";
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new BeowulfConfigurationError(
        "fetch implementation is not available. Use Node.js >= 18 or pass fetchImpl."
      );
    }

    this.headers = { ...(config.headers ?? {}) };
    if (config.token) {
      this.headers[this.tokenHeader] = config.token;
    }
  }

  /**
   * @returns {Beowulf}
   */
  static fromEnv() {
    const baseUrl = process.env.CEDAR_BASE_URL?.trim() || "http://localhost:8080";
    const appIdRaw = process.env.CEDAR_APP_ID?.trim();
    const appId = appIdRaw ? Number(appIdRaw) : null;
    if (appIdRaw && !Number.isFinite(appId)) {
      throw new BeowulfConfigurationError(`invalid CEDAR_APP_ID value: ${appIdRaw}`);
    }

    const token = process.env.CEDAR_APP_API_KEY || process.env.CEDAR_API_KEY || undefined;
    const headers = {};
    if (process.env.CEDAR_BEARER_TOKEN) {
      headers.Authorization = `Bearer ${process.env.CEDAR_BEARER_TOKEN}`;
    }
    return new Beowulf({
      token,
      pdp: baseUrl,
      applicationId: appId,
      headers,
    });
  }

  /**
   * @param {string | Record<string, unknown>} user
   * @param {string | Record<string, unknown>} action
   * @param {string | Record<string, unknown>} resource
   * @param {{
   *   context?: Record<string, unknown>,
   *   applicationId?: number,
   *   principalType?: string,
   *   actionType?: string,
   *   resourceType?: string
   * }} [options]
   * @returns {Promise<boolean>}
   */
  async check(user, action, resource, options = {}) {
    const decision = await this.authorize(user, action, resource, options);
    return decision.allowed;
  }

  /**
   * @param {string | Record<string, unknown>} user
   * @param {string | Record<string, unknown>} action
   * @param {string | Record<string, unknown>} resource
   * @param {{
   *   context?: Record<string, unknown>,
   *   applicationId?: number,
   *   principalType?: string,
   *   actionType?: string,
   *   resourceType?: string
   * }} [options]
   * @returns {Promise<AuthorizationDecision>}
   */
  async authorize(user, action, resource, options = {}) {
    const appId = this.#resolveApplicationId(options.applicationId);
    const principal = this.#normalizeEntity(user, options.principalType ?? "User", "principal");
    const normalizedAction = this.#normalizeEntity(action, options.actionType ?? "Action", "action");
    const normalizedResource = this.#normalizeEntity(
      resource,
      options.resourceType ?? "Resource",
      "resource"
    );
    const payload = {
      application_id: appId,
      principal,
      action: normalizedAction,
      resource: normalizedResource,
      context: options.context ?? {},
    };
    const body = await this.#postJson("/v1/authorize", payload);
    return new AuthorizationDecision(body);
  }

  /**
   * @param {string} username
   * @param {{
   *   groups?: string[],
   *   includeInherited?: boolean,
   *   applicationId?: number
   * }} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getEntitlements(username, options = {}) {
    if (!username || !String(username).trim()) {
      throw new BeowulfConfigurationError("username cannot be empty");
    }
    const appId = this.#resolveApplicationId(options.applicationId);
    const payload = {
      application_id: appId,
      username,
      groups: options.groups ?? [],
      include_inherited: options.includeInherited ?? true,
    };
    return this.#postJson("/v1/entitlements", payload);
  }

  close() {
    // No persistent sockets/resources to explicitly dispose in fetch-only client.
  }

  /**
   * @param {number | undefined} requestAppId
   * @returns {number}
   */
  #resolveApplicationId(requestAppId) {
    const id = requestAppId ?? this.applicationId;
    if (!Number.isFinite(id)) {
      throw new BeowulfConfigurationError(
        "applicationId is required. Set it in Beowulf(...) or pass it per request."
      );
    }
    return Number(id);
  }

  /**
   * @param {string | Record<string, unknown>} input
   * @param {string} defaultType
   * @param {"principal" | "action" | "resource"} kind
   * @returns {EntityRef}
   */
  #normalizeEntity(input, defaultType, kind) {
    if (typeof input === "string") {
      if (!input.trim()) {
        throw new BeowulfConfigurationError(`${kind} cannot be empty`);
      }
      return { type: defaultType, id: input };
    }

    if (!input || typeof input !== "object") {
      throw new BeowulfConfigurationError(
        `${kind} must be a string or object with id/key and optional type`
      );
    }

    const type = this.#pickString(input, ["type", `${kind}_type`, `${kind}Type`]) ?? defaultType;
    const id = this.#pickString(input, ["id", "key", `${kind}_id`, `${kind}Id`]);
    if (!id) {
      throw new BeowulfConfigurationError(
        `${kind} mapping must include one of: id, key, ${kind}_id, ${kind}Id`
      );
    }
    return { type, id };
  }

  /**
   * @param {Record<string, unknown>} obj
   * @param {string[]} keys
   * @returns {string | null}
   */
  #pickString(obj, keys) {
    for (const key of keys) {
      if (!key) continue;
      if (!(key in obj)) continue;
      const raw = obj[key];
      if (raw === undefined || raw === null) continue;
      const value = String(raw).trim();
      if (value) return value;
    }
    return null;
  }

  /**
   * @param {string} path
   * @param {Record<string, unknown>} payload
   * @returns {Promise<Record<string, unknown>>}
   */
  async #postJson(path, payload) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const headers = {
      "Content-Type": "application/json",
      ...this.headers,
    };

    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      throw new BeowulfApiError(`request failed for ${path}: ${String(error)}`, { cause: error });
    } finally {
      clearTimeout(timeoutId);
    }

    const rawBody = await response.text();
    const parsed = this.#tryParseJsonObject(rawBody);
    if (response.ok) {
      if (!parsed) {
        throw new BeowulfApiError("backend returned non-JSON response", {
          statusCode: response.status,
          responseBody: rawBody,
        });
      }
      return parsed;
    }

    const detail = parsed?.error || parsed?.message || rawBody || `HTTP ${response.status}`;
    throw new BeowulfApiError(`backend request failed: ${String(detail)}`, {
      statusCode: response.status,
      responseBody: rawBody,
    });
  }

  /**
   * @param {string} text
   * @returns {Record<string, unknown> | null}
   */
  #tryParseJsonObject(text) {
    if (!text || !text.trim()) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore parse errors and return null.
    }
    return null;
  }
}
