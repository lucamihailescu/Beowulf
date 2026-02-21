# Beowulf Python SDK

`beowulf` is a Python SDK for integrating applications and agents with this Cedar authorization backend.

It is intentionally modeled after common authorization SDK usage (for example Permit-style `check()` flows), while mapping requests to this backend's `/v1/authorize` and `/v1/entitlements` APIs.

## Install

From the repository root:

```bash
pip install -e sdks/python/beowulf
```

## Quickstart (Async)

This usage pattern mirrors the "initialize SDK, then run `check()`" approach often used in authorization clients.

```python
import asyncio
from beowulf import Beowulf


async def main() -> None:
    client = Beowulf(
        token="cedar_app_10_xxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyy",  # runtime API key
        pdp="http://localhost:8080",
        application_id=10,
    )

    permitted = await client.check(
        "john@smith.com",                    # user
        "atomic.demo.approve",               # action id
        {"type": "Tool", "id": "atomic:target"},  # resource
    )

    if permitted:
        print("John is permitted")
    else:
        print("John is NOT permitted")

    await client.aclose()


asyncio.run(main())
```

## Quickstart (Sync)

```python
from beowulf import Beowulf

client = Beowulf(
    token="cedar_app_10_xxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    pdp="http://localhost:8080",
    application_id=10,
)

allowed = client.check_sync(
    "atomic_allow_user",
    "atomic.demo.approve",
    {"type": "Tool", "id": "atomic:target"},
)
print("allowed=", allowed)
client.close()
```

## Client Initialization

```python
from beowulf import Beowulf

client = Beowulf(
    token="<runtime-api-key>",          # sent as X-API-Key by default
    pdp="http://localhost:8080",        # Cedar backend base URL
    application_id=1,                   # default app id for calls
    timeout=5.0,                        # request timeout
)
```

You can also initialize from environment variables:

```python
from beowulf import Beowulf

client = Beowulf.from_env()
```

Supported env vars:
- `CEDAR_BASE_URL`
- `CEDAR_APP_ID`
- `CEDAR_APP_API_KEY` (preferred runtime key)
- `CEDAR_API_KEY` (fallback)
- `CEDAR_BEARER_TOKEN` (optional; sent as `Authorization: Bearer ...`)

## API

### `await client.check(user, action, resource, ...) -> bool`

Runs an authorization decision and returns `True` when decision is `allow`.

Accepted inputs:
- `user`: `str` or mapping (`{"id": "...", "type": "User"}` or `{"key": "..."}`)
- `action`: `str` or mapping (`{"id": "...", "type": "Action"}`)
- `resource`: `str` or mapping (`{"id": "...", "type": "Tool"}`)

If string inputs are used:
- user defaults to type `User`
- action defaults to type `Action`
- resource defaults to type `Resource`

### `await client.authorize(...) -> AuthorizationDecision`

Returns full response:

```python
decision = await client.authorize(
    user="alice",
    action="view",
    resource={"type": "Document", "id": "doc-1"},
    context={"request_id": "req-123"},
)

print(decision.decision)  # "allow" or "deny"
print(decision.reasons)
print(decision.errors)
```

### `await client.get_entitlements(username, ...) -> dict`

Calls `/v1/entitlements` for user/group entitlement lookup.

## Important Authentication Notes

- Runtime application API keys (`cedar_app_*`) are intended for runtime decision endpoints (`/v1/authorize`, `/v1/entitlements`).
- Policy management endpoints (for example creating policy versions) typically require admin/user auth context, such as Bearer token flows.

## Error Handling

```python
from beowulf import Beowulf, BeowulfAPIError, BeowulfConfigurationError

try:
    client = Beowulf.from_env()
    allowed = client.check_sync("alice", "view", {"type": "Document", "id": "doc-1"})
except BeowulfConfigurationError as exc:
    print("Configuration error:", exc)
except BeowulfAPIError as exc:
    print("API error:", exc.status_code, exc.response_body)
```
