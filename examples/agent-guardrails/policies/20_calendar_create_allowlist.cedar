// Least-privilege calendar guardrails.
permit (
    principal == AgentGuardrails::Agent::"agent-calendar",
    action == AgentGuardrails::Action::"calendar.create",
    resource in AgentGuardrails::Team::"allow-calendar-targets"
) when {
    !(context has break_glass && context.break_glass)
};

permit (
    principal in AgentGuardrails::Team::"delegated-calendar-users",
    action == AgentGuardrails::Action::"calendar.create",
    resource in AgentGuardrails::Team::"allow-calendar-targets"
) when {
    context has agent_id &&
    context.agent_id == "agent-calendar" &&
    context has delegated_user &&
    context.delegated_user == true
};
