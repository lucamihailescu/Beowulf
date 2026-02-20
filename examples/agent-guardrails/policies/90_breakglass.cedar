// Break-glass policy: controlled emergency override.
// Runtime contract requirement:
// - context.request_epoch: current epoch seconds
// - context.expires_at: override expiration epoch seconds
// - context.ticket_id, context.reason, context.approved_by: non-empty strings

permit (
    principal in AgentGuardrails::Team::"breakglass-operators",
    action,
    resource
) when {
    context has break_glass &&
    context.break_glass == true &&
    context has ticket_id &&
    context.ticket_id != "" &&
    context has reason &&
    context.reason != "" &&
    context has approved_by &&
    context.approved_by != "" &&
    context has request_epoch &&
    context has expires_at &&
    context.expires_at > context.request_epoch &&
    // Keep emergency override to <= 15 minutes.
    context.expires_at <= context.request_epoch + 900
};

// Prevent malformed break-glass attempts.
forbid (
    principal,
    action,
    resource
) when {
    context has break_glass &&
    context.break_glass == true &&
    (
        !(context has ticket_id) ||
        context.ticket_id == "" ||
        !(context has reason) ||
        context.reason == "" ||
        !(context has approved_by) ||
        context.approved_by == "" ||
        !(context has request_epoch) ||
        !(context has expires_at)
    )
};
