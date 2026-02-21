from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class EntityRef:
    """Entity reference used by Cedar authorization requests."""

    type: str
    id: str


@dataclass
class AuthorizationDecision:
    """Parsed decision response from /v1/authorize."""

    decision: str
    reasons: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def allowed(self) -> bool:
        return self.decision == "allow"

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "AuthorizationDecision":
        return cls(
            decision=str(data.get("decision", "deny")).lower(),
            reasons=[str(x) for x in (data.get("reasons") or [])],
            errors=[str(x) for x in (data.get("errors") or [])],
        )
