# Beowulf Node.js SDK

`beowulf-cedar-sdk` is a Node.js SDK for integrating applications and agents with this Cedar authorization backend.

It follows the same runtime check pattern used by common authorization SDKs (`check(user, action, resource)`), and mirrors the Python/.NET Beowulf SDK behavior for:

- `POST /v1/authorize`
- `POST /v1/entitlements`

## Install

### npm (published package)

```bash
npm install beowulf-cedar-sdk
```

### Local development (from repository root)

```bash
npm install ./sdks/node/beowulf
```

## Quickstart

```javascript
import { Beowulf } from "beowulf-cedar-sdk";

const permit = new Beowulf({
  token: process.env.CEDAR_APP_API_KEY,
  pdp: "http://localhost:8080",
  applicationId: 10,
});

const permitted = await permit.check(
  "john@smith.com",
  "atomic.demo.approve",
  { type: "Tool", id: "atomic:target" }
);

console.log("permitted=", permitted);
```

## Full decision response

```javascript
import { Beowulf } from "beowulf-cedar-sdk";

const sdk = Beowulf.fromEnv();
const decision = await sdk.authorize(
  "alice",
  "view",
  { type: "Document", id: "doc-1" },
  { context: { request_id: "req-123" } }
);

console.log(decision.decision);
console.log(decision.reasons);
console.log(decision.errors);
```

## Entitlements

```javascript
const sdk = Beowulf.fromEnv();
const entitlements = await sdk.getEntitlements("alice", {
  groups: ["analysts"],
  includeInherited: true,
});
console.log(entitlements);
```

## Environment-based initialization

```javascript
import { Beowulf } from "beowulf-cedar-sdk";
const sdk = Beowulf.fromEnv();
```

Supported env vars:

- `CEDAR_BASE_URL`
- `CEDAR_APP_ID`
- `CEDAR_APP_API_KEY` (preferred runtime key)
- `CEDAR_API_KEY` (fallback)
- `CEDAR_BEARER_TOKEN` (optional)

## API summary

- `await sdk.check(user, action, resource, options?) -> boolean`
- `await sdk.authorize(user, action, resource, options?) -> AuthorizationDecision`
- `await sdk.getEntitlements(username, options?) -> object`

Input rules:

- `user`, `action`, and `resource` can be strings or objects.
- String inputs use default types: `User`, `Action`, and `Resource`.
- Object inputs can include `id`/`key` and optional `type`.

## Error handling

- `BeowulfConfigurationError`: invalid setup/input values
- `BeowulfApiError`: network/HTTP/backend failures (`statusCode`, `responseBody`)

## Publishing

When ready to publish:

```bash
cd sdks/node/beowulf
npm publish
```
