using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Parameters;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Revit.FamilyFoundry.Reconcile;

/// <summary>Embedded offline definitions take precedence; APS cache can seed authoring. Native definitions live only for this apply scope.</summary>
public sealed class FamilySharedParameterSource(Document document,
    IReadOnlyList<ParametersApi.Parameters.ParametersResult>? definitions = null) : IDisposable {
    private IReadOnlyList<ParametersApi.Parameters.ParametersResult>? _definitions = definitions;
    private TempSharedParamFile? _file;
    private readonly Dictionary<string, SharedDefinitionSpec> _resolved = new(StringComparer.Ordinal);
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
            if (property.Value is not JObject parameter) continue;
            var target = (JObject)json["parameters"]![property.Name]!;
            if (target.Value<string>("propertiesGroup") is { } group)
                target["propertiesGroup"] = SetParamMetadata.Group(group).TypeId;
            if (parameter.Value<bool?>("shared") != true) continue;
            SharedDefinitionSpec definition;
            if (parameter.Value<string>("sharedSpecId") is { } specId) {
                definition = new SharedDefinitionSpec(property.Name, new ForgeTypeId(specId),
                    Guid: parameter.Value<Guid?>("sharedGuid") ?? throw new InvalidOperationException("Embedded shared definition requires sharedGuid."),
                    Description: parameter.Value<string>("tooltip") ?? "",
                    Visible: parameter.Value<bool?>("sharedVisible") ?? true,
                    UserModifiable: parameter.Value<bool?>("sharedUserModifiable") ?? true);
            } else {
                var source = this.Find(property.Name);
                var options = source.DownloadOptions;
                definition = new SharedDefinitionSpec(property.Name, options.GetSpecTypeId(), Guid: options.GetGuid(),
                    Description: source.Description ?? "", Visible: options.Visible, UserModifiable: !source.ReadOnly);
                target["isInstance"] ??= options.IsInstance;
                if (options.GetGroupTypeId().TypeId is { Length: > 0 } groupId) target["propertiesGroup"] ??= groupId;
            }
            if (parameter.Value<Guid?>("sharedGuid") is { } requested && requested != definition.Guid)
                throw new InvalidOperationException($"Shared parameter '{property.Name}' requested GUID {requested}, source defines {definition.Guid}.");
            this._resolved[property.Name] = definition;
            this.ResolvedDefinitions[property.Name] = definition;
            target["sharedGuid"] = definition.Guid!.Value.ToString();
            target["sharedSpecId"] = definition.DataType.TypeId;
            target["sharedVisible"] = definition.Visible;
            target["sharedUserModifiable"] = definition.UserModifiable;
            if (!string.IsNullOrEmpty(definition.Description)) target["tooltip"] = definition.Description;
        }
        return json.ToObject<FamilyModel>(JsonSerializer.Create(FamilyModelJson.Settings))!;
    }

    public ExternalDefinition GetDefinition(string name) {
        if (!this._resolved.TryGetValue(name, out var definition)) {
            var source = this.Find(name);
            definition = new SharedDefinitionSpec(name, source.DownloadOptions.GetSpecTypeId(), Guid: source.DownloadOptions.GetGuid(),
                Description: source.Description ?? "", Visible: source.DownloadOptions.Visible, UserModifiable: !source.ReadOnly);
        }
        this._file ??= new TempSharedParamFile(document);
        return SharedParameterBinder.EnsureDefinition(this._file, definition);
    }

    public void Dispose() => this._file?.Dispose();
}
