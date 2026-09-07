using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Extensions.FamParameter;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>Source migration precedes explicit authored writes. Destination state wins; source references transfer before removal.</summary>
public sealed class NormalizeParamSources(FamilyModel desired, IReadOnlyCollection<string> authoredNames, Func<string, ExternalDefinition?> sharedSource, IReadOnlyCollection<string>? targets = null)
    : DocOperation<DefaultOperationSettings>(new()) {
    public override string Description => "Normalize explicit parameter sources and shared identities";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext context, OperationContext group) {
        var fm = doc.FamilyManager;
        var originalType = fm.CurrentType;
        var logs = new List<LogEntry>();
        var cleanup = new List<(string Source, string Target)>();
        var ranking = new MapParamsSettings();
        var mappings = desired.Parameters.Where(p => (targets ?? authoredNames).Contains(p.Key) && (p.Value.WasNamed is { Count: > 0 } || p.Value.Shared.HasValue)).ToList();
        var sharedCandidates = mappings.SelectMany(p => (p.Value.WasNamed ?? []).Distinct()).GroupBy(n => n)
            .Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet(StringComparer.Ordinal);
        var transfers = new List<(string Target, List<string> Sources, string Strategy, bool PreservePopulated, IReadOnlyCollection<string> MissingValues)>();
        context.PreProcessSnapshot ??= doc.Document.CaptureFamilySnapshot();
        try {
            foreach (var (name, spec) in mappings) {
                var existing = fm.FindParameter(name);
                var existed = existing is not null;
                var nativeReplacement = false;
                var candidates = ranking.GetRankedCurrParams(spec.WasNamed ?? [], fm, context, includeEmpty: true)
                    .Where(p => p.Definition.Name != name).Select(p => p.Definition.Name).ToList();
                var needsShared = spec.Shared == true && (existing is null || !existing.IsShared || existing.GUID != spec.SharedGuid || spec.SharedSpecId is { } specId && existing.Definition.GetDataType() != new ForgeTypeId(specId) || spec.SharedVisible is { } visible && (existing.Definition as InternalDefinition)?.Visible != visible || spec.SharedUserModifiable is { } modifiable && existing.UserModifiable != modifiable);
                var definition = needsShared ? sharedSource(name) ?? throw new InvalidOperationException($"No shared definition for '{name}'.") : null;
                var dataType = definition?.GetDataType() ?? (spec.DataType is { } data ? SetParamMetadata.Spec(data) : existing?.Definition.GetDataType());
                var propertiesGroup = spec.PropertiesGroup is { } pg ? SetParamMetadata.Group(pg) : new ForgeTypeId(string.Empty);
                var strategy = spec.MappingStrategy ?? "CoerceByStorageType";
                var first = candidates.Select(fm.FindParameter).FirstOrDefault(p => p is not null);
                if (existing is null && first is not null && !authoredNames.Contains(first.Definition.Name) && !sharedCandidates.Contains(first.Definition.Name) && !first.IsBuiltInParameter() && first.Definition.GetDataType() == dataType &&
                    strategy is "Strict" or "CoerceByStorageType") {
                    existing = doc.ReplaceDefinition(first, name, definition, propertiesGroup, spec.IsInstance ?? false);
                    nativeReplacement = true;
                } else if (existing is null) {
                    existing = AddParams.Create(doc, name, spec, sharedSource);
                } else if (needsShared) {
                    existing = doc.ReplaceDefinition(existing, name, definition, propertiesGroup, spec.IsInstance ?? existing.IsInstance);
                } else if (spec.Shared == false && existing.IsShared) {
                    existing = doc.ReplaceDefinition(existing, name, null, propertiesGroup, spec.IsInstance ?? existing.IsInstance);
                }
                fm = doc.FamilyManager;
                if (dataType is not null && existing.Definition.GetDataType() != dataType)
                    throw new InvalidOperationException($"'{name}' has an incompatible destination datatype.");
                if (!existed || spec.FillBlanksFromSources == true)
                    transfers.Add((name, candidates, strategy, existed || nativeReplacement, spec.SourceValuesTreatedAsMissing ?? []));
                cleanup.AddRange(candidates.Select(source => (source, name)));
                logs.Add(new LogEntry(name).Success(existed ? "Existing destination preferred; explicit writes follow." : "Destination created from explicit source rules."));
            }
            // Definitions are stable before value copying. A source used by multiple targets cannot be consumed early.
            if (mappings.Count > 0) doc.Document.Regenerate();
            fm = doc.FamilyManager;
            var work = transfers.Select(t => (Target: fm.FindParameter(t.Target) ?? throw new InvalidOperationException($"Created target '{t.Target}' is unavailable after regeneration."),
                Sources: t.Sources.Select(fm.FindParameter).OfType<FamilyParameter>().ToList(), t.Strategy, t.PreservePopulated, t.MissingValues)).ToList();
            foreach (var type in fm.Types.Cast<FamilyType>().ToList()) {
                var pending = work.Where(t => (!t.PreservePopulated || Blank(doc, type, t.Target)) &&
                    t.Sources.Any(source => !Blank(doc, type, source, t.MissingValues))).ToList();
                if (pending.Count == 0) continue;
                if (fm.CurrentType != type) fm.CurrentType = type;
                foreach (var transfer in pending) {
                    Exception? failure = null;
                    foreach (var source in transfer.Sources.Where(source => !Blank(doc, type, source, transfer.MissingValues))) {
                        using var attempt = new SubTransaction(doc.Document);
                        attempt.Start();
                        try {
                            if (doc.SetValue(transfer.Target, source, transfer.Strategy) is null) throw new InvalidOperationException("Coercion produced no value.");
                            if (attempt.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Value transfer did not commit.");
                            failure = null;
                            break;
                        } catch (Exception exception) { failure = exception; }
                    }
                    if (failure is not null) throw new InvalidOperationException($"All sources failed for '{transfer.Target.Definition.Name}' in '{type.Name}'.", failure);
                }
            }
            foreach (var (sourceName, targetName) in cleanup.Distinct()) {
                var source = fm.FindParameter(sourceName);
                var target = fm.FindParameter(targetName);
                if (source is null || target is null || authoredNames.Contains(sourceName)) continue;
                if (source.IsBuiltInParameter()) {
                    logs.Add(new LogEntry(sourceName).Skip("Revit-owned built-in source is read-only to removal; destination state wins."));
                    continue;
                }
                doc.TransferAndRemoveParameter(source, target);
                doc.Document.Regenerate();
                fm = doc.FamilyManager;
                logs.Add(new LogEntry(sourceName).Success($"Transferred references to '{targetName}' and removed source; destination values win."));
            }
        } finally { if (originalType is not null && fm.CurrentType != originalType) fm.CurrentType = originalType; }
        return new OperationLog(this.Name, logs);
    }

    private static bool Blank(FamilyDocument doc, FamilyType type, FamilyParameter parameter, IReadOnlyCollection<string>? missingValues = null) =>
        string.IsNullOrWhiteSpace(parameter.Formula) && (!type.HasValue(parameter) || parameter.StorageType == StorageType.String &&
            (string.IsNullOrWhiteSpace(type.AsString(parameter)) || missingValues?.Contains(type.AsString(parameter), StringComparer.Ordinal) == true));
}
