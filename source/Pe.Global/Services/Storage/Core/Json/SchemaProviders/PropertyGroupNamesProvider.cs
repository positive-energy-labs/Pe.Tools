using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

public class PropertyGroupNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() {
        var labelMap = GetLabelForgeMap();
        return labelMap.Keys;
    }

    public static Dictionary<string, ForgeTypeId> GetLabelForgeMap() {
        var properties = typeof(GroupTypeId).GetProperties(BindingFlags.Public | BindingFlags.Static);
        var labelMap = new Dictionary<string, ForgeTypeId>();

        foreach (var property in properties) {
            if (property.PropertyType != typeof(ForgeTypeId)) continue;
            var value = property.GetValue(null) as ForgeTypeId;
            if (value == null) continue;

            var label = value.ToLabel();
            _ = labelMap.TryAdd(label, value);
        }

        return labelMap;
    }

    public static Dictionary<ForgeTypeId, string> GetForgeLabelMap() =>
        GetLabelForgeMap().ToDictionary(kvp => kvp.Value, kvp => kvp.Key);

    public static string GetLabelForForge(ForgeTypeId forge) =>
        GetForgeLabelMap().TryGetValue(forge, out var label) ? label : forge.TypeId;
}