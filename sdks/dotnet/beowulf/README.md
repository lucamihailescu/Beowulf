# Beowulf .NET SDK

`Beowulf.Cedar` is a .NET SDK for integrating C#/.NET services and agents with this Cedar authorization backend.

It mirrors the Python SDK behavior for runtime authorization (`/v1/authorize`) and entitlements (`/v1/entitlements`).

## Install

### NuGet package

```bash
dotnet add package Beowulf.Cedar
```

### Local development (from repository root)

```bash
dotnet pack sdks/dotnet/beowulf/src/Beowulf.Cedar/Beowulf.Cedar.csproj -c Release
```

Then consume the generated `.nupkg` from your local feed.

## Quickstart (Async)

```csharp
using Beowulf.Cedar;

var client = new Beowulf(
    token: "cedar_app_10_xxxxx",
    pdp: "http://localhost:8080",
    applicationId: 10);

var allowed = await client.CheckAsync(
    user: "alice",
    action: "email.send",
    resource: new EntityRef("EmailAddress", "foo@bar.com"));

Console.WriteLine($"allowed={allowed}");
await client.DisposeAsync();
```

## Quickstart (Sync)

```csharp
using Beowulf.Cedar;

using var client = new Beowulf(
    token: "cedar_app_10_xxxxx",
    pdp: "http://localhost:8080",
    applicationId: 10);

var decision = client.Authorize(
    user: "alice",
    action: "view",
    resource: new EntityRef("Document", "doc-1"));

Console.WriteLine($"decision={decision.Decision}");
```

## Environment-based initialization

```csharp
using Beowulf.Cedar;

using var client = Beowulf.FromEnvironment();
```

Supported env vars:
- `CEDAR_BASE_URL`
- `CEDAR_APP_ID`
- `CEDAR_APP_API_KEY` (preferred)
- `CEDAR_API_KEY` (fallback)
- `CEDAR_BEARER_TOKEN` (optional)

## API overview

- `CheckAsync(...)` / `Check(...)` -> returns `bool` (`allow` => `true`)
- `AuthorizeAsync(...)` / `Authorize(...)` -> returns `AuthorizationDecision`
- `GetEntitlementsAsync(...)` / `GetEntitlements(...)` -> returns JSON dictionary payload

## Error handling

- `BeowulfConfigurationException`: invalid setup/inputs
- `BeowulfApiException`: HTTP/network/backend errors with `StatusCode` and `ResponseBody`

## Chocolatey note

Chocolatey is best suited for executable tools. The SDK itself is distributed via NuGet.

If you want Chocolatey support, publish a companion CLI (for example `beowulf-cedar-cli`) and ship that CLI through Chocolatey while the SDK remains on NuGet.
