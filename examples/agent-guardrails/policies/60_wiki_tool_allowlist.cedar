// Least-privilege Wiki guardrails.
permit (
    principal == AgentGuardrails::Agent::"agent-wiki",
    action == AgentGuardrails::Action::"wiki.read",
    resource in AgentGuardrails::Team::"allow-wiki-read-spaces"
) when {
    !(context has break_glass && context.break_glass)
};

permit (
    principal == AgentGuardrails::Agent::"agent-wiki",
    action == AgentGuardrails::Action::"wiki.write",
    resource in AgentGuardrails::Team::"allow-wiki-write-spaces"
) when {
    !(context has break_glass && context.break_glass)
};

permit (
    principal in AgentGuardrails::Team::"delegated-wiki-users",
    action in [
        AgentGuardrails::Action::"wiki.read",
        AgentGuardrails::Action::"wiki.write"
    ],
    resource in AgentGuardrails::Team::"allow-wiki-delegated-spaces"
) when {
    context has agent_id &&
    context.agent_id == "agent-wiki" &&
    context has delegated_user &&
    context.delegated_user == true
};
