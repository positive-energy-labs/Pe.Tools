using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.Snapshots;
using Pe.StorageRuntime.Revit;

namespace Pe.FamilyFoundry.Aggregators;

/// <summary>
///     Orchestrates parameter collection and aggregation across multiple families.
/// </summary>
public static class FamilyParamAggregator {
    /// <summary>
    ///     Aggregates parameter data from all provided families.
    /// </summary>
    /// <returns>Dictionary of parameter name to aggregated data</returns>
    public static IEnumerable<AggregatedParamData> Aggregate(Document doc,
        CollectorQueue collectorQueue,
        List<Family> families) {
        var aggregated = new Dictionary<(string, bool, string), AggregatedParamData>();
        foreach (var family in families) {
            var familyName = family.Name;
            var categoryName = family.FamilyCategory?.Name ?? "Unknown";
            var snapshot = new FamilySnapshot { FamilyName = familyName };

            try {
                collectorQueue.ToProjectCollectorFunc()(snapshot, doc, family);

                foreach (var param in snapshot.Parameters?.Data ?? []) {
                    // Only count this family if the parameter has a value for every type
                    var key = GenerateKey(param);

                    if (!aggregated.TryGetValue(key, out var existing)) {
                        existing = new AggregatedParamData(param);
                        aggregated[key] = existing;
                    }

                    if (!existing.FamilyNames.Contains(familyName)) existing.FamilyNames.Add(familyName);
                    _ = existing.FamilyCategories.Add(categoryName);
                }
            } catch {
                // Skip families that fail to process
            }
        }

        return aggregated.Values;
    }

    /// <summary>
    ///     Enriches aggregated parameter data with schedule information.
    ///     Looks at all schedules and adds schedule names and categories where each parameter appears.
    /// </summary>
    public static void EnrichWithScheduleData(Document doc,
        IEnumerable<AggregatedParamData> aggregatedData,
        List<Category> categoryFilter = null) {
        var paramToSchedules = new Dictionary<string, List<string>>();
        var paramToScheduleCategories = new Dictionary<string, HashSet<string>>();

        var schedules = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .OfType<ViewSchedule>()
            .Where(s => s.Definition != null);

        if (categoryFilter?.Any() == true)
            schedules = schedules.Where(s => categoryFilter.Any(c => c.Id == s.Definition.CategoryId));

        foreach (var schedule in schedules) {
            var definition = schedule.Definition;
            var scheduleName = schedule.Name;
            var scheduleCategory = doc.GetElement(definition.CategoryId)?.Name ?? "Unknown";

            for (var i = 0; i < definition.GetFieldCount(); i++) {
                var field = definition.GetField(i);
                if (field.ParameterId == ElementId.InvalidElementId) continue;

                var paramElement = doc.GetElement(field.ParameterId) as ParameterElement;
                var paramName = paramElement?.Name ?? field.GetName();

                if (!paramToSchedules.TryGetValue(paramName, out var scheduleList)) {
                    scheduleList = [];
                    paramToSchedules[paramName] = scheduleList;
                }

                if (!scheduleList.Contains(scheduleName)) scheduleList.Add(scheduleName);

                if (!paramToScheduleCategories.TryGetValue(paramName, out var categorySet)) {
                    categorySet = [];
                    paramToScheduleCategories[paramName] = categorySet;
                }

                _ = categorySet.Add(scheduleCategory);
            }
        }

        foreach (var data in aggregatedData) {
            if (paramToSchedules.TryGetValue(data.ParamName, out var scheduleNames))
                data.ScheduleNames = scheduleNames;

            if (paramToScheduleCategories.TryGetValue(data.ParamName, out var scheduleCategories))
                data.ScheduleCategories = scheduleCategories;
        }
    }

    /// <summary>
    ///     Writes aggregated data to CSV file.
    /// </summary>
    public static string WriteToCsv(IEnumerable<AggregatedParamData> data, StorageClient storage) {
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
        var filename = $"param-aggregation_{timestamp}.csv";
        var filePath = Path.Combine(storage.OutputDir().DirectoryPath, filename);

        var csvContent = ConvertJsonToCsv(data);
        File.WriteAllText(filePath, csvContent);
        return filePath;
    }

    /// <summary>
    ///     Converts a collection of objects to CSV by serializing to JSON first.
    ///     Lists and collections are joined with semicolons instead of commas.
    /// </summary>
    private static string ConvertJsonToCsv(IEnumerable<AggregatedParamData> data) {
        var dataList = data.ToList();
        if (!dataList.Any()) return string.Empty;

        // Serialize to JSON
        var json = JsonConvert.SerializeObject(dataList);
        var jsonArray = JArray.Parse(json);

        // Get all unique property names from all objects
        var properties = jsonArray
            .SelectMany(obj => ((JObject)obj).Properties())
            .Select(p => p.Name)
            .Distinct()
            .ToList();

        // Header row
        var lines = new List<string> { string.Join(",", properties.Select(EscapeCsvField)) };

        // Data rows
        foreach (var item in jsonArray) {
            var values = properties.Select(prop => {
                var token = item[prop];
                return ConvertJsonValueToCsvField(token);
            });
            lines.Add(string.Join(",", values));
        }

        return string.Join(Environment.NewLine, lines);
    }

    /// <summary>
    ///     Converts a JSON token to a CSV field value.
    ///     Arrays/lists are joined with semicolons and sorted for consistency.
    /// </summary>
    private static string ConvertJsonValueToCsvField(JToken token) {
        if (token == null || token.Type == JTokenType.Null)
            return string.Empty;

        if (token.Type == JTokenType.Array) {
            var items = token.Select(t => t.ToString()).OrderBy(s => s);
            return EscapeCsvField(string.Join("; ", items));
        }

        return EscapeCsvField(token.ToString());
    }

    /// <summary>
    ///     Generates a unique key for a parameter based on name and instance/type distinction.
    /// </summary>
    private static (string, bool, string) GenerateKey(ParamSnapshot param) =>
        (param.Name, param.IsInstance, param.SharedGuid?.ToString() ?? string.Empty);

    /// <summary>
    ///     Escapes a field for CSV output (handles commas and quotes).
    /// </summary>
    private static string EscapeCsvField(string field) {
        if (string.IsNullOrEmpty(field)) return string.Empty;

        if (field.Contains(',') || field.Contains('"') || field.Contains('\n'))
            return $"\"{field.Replace("\"", "\"\"")}\"";

        return field;
    }
}