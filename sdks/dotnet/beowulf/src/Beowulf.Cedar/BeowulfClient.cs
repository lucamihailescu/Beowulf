using System.Collections;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Beowulf.Cedar;

public sealed class Beowulf : IDisposable, IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = null,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;

    public string BaseUrl { get; }
    public int? ApplicationId { get; }
    public TimeSpan Timeout { get; }

    public Beowulf(
        string? token = null,
        string pdp = "http://localhost:8080",
        int? applicationId = null,
        TimeSpan? timeout = null,
        IReadOnlyDictionary<string, string>? headers = null,
        string tokenHeader = "X-API-Key",
        HttpClient? httpClient = null)
    {
        BaseUrl = (pdp ?? "http://localhost:8080").TrimEnd('/');
        ApplicationId = applicationId;
        Timeout = timeout ?? TimeSpan.FromSeconds(5);

        _ownsHttpClient = httpClient is null;
        _httpClient = httpClient ?? new HttpClient();
        _httpClient.BaseAddress = new Uri($"{BaseUrl}/", UriKind.Absolute);
        _httpClient.Timeout = Timeout;

        if (!string.IsNullOrWhiteSpace(token))
        {
            _httpClient.DefaultRequestHeaders.Remove(tokenHeader);
            _httpClient.DefaultRequestHeaders.TryAddWithoutValidation(tokenHeader, token);
        }

        if (headers is not null)
        {
            foreach (var kvp in headers)
            {
                _httpClient.DefaultRequestHeaders.Remove(kvp.Key);
                _httpClient.DefaultRequestHeaders.TryAddWithoutValidation(kvp.Key, kvp.Value);
            }
        }
    }

    public static Beowulf FromEnvironment()
    {
        var baseUrl = Environment.GetEnvironmentVariable("CEDAR_BASE_URL");
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            baseUrl = "http://localhost:8080";
        }

        int? appId = null;
        var appIdRaw = Environment.GetEnvironmentVariable("CEDAR_APP_ID");
        if (!string.IsNullOrWhiteSpace(appIdRaw))
        {
            if (!int.TryParse(appIdRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
            {
                throw new BeowulfConfigurationException($"invalid CEDAR_APP_ID value: {appIdRaw}");
            }

            appId = parsed;
        }

        var token = Environment.GetEnvironmentVariable("CEDAR_APP_API_KEY");
        if (string.IsNullOrWhiteSpace(token))
        {
            token = Environment.GetEnvironmentVariable("CEDAR_API_KEY");
        }

        Dictionary<string, string>? headers = null;
        var bearer = Environment.GetEnvironmentVariable("CEDAR_BEARER_TOKEN");
        if (!string.IsNullOrWhiteSpace(bearer))
        {
            headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["Authorization"] = $"Bearer {bearer}",
            };
        }

        return new Beowulf(token: token, pdp: baseUrl, applicationId: appId, headers: headers);
    }

    public async Task<bool> CheckAsync(
        object user,
        object action,
        object resource,
        IReadOnlyDictionary<string, object?>? context = null,
        int? applicationId = null,
        string principalType = "User",
        string actionType = "Action",
        string resourceType = "Resource",
        CancellationToken cancellationToken = default)
    {
        var decision = await AuthorizeAsync(
            user,
            action,
            resource,
            context,
            applicationId,
            principalType,
            actionType,
            resourceType,
            cancellationToken);
        return decision.Allowed;
    }

    public bool Check(
        object user,
        object action,
        object resource,
        IReadOnlyDictionary<string, object?>? context = null,
        int? applicationId = null,
        string principalType = "User",
        string actionType = "Action",
        string resourceType = "Resource")
    {
        return CheckAsync(user, action, resource, context, applicationId, principalType, actionType, resourceType)
            .GetAwaiter()
            .GetResult();
    }

    public async Task<AuthorizationDecision> AuthorizeAsync(
        object user,
        object action,
        object resource,
        IReadOnlyDictionary<string, object?>? context = null,
        int? applicationId = null,
        string principalType = "User",
        string actionType = "Action",
        string resourceType = "Resource",
        CancellationToken cancellationToken = default)
    {
        var appId = ResolveApplicationId(applicationId);
        var principal = NormalizeEntity(user, principalType, "principal");
        var normalizedAction = NormalizeEntity(action, actionType, "action");
        var normalizedResource = NormalizeEntity(resource, resourceType, "resource");

        var payload = new AuthorizePayload(
            appId,
            principal,
            normalizedAction,
            normalizedResource,
            context is null ? new Dictionary<string, object?>() : new Dictionary<string, object?>(context));

        return await PostJsonAsync<AuthorizePayload, AuthorizationDecision>(
            "v1/authorize",
            payload,
            cancellationToken);
    }

    public AuthorizationDecision Authorize(
        object user,
        object action,
        object resource,
        IReadOnlyDictionary<string, object?>? context = null,
        int? applicationId = null,
        string principalType = "User",
        string actionType = "Action",
        string resourceType = "Resource")
    {
        return AuthorizeAsync(user, action, resource, context, applicationId, principalType, actionType, resourceType)
            .GetAwaiter()
            .GetResult();
    }

    public async Task<IReadOnlyDictionary<string, JsonElement>> GetEntitlementsAsync(
        string username,
        IReadOnlyList<string>? groups = null,
        bool includeInherited = true,
        int? applicationId = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            throw new BeowulfConfigurationException("username cannot be empty");
        }

        var appId = ResolveApplicationId(applicationId);
        var payload = new EntitlementsPayload(
            appId,
            username,
            groups ?? [],
            includeInherited);

        return await PostJsonAsync<EntitlementsPayload, Dictionary<string, JsonElement>>(
            "v1/entitlements",
            payload,
            cancellationToken);
    }

    public IReadOnlyDictionary<string, JsonElement> GetEntitlements(
        string username,
        IReadOnlyList<string>? groups = null,
        bool includeInherited = true,
        int? applicationId = null)
    {
        return GetEntitlementsAsync(username, groups, includeInherited, applicationId)
            .GetAwaiter()
            .GetResult();
    }

    private int ResolveApplicationId(int? requestAppId)
    {
        var appId = requestAppId ?? ApplicationId;
        if (!appId.HasValue)
        {
            throw new BeowulfConfigurationException(
                "application_id is required. Set it on BeowulfClient(...) or per request.");
        }

        return appId.Value;
    }

    private static EntityRef NormalizeEntity(object input, string defaultType, string kind)
    {
        if (input is null)
        {
            throw new BeowulfConfigurationException($"{kind} cannot be null");
        }

        if (input is EntityRef entity)
        {
            ValidateEntity(kind, entity.Type, entity.Id);
            return entity;
        }

        if (input is string text)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                throw new BeowulfConfigurationException($"{kind} cannot be empty");
            }

            return new EntityRef(defaultType, text);
        }

        if (input is JsonElement jsonElement && jsonElement.ValueKind == JsonValueKind.Object)
        {
            var type = ReadJsonField(jsonElement, "type")
                ?? ReadJsonField(jsonElement, $"{kind}_type")
                ?? defaultType;
            var id = ReadJsonField(jsonElement, "id")
                ?? ReadJsonField(jsonElement, "key")
                ?? ReadJsonField(jsonElement, $"{kind}_id")
                ?? string.Empty;
            ValidateEntity(kind, type, id);
            return new EntityRef(type, id);
        }

        if (input is IDictionary dictionary)
        {
            var type = ReadDictionaryField(dictionary, "type")
                ?? ReadDictionaryField(dictionary, $"{kind}_type")
                ?? defaultType;
            var id = ReadDictionaryField(dictionary, "id")
                ?? ReadDictionaryField(dictionary, "key")
                ?? ReadDictionaryField(dictionary, $"{kind}_id")
                ?? string.Empty;
            ValidateEntity(kind, type, id);
            return new EntityRef(type, id);
        }

        var inputType = input.GetType();
        var idValue = ReadProperty(input, "Id")
            ?? ReadProperty(input, "Key")
            ?? ReadProperty(input, $"{ToPascalCase(kind)}Id");
        var typeValue = ReadProperty(input, "Type")
            ?? ReadProperty(input, $"{ToPascalCase(kind)}Type")
            ?? defaultType;

        if (idValue is null)
        {
            throw new BeowulfConfigurationException(
                $"{kind} must be string, EntityRef, dictionary, JSON object, or an object with Id/Type fields (received {inputType.Name}).");
        }

        var normalizedType = Convert.ToString(typeValue, CultureInfo.InvariantCulture) ?? defaultType;
        var normalizedId = Convert.ToString(idValue, CultureInfo.InvariantCulture) ?? string.Empty;
        ValidateEntity(kind, normalizedType, normalizedId);
        return new EntityRef(normalizedType, normalizedId);
    }

    private static void ValidateEntity(string kind, string type, string id)
    {
        if (string.IsNullOrWhiteSpace(type))
        {
            throw new BeowulfConfigurationException($"{kind}.type cannot be empty");
        }

        if (string.IsNullOrWhiteSpace(id))
        {
            throw new BeowulfConfigurationException($"{kind}.id cannot be empty");
        }
    }

    private static object? ReadProperty(object value, string propertyName)
    {
        var prop = value.GetType().GetProperty(propertyName);
        return prop?.GetValue(value);
    }

    private static string ToPascalCase(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return value;
        }

        if (value.Length == 1)
        {
            return value.ToUpperInvariant();
        }

        return char.ToUpperInvariant(value[0]) + value[1..];
    }

    private static string? ReadDictionaryField(IDictionary dictionary, string key)
    {
        foreach (DictionaryEntry entry in dictionary)
        {
            if (!string.Equals(Convert.ToString(entry.Key, CultureInfo.InvariantCulture), key, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            return Convert.ToString(entry.Value, CultureInfo.InvariantCulture);
        }

        return null;
    }

    private static string? ReadJsonField(JsonElement element, string field)
    {
        foreach (var property in element.EnumerateObject())
        {
            if (!string.Equals(property.Name, field, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            return property.Value.ValueKind switch
            {
                JsonValueKind.String => property.Value.GetString(),
                JsonValueKind.Number => property.Value.GetRawText(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                _ => property.Value.GetRawText(),
            };
        }

        return null;
    }

    private async Task<TResponse> PostJsonAsync<TRequest, TResponse>(
        string path,
        TRequest payload,
        CancellationToken cancellationToken)
    {
        HttpResponseMessage response;
        try
        {
            response = await _httpClient.PostAsJsonAsync(path, payload, JsonOptions, cancellationToken);
        }
        catch (Exception ex)
        {
            throw new BeowulfApiException($"request failed for /{path}: {ex.Message}", innerException: ex);
        }

        return await HandleResponseAsync<TResponse>(response, path, cancellationToken);
    }

    private static async Task<TResponse> HandleResponseAsync<TResponse>(
        HttpResponseMessage response,
        string path,
        CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            try
            {
                var parsed = await response.Content.ReadFromJsonAsync<TResponse>(JsonOptions, cancellationToken);
                if (parsed is null)
                {
                    throw new BeowulfApiException("expected JSON object response", (int)response.StatusCode);
                }

                return parsed;
            }
            catch (NotSupportedException ex)
            {
                var raw = await response.Content.ReadAsStringAsync(cancellationToken);
                throw new BeowulfApiException("backend returned non-JSON response", (int)response.StatusCode, raw, ex);
            }
            catch (JsonException ex)
            {
                var raw = await response.Content.ReadAsStringAsync(cancellationToken);
                throw new BeowulfApiException("backend returned invalid JSON response", (int)response.StatusCode, raw, ex);
            }
        }

        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        var detail = ExtractErrorDetail(body);
        throw new BeowulfApiException(
            $"backend request failed for /{path}: {detail}",
            (int)response.StatusCode,
            body);
    }

    private static string ExtractErrorDetail(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return "empty response body";
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(body, JsonOptions);
            if (parsed is null)
            {
                return body;
            }

            if (parsed.TryGetValue("error", out var error))
            {
                return error.ValueKind == JsonValueKind.String ? error.GetString() ?? body : error.GetRawText();
            }

            if (parsed.TryGetValue("message", out var message))
            {
                return message.ValueKind == JsonValueKind.String ? message.GetString() ?? body : message.GetRawText();
            }

            return body;
        }
        catch
        {
            return body;
        }
    }

    public void Dispose()
    {
        if (_ownsHttpClient)
        {
            _httpClient.Dispose();
        }
    }

    public ValueTask DisposeAsync()
    {
        Dispose();
        return ValueTask.CompletedTask;
    }

    private sealed record AuthorizePayload(
        [property: JsonPropertyName("application_id")] int ApplicationId,
        [property: JsonPropertyName("principal")] EntityRef Principal,
        [property: JsonPropertyName("action")] EntityRef Action,
        [property: JsonPropertyName("resource")] EntityRef Resource,
        [property: JsonPropertyName("context")] Dictionary<string, object?> Context);

    private sealed record EntitlementsPayload(
        [property: JsonPropertyName("application_id")] int ApplicationId,
        [property: JsonPropertyName("username")] string Username,
        [property: JsonPropertyName("groups")] IReadOnlyList<string> Groups,
        [property: JsonPropertyName("include_inherited")] bool IncludeInherited);
}
