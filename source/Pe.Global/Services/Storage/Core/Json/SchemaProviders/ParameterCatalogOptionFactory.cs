using Pe.Global.Services.Aps.Models;
using Pe.Global.Services.SignalR;
using Pe.Global.Services.Storage.Core;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

public static class ParameterCatalogOptionFactory {
    public static List<ParameterCatalogEntry> Build(HashSet<string> selectedFamilyNames) {
        var doc = Document.DocumentManager.GetActiveDocument();
        if (doc == null) return [];

        var apsGuids = LoadApsParameterGuids();
        return ProjectFamilyParameterCollector.Collect(doc, selectedFamilyNames)
            .Select(entry => new ParameterCatalogEntry(
                Name: entry.Name,
                StorageType: entry.StorageType.ToString(),
                DataType: entry.DataType.TypeId,
                IsShared: entry.IsShared,
                IsInstance: entry.IsInstance,
                IsBuiltIn: entry.IsBuiltIn,
                IsProjectParameter: entry.IsProjectParameter,
                IsParamService: entry.IsShared && entry.SharedGuid.HasValue && apsGuids.Contains(entry.SharedGuid.Value),
                SharedGuid: entry.SharedGuid?.ToString(),
                FamilyNames: entry.FamilyNames.OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList(),
                TypeNames: entry.ValuesPerType.Keys.OrderBy(n => n, StringComparer.Ordinal).ToList()
            ))
            .ToList();
    }

    private static HashSet<Guid> LoadApsParameterGuids() {
        try {
            var cache = Storage.GlobalDir().StateJson<ParametersApi.Parameters>("parameters-service-cache")
                as JsonReader<ParametersApi.Parameters>;
            if (cache == null || !File.Exists(cache.FilePath))
                return [];

            var results = cache.Read().Results;
            if (results == null)
                return [];

            var guids = new HashSet<Guid>();
            foreach (var param in results) {
                try { _ = guids.Add(param.DownloadOptions.GetGuid()); } catch {
                    // Skip entries with unparseable GUIDs.
                }
            }

            return guids;
        } catch {
            return [];
        }
    }
}
