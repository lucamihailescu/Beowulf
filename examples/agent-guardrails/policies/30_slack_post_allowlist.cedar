// Least-privilege Slack posting guardrails.
permit (
    principal == AgentGuardrails::Agent::"agent-slack",
    action == AgentGuardrails::Action::"slack.post",
    resource in AgentGuardrails::Team::"allow-slack-channels"
) when {
    !(context has break_glass && context.break_glass)
};

permit (
    principal in AgentGuardrails::Team::"delegated-slack-users",
    action == AgentGuardrails::Action::"slack.post",
    resource in AgentGuardrails::Team::"allow-slack-channels"
) when {
    context has agent_id &&
    context.agent_id == "agent-slack" &&
    context has delegated_user &&
    context.delegated_user == true
};
