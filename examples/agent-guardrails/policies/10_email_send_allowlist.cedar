// Least-privilege email guardrails.
// Service-agent flow: only the mail agent may send, and only to allowlisted recipients.
permit (
    principal == AgentGuardrails::Agent::"agent-mailer",
    action == AgentGuardrails::Action::"email.send",
    resource in AgentGuardrails::Team::"allow-email-foo-bar"
) when {
    !(context has break_glass && context.break_glass)
};

// Delegated-user flow: approved human users may send only through the approved agent.
permit (
    principal in AgentGuardrails::Team::"delegated-email-users",
    action == AgentGuardrails::Action::"email.send",
    resource in AgentGuardrails::Team::"allow-email-foo-bar"
) when {
    context has agent_id &&
    context.agent_id == "agent-mailer" &&
    context has delegated_user &&
    context.delegated_user == true
};
