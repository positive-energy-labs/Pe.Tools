using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Global.Services.Aps.Models;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Json;
using Serilog;
using System.Diagnostics;
using System.IO;
using System.Text;
using Toon;

namespace Pe.Tools.Commands;

[Transaction(TransactionMode.Manual)]
public class CmdCacheParametersService : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elements) {
        var cacheFilename = "parameters-service-cache";
        var globalState = StorageClient.Default.Global().State();
        var apsParamsCache = globalState.Json<ParametersApi.Parameters>(cacheFilename);
        var cacheFilePath = ((JsonReader<ParametersApi.Parameters>)apsParamsCache).FilePath;

        var svcAps = new Aps(new CacheParametersService());
        var parameters = Task.Run(async () =>
            await svcAps.Parameters(new CacheParametersService()).GetParameters(
                apsParamsCache, false)
        ).Result;

        var additionalFormatPaths = WriteAdditionalFormats(parameters, cacheFilename, globalState.DirectoryPath);
        Log.Information(
            "[APS Cache] Wrote {ParameterCount} APS parameters to {JsonPath}. Additional artifacts: {AdditionalFormatPaths}",
            parameters?.Results?.Count ?? 0,
            cacheFilePath,
            additionalFormatPaths);

        return Result.Succeeded;
    }

    private static IReadOnlyList<string> WriteAdditionalFormats(
        ParametersApi.Parameters parameters,
        string baseFilename,
        string stateDirectoryPath) {
        if (parameters?.Results == null) return [];

        var basePath = Path.Combine(stateDirectoryPath, baseFilename);

        var enrichedData = parameters.Results
            .Where(p => !p.IsArchived)
            .OrderBy(p => p.Name)
            .Select(p => new EnrichedParameterData(p))
            .ToList();

        if (enrichedData.Count == 0)
            return [];

        var writtenPaths = new List<string> {
            $"{basePath}.csv",
            $"{basePath}.toon",
            $"{basePath}.md"
        };

        WriteCsv(enrichedData, writtenPaths[0]);
        WriteToon(enrichedData, writtenPaths[1]);
        WriteMarkdown(enrichedData, writtenPaths[2]);
        return writtenPaths;
    }

    private static void WriteCsv(List<EnrichedParameterData> data, string filePath) {
        if (data.Count == 0) return;

        var json = JsonConvert.SerializeObject(data);
        var jsonArray = JArray.Parse(json);

        var properties = jsonArray
            .SelectMany(obj => ((JObject)obj).Properties())
            .Select(p => p.Name)
            .Distinct()
            .ToList();

        var lines = new List<string> { string.Join(",", properties.Select(EscapeCsvField)) };

        foreach (var item in jsonArray) {
            var values = properties.Select(prop => {
                var token = item[prop];
                return ConvertJsonValueToCsvField(token);
            });
            lines.Add(string.Join(",", values));
        }

        File.WriteAllText(filePath, string.Join(Environment.NewLine, lines));
    }

    private static void WriteToon(List<EnrichedParameterData> data, string filePath) {
        if (data.Count == 0) return;

        var abridgedData = data.Select(p => new {
            p.Id,
            p.Name,
            p.Description,
            p.IsInstance,
            p.ValueTypeId,
            p.SpecId,
            p.SpecLabel,
            p.GroupId,
            p.GroupLabel,
            p.CategoryIds
        }
        ).ToList();

        var json = JsonConvert.SerializeObject(abridgedData, Formatting.Indented);
        var toon = ToonTranspiler.EncodeJson(json, ToonOptions.Default);
        File.WriteAllText(filePath, toon);
    }

    private static void WriteMarkdown(List<EnrichedParameterData> data, string filePath) {
        if (data.Count == 0) return;

        var sb = new StringBuilder();

        // Header
        _ = sb.AppendLine("---");
        _ = sb.AppendLine($"Total Parameters: {data.Count}");
        _ = sb.AppendLine($"Generated: {DateTime.UtcNow:yyyy-MM-ddTHH:mm:ss.fffZ}");

        // Add section ranges
        var sections = GetSectionRanges(data);
        if (sections.Count != 0) {
            _ = sb.AppendLine();
            _ = sb.AppendLine("Sections:");
            foreach (var section in sections.OrderBy(kvp => kvp.Value.start)) {
                var prefix = section.Key;
                var start = section.Value.start;
                var end = section.Value.end;
                var count = end - start + 1;
                _ = sb.AppendLine($"- `{prefix}*`: #{start}-{end} ({count} params)");
            }
        }

        _ = sb.AppendLine("---");
        _ = sb.AppendLine("# Human Readable Parameters Service Cache Summary");
        _ = sb.AppendLine();

        // Parameters list
        for (var i = 0; i < data.Count; i++) {
            var param = data[i];
            _ = sb.AppendLine($"## {i + 1}. ({(param.IsInstance ? "INST" : "TYPE")}) **{param.Name}**");
            _ = sb.AppendLine(
                $"- Description: {(string.IsNullOrWhiteSpace(param.Description) ? "No description provided" : param.Description)}");
            _ = sb.AppendLine($"- Spec: {param.SpecLabel} (`{param.SpecId}`)");

            if (param.ReadOnly)
                _ = sb.AppendLine("Read-Only: Yes");

            _ = sb.AppendLine();
        }

        File.WriteAllText(filePath, sb.ToString());
    }

    private static string ConvertJsonValueToCsvField(JToken? token) {
        if (token == null || token.Type == JTokenType.Null) return string.Empty;

        if (token.Type == JTokenType.Array) {
            var items = token.Select(t => t.ToString()).OrderBy(s => s);
            return EscapeCsvField(string.Join("; ", items));
        }

        return EscapeCsvField(token.ToString());
    }

    private static string EscapeCsvField(string field) {
        if (string.IsNullOrEmpty(field)) return string.Empty;

        if (field.Contains(',') || field.Contains('"') || field.Contains('\n'))
            return $"\"{field.Replace("\"", "\"\"")}\"";

        return field;
    }

    private static Dictionary<string, (int start, int end)> GetSectionRanges(List<EnrichedParameterData> data) {
        var SECTION_QUANTITY_THRESHOLD = 4;
        var MIN_CONSECUTIVE_COUNT = 3;
        var prefixLength = 1;
        Dictionary<string, (int start, int end)> sections = [];

        // Incrementally increase prefix length until we find enough meaningful sections
        while (sections.Count < SECTION_QUANTITY_THRESHOLD && prefixLength <= 10) {
            sections = IdentifySections(data, prefixLength, MIN_CONSECUTIVE_COUNT);
            prefixLength++;
        }

        return sections;
    }

    private static Dictionary<string, (int start, int end)> IdentifySections(
        List<EnrichedParameterData> data,
        int prefixLength,
        int minConsecutiveCount) {
        var sections = new Dictionary<string, (int start, int end)>();

        if (data.Count == 0) return sections;

        var currentPrefix = GetPrefix(data[0].Name, prefixLength);
        var sectionStart = 0;

        for (var i = 1; i < data.Count; i++) {
            var prefix = GetPrefix(data[i].Name, prefixLength);

            // If prefix changes, check if previous section was long enough
            if (prefix != currentPrefix) {
                var sectionLength = i - sectionStart;
                if (sectionLength >= minConsecutiveCount && !string.IsNullOrEmpty(currentPrefix))
                    sections[currentPrefix] = (sectionStart + 1, i); // +1 for 1-indexed display

                currentPrefix = prefix;
                sectionStart = i;
            }
        }

        // Handle the last section
        var lastSectionLength = data.Count - sectionStart;
        if (lastSectionLength >= minConsecutiveCount && !string.IsNullOrEmpty(currentPrefix))
            sections[currentPrefix] = (sectionStart + 1, data.Count);

        return sections;
    }

    private static string GetPrefix(string? name, int length) {
        if (string.IsNullOrEmpty(name)) return string.Empty;
        if (length > name.Length) return name;
        return name[..length];
    }
}

public class EnrichedParameterData {
    public EnrichedParameterData(ParametersApi.Parameters.ParametersResult param) {
        this.Id = param.Id;
        this.Name = param.Name;
        this.Description = param.Description;
        this.SpecId = param.SpecId;
        this.SpecLabel = new ForgeTypeId(param.SpecId).ToLabel();
        this.ValueTypeId = param.ValueTypeId;
        this.ReadOnly = param.ReadOnly;
        this.CreatedBy = param.CreatedBy;
        this.CreatedAt = param.CreatedAt;
        this.IsArchived = param.IsArchived;

        if (param.Metadata != null) {
            this.IsInstance = param.DownloadOptions.IsInstance;
            this.Visible = param.DownloadOptions.Visible;

            this.GroupId = TryGetMetadataBindingId(param.Metadata, "group");
            this.GroupLabel = TryGetForgeLabel(this.GroupId, param.Name, "group");

            this.CategoryIds = GetMetadataBindingIds(param.Metadata, "categories");
            this.CategoryLabels = this.CategoryIds
                .Select(categoryId => TryGetForgeLabel(categoryId, param.Name, "category"))
                .Where(label => !string.IsNullOrWhiteSpace(label))
                .ToList();
        }
    }

    private static string? TryGetMetadataBindingId(
        IEnumerable<ParametersApi.Parameters.ParametersResult.RawMetadataValue> metadata,
        string metadataId) =>
        metadata.FirstOrDefault(m => m.Id == metadataId)?.Value switch {
            ParametersApi.Parameters.ParametersResult.ParameterDownloadOpts.MetadataBinding binding => binding.Id,
            JObject valueObject => valueObject.Value<string>("id") ?? valueObject.Value<string>("Id"),
            _ => null
        };

    private static List<string> GetMetadataBindingIds(
        IEnumerable<ParametersApi.Parameters.ParametersResult.RawMetadataValue> metadata,
        string metadataId) =>
        metadata.FirstOrDefault(m => m.Id == metadataId)?.Value switch {
            List<ParametersApi.Parameters.ParametersResult.ParameterDownloadOpts.MetadataBinding> bindings =>
                bindings.Select(binding => binding.Id).Where(id => !string.IsNullOrWhiteSpace(id)).ToList()!,
            JArray valueArray => valueArray
                .OfType<JObject>()
                .Select(valueObject => valueObject.Value<string>("id") ?? valueObject.Value<string>("Id"))
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Cast<string>()
                .ToList(),
            _ => []
        };

    private static string TryGetForgeLabel(string? forgeTypeId, string? parameterName, string metadataKind) {
        if (string.IsNullOrWhiteSpace(forgeTypeId))
            return string.Empty;

        try {
            return new ForgeTypeId(forgeTypeId).ToLabel();
        } catch (Exception ex) {
            Log.Debug(
                ex,
                "[APS Cache] Failed to derive {MetadataKind} label for parameter {ParameterName}. ForgeTypeId={ForgeTypeId}",
                metadataKind,
                parameterName,
                forgeTypeId);
            Debug.WriteLine($"{metadataKind} label derivation failed: ForgeTypeId: {forgeTypeId}");
            return string.Empty;
        }
    }

    public string? Id { get; }
    public string? Name { get; }
    public string? Description { get; }
    public string? SpecId { get; }
    public string SpecLabel { get; } = string.Empty;
    public string? ValueTypeId { get; }
    public bool ReadOnly { get; }
    public string? CreatedBy { get; }
    public string? CreatedAt { get; }
    public bool IsArchived { get; }
    public bool IsInstance { get; }
    public bool Visible { get; }
    public string? GroupId { get; }
    public string GroupLabel { get; } = string.Empty;
    public List<string> CategoryIds { get; } = [];
    public List<string> CategoryLabels { get; } = [];
}

public class CacheParametersService : Aps.IOAuthTokenProvider, Aps.IParametersTokenProvider {
#if DEBUG
    public string GetClientId() => ReadGlobalSettings().ApsWebClientId1;
    public string GetClientSecret() => ReadGlobalSettings().ApsWebClientSecret1;
#else
    public string GetClientId() => ReadGlobalSettings().ApsDesktopClientId1;
    public string GetClientSecret() => null;
#endif
    public string GetAccountId() => ReadGlobalSettings().Bim360AccountId;
    public string GetGroupId() => ReadGlobalSettings().ParamServiceGroupId;
    public string GetCollectionId() => ReadGlobalSettings().ParamServiceCollectionId;

    private static GlobalSettings ReadGlobalSettings() =>
        StorageClient.Default.Global().Settings<GlobalSettings>().Read();
}
