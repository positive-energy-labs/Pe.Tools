using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Parameters;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Revit.FamilyFoundry.Reconcile;

/// <summary>Read-only APS cache resolution; native definitions live only for this apply scope.</summary>
public sealed class FamilySharedParameterSource(Document document,
    IReadOnlyList<ParametersApi.Parameters.ParametersResult>? definitions = null) : IDisposable {
    private IReadOnlyList<ParametersApi.Parameters.ParametersResult>? _definitions = definitions;
    private TempSharedParamFile? _file;
    public Dictionary<string, object> ResolvedDefinitions { get; } = new(StringComparer.Ordinal);

    private ParametersApi.Parameters.ParametersResult Find(string name) {
        if (this._definitions is null) {
            var cache = StorageClient.Default.Global().State().Json<ParametersApi.Parameters>("parameters-service-cache");
            var path = ((JsonReader<ParametersApi.Parameters>)cache).FilePath;
            this._definitions = JsonConvert.DeserializeObject<ParametersApi.Parameters>(File.ReadAllText(path))?.Results
                ?? throw new InvalidOperationException($"APS parameter cache has no definitions: {path}");
        }
        var matches = this._definitions.Where(p => !p.IsArchived && p.Name == name).ToList();
        return matches.Count == 1 ? matches[0] : throw new InvalidOperationException(
            $"Shared parameter '{name}' resolves to {matches.Count} active APS definitions; exactly one is required.");
    }

    public FamilyModel Resolve(FamilyModel model, JObject authored) {
        var json = JObject.Parse(FamilyModelJson.Serialize(model));
        foreach (var property in (authored["parameters"] as JObject)?.Properties() ?? []) {
            if (property.Value is not JObject parameter || parameter.Value<bool?>("shared") != true) continue;
            var source = this.Find(property.Name);
            var guid = source.DownloadOptions.GetGuid();
            this.ResolvedDefinitions[property.Name] = new { Guid = guid, Spec = source.DownloadOptions.GetSpecTypeId().TypeId,
                Description = source.Description ?? "", source.DownloadOptions.Visible, UserModifiable = !source.ReadOnly,
                source.DownloadOptions.IsInstance, Group = source.DownloadOptions.GetGroupTypeId().TypeId };
            if (parameter.Value<string>("sharedGuid") is { } requested && Guid.Parse(requested) != guid)
                throw new InvalidOperationException($"Shared parameter '{property.Name}' requested GUID {requested}, APS defines {guid}.");
            var target = (JObject)json["parameters"]![property.Name]!;
            target["sharedGuid"] = guid.ToString();
            target["isInstance"] ??= source.DownloadOptions.IsInstance;
            target["propertiesGroup"] ??= source.DownloadOptions.GetGroupTypeId().TypeId;
        }
        return json.ToObject<FamilyModel>(JsonSerializer.Create(FamilyModelJson.Settings))!;
    }

    public ExternalDefinition GetDefinition(string name) {
        var source = this.Find(name);
        this._file ??= new TempSharedParamFile(document);
        var options = source.DownloadOptions;
        return SharedParameterBinder.EnsureDefinition(this._file, new SharedDefinitionSpec(name,
            options.GetSpecTypeId(), Description: source.Description ?? "", Guid: options.GetGuid(),
            Visible: options.Visible, UserModifiable: !source.ReadOnly));
    }

    public void Dispose() => this._file?.Dispose();
}
