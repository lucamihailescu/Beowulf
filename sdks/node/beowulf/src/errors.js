export class BeowulfError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "BeowulfError";
    if (options.cause !== undefined) {
      // Keep compatibility with older runtimes that may not support Error.cause in ctor.
      this.cause = options.cause;
    }
  }
}

export class BeowulfConfigurationError extends BeowulfError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "BeowulfConfigurationError";
  }
}

export class BeowulfApiError extends BeowulfError {
  /**
   * @param {string} message
   * @param {{ statusCode?: number, responseBody?: string, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "BeowulfApiError";
    this.statusCode = options.statusCode;
    this.responseBody = options.responseBody;
  }
}
