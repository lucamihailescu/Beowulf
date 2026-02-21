using System.Text.Json.Serialization;

namespace Beowulf.Cedar;

public sealed class EntityRef
{
    [JsonPropertyName("type")]
    public string Type { get; init; } = string.Empty;

    [JsonPropertyName("id")]
    public string Id { get; init; } = string.Empty;

    public EntityRef()
    {
    }

    public EntityRef(string type, string id)
    {
        Type = type;
        Id = id;
    }
}
