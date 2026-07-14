using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Compat;
using Pe.Shared.RevitData;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.ValueDomains;

public sealed class CategoryIdsValueDomain()
    : SettingsValueDomainBase(
        ValueDomainKeys.CategoryIds,
        SettingsRuntimeMode.LiveDocument,
        mode: SettingsOptionsMode.Constraint,
        allowsCustomValue: false) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var items = context.GetActiveDocument()
            .CollectInstanceCategories()
            .OrderBy(category => category.Name, StringComparer.OrdinalIgnoreCase)
            .Select(category => new ValueDomainOptionItem(
                category.Id.Value().ToString(),
                category.Name,
                null,
                category.Id.Value() < 0
                    ? new Dictionary<string, string> { ["builtInCategory"] = category.ToBuiltInCategory().ToString() }
                    : null))
            .ToList();
        return new(items);
    }
}

public sealed class ElementUniqueIdsValueDomain()
    : SettingsValueDomainBase(
        ValueDomainKeys.ElementUniqueIds,
        SettingsRuntimeMode.LiveDocument,
        mode: SettingsOptionsMode.Constraint,
        allowsCustomValue: false) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        if (!DocumentValueDomainContext.TryCategoryId(context, out var categoryId))
            return new([]);

        var doc = context.GetActiveDocument();
        var items = doc.CollectInstances(categoryId)
            .Select(element => {
                var type = doc.GetElement(element.GetTypeId()) as ElementType;
                var label = string.IsNullOrWhiteSpace(element.Name)
                    ? $"{element.Category?.Name} {element.Id.Value()}"
                    : $"{element.Name} · {element.Id.Value()}";
                var description = string.Join(" · ", new[] { element.Category?.Name, type?.Name }
                    .Where(value => !string.IsNullOrWhiteSpace(value)));
                return new ValueDomainOptionItem(element.UniqueId, label, description);
            })
            .OrderBy(item => item.Label, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return new(items);
    }
}

public sealed class ParameterIdentitiesValueDomain()
    : SettingsValueDomainBase(
        ValueDomainKeys.ParameterIdentities,
        SettingsRuntimeMode.LiveDocument,
        mode: SettingsOptionsMode.Constraint,
        allowsCustomValue: false) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var doc = context.GetActiveDocument();
        var elements = ResolveElements(doc, context).ToList();
        var scope = DocumentValueDomainContext.Read(context, ValueDomainContextKeys.ParameterScope) ?? "instanceThenType";
        var writableOnly = bool.TryParse(DocumentValueDomainContext.Read(context, ValueDomainContextKeys.WritableOnly), out var writable) && writable;
        var storageType = DocumentValueDomainContext.Read(context, ValueDomainContextKeys.StorageType);
        var dataTypeId = DocumentValueDomainContext.Read(context, ValueDomainContextKeys.DataTypeId);
        var candidates = new Dictionary<string, ParameterOption>(StringComparer.OrdinalIgnoreCase);

        if (!string.Equals(scope, "type", StringComparison.OrdinalIgnoreCase))
            foreach (var element in elements)
                AddParameters(element.Parameters.Cast<Parameter>(), "instance", writableOnly, storageType, dataTypeId, candidates);

        if (!string.Equals(scope, "instance", StringComparison.OrdinalIgnoreCase))
            foreach (var type in doc.ResolveElementTypes(elements))
                AddParameters(type.Parameters.Cast<Parameter>(), "type", writableOnly, storageType, dataTypeId, candidates);

        IReadOnlyList<ValueDomainOptionItem> items = candidates.Values
            .OrderBy(candidate => candidate.Identity.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(candidate => candidate.Scope, StringComparer.Ordinal)
            .Select(candidate => candidate.ToItem())
            .ToList();
        return new(items);
    }

    private static IEnumerable<Element> ResolveElements(Document doc, ValueDomainExecutionContext context) {
        var uniqueIds = DocumentValueDomainContext.Split(DocumentValueDomainContext.Read(context, ValueDomainContextKeys.ElementUniqueIds));
        if (uniqueIds.Count != 0)
            return doc.ResolveElements(uniqueIds);
        if (!DocumentValueDomainContext.TryCategoryId(context, out var categoryId))
            return [];
        return doc.CollectInstances(categoryId);
    }

    private static void AddParameters(
        IEnumerable<Parameter> parameters,
        string scope,
        bool writableOnly,
        string? storageType,
        string? dataTypeId,
        Dictionary<string, ParameterOption> candidates
    ) {
        foreach (var parameter in parameters) {
            if (parameter.Definition == null || writableOnly && parameter.IsReadOnly)
                continue;
            if (!string.IsNullOrWhiteSpace(storageType) &&
                !string.Equals(parameter.StorageType.ToString(), storageType, StringComparison.OrdinalIgnoreCase))
                continue;
            var parameterDataTypeId = parameter.Definition.GetDataType()?.TypeId;
            if (!string.IsNullOrWhiteSpace(dataTypeId) &&
                !string.Equals(parameterDataTypeId, dataTypeId, StringComparison.OrdinalIgnoreCase))
                continue;

            var identity = ParameterIdentityEngine.FromCanonical(ParameterIdentityFactory.FromParameter(parameter));
            var key = $"{identity.Key}|{scope}";
            if (!candidates.ContainsKey(key))
                candidates[key] = new ParameterOption(identity, scope, parameter.StorageType.ToString(), parameterDataTypeId);
        }
    }

    private sealed record ParameterOption(ParameterIdentity Identity, string Scope, string StorageType, string? DataTypeId) {
        public ValueDomainOptionItem ToItem() {
            var metadata = new Dictionary<string, string> {
                ["key"] = this.Identity.Key,
                ["kind"] = this.Identity.Kind.ToString(),
                ["name"] = this.Identity.Name,
                ["scope"] = this.Scope,
                ["storageType"] = this.StorageType
            };
            Add(metadata, "builtInParameterId", this.Identity.BuiltInParameterId?.ToString());
            Add(metadata, "sharedGuid", this.Identity.SharedGuid);
            Add(metadata, "parameterElementId", this.Identity.ParameterElementId?.ToString());
            Add(metadata, "dataTypeId", this.DataTypeId);
            return new ValueDomainOptionItem(
                $"{this.Identity.Key}|{this.Scope}",
                $"{this.Identity.Name} · {this.Scope}",
                this.DataTypeId,
                metadata);
        }

        private static void Add(Dictionary<string, string> metadata, string key, string? value) {
            if (!string.IsNullOrWhiteSpace(value)) metadata[key] = value;
        }
    }
}

file static class DocumentValueDomainContext {
    public static bool TryCategoryId(ValueDomainExecutionContext context, out long categoryId) =>
        long.TryParse(Read(context, ValueDomainContextKeys.CategoryId), out categoryId) && categoryId != 0;

    public static string? Read(ValueDomainExecutionContext context, string key) =>
        context.TryGetContextValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value : null;

    public static HashSet<string> Split(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split(['\n', '\r', ',', ';', '|'], StringSplitOptions.RemoveEmptyEntries)
                .Select(item => item.Trim())
                .Where(item => item.Length != 0)
                .ToHashSet(StringComparer.Ordinal);
}
