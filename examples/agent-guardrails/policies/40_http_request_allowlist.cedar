// Least-privilege HTTP guardrails.
// GET is allowlisted to approved read endpoints.
permit (
    principal == AgentGuardrails::Agent::"agent-http",
    action == AgentGuardrails::Action::"http.request.get",
    resource in AgentGuardrails::Team::"allow-http-get-endpoints"
) when {
    !(context has break_glass && context.break_glass)
};

// POST is allowlisted to approved write endpoints.
permit (
    principal == AgentGuardrails::Agent::"agent-http",
    action == AgentGuardrails::Action::"http.request.post",
    resource in AgentGuardrails::Team::"allow-http-post-endpoints"
) when {
    !(context has break_glass && context.break_glass)
};

permit (
    principal in AgentGuardrails::Team::"delegated-http-users",
    action in [
        AgentGuardrails::Action::"http.request.get",
        AgentGuardrails::Action::"http.request.post"
    ],
    resource in AgentGuardrails::Team::"allow-http-delegated-endpoints"
) when {
    context has agent_id &&
    context.agent_id == "agent-http" &&
    context has delegated_user &&
    context.delegated_user == true
};
