using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Global.Services.Aps;
using Pe.Global.Services.Aps.Models;
using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
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
        var apsParamsCache = Storage.GlobalDir().StateJson<ParametersApi.Parameters>(cacheFilename);

        var svcAps = new Aps(new CacheParametersService());
        var parameters = Task.Run(async () =>
            await svcAps.Parameters(new CacheParametersService()).GetParameters(
                apsParamsCache, false)
        ).Result;

        WriteAdditionalFormats(parameters, cacheFilename);

        return Result.Succeeded;
    }

    private static void WriteAdditionalFormats(ParametersApi.Parameters parameters, string baseFilename) {
        if (parameters?.Results == null) return;

        var globalDir = Storage.GlobalDir().DirectoryPath;
        var basePath = Path.Combine(globalDir, baseFilename);

        var enrichedData = parameters.Results
            .Where(p => p.IsArchived == false)
            .OrderBy(p => p.Name)
            .Select(p => new EnrichedParameterData(p))
            .ToList();

        WriteCsv(enrichedData, $"{basePath}.csv");
        WriteToon(enrichedData, $"{basePath}.toon");
        WriteMarkdown(enrichedData, $"{basePath}.md");
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

        var json = JsonConvert.SerializeObject(data, Formatting.Indented);
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
            foreach (var (prefix, (start, end)) in sections.OrderBy(kvp => kvp.Value.start)) {
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
            _ = sb.AppendLine($"## {i + 1}. **{param.Name}**");
            _ = sb.AppendLine($"- Description: {(string.IsNullOrWhiteSpace(param.Description) ? "No description provided" : param.Description)}");
            _ = sb.AppendLine($"- Spec: {param.SpecLabel} (`{param.SpecId}`)");
            _ = sb.AppendLine($"- Scope: {(param.IsInstance ? "INSTANCE" : "TYPE")}");

            if (param.ReadOnly)
                _ = sb.AppendLine($"Read-Only: Yes");

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
                if (sectionLength >= minConsecutiveCount && !string.IsNullOrEmpty(currentPrefix)) {
                    sections[currentPrefix] = (sectionStart + 1, i); // +1 for 1-indexed display
                }

                currentPrefix = prefix;
                sectionStart = i;
            }
        }

        // Handle the last section
        var lastSectionLength = data.Count - sectionStart;
        if (lastSectionLength >= minConsecutiveCount && !string.IsNullOrEmpty(currentPrefix)) {
            sections[currentPrefix] = (sectionStart + 1, data.Count);
        }

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
        this.SpecLabel = GetSpecLabel(param.SpecId);
        this.ValueTypeId = param.ValueTypeId;
        this.ReadOnly = param.ReadOnly;
        this.CreatedBy = param.CreatedBy;
        this.CreatedAt = param.CreatedAt;
        this.IsArchived = param.IsArchived;

        if (param.Metadata != null) {
            this.IsInstance = param.DownloadOptions.IsInstance;
            this.Visible = param.DownloadOptions.Visible;

            var groupId = param.Metadata
                .FirstOrDefault(m => m.Id == "group")?
                .Value as ParametersApi.Parameters.ParametersResult.ParameterDownloadOpts.MetadataBinding;

            this.GroupId = groupId?.Id;
            this.GroupLabel = GetGroupLabel(this.GroupId);

            var categories = param.Metadata
                .FirstOrDefault(m => m.Id == "categories")?
                .Value as List<ParametersApi.Parameters.ParametersResult.ParameterDownloadOpts.MetadataBinding>;

            this.CategoryIds = categories?.Select(c => c.Id).ToList() ?? [];
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

    private static string GetSpecLabel(string? specId) {
        if (string.IsNullOrEmpty(specId)) return string.Empty;
        var forgeTypeId = new ForgeTypeId(specId);
        return SpecNamesProvider.GetLabelForForge(forgeTypeId);
    }

    private static string GetGroupLabel(string? groupId) {
        if (string.IsNullOrEmpty(groupId)) return string.Empty;
        var forgeTypeId = new ForgeTypeId(groupId);
        return PropertyGroupNamesProvider.GetLabelForForge(forgeTypeId);
    }
}

public class CacheParametersService : Aps.IOAuthTokenProvider, Aps.IParametersTokenProvider {
#if DEBUG
    public string GetClientId() => Storage.GlobalDir().SettingsJson().Read().ApsWebClientId1;
    public string GetClientSecret() => Storage.GlobalDir().SettingsJson().Read().ApsWebClientSecret1;
#else
    public string GetClientId() => Storage.GlobalDir().SettingsJson().Read().ApsDesktopClientId1;
    public string GetClientSecret() => null;
#endif
    public string GetAccountId() => Storage.GlobalDir().SettingsJson().Read().Bim360AccountId;
    public string GetGroupId() => Storage.GlobalDir().SettingsJson().Read().ParamServiceGroupId;
    public string GetCollectionId() => Storage.GlobalDir().SettingsJson().Read().ParamServiceCollectionId;
}