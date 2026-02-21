using System.Text.Json.Serialization;

namespace Beowulf.Cedar;

public sealed class AuthorizationDecision
{
    [JsonPropertyName("decision")]
    public string Decision { get; init; } = string.Empty;

    [JsonPropertyName("reasons")]
    public List<object> Reasons { get; init; } = [];

    [JsonPropertyName("errors")]
    public List<object> Errors { get; init; } = [];

    [JsonIgnore]
    public bool Allowed => string.Equals(Decision, "allow", StringComparison.OrdinalIgnoreCase);
}
