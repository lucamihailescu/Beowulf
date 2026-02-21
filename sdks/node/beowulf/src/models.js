export class AuthorizationDecision {
  /**
   * @param {{ decision?: string, reasons?: unknown[], errors?: unknown[] }} input
   */
  constructor(input = {}) {
    this.decision = String(input.decision ?? "");
    this.reasons = Array.isArray(input.reasons) ? input.reasons : [];
    this.errors = Array.isArray(input.errors) ? input.errors : [];
  }

  /**
   * @returns {boolean}
   */
  get allowed() {
    return this.decision.toLowerCase() === "allow";
  }
}
