using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamDocument.SetValue;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Extensions.FamParameter;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>Source migration precedes explicit authored writes. Destination state wins; source references transfer before removal.</summary>
public sealed class NormalizeParamSources(FamilyModel desired, IReadOnlyCollection<string> authoredNames, Func<string, ExternalDefinition?> sharedSource,
    IReadOnlyCollection<string>? targets = null, ElectricalConnectorParameterRule? connectorRule = null, IReadOnlyList<BlankRule>? blanks = null,
    bool backlinkBuiltIns = true)
    : DocOperation<DefaultOperationSettings>(new()) {
    public override string Description => "Normalize explicit parameter sources and shared identities";

    /// <summary>
    ///     Each value the last Execute left uncarried for want of a declared mappingUnit, by name (ruling 2026-09-19: reported, never a family
    ///     refusal). Its source is kept, so nothing the person never saw is lost. The receipt carries them as run effects.
    /// </summary>
    public List<string> Reports { get; } = [];

    /// <summary>What a report adds when its source stays: a re-run with mappingUnit declared carries the values and removes it.</summary>
    public static string Kept(string source) => $"; source '{source}' kept so its values are not lost";

    private readonly Dictionary<string, ForgeTypeId?> units = new(StringComparer.Ordinal);

    private List<KeyValuePair<string, FamilyModelParameter>> Mappings() => desired.Parameters.Where(p => targets?.Contains(p.Key) == true || targets is null &&
        authoredNames.Contains(p.Key) && (p.Value.WasNamed is { Count: > 0 } || p.Value.Shared.HasValue)).ToList();

    /// <summary>
    ///     Whether some value could be left uncarried for want of a mappingUnit: a bare present source (Number, Integer, text), or a bare destination
    ///     stepping aside, into a measured destination that declares none. Preview runs this operation (rolled back) only then, so its Reports are
    ///     the plan's (FamilyPreparation.UncarriedValues).
    /// </summary>
    public bool CouldNeedUnit(FamilyManager fm) => this.Mappings().Any(mapping => {
        var (name, spec) = (mapping.Key, mapping.Value);
        if (spec.MappingUnit is not null) return false;
        var to = spec.SharedSpecId is { } id ? new ForgeTypeId(id) : spec.DataType is { } data ? SetParamMetadata.Spec(data)
            : spec.Shared == true ? sharedSource(name)?.GetDataType() : fm.FindParameter(name)?.Definition.GetDataType();
        if (to is null || !UnitUtils.IsMeasurableSpec(to) || to == SpecTypeId.Number) return false;
        return (spec.WasNamed ?? []).Append(name).Select(fm.FindParameter).OfType<FamilyParameter>()
            .Any(p => p.StorageType != StorageType.ElementId && p.Definition.GetDataType() is var from && from != to &&
                      (from == SpecTypeId.Number || !UnitUtils.IsMeasurableSpec(from)));
    });

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext context, OperationContext group) {
        this.Reports.Clear();
        this.units.Clear();
        var fm = doc.FamilyManager;
        var originalType = fm.CurrentType;
        var logs = new List<LogEntry>();
        var cleanup = new List<(string Source, string Target)>();
        var sourceLabels = new Dictionary<string, string>(StringComparer.Ordinal);
        var ranking = new MapParamsSettings();
        var mappings = this.Mappings();
        var sharedCandidates = mappings.SelectMany(p => (p.Value.WasNamed ?? []).Distinct()).GroupBy(n => n)
            .Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet(StringComparer.Ordinal);
        var transfers = new List<(string Target, List<string> Sources, string Strategy, bool PreservePopulated, IReadOnlyCollection<string> MissingValues)>();
        var uncarried = new Dictionary<string, List<string>>(StringComparer.Ordinal);
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
                var strategy = (spec.MappingStrategy ?? MappingStrategy.CoerceByStorageType).ToString();
                // A destination of another data type cannot change in place. It steps aside and becomes the first-ranked source, so its values
                // cross under the mapping's strategy and its references transfer (ruling-ff-coercion 2026-09-18: coerce, don't refuse).
                string? retyped = null;
                if (existing is not null && dataType is not null && existing.Definition.GetDataType() != dataType && !existing.IsBuiltInParameter()) {
                    retyped = FamilyDocumentNormalizeParameter.StepAside(fm, existing);
                    sourceLabels[retyped] = name;
                    existing = null;
                }
                var first = candidates.Select(fm.FindParameter).FirstOrDefault(p => p is not null);
                if (retyped is not null) {
                    existing = AddParams.Create(doc, name, spec, sharedSource);
                } else if (existing is null && first is not null && !authoredNames.Contains(first.Definition.Name) && !sharedCandidates.Contains(first.Definition.Name) && !first.IsBuiltInParameter() && first.Definition.GetDataType() == dataType &&
                    strategy is "Strict" or "CoerceByStorageType") {
                    try {
                        existing = doc.ReplaceDefinition(first, name, definition, propertiesGroup, spec.IsInstance ?? false);
                        nativeReplacement = true;
                    } catch (InvalidOperationException exception) {
                        // Revit refuses some in-place replacements (observed on Old_Template dimension and capacity parameters).
                        // The sub-transaction rolled back; fall through to create-then-transfer, which moves values, formulas and associations.
                        logs.Add(new LogEntry(name).Skip($"Native replacement of '{first.Definition.Name}' refused; transferring instead. {exception.Message}"));
                        existing = AddParams.Create(doc, name, spec, sharedSource);
                        _ = context.CreatedParameters.Add(name);
                    }
                } else if (existing is null) {
                    existing = AddParams.Create(doc, name, spec, sharedSource);
                    _ = context.CreatedParameters.Add(name);
                } else if (needsShared) {
                    existing = doc.ReplaceDefinition(existing, name, definition, propertiesGroup, spec.IsInstance ?? existing.IsInstance);
                } else if (spec.Shared == false && existing.IsShared) {
                    existing = doc.ReplaceDefinition(existing, name, null, propertiesGroup, spec.IsInstance ?? existing.IsInstance);
                }
                fm = doc.FamilyManager;
                if (dataType is not null && existing.Definition.GetDataType() != dataType)
                    throw new InvalidOperationException($"'{name}' has an incompatible destination datatype.");
                this.units[name] = spec.MappingUnit is { } symbol ? MappingUnit.Resolve(existing.Definition.GetDataType(), symbol) : null;
                // The replan seeds itself from a re-capture taken after this step, so an identity that did not settle here would read as
                // converged and replan forever (rung 5b: same-named shared destinations carrying an older GUID). Say so instead.
                if (spec.Shared == true && spec.SharedGuid is { } wantedGuid && (!existing.IsShared || existing.GUID != wantedGuid))
                    throw new InvalidOperationException($"'{name}' did not take shared identity {wantedGuid}; it reads {(existing.IsShared ? existing.GUID.ToString() : "family parameter")} after {(needsShared ? "replacement" : "no replacement")}.");
                // A family-type selector sharing a legacy name (Old_Template VMB 'Voltage') carries no value to move; an ElementId source feeds only an ElementId destination.
                bool Usable(string source) => fm.FindParameter(source) is { } p && (p.StorageType != StorageType.ElementId || existing.StorageType == StorageType.ElementId);
                if (retyped is not null)
                    transfers.Add((name, [retyped, .. spec.FillBlanksFromSources == true ? candidates.Where(Usable) : []], strategy, false, spec.SourceValuesTreatedAsMissing ?? []));
                // A declared mappingUnit fills an existing destination's blank types too: the re-run that carries values a kept source still holds.
                else if (!existed || spec.FillBlanksFromSources == true || spec.MappingUnit is not null)
                    transfers.Add((name, candidates.Where(Usable).ToList(), strategy, existed || nativeReplacement, spec.SourceValuesTreatedAsMissing ?? []));
                if (retyped is not null) cleanup.Add((retyped, name));
                // Every present source is cleaned up, not only the ranked ones: ranking dedupes equal values, and a leftover source replans forever (rung 5b).
                cleanup.AddRange((spec.WasNamed ?? []).Where(source => source != name && Usable(source)).Select(source => (source, name)));
                logs.Add(new LogEntry(name).Success(existed ? "Existing destination preferred; explicit writes follow." : "Destination created from explicit source rules."));
            }
            // Definitions are stable before value copying. A source used by multiple targets cannot be consumed early.
            if (mappings.Count > 0) doc.Document.Regenerate();
            fm = doc.FamilyManager;
            var work = transfers.Select(t => (Target: fm.FindParameter(t.Target) ?? throw new InvalidOperationException($"Created target '{t.Target}' is unavailable after regeneration."),
                Sources: t.Sources.Select(fm.FindParameter).OfType<FamilyParameter>().ToList(), t.Strategy, t.PreservePopulated, t.MissingValues)).ToList();
            // Created destinations that no source fills take run.blanksBecome here, before the replan re-captures the family as its baseline.
            var created = blanks is { Count: > 0 } ? work.Where(t => context.CreatedParameters.Contains(t.Target.Definition.Name)).Select(t => t.Target).ToList() : [];
            foreach (var type in fm.Types.Cast<FamilyType>().ToList()) {
                var pending = work.Where(t => (!t.PreservePopulated || Blank(doc, type, t.Target)) &&
                    t.Sources.Any(source => !Blank(doc, type, source, t.MissingValues))).ToList();
                if (pending.Count == 0 && created.Count == 0) continue;
                if (fm.CurrentType != type) fm.CurrentType = type;
                foreach (var transfer in pending) {
                    Exception? failure = null;
                    (FamilyParameter Source, MissingUnitException Why)? unitless = null;
                    foreach (var source in transfer.Sources.Where(source => !Blank(doc, type, source, transfer.MissingValues))) {
                        using var attempt = new SubTransaction(doc.Document);
                        attempt.Start();
                        try {
                            if (doc.SetValue(transfer.Target, source, transfer.Strategy, this.units.GetValueOrDefault(transfer.Target.Definition.Name)) is null)
                                throw new InvalidOperationException("Coercion produced no value.");
                            if (attempt.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Value transfer did not commit.");
                            failure = null;
                            break;
                        } catch (Exception exception) {
                            failure = exception;
                            if (exception is MissingUnitException why) unitless ??= (source, why);
                        }
                    }
                    // A bare number with no declared unit is left uncarried and named, and its source is kept below; the family still migrates.
                    if (failure is not null && unitless is var (from, missing)) {
                        var list = uncarried.TryGetValue(from.Definition.Name, out var have) ? have : uncarried[from.Definition.Name] = [];
                        list.Add(FamilyFormulaCopy.NotCarried(doc, from, sourceLabels.GetValueOrDefault(from.Definition.Name) ?? from.Definition.Name,
                            type.AsValueString(from), transfer.Target, type.Name, transfer.Strategy, missing));
                    } else if (failure is not null)
                        throw new InvalidOperationException($"All sources failed for '{transfer.Target.Definition.Name}' in '{type.Name}': {failure.Message}", failure);
                }
                foreach (var target in created)
                    if (SetBlankValues.Fill(doc, type, target, blanks!, created: true) is { } written)
                        logs.Add(new LogEntry(target.Definition.Name).Success($"{type.Name}: blank → {written}"));
            }
            var pairs = cleanup.Distinct().ToList();
            // One source surrenders its labels, arrays and associations to one destination only: the first in mapping order. Values already
            // reached every destination above. The company mapping names one source for two destinations on purpose (run 15, 2026-09-08), so
            // this is recorded, not refused.
            foreach (var bySource in pairs.GroupBy(pair => pair.Source, StringComparer.Ordinal)) {
                var targets = bySource.Select(pair => pair.Target).Distinct(StringComparer.Ordinal).ToList();
                if (targets.Count > 1)
                    logs.Add(new LogEntry(bySource.Key).Skip($"'{bySource.Key}' is named by {string.Join(", ", targets.Select(t => $"'{t}'"))}; its labels, arrays and associations go to '{targets[0]}' only."));
            }
            foreach (var (sourceName, targetName) in pairs) {
                var source = fm.FindParameter(sourceName);
                var target = fm.FindParameter(targetName);
                if (source is null || target is null || authoredNames.Contains(sourceName)) continue;
                if (source.IsBuiltInParameter()) {
                    // A built-in cannot be removed; it reads the destination through a formula so schedules keyed on it stay right (run.backlinkBuiltIns).
                    if (!backlinkBuiltIns) { logs.Add(new LogEntry(sourceName).Skip("Revit-owned built-in source left as is; destination state wins.")); continue; }
                    try {
                        fm.SetFormula(source, targetName);
                        logs.Add(new LogEntry(sourceName).Success($"Built-in reads '{targetName}' through a formula."));
                    } catch (Autodesk.Revit.Exceptions.ApplicationException exception) {
                        logs.Add(new LogEntry(sourceName).Skip($"Built-in could not take formula '{targetName}': {exception.Message}"));
                    }
                    continue;
                }
                var label = sourceLabels.GetValueOrDefault(sourceName) ?? sourceName;
                var left = uncarried.TryGetValue(sourceName, out var found) ? found
                    : context.KeptSources.Contains(label) ? [] : this.Uncarried(doc, source, label, target, StrategyOf(targetName), this.units.GetValueOrDefault(targetName));
                if (left.Count > 0 || context.KeptSources.Contains(label)) {
                    uncarried.Remove(sourceName);
                    // A stepped-aside destination holds a temporary name; it stays under a readable one.
                    if (sourceName != label) fm.RenameParameter(source, label + " (uncarried)");
                    _ = context.KeptSources.Add(label);
                    foreach (var report in left.Select(report => report + Kept(label))) {
                        this.Reports.Add(report);
                        logs.Add(new LogEntry(sourceName).Skip(report));
                    }
                    continue;
                }
                var notes = doc.TransferAndRemoveParameter(source, target, connectorRule is null ? null : new Dictionary<BuiltInParameter, string> {
                    [BuiltInParameter.RBS_ELEC_VOLTAGE] = connectorRule.Voltage,
                    [BuiltInParameter.RBS_ELEC_NUMBER_OF_POLES] = connectorRule.NumberOfPoles,
                    [BuiltInParameter.RBS_ELEC_APPARENT_LOAD] = connectorRule.ApparentPower
                }, StrategyOf(targetName), sourceLabels.GetValueOrDefault(sourceName), this.units.GetValueOrDefault(targetName));
                // Preview already names these (FamilyPlanning.SourceFormulaCrossings); the log repeats them per source.
                foreach (var note in notes) logs.Add(new LogEntry(sourceName).Success(note));
                // TransferAndRemoveParameter commits its own sub-transaction, and Revit regenerates on commit;
                // one explicit regeneration after the loop replaces one per removed source.
                fm = doc.FamilyManager;
                logs.Add(new LogEntry(sourceName).Success($"Transferred references to '{targetName}' and removed source; destination values win."));
            }
            // A source no cleanup reached (authored, built-in) keeps its values anyway; its uncarried values are still named.
            foreach (var report in uncarried.Values.SelectMany(list => list)) {
                this.Reports.Add(report);
                logs.Add(new LogEntry("mappingUnit").Skip(report));
            }
            if (pairs.Count > 0) {
                doc.Document.Regenerate();
                fm = doc.FamilyManager;
            }
        } finally { if (originalType is not null && fm.CurrentType != originalType) fm.CurrentType = originalType; }
        return new OperationLog(this.Name, logs);
    }

    /// <summary>
    ///     A later run: the destination's blank types whose bare source value still needs a declared unit, one report each. Only a bare source
    ///     into a measured destination with no mappingUnit can need one, so every other pair skips the per-type check.
    /// </summary>
    private List<string> Uncarried(FamilyDocument doc, FamilyParameter source, string label, FamilyParameter target, string strategy, ForgeTypeId? unit) {
        var from = source.Definition.GetDataType();
        var to = target.Definition.GetDataType();
        if (unit is not null || !UnitUtils.IsMeasurableSpec(to) || to == SpecTypeId.Number || from != SpecTypeId.Number && UnitUtils.IsMeasurableSpec(from))
            return [];
        var fm = doc.FamilyManager;
        var reports = new List<string>();
        foreach (var type in fm.Types.Cast<FamilyType>().Where(type => Blank(doc, type, target) && !Blank(doc, type, source)).ToList()) {
            if (fm.CurrentType != type) fm.CurrentType = type;
            using var attempt = new SubTransaction(doc.Document);
            attempt.Start();
            try { _ = doc.SetValue(target, source, strategy); }
            catch (MissingUnitException why) { reports.Add(FamilyFormulaCopy.NotCarried(doc, source, label, type.AsValueString(source), target, type.Name, strategy, why)); }
            catch (Exception) { } // not a unit gap: removal proceeds as it always has
            attempt.RollBack();
        }
        return reports;
    }

    // The mapping's own coercion also carries a source formula's values when the formula cannot cross (FamilyFormulaCopy.Blocker).
    private string StrategyOf(string target) =>
        (desired.Parameters.GetValueOrDefault(target)?.MappingStrategy ?? MappingStrategy.CoerceByStorageType).ToString();

    private static bool Blank(FamilyDocument doc, FamilyType type, FamilyParameter parameter, IReadOnlyCollection<string>? missingValues = null) =>
        string.IsNullOrWhiteSpace(parameter.Formula) && (!type.HasValue(parameter) || parameter.StorageType == StorageType.String &&
            (string.IsNullOrWhiteSpace(type.AsString(parameter)) || missingValues?.Contains(type.AsString(parameter), StringComparer.Ordinal) == true));
}
