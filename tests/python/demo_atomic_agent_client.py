#!/usr/bin/env python3
"""
Atomic Agents demo client harness for the FastMCP integration tests.

Provides:
- deterministic MCP tool calls (always available),
- optional live-LLM orchestration path via atomic-agents.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        # FastMCP tool results can be wrapped as {"type":"text","text":"{...json...}"}.
        text_value = value.get("text")
        if isinstance(text_value, str):
            try:
                decoded = json.loads(text_value)
                if isinstance(decoded, dict):
                    return decoded
            except Exception:
                pass
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, dict) else {"value": decoded}
        except Exception:
            return {"value": value}
    if isinstance(value, list):
        for item in value:
            parsed = _as_dict(item)
            if parsed:
                return parsed
        return {"value": value}
    if hasattr(value, "model_dump"):
        dumped = value.model_dump()
        return _as_dict(dumped) if isinstance(dumped, dict) else {"value": dumped}
    if hasattr(value, "dict"):
        dumped = value.dict()
        return _as_dict(dumped) if isinstance(dumped, dict) else {"value": dumped}
    if hasattr(value, "text"):
        return _as_dict(getattr(value, "text"))
    if hasattr(value, "content"):
        return _as_dict(getattr(value, "content"))
    if hasattr(value, "data"):
        return _as_dict(getattr(value, "data"))
    return {"value": str(value)}


async def _call_tool_async(server_url: str, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    from fastmcp import Client

    arguments = arguments or {}
    timeout_seconds = float(os.getenv("FASTMCP_DEMO_CLIENT_TIMEOUT_SECONDS", "3"))
    candidates = []
    if server_url.endswith("/mcp"):
        candidates = [server_url, server_url[:-4]]
    else:
        candidates = [server_url, f"{server_url.rstrip('/')}/mcp"]

    last_exc: Exception | None = None
    for url in candidates:
        try:
            async def _single_attempt() -> dict[str, Any]:
                async with Client(url) as client:
                    result = await client.call_tool(name=name, arguments=arguments)
                    return _as_dict(result)

            return await asyncio.wait_for(_single_attempt(), timeout=timeout_seconds)
        except Exception as exc:
            last_exc = exc
    if last_exc:
        raise last_exc
    raise RuntimeError("unable to call MCP tool")


def call_tool(server_url: str, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    return asyncio.run(_call_tool_async(server_url=server_url, name=name, arguments=arguments))


@dataclass
class AtomicDecisionHarness:
    server_url: str

    def healthcheck(self) -> dict[str, Any]:
        return call_tool(self.server_url, "healthcheck", {})

    def set_auth_mode(self, mode: str) -> dict[str, Any]:
        return call_tool(self.server_url, "set_demo_auth_mode", {"mode": mode})

    def deterministic_decide(
        self,
        *,
        user_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        principal_type: str = "User",
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "user_id": user_id,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "principal_type": principal_type,
            "context": context or {},
        }
        return call_tool(self.server_url, "decide_action", payload)

    @staticmethod
    def live_llm_available() -> bool:
        return bool(os.getenv("OPENAI_API_KEY", "").strip())

    def live_llm_decide(
        self,
        *,
        instruction: str,
        fallback_request: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Optional live path using atomic-agents.

        If dependencies or provider configuration are missing, returns:
          {"status":"skipped","reason":"..."}
        """

        if not self.live_llm_available():
            return {"status": "skipped", "reason": "OPENAI_API_KEY not set"}

        try:
            import instructor
            from openai import OpenAI
            from pydantic import Field

            from atomic_agents import AgentConfig, AtomicAgent, BaseIOSchema, BasicChatInputSchema
            from atomic_agents.context import ChatHistory, SystemPromptGenerator
        except Exception as exc:
            return {"status": "skipped", "reason": f"live dependencies unavailable: {exc}"}

        class DecisionRequestSchema(BaseIOSchema):
            user_id: str = Field(..., description="Principal identifier")
            action: str = Field(..., description="Action identifier")
            resource_type: str = Field(..., description="Resource type")
            resource_id: str = Field(..., description="Resource identifier")
            principal_type: str = Field(default="User", description="Principal type")

        try:
            agent = AtomicAgent[BasicChatInputSchema, DecisionRequestSchema](
                config=AgentConfig(
                    client=instructor.from_openai(OpenAI()),
                    model=os.getenv("ATOMIC_AGENT_MODEL", "gpt-5-mini"),
                    system_prompt_generator=SystemPromptGenerator(
                        background=[
                            "You produce authorization decision request fields for an MCP authorization tool."
                        ],
                        steps=[
                            "Read the instruction and output one complete decision request object.",
                            "Keep values concise and avoid adding unknown fields.",
                        ],
                        output_instructions=[
                            "Return only fields required by the output schema.",
                        ],
                    ),
                    history=ChatHistory(),
                )
            )
            response = agent.run(BasicChatInputSchema(chat_message=instruction))
            generated = {
                "user_id": getattr(response, "user_id", fallback_request["user_id"]),
                "action": getattr(response, "action", fallback_request["action"]),
                "resource_type": getattr(response, "resource_type", fallback_request["resource_type"]),
                "resource_id": getattr(response, "resource_id", fallback_request["resource_id"]),
                "principal_type": getattr(response, "principal_type", fallback_request.get("principal_type", "User")),
            }
        except Exception as exc:
            return {"status": "skipped", "reason": f"atomic-agents live path failed: {exc}"}

        decided = self.deterministic_decide(
            user_id=generated["user_id"],
            action=generated["action"],
            resource_type=generated["resource_type"],
            resource_id=generated["resource_id"],
            principal_type=generated["principal_type"],
            context=fallback_request.get("context", {}),
        )
        decided["status"] = decided.get("status", "ok")
        decided["generated_request"] = generated
        return decided


if __name__ == "__main__":
    url = os.getenv("FASTMCP_DEMO_URL", "http://127.0.0.1:8765/mcp")
    harness = AtomicDecisionHarness(server_url=url)
    print(json.dumps(harness.healthcheck(), indent=2))
