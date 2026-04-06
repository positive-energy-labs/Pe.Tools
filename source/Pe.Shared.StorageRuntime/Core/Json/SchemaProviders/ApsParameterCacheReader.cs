using Newtonsoft.Json.Linq;
using Pe.Shared.StorageRuntime.Json;
using Pe.Shared.StorageRuntime;

namespace Pe.Shared.StorageRuntime.Revit.Core.Json.SchemaProviders;

public static class ApsParameterCacheReader {
    private const string CacheFilename = "parameters-service-cache";

    public static IReadOnlyList<ApsParameterCacheEntry> ReadEntries() {
        try {
            var cache = StorageClient.Default.Global().State().Json<object>(CacheFilename);
            var cachePath = ((JsonReader<object>)cache).FilePath;
            if (!File.Exists(cachePath))
                return [];

            var root = JObject.Parse(File.ReadAllText(cachePath));
            if (root[GetTokenName(root, "Results")] is not JArray results)
                return [];

            var entries = new List<ApsParameterCacheEntry>(results.Count);
            foreach (var result in results.OfType<JObject>()) {
                var id = result.Value<string>(GetTokenName(result, "Id"));
                var name = result.Value<string>(GetTokenName(result, "Name")) ?? string.Empty;
                var metadata = result[GetTokenName(result, "Metadata")] as JArray;

                entries.Add(new ApsParameterCacheEntry(
                    name,
                    IsArchived(metadata),
                    TryParseGuid(id)
                ));
            }

            return entries;
        } catch {
            return [];
        }
    }

    private static string GetTokenName(JObject obj, string expectedName) =>
        obj.Properties()
            .FirstOrDefault(property => property.Name.Equals(expectedName, StringComparison.OrdinalIgnoreCase))
            ?.Name
        ?? expectedName;

    private static bool IsArchived(JArray? metadata) {
        if (metadata == null)
            return false;

        foreach (var item in metadata.OfType<JObject>()) {
            var id = item.Value<string>(GetTokenName(item, "Id"));
            if (!string.Equals(id, "isArchived", StringComparison.OrdinalIgnoreCase))
                continue;

            var valueToken = item[GetTokenName(item, "Value")];
            if (valueToken?.Type == JTokenType.Boolean)
                return valueToken.Value<bool>();
        }

        return false;
    }

    private static Guid? TryParseGuid(string? parameterId) {
        if (string.IsNullOrWhiteSpace(parameterId))
            return null;

        var typeIdParts = parameterId.Split(':');
        if (typeIdParts.Length < 2)
            return null;

        var parameterPart = typeIdParts[1];
        var dashIndex = parameterPart.IndexOf('-');
        var guidText = dashIndex > 0 ? parameterPart[..dashIndex] : parameterPart;
        return Guid.TryParse(guidText, out var guid) ? guid : null;
    }
}

public sealed record ApsParameterCacheEntry(
    string Name,
    bool IsArchived,
    Guid? SharedGuid
);
