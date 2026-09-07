using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Extensions.FamParameter;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>Source migration precedes explicit authored writes. Untransferred sources remain in the family.</summary>
public sealed class NormalizeParamSources(FamilyModel desired, IReadOnlyCollection<string> authoredNames, Func<string, ExternalDefinition?> sharedSource)
    : DocOperation<DefaultOperationSettings>(new()) {
    public override string Description => "Normalize explicit parameter sources and shared identities";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext context, OperationContext group) {
        var fm = doc.FamilyManager;
        var originalType = fm.CurrentType;
        var logs = new List<LogEntry>();
        var cleanup = new List<(string Source, string Target)>();
        var ranking = new MapParamsSettings();
        context.PreProcessSnapshot ??= doc.Document.CaptureFamilySnapshot();
        try {
            foreach (var (name, spec) in desired.Parameters.Where(p => authoredNames.Contains(p.Key) && (p.Value.WasNamed is { Count: > 0 } || p.Value.Shared.HasValue))) {
                var existing = fm.FindParameter(name);
                var existed = existing is not null;
                var nativeReplacement = false;
                var candidates = ranking.GetRankedCurrParams(spec.WasNamed ?? [], fm, context)
                    .Where(p => p.Definition.Name != name).Select(p => p.Definition.Name).ToList();
                var needsShared = spec.Shared == true && (existing is null || !existing.IsShared || existing.GUID != spec.SharedGuid);
                var definition = needsShared ? sharedSource(name) ?? throw new InvalidOperationException($"No shared definition for '{name}'.") : null;
                var dataType = definition?.GetDataType() ?? (spec.DataType is { } data ? SetParamMetadata.Spec(data) : existing?.Definition.GetDataType());
                var propertiesGroup = spec.PropertiesGroup is { } pg ? SetParamMetadata.Group(pg) : new ForgeTypeId(string.Empty);
                var strategy = spec.MappingStrategy ?? "CoerceByStorageType";
                var first = candidates.Select(fm.FindParameter).FirstOrDefault(p => p is not null);
                if (existing is null && first is not null && !authoredNames.Contains(first.Definition.Name) && !first.IsBuiltInParameter() && first.Definition.GetDataType() == dataType &&
                    strategy is "Strict" or "CoerceByStorageType") {
                    existing = doc.ReplaceDefinition(first, name, definition, propertiesGroup, spec.IsInstance ?? false);
                    nativeReplacement = true;
                } else if (existing is null) {
                    var added = new AddParams([(name, spec)], sharedSource).Execute(doc, context, group);
                    OperationProcessor.ThrowOnErrors([added]);
                    existing = fm.FindParameter(name)!;
                } else if (needsShared) {
                    existing = doc.ReplaceDefinition(existing, name, definition, propertiesGroup, spec.IsInstance ?? existing.IsInstance);
                } else if (spec.Shared == false && existing.IsShared) {
                    existing = doc.ReplaceDefinition(existing, name, null, propertiesGroup, spec.IsInstance ?? existing.IsInstance);
                }
                if (dataType is not null && existing.Definition.GetDataType() != dataType)
                    throw new InvalidOperationException($"'{name}' has an incompatible destination datatype.");
                if (!existed || spec.FillBlanksFromSources == true) {
                    foreach (var type in fm.Types.Cast<FamilyType>().ToList()) {
                        fm.CurrentType = type;
                        if ((existed || nativeReplacement) && !Blank(doc, type, existing)) continue;
                        Exception? failure = null;
                        foreach (var sourceName in candidates) {
                            var source = fm.FindParameter(sourceName);
                            if (source is null || Blank(doc, type, source)) continue;
                            using var attempt = new SubTransaction(doc.Document);
                            attempt.Start();
                            try {
                                if (doc.SetValue(existing, source, strategy) is null) throw new InvalidOperationException("Coercion produced no value.");
                                if (attempt.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Value transfer did not commit.");
                                failure = null;
                                break;
                            } catch (Exception exception) { failure = exception; }
                        }
                        if (failure is not null) throw new InvalidOperationException($"All sources failed for '{name}' in '{type.Name}'.", failure);
                    }
                }
                cleanup.AddRange(candidates.Select(source => (source, name)));
                logs.Add(new LogEntry(name).Success(existed ? "Existing destination preferred; explicit writes follow." : "Destination created from explicit source rules."));
            }
            foreach (var (sourceName, targetName) in cleanup.Distinct()) {
                var source = fm.FindParameter(sourceName);
                var target = fm.FindParameter(targetName);
                if (source is null || target is null || authoredNames.Contains(sourceName)) continue;
                var removed = doc.TryMergeEquivalentParameter(source, target);
                logs.Add(new LogEntry(sourceName).Skip(removed ? $"Transferred dependencies and removed equivalent source into '{targetName}'." : "Retained source: values, formula, scope or datatype are not equivalent."));
            }
        } finally { if (originalType is not null) fm.CurrentType = originalType; }
        return new OperationLog(this.Name, logs);
    }

    private static bool Blank(FamilyDocument doc, FamilyType type, FamilyParameter parameter) =>
        string.IsNullOrWhiteSpace(parameter.Formula) && (!type.HasValue(parameter) || parameter.StorageType == StorageType.String && string.IsNullOrWhiteSpace(type.AsString(parameter)));
}
