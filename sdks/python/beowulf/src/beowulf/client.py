from __future__ import annotations

import os
from typing import Any, Mapping

import httpx

from .exceptions import BeowulfAPIError, BeowulfConfigurationError
from .models import AuthorizationDecision, EntityRef


UserInput = str | Mapping[str, Any]
ActionInput = str | Mapping[str, Any]
ResourceInput = str | Mapping[str, Any]


class Beowulf:
    """
    Async-first SDK client for Cedar authorization checks.

    The API is intentionally similar to common authorization SDKs:
    - `await client.check(user, action, resource)`
    - `await client.authorize(...)` for full decision payload
    """

    def __init__(
        self,
        *,
        token: str | None = None,
        pdp: str = "http://localhost:8080",
        application_id: int | None = None,
        timeout: float = 5.0,
        headers: Mapping[str, str] | None = None,
        token_header: str = "X-API-Key",
    ):
        self.base_url = pdp.rstrip("/")
        self.application_id = application_id
        self.timeout = timeout

        default_headers: dict[str, str] = dict(headers or {})
        if token:
            default_headers[token_header] = token

        self._headers = default_headers
        self._sync_client = httpx.Client(base_url=self.base_url, timeout=self.timeout, headers=self._headers)
        self._async_client = httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout, headers=self._headers)

    @classmethod
    def from_env(cls) -> "Beowulf":
        base_url = os.getenv("CEDAR_BASE_URL", "http://localhost:8080")
        app_id_raw = os.getenv("CEDAR_APP_ID", "").strip()
        app_id = int(app_id_raw) if app_id_raw else None
        token = os.getenv("CEDAR_APP_API_KEY") or os.getenv("CEDAR_API_KEY")
        bearer = os.getenv("CEDAR_BEARER_TOKEN")
        headers: dict[str, str] = {}
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        return cls(token=token, pdp=base_url, application_id=app_id, headers=headers)

    async def check(
        self,
        user: UserInput,
        action: ActionInput,
        resource: ResourceInput,
        *,
        context: Mapping[str, Any] | None = None,
        application_id: int | None = None,
        principal_type: str = "User",
        action_type: str = "Action",
        resource_type: str = "Resource",
    ) -> bool:
        decision = await self.authorize(
            user=user,
            action=action,
            resource=resource,
            context=context,
            application_id=application_id,
            principal_type=principal_type,
            action_type=action_type,
            resource_type=resource_type,
        )
        return decision.allowed

    async def authorize(
        self,
        *,
        user: UserInput,
        action: ActionInput,
        resource: ResourceInput,
        context: Mapping[str, Any] | None = None,
        application_id: int | None = None,
        principal_type: str = "User",
        action_type: str = "Action",
        resource_type: str = "Resource",
    ) -> AuthorizationDecision:
        app_id = self._resolve_application_id(application_id)
        principal_ref = self._normalize_user(user, default_type=principal_type)
        action_ref = self._normalize_action(action, default_type=action_type)
        resource_ref = self._normalize_resource(resource, default_type=resource_type)

        payload = {
            "application_id": app_id,
            "principal": {"type": principal_ref.type, "id": principal_ref.id},
            "action": {"type": action_ref.type, "id": action_ref.id},
            "resource": {"type": resource_ref.type, "id": resource_ref.id},
            "context": dict(context or {}),
        }
        body = await self._post_json_async("/v1/authorize", payload)
        return AuthorizationDecision.from_json(body)

    def check_sync(
        self,
        user: UserInput,
        action: ActionInput,
        resource: ResourceInput,
        *,
        context: Mapping[str, Any] | None = None,
        application_id: int | None = None,
        principal_type: str = "User",
        action_type: str = "Action",
        resource_type: str = "Resource",
    ) -> bool:
        decision = self.authorize_sync(
            user=user,
            action=action,
            resource=resource,
            context=context,
            application_id=application_id,
            principal_type=principal_type,
            action_type=action_type,
            resource_type=resource_type,
        )
        return decision.allowed

    def authorize_sync(
        self,
        *,
        user: UserInput,
        action: ActionInput,
        resource: ResourceInput,
        context: Mapping[str, Any] | None = None,
        application_id: int | None = None,
        principal_type: str = "User",
        action_type: str = "Action",
        resource_type: str = "Resource",
    ) -> AuthorizationDecision:
        app_id = self._resolve_application_id(application_id)
        principal_ref = self._normalize_user(user, default_type=principal_type)
        action_ref = self._normalize_action(action, default_type=action_type)
        resource_ref = self._normalize_resource(resource, default_type=resource_type)

        payload = {
            "application_id": app_id,
            "principal": {"type": principal_ref.type, "id": principal_ref.id},
            "action": {"type": action_ref.type, "id": action_ref.id},
            "resource": {"type": resource_ref.type, "id": resource_ref.id},
            "context": dict(context or {}),
        }
        body = self._post_json_sync("/v1/authorize", payload)
        return AuthorizationDecision.from_json(body)

    def authorize_with_metadata_sync(
        self,
        *,
        user: UserInput,
        action: ActionInput,
        resource: ResourceInput,
        context: Mapping[str, Any] | None = None,
        application_id: int | None = None,
        principal_type: str = "User",
        action_type: str = "Action",
        resource_type: str = "Resource",
    ) -> tuple[AuthorizationDecision, dict[str, str]]:
        """
        Sync authorize variant that also returns response headers.

        Useful for diagnostics where callers need transport metadata such as
        `X-Cedar-Cache`.
        """
        app_id = self._resolve_application_id(application_id)
        principal_ref = self._normalize_user(user, default_type=principal_type)
        action_ref = self._normalize_action(action, default_type=action_type)
        resource_ref = self._normalize_resource(resource, default_type=resource_type)

        payload = {
            "application_id": app_id,
            "principal": {"type": principal_ref.type, "id": principal_ref.id},
            "action": {"type": action_ref.type, "id": action_ref.id},
            "resource": {"type": resource_ref.type, "id": resource_ref.id},
            "context": dict(context or {}),
        }
        try:
            response = self._sync_client.post("/v1/authorize", json=payload)
        except httpx.HTTPError as exc:
            raise BeowulfAPIError(f"request failed for /v1/authorize: {exc}") from exc
        body = self._handle_response(response)
        return AuthorizationDecision.from_json(body), dict(response.headers)

    async def get_entitlements(
        self,
        username: str,
        *,
        groups: list[str] | None = None,
        include_inherited: bool = True,
        application_id: int | None = None,
    ) -> dict[str, Any]:
        app_id = self._resolve_application_id(application_id)
        payload = {
            "application_id": app_id,
            "username": username,
            "groups": groups or [],
            "include_inherited": include_inherited,
        }
        return await self._post_json_async("/v1/entitlements", payload)

    def get_entitlements_sync(
        self,
        username: str,
        *,
        groups: list[str] | None = None,
        include_inherited: bool = True,
        application_id: int | None = None,
    ) -> dict[str, Any]:
        app_id = self._resolve_application_id(application_id)
        payload = {
            "application_id": app_id,
            "username": username,
            "groups": groups or [],
            "include_inherited": include_inherited,
        }
        return self._post_json_sync("/v1/entitlements", payload)

    async def aclose(self) -> None:
        await self._async_client.aclose()

    def close(self) -> None:
        self._sync_client.close()

    async def __aenter__(self) -> "Beowulf":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.aclose()

    def __enter__(self) -> "Beowulf":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def _resolve_application_id(self, application_id: int | None) -> int:
        app_id = application_id if application_id is not None else self.application_id
        if app_id is None:
            raise BeowulfConfigurationError(
                "application_id is required. Pass it to Beowulf(...) or per request."
            )
        return int(app_id)

    @staticmethod
    def _normalize_user(user: UserInput, *, default_type: str) -> EntityRef:
        if isinstance(user, str):
            if not user:
                raise BeowulfConfigurationError("user cannot be empty")
            return EntityRef(type=default_type, id=user)

        user_type = str(user.get("type") or user.get("principal_type") or default_type).strip()
        user_id = str(user.get("id") or user.get("key") or user.get("user_id") or "").strip()
        if not user_id:
            raise BeowulfConfigurationError("user mapping must include one of: id, key, user_id")
        return EntityRef(type=user_type, id=user_id)

    @staticmethod
    def _normalize_action(action: ActionInput, *, default_type: str) -> EntityRef:
        if isinstance(action, str):
            if not action:
                raise BeowulfConfigurationError("action cannot be empty")
            return EntityRef(type=default_type, id=action)

        action_type = str(action.get("type") or action.get("action_type") or default_type).strip()
        action_id = str(action.get("id") or action.get("key") or action.get("name") or "").strip()
        if not action_id:
            raise BeowulfConfigurationError("action mapping must include one of: id, key, name")
        return EntityRef(type=action_type, id=action_id)

    @staticmethod
    def _normalize_resource(resource: ResourceInput, *, default_type: str) -> EntityRef:
        if isinstance(resource, str):
            if not resource:
                raise BeowulfConfigurationError("resource cannot be empty")
            return EntityRef(type=default_type, id=resource)

        resource_type = str(resource.get("type") or resource.get("resource_type") or default_type).strip()
        resource_id = str(resource.get("id") or resource.get("key") or resource.get("name") or "").strip()
        if not resource_id:
            raise BeowulfConfigurationError("resource mapping must include one of: id, key, name")
        return EntityRef(type=resource_type, id=resource_id)

    async def _post_json_async(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self._async_client.post(path, json=payload)
        except httpx.HTTPError as exc:
            raise BeowulfAPIError(f"request failed for {path}: {exc}") from exc
        return self._handle_response(response)

    def _post_json_sync(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._sync_client.post(path, json=payload)
        except httpx.HTTPError as exc:
            raise BeowulfAPIError(f"request failed for {path}: {exc}") from exc
        return self._handle_response(response)

    @staticmethod
    def _handle_response(response: httpx.Response) -> dict[str, Any]:
        if response.is_success:
            try:
                data = response.json()
                if isinstance(data, dict):
                    return data
                raise BeowulfAPIError("expected JSON object response", status_code=response.status_code)
            except ValueError as exc:
                raise BeowulfAPIError(
                    "backend returned non-JSON response",
                    status_code=response.status_code,
                    response_body=response.text,
                ) from exc

        detail = ""
        try:
            body = response.json()
            if isinstance(body, dict):
                detail = str(body.get("error") or body.get("message") or body)
            else:
                detail = str(body)
        except ValueError:
            detail = response.text.strip()
        detail = detail or f"HTTP {response.status_code}"
        raise BeowulfAPIError(
            f"backend request failed: {detail}",
            status_code=response.status_code,
            response_body=response.text,
        )
