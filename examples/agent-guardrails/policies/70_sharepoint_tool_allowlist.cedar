// Least-privilege SharePoint guardrails.
permit (
    principal == AgentGuardrails::Agent::"agent-sharepoint",
    action == AgentGuardrails::Action::"sharepoint.read",
    resource in AgentGuardrails::Team::"allow-sharepoint-read"
) when {
    !(context has break_glass && context.break_glass)
};

permit (
    principal == AgentGuardrails::Agent::"agent-sharepoint",
    action == AgentGuardrails::Action::"sharepoint.write",
    resource in AgentGuardrails::Team::"allow-sharepoint-write"
) when {
    !(context has break_glass && context.break_glass)
};

permit (
    principal in AgentGuardrails::Team::"delegated-sharepoint-users",
    action in [
        AgentGuardrails::Action::"sharepoint.read",
        AgentGuardrails::Action::"sharepoint.write"
    ],
    resource in AgentGuardrails::Team::"allow-sharepoint-delegated"
) when {
    context has agent_id &&
    context.agent_id == "agent-sharepoint" &&
    context has delegated_user &&
    context.delegated_user == true
};
