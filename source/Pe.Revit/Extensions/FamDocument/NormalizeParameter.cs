using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;

namespace Pe.Revit.Extensions.FamDocument;

public static class FamilyDocumentNormalizeParameter {
    /// <summary>Native same-spec replacement preserves values and references. No stale source handle escapes.</summary>
    public static FamilyParameter ReplaceDefinition(this FamilyDocument document, FamilyParameter source,
        string name, ExternalDefinition? shared, ForgeTypeId group, bool instance) {
        using var transaction = new SubTransaction(document.Document);
        transaction.Start();
        var fm = document.FamilyManager;
        if (shared is not null && source.Definition.GetDataType() != shared.GetDataType())
            throw new InvalidOperationException($"Cannot natively replace '{source.Definition.Name}' with a different data type.");
        var replacement = source;
        // Shared replacement cannot create an external definition while another parameter owns its name.
        if (!source.IsShared && shared is not null && source.Definition.Name == shared.Name)
            fm.RenameParameter(source, "FF_Transfer_" + Guid.NewGuid().ToString("N"));
        else if (source.IsShared)
            replacement = fm.ReplaceParameter(source, shared is null ? name : "FF_Transfer_" + Guid.NewGuid().ToString("N"), group, instance);
        if (shared is not null) replacement = fm.ReplaceParameter(replacement, shared, group, instance);
        else {
            if (replacement.Definition.Name != name) fm.RenameParameter(replacement, name);
            if (replacement.Definition is InternalDefinition definition && definition.GetGroupTypeId() != group) definition.SetGroupTypeId(group);
            if (replacement.IsInstance != instance) { if (instance) fm.MakeInstance(replacement); else fm.MakeType(replacement); }
        }
        if (transaction.Commit() != TransactionStatus.Committed) throw new InvalidOperationException($"Replacement of '{name}' did not commit.");
        return replacement;
    }

    /// <summary>Destination values win. Transfer all source references, then remove the source; any failure rolls back.</summary>
    public static void TransferAndRemoveParameter(this FamilyDocument document, FamilyParameter source, FamilyParameter target) {
        if (source.IsBuiltInParameter()) throw new InvalidOperationException("Revit-owned built-in parameters cannot be removed.");
        if (source.Id == target.Id) throw new InvalidOperationException("Source and destination must be distinct parameters.");
        using var transaction = new SubTransaction(document.Document);
        transaction.Start();
        var fm = document.FamilyManager;
        var sourceName = source.Definition.Name;
        var temporary = "FF_Transfer_" + Guid.NewGuid().ToString("N");
        if (source.IsShared) source = fm.ReplaceParameter(source, temporary, source.Definition.GetGroupTypeId(), source.IsInstance);
        else fm.RenameParameter(source, temporary);
        var dimensions = source.AssociatedDimensions(document).ToList();
        var arrays = source.AssociatedArrays(document).ToList();
        foreach (var parameter in source.AssociatedParameters.Cast<Parameter>().ToList()) {
            var diagnostic = AssociationDiagnostic(source, target, parameter, fm);
            if (!fm.CanElementParameterBeAssociated(parameter))
                throw new InvalidOperationException($"Cannot transfer parameter association. {diagnostic}");
            try {
                fm.AssociateElementParameterToFamilyParameter(parameter, null);
                fm.AssociateElementParameterToFamilyParameter(parameter, target);
            } catch (Exception exception) {
                throw new InvalidOperationException($"Cannot transfer parameter association. {diagnostic}", exception);
            }
        }
        document.LabelDimensions(dimensions.Select(dimension => (dimension, target)));
        foreach (var array in arrays) array.Label = target;
        foreach (var dependent in source.GetDependents(fm.Parameters).ToList()) {
            var formula = dependent.Formula.Replace(temporary, target.Definition.Name);
            try { fm.SetFormula(dependent, formula); }
            catch (Exception exception) {
                throw new InvalidOperationException(
                    $"Failed to transfer formula on '{dependent.Definition.Name}' from source '{sourceName}' to destination '{target.Definition.Name}'. Attempted formula: {formula}", exception);
            }
        }
        if (source.HasAnyAssociation(document)) throw new InvalidOperationException($"Source '{temporary}' still has dependencies.");
        fm.RemoveParameter(source);
        if (transaction.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Source transfer did not commit.");
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
