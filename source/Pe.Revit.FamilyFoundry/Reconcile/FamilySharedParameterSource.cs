using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Parameters;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Reconcile;

public sealed record SharedParameterAuthority(string ResourceId, string? CollectionId);

/// <summary>Pod execution resolves declared current APS definitions. Non-pod capture replay can supply embedded definitions.</summary>
public sealed class FamilySharedParameterSource(Document document,
    IReadOnlyList<ParametersApi.Parameters.ParametersResult>? definitions = null,
    string? collectionId = null,
    IReadOnlyCollection<string>? requiredResourceIds = null,
    bool requireDeclaration = false,
    string? observedParametersDigest = null,
    IReadOnlyList<SharedParameterAuthority>? declaredRequirements = null) : IDisposable {
    private IReadOnlyList<ParametersApi.Parameters.ParametersResult>? _definitions = definitions;
    private TempSharedParamFile? _file;
    private readonly Dictionary<string, SharedDefinitionSpec> _resolved = new(StringComparer.Ordinal);
    public Dictionary<string, object> ResolvedDefinitions { get; } = new(StringComparer.Ordinal);
    public string? ObservedParametersDigest { get; private set; } = observedParametersDigest;
    private readonly HashSet<string> _observedResourceIds = new(StringComparer.Ordinal);
    public IReadOnlyCollection<string> ObservedResourceIds => this._observedResourceIds;

    private ParametersApi.Parameters.ParametersResult Find(string name) {
        if (this._definitions is null) {
            if (declaredRequirements is not null) {
                var parameters = declaredRequirements;
                var collections = parameters.Select(requirement => requirement.CollectionId).Distinct(StringComparer.Ordinal).ToList();
                if (collections.Count > 1)
                    throw new InvalidOperationException("Family Foundry shared parameter lookup requires one APS collection per pod.");
                collectionId = collections.SingleOrDefault();
                requiredResourceIds = parameters.Select(requirement => requirement.ResourceId).ToList();
            }
            if (requireDeclaration && requiredResourceIds is not { Count: > 0 })
                throw new InvalidOperationException("Pod-authored shared parameters require an aps.parameters declaration; embedded definitions are not an authority.");
            var current = ParametersServiceCache.ResolveCurrentAsync(collectionId).GetAwaiter().GetResult();
            this._definitions = current.Definitions;
            this.ObservedParametersDigest = current.Digest;
        }
        var matches = this._definitions.Where(p => !p.IsArchived && p.Name == name
            && (!requireDeclaration || requiredResourceIds?.Contains(p.Id) == true)).ToList();
        if (matches.Count != 1)
            throw new InvalidOperationException($"Shared parameter '{name}' resolves to {matches.Count} active APS definitions; exactly one is required.");
        this._observedResourceIds.Add(matches[0].Id);
        return matches[0];
    }

    public FamilyModel Resolve(FamilyModel model, JObject authored) {
        var json = JObject.Parse(FamilyModelJson.Serialize(model));
        foreach (var property in (authored["parameters"] as JObject)?.Properties() ?? []) {
            if (property.Value is not JObject parameter) continue;
            var target = (JObject)json["parameters"]![property.Name]!;
            if (target.Value<string>("propertiesGroup") is { } group)
                target["propertiesGroup"] = SetParamMetadata.Group(group).TypeId;
            if (parameter.Value<bool?>("shared") != true) {
                target["isInstance"] ??= false;
                continue;
            }
            SharedDefinitionSpec definition;
            if (!requireDeclaration && parameter.Value<string>("sharedSpecId") is { } specId) {
                definition = new SharedDefinitionSpec(property.Name, new ForgeTypeId(specId),
                    Guid: parameter["sharedGuid"]?.ToObject<Guid?>() ?? throw new InvalidOperationException("Embedded shared definition requires sharedGuid."),
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
            if (parameter["sharedGuid"]?.ToObject<Guid?>() is { } requested && requested != definition.Guid)
                throw new InvalidOperationException($"Shared parameter '{property.Name}' requested GUID {requested}, source defines {definition.Guid}.");
            if (requireDeclaration && parameter.Value<string>("sharedSpecId") is { } requestedSpec
                && requestedSpec != definition.DataType.TypeId)
                throw new InvalidOperationException($"Shared parameter '{property.Name}' requested data type '{requestedSpec}', APS defines '{definition.DataType.TypeId}'.");
            this._resolved[property.Name] = definition;
            this.ResolvedDefinitions[property.Name] = definition;
            target["sharedGuid"] = definition.Guid!.Value.ToString();
            target["sharedSpecId"] = definition.DataType.TypeId;
            target["sharedVisible"] = definition.Visible;
            target["sharedUserModifiable"] = definition.UserModifiable;
            target["isInstance"] ??= false;
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
