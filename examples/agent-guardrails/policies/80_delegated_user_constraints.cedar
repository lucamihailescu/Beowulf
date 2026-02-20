// Global delegated-user safety constraints.
// These forbids enforce runtime context hygiene for User principals.

forbid (
    principal,
    action,
    resource
) when {
    principal is AgentGuardrails::User &&
    !(context has break_glass && context.break_glass) &&
    !(context has delegated_user && context.delegated_user == true)
};

forbid (
    principal,
    action,
    resource
) when {
    principal is AgentGuardrails::User &&
    !(context has break_glass && context.break_glass) &&
    !(context has agent_id) 
};

forbid (
    principal,
    action,
    resource
) when {
    principal is AgentGuardrails::User &&
    !(context has break_glass && context.break_glass) &&
    context has agent_id &&
    context.agent_id == ""
};
