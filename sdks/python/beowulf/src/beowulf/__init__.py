"""
Beowulf SDK for Cedar authorization runtime integration.

Example:
    import asyncio
    from beowulf import Beowulf

    async def main() -> None:
        client = Beowulf(token="cedar_app_...", pdp="http://localhost:8080", application_id=1)
        allowed = await client.check("alice", "email.send", {"type": "EmailAddress", "id": "foo@bar.com"})
        print("allowed=", allowed)
        await client.aclose()

    asyncio.run(main())
"""

from .client import Beowulf
from .exceptions import BeowulfAPIError, BeowulfConfigurationError, BeowulfError
from .models import AuthorizationDecision, EntityRef

__all__ = [
    "AuthorizationDecision",
    "Beowulf",
    "BeowulfAPIError",
    "BeowulfConfigurationError",
    "BeowulfError",
    "EntityRef",
]
