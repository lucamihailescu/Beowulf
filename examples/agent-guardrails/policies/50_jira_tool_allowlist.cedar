// Least-privilege JIRA guardrails.
permit (
    principal == AgentGuardrails::Agent::"agent-jira",
    action == AgentGuardrails::Action::"jira.read",
    resource in AgentGuardrails::Team::"allow-jira-read-projects"
) when {
    !(context has break_glass && context.break_glass)
};

permit (
    principal == AgentGuardrails::Agent::"agent-jira",
    action == AgentGuardrails::Action::"jira.write",
    resource in AgentGuardrails::Team::"allow-jira-write-projects"
) when {
    !(context has break_glass && context.break_glass)
};

permit (
    principal in AgentGuardrails::Team::"delegated-jira-users",
    action in [
        AgentGuardrails::Action::"jira.read",
        AgentGuardrails::Action::"jira.write"
    ],
    resource in AgentGuardrails::Team::"allow-jira-delegated-projects"
) when {
    context has agent_id &&
    context.agent_id == "agent-jira" &&
    context has delegated_user &&
    context.delegated_user == true
};
