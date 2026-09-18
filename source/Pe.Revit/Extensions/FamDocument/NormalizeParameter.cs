using Autodesk.Revit.DB.Electrical;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;
using Pe.Revit.Extensions.FamDocument.SetValue;

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
    ///     Returns the named note when the source formula was not copied but evaluated per type and coerced by <paramref name="strategy" />.
    /// </summary>
    public static string? TransferAndRemoveParameter(this FamilyDocument document, FamilyParameter source, FamilyParameter target,
        IReadOnlyDictionary<BuiltInParameter, string>? associationRoutes = null, string strategy = "CoerceByStorageType") {
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
        string? note = null;
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
        var sourceName = source.Definition.Name;
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
            // A source formula is intent the destination keeps (kaitpw 2026-09-08). Native refusal rolls back the whole transfer, and names
            // its cause so a corpus run reads as a census (circular, data type, type/instance). Across a data-type change the formula is never
            // copied: Revit re-reads bare numbers in project units (user ruling R1, 2026-09-18). A unit-aware mapping strategy evaluates it per
            // type instead; any other strategy refuses.
            if (!targetIsExactAlias && !sourceIsExactAlias && !string.IsNullOrEmpty(source.Formula) && string.IsNullOrEmpty(target.Formula)) {
                var formula = source.Formula;
                string Refusal(string reason) => FamilyFormulaCopy.Refusal(document.Document.Title, formula, sourceName, source, target, reason);
                if (source.Definition.GetDataType() != target.Definition.GetDataType()) {
                    var coercion = FamilyFormulaCopy.AcrossDataTypes(strategy, source.Definition.GetDataType(), target.Definition.GetDataType())
                                   ?? throw new InvalidOperationException(Refusal(FamilyFormulaCopy.NoUnitAwareStrategy(strategy)));
                    foreach (var type in fm.Types.Cast<FamilyType>().ToList()) {
                        if (fm.CurrentType != type) fm.CurrentType = type;
                        var context = CoercionContext.FromParam(document, source, target);
                        if (context.SourceValue is null) continue;
                        if (!coercion.CanMap(context))
                            throw new InvalidOperationException(Refusal($"{strategy} cannot coerce '{context.SourceValueString ?? context.SourceValue}' in type '{type.Name}'"));
                        var (_, error) = coercion.Map(context);
                        if (error is not null) throw new InvalidOperationException(Refusal($"{strategy} failed in type '{type.Name}': {error.Message}"), error);
                    }
                    note = FamilyFormulaCopy.EvaluatedNote(formula, sourceName, target.Definition.Name, strategy);
                } else {
                    try { fm.SetFormula(target, formula); }
                    catch (Autodesk.Revit.Exceptions.ApplicationException exception) {
                        throw new InvalidOperationException(Refusal(exception.Message), exception);
                    }
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
        return note;
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
    private static string Scope(bool instance) => instance ? "instance" : "type";

    public static string Refusal(string family, string formula, string source, ForgeTypeId sourceSpec, bool sourceInstance,
        string target, ForgeTypeId targetSpec, bool targetInstance, string reason) =>
        $"Family '{family}': cannot copy formula '{formula}' from source '{source}' ({sourceSpec.TypeId}, {Scope(sourceInstance)}) " +
        $"to destination '{target}' ({targetSpec.TypeId}, {Scope(targetInstance)}): {reason}";

    public static string Refusal(string family, string formula, string sourceName, FamilyParameter source, FamilyParameter target, string reason) =>
        Refusal(family, formula, sourceName, source.Definition.GetDataType(), source.IsInstance,
            target.Definition.Name, target.Definition.GetDataType(), target.IsInstance, reason);

    public static string NoUnitAwareStrategy(string strategy) =>
        $"data types differ and mapping strategy '{strategy}' does not convert through units (Revit would re-read bare numbers in project units)";

    public static string EvaluatedNote(string formula, string source, string target, string strategy) =>
        $"formula `{formula}` on '{source}' not copied to '{target}'; per-type values evaluated and coerced by {strategy}";

    /// <summary>
    ///     The unit-aware strategy that may carry values from <paramref name="sourceSpec" /> to <paramref name="targetSpec" />, or null.
    ///     Spec-level gate only; each value still has to pass the strategy's own CanMap at transfer.
    /// </summary>
    public static ICoercionStrategy? AcrossDataTypes(string strategy, ForgeTypeId sourceSpec, ForgeTypeId targetSpec) =>
        ParamCoercionStrategyRegistry.UnitAware(strategy) is { } coercion && strategy switch {
            "CoerceElectrical" => targetSpec.TypeId.Contains(".electrical:"),
            nameof(BuiltInCoercionStrategy.CoerceMeasurableToNumber) => targetSpec == SpecTypeId.Number && UnitUtils.IsMeasurableSpec(sourceSpec),
            _ => false
        } ? coercion : null;

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
