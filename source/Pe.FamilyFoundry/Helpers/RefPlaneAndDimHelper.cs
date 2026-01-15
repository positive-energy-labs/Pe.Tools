using System.Text.Json.Serialization;

namespace Pe.FamilyFoundry.Helpers;

/// <summary>
///     Caches ReferencePlane lookups by name for performance.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public class PlaneQuery {
    private readonly Dictionary<string, ReferencePlane> _cache = new();
    private readonly Document _doc;

    public PlaneQuery(Document doc) => _doc = doc;

    public ReferencePlane Get(string name) {
        if (string.IsNullOrEmpty(name)) return null;
        if (!_cache.ContainsKey(name)) {
            _cache[name] = new FilteredElementCollector(_doc)
                .OfClass(typeof(ReferencePlane))
                .Cast<ReferencePlane>()
                .FirstOrDefault(rp => rp.Name == name);
        }

        return _cache[name];
    }

    public ReferencePlane ReCache(string name) =>
        string.IsNullOrEmpty(name)
            ? null
            : _cache[name] = new FilteredElementCollector(_doc)
                .OfClass(typeof(ReferencePlane))
                .Cast<ReferencePlane>()
                .FirstOrDefault(rp => rp.Name == name);
}
