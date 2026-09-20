using Autodesk.Revit.DB.Electrical;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;
using Pe.Revit.Extensions.FamDocument.SetValue;
using Pe.Revit.Extensions.FamDocument.SetValue.Utils;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Extensions.FamDocument;

public static class FamilyDocumentNormalizeParameter {
    /// <summary>Native same-spec replacement preserves values and references. No stale source handle escapes.</summary>
    public static FamilyParameter ReplaceDefinition(this FamilyDocument document, FamilyParameter source,
        string name, ExternalDefinition? shared, ForgeTypeId group, bool instance) {
        using var transaction = new SubTransaction(document.Document);
        transaction.Start();
        var fm = document.FamilyManager;
        var sourceName = source.Definition.Name;
        try {
        if (shared is not null && source.Definition.GetDataType() != shared.GetDataType())
            throw new InvalidOperationException($"Cannot natively replace '{source.Definition.Name}' with a different data type.");
        var replacement = source;
        // Shared replacement cannot create an external definition while another parameter owns its name.
        if (!source.IsShared && shared is not null && source.Definition.Name == shared.Name)
            fm.RenameParameter(source, "FF_Transfer_" + Guid.NewGuid().ToString("N"));
        // A shared source always leaves through a unique temporary family name: replacing it straight to `name` fails natively when
        // it already holds that name ("The parameter 'X' is already in use", shared→family same-name). The rename below restores `name`;
        // any failure rolls this sub-transaction back, so the temporary name never survives.
        else if (source.IsShared)
            replacement = fm.ReplaceParameter(source, "FF_Transfer_" + Guid.NewGuid().ToString("N"), group, instance);
        if (shared is not null) replacement = fm.ReplaceParameter(replacement, shared, group, instance);
        else {
            if (replacement.Definition.Name != name) fm.RenameParameter(replacement, name);
            if (replacement.Definition is InternalDefinition definition && definition.GetGroupTypeId() != group) definition.SetGroupTypeId(group);
            if (replacement.IsInstance != instance) { if (instance) fm.MakeInstance(replacement); else fm.MakeType(replacement); }
        }
        if (transaction.Commit() != TransactionStatus.Committed) throw new InvalidOperationException($"Replacement of '{name}' did not commit.");
        return replacement;
        } catch (Autodesk.Revit.Exceptions.InvalidOperationException exception) {
            throw new InvalidOperationException($"Replacing '{sourceName}' with '{name}' (shared: {shared?.Name ?? "no"}, instance: {instance}) failed natively: {exception.Message}", exception);
        }
    }

    /// <summary>
    ///     Destination values win. Transfer source references, honoring exact connector routes, then remove the source; any failure rolls back.
    ///     Returns the named notes: the source formula that could not cross, whose per-type values <paramref name="strategy" /> carried instead,
    ///     and each value it left uncarried for want of a declared unit (<paramref name="unit" />).
    /// </summary>
    public static List<string> TransferAndRemoveParameter(this FamilyDocument document, FamilyParameter source, FamilyParameter target,
        IReadOnlyDictionary<BuiltInParameter, string>? associationRoutes = null, string strategy = "CoerceByStorageType", string? sourceLabel = null,
        ForgeTypeId? unit = null) {
        if (source.IsBuiltInParameter()) throw new InvalidOperationException("Revit-owned built-in parameters cannot be removed.");
        if (source.Id == target.Id) throw new InvalidOperationException("Source and destination must be distinct parameters.");
        var fm = document.FamilyManager;
        var dependents = source.GetDependents(fm.Parameters).ToList();
        var targetDependsOnSource = dependents.Any(dependent => dependent.Id == target.Id);
        var targetIsExactAlias = targetDependsOnSource && fm.Parameters.TryGetSingleReference(target.Formula)?.Id == source.Id;
        // The source reads exactly the destination, directly or through exact aliases (`Mech Equip Model Number = Model` where the built-in
        // `Model = PE_G___Model`): its value is the destination's in every type, and its dependents are rewritten to the destination below,
        // so not copying that circular formula loses nothing.
        var sourceIsExactAlias = FamilyFormulaCopy.IsExactAliasOf(fm.Parameters, source, target);
        var notes = new List<string>();
        if (targetDependsOnSource && !targetIsExactAlias)
            throw new InvalidOperationException(
                $"Cannot remove source '{source.Definition.Name}': destination '{target.Definition.Name}' formula '{target.Formula}' depends on the source but is not an exact alias. Refusing to discard formula intent.");
        var targetValues = targetIsExactAlias
            ? fm.Types.Cast<FamilyType>().Select(type => (Type: type, Value: document.GetValue(type, target))).ToList()
            : [];
        var associations = source.AssociatedParameters.Cast<Parameter>().Select(parameter => {
            var builtIn = (parameter.Definition as InternalDefinition)?.BuiltInParameter ?? BuiltInParameter.INVALID;
            if (parameter.Element is not ConnectorElement || associationRoutes?.TryGetValue(builtIn, out var routedName) != true)
                return (Parameter: parameter, Target: target);
            var routed = fm.get_Parameter(routedName) ?? throw new InvalidOperationException(
                $"Cannot route connector association '{parameter.Definition.Name}' to missing family parameter '{routedName}'.");
            if (routed.Id == source.Id)
                throw new InvalidOperationException($"Cannot remove source '{source.Definition.Name}' while connector association '{parameter.Definition.Name}' routes back to it.");
            return (Parameter: parameter, Target: routed);
        }).ToList();
        using var transaction = new SubTransaction(document.Document);
        transaction.Start();
        var originalType = fm.CurrentType;
        var sourceName = sourceLabel ?? source.Definition.Name;
        try {
            var temporary = "FF_Transfer_" + Guid.NewGuid().ToString("N");
            if (source.IsShared) source = fm.ReplaceParameter(source, temporary, source.Definition.GetGroupTypeId(), source.IsInstance);
            else fm.RenameParameter(source, temporary);
            var dimensions = source.AssociatedDimensions(document).ToList();
            var arrays = source.AssociatedArrays(document).ToList();
            foreach (var (parameter, associationTarget) in associations) {
                var diagnostic = AssociationDiagnostic(source, associationTarget, parameter, fm);
                if (!fm.CanElementParameterBeAssociated(parameter))
                    throw new InvalidOperationException($"Cannot transfer parameter association. {diagnostic}");
                try {
                    fm.AssociateElementParameterToFamilyParameter(parameter, null);
                    fm.AssociateElementParameterToFamilyParameter(parameter, associationTarget);
                } catch (Exception exception) {
                    throw new InvalidOperationException($"Cannot transfer parameter association. {diagnostic}", exception);
                }
            }
            document.LabelDimensions(dimensions.Select(dimension => (dimension, target)));
            foreach (var array in arrays) array.Label = target;
            // A source formula is intent the destination keeps (kaitpw 2026-09-08). One that cannot cross is dropped with a named note, and each
            // type's value is carried by the mapping's strategy instead (ruling-ff-coercion 2026-09-18): never across data types (R1), nor where
            // Revit refuses it. Only a value the strategy cannot carry refuses, by name; the transfer then rolls back whole.
            if (!targetIsExactAlias && !sourceIsExactAlias && !string.IsNullOrEmpty(source.Formula) && string.IsNullOrEmpty(target.Formula)) {
                var formula = source.Formula;
                var blocker = FamilyFormulaCopy.Blocker(fm.Parameters, formula, source.Definition.GetDataType(), target.Definition.GetDataType(), target.IsInstance);
                if (blocker is null)
                    try { fm.SetFormula(target, formula); }
                    catch (Autodesk.Revit.Exceptions.ApplicationException) { blocker = FamilyFormulaCopy.NativeRefusal; }
                if (blocker is not null) {
                    var (refusals, reports) = FamilyFormulaCopy.Carry(document, source, sourceName, target, strategy, keep: true, unit);
                    if (refusals.FirstOrDefault() is { } refusal) throw new InvalidOperationException(refusal);
                    notes.Add(FamilyFormulaCopy.DroppedNote(formula, sourceName, target.Definition.Name, blocker, strategy));
                    notes.AddRange(reports);
                }
            }
            if (targetIsExactAlias) {
                fm.SetFormula(target, null!);
                foreach (var (type, value) in targetValues.Where(item => item.Value is not null)) {
                    if (fm.CurrentType != type) fm.CurrentType = type;
                    if (document.SetValue(target, value) is null)
                        throw new InvalidOperationException($"Failed to materialize destination '{target.Definition.Name}' for family type '{type.Name}'.");
                }
            }
            foreach (var dependent in dependents.Where(dependent => dependent.Id != target.Id)) {
                // A dependent found through a label or association carries no formula; only formula text is rewritten here.
                if (string.IsNullOrEmpty(dependent.Formula)) continue;
                var formula = dependent.Formula.Replace(temporary, target.Definition.Name);
                try { fm.SetFormula(dependent, formula); }
                catch (Exception exception) {
                    throw new InvalidOperationException(
                        $"Failed to transfer formula on '{dependent.Definition.Name}' from source '{sourceName}' to destination '{target.Definition.Name}'. Attempted formula: {formula}", exception);
                }
            }
            if (source.HasAnyAssociation(document)) throw new InvalidOperationException($"Source '{temporary}' still has dependencies.");
            fm.RemoveParameter(source);
        } finally {
            if (originalType is not null && fm.CurrentType != originalType) fm.CurrentType = originalType;
        }
        if (transaction.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Source transfer did not commit.");
        return notes;
    }

    /// <summary>Renames a parameter out of the way under a unique temporary name, keeping its values and references; returns that name.</summary>
    public static string StepAside(FamilyManager fm, FamilyParameter parameter) {
        var temporary = "FF_Retype_" + Guid.NewGuid().ToString("N");
        if (parameter.IsShared) fm.ReplaceParameter(parameter, temporary, parameter.Definition.GetGroupTypeId(), parameter.IsInstance);
        else fm.RenameParameter(parameter, temporary);
        return temporary;
    }

    private static string AssociationDiagnostic(FamilyParameter source, FamilyParameter target, Parameter elementParameter, FamilyManager manager) {
        var element = elementParameter.Element;
        var builtIn = (elementParameter.Definition as InternalDefinition)?.BuiltInParameter ?? BuiltInParameter.INVALID;
        static string Spec(Definition definition) => definition.GetDataType().TypeId;
        return $"Source='{source.Definition.Name}' Id={source.Id} Storage={source.StorageType} Spec={Spec(source.Definition)} Instance={source.IsInstance}; " +
               $"Destination='{target.Definition.Name}' Id={target.Id} Storage={target.StorageType} Spec={Spec(target.Definition)} Instance={target.IsInstance}; " +
               $"Element={element.GetType().Name} Id={element.Id}; ElementParameter='{elementParameter.Definition.Name}' Id={elementParameter.Id} " +
               $"BIP={builtIn} Storage={elementParameter.StorageType} Spec={Spec(elementParameter.Definition)} CanAssociate={manager.CanElementParameterBeAssociated(elementParameter)}.";
    }
}

/// <summary>The one rule for carrying a source formula to its destination; preparation (preview) and transfer (apply) both read it.</summary>
public static class FamilyFormulaCopy {
    public const string NativeRefusal = "Revit refused it";

    private static string Scope(bool instance) => instance ? "instance" : "type";

    /// <summary>
    ///     Why a source formula cannot be copied onto the destination, or null when Revit is asked. Scope is its own clause so a scope
    ///     strategy (the open instance->type question, ruling-ff-coercion) slots in here.
    /// </summary>
    public static string? Blocker(FamilyParameterSet parameters, string formula, ForgeTypeId sourceSpec, ForgeTypeId targetSpec, bool targetInstance) {
        if (sourceSpec != targetSpec) return $"{sourceSpec.TypeId} → {targetSpec.TypeId}: a formula is not copied across data types";
        if (targetInstance) return null;
        var reads = parameters.GetReferencedIn(formula).Where(p => p.IsInstance).Select(p => $"'{p.Definition.Name}'").ToList();
        return reads.Count == 0 ? null : $"a type parameter cannot read instance parameter{(reads.Count > 1 ? "s" : "")} {string.Join(", ", reads)}";
    }

    public static string DroppedNote(string formula, string source, string target, string blocker, string strategy) =>
        $"formula `{formula}` on '{source}' not copied to '{target}' ({blocker}); per-type values carried by {strategy}";

    /// <summary>
    ///     Carries every family type's value of <paramref name="source" /> into <paramref name="target" /> under <paramref name="strategy" />
    ///     and the mapping's declared <paramref name="unit" />, one sub-transaction per value. Refusals name each value the strategy cannot carry;
    ///     reports name each bare number left uncarried for want of a declared unit (ruling 2026-09-19: reported, never a family refusal).
    ///     <paramref name="keep" /> false rolls every write back (preview).
    /// </summary>
    public static (List<string> Refusals, List<string> Reports) Carry(FamilyDocument document, FamilyParameter source, string sourceName,
        FamilyParameter target, string strategy, bool keep, ForgeTypeId? unit = null) {
        var fm = document.FamilyManager;
        var coercion = ParamCoercionStrategyRegistry.Get(strategy);
        var refusals = new List<string>();
        var reports = new List<string>();
        var originalType = fm.CurrentType;
        try {
            foreach (var type in fm.Types.Cast<FamilyType>().ToList()) {
                if (fm.CurrentType != type) fm.CurrentType = type;
                var context = CoercionContext.FromParam(document, source, target, unit);
                if (context.SourceValue is null) continue;
                using var attempt = new SubTransaction(document.Document);
                attempt.Start();
                Exception? failure = new ArgumentException($"{strategy} cannot carry it");
                try {
                    if (coercion.CanMap(context)) failure = coercion.Map(context).AsTuple().error;
                } catch (Exception exception) { failure = exception; }
                if (failure is null && keep) attempt.Commit();
                else attempt.RollBack();
                if (failure is not null)
                    (failure is MissingUnitException ? reports : refusals).Add(NotCarried(document, source, sourceName, context.SourceValueString ?? context.SourceValue,
                        target, type.Name, strategy, failure));
            }
        } finally {
            if (originalType is not null && fm.CurrentType != originalType) fm.CurrentType = originalType;
        }
        return (refusals, reports);
    }

    /// <summary>One uncarried value by name: family, source, value, type, destination and strategy. A missing unit is reported, anything else refused.</summary>
    public static string NotCarried(FamilyDocument document, FamilyParameter source, string sourceName, object? value, FamilyParameter target,
        string type, string strategy, Exception failure) =>
        $"Family '{document.Document.Title}': {(failure is MissingUnitException ? "did not carry" : "cannot carry")} '{sourceName}' value '{value}' " +
        $"({source.Definition.GetDataType().TypeId}, {Scope(source.IsInstance)}) into '{target.Definition.Name}' " +
        $"({target.Definition.GetDataType().TypeId}, {Scope(target.IsInstance)}) in type '{type}' under {strategy}: {failure.Message}";

    /// <summary>
    ///     True when <paramref name="source" />'s formula is exactly <paramref name="target" />'s name, or exactly the name of a parameter whose
    ///     formula is, and so on (cycle-guarded). Such a source equals the destination in every type.
    /// </summary>
    public static bool IsExactAliasOf(FamilyParameterSet parameters, FamilyParameter source, FamilyParameter target) {
        var seen = new HashSet<long> { source.Id.Value() };
        for (var next = parameters.TryGetSingleReference(source.Formula); next is not null; next = parameters.TryGetSingleReference(next.Formula)) {
            if (next.Id == target.Id) return true;
            if (!seen.Add(next.Id.Value())) return false;
        }
        return false;
    }
}
