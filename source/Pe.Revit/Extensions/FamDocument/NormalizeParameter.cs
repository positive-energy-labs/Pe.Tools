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
        // A temporary local name also handles shared-to-shared replacement with the same display name.
        var replacement = fm.ReplaceParameter(source, "FF_Transfer_" + Guid.NewGuid().ToString("N"), group, instance);
        if (shared is not null) replacement = fm.ReplaceParameter(replacement, shared, group, instance);
        else fm.RenameParameter(replacement, name);
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
        var temporary = "FF_Transfer_" + Guid.NewGuid().ToString("N");
        source = fm.ReplaceParameter(source, temporary, source.Definition.GetGroupTypeId(), source.IsInstance);
        var dimensions = source.AssociatedDimensions(document).ToList();
        var arrays = source.AssociatedArrays(document).ToList();
        foreach (var parameter in source.AssociatedParameters.Cast<Parameter>().ToList()) {
            if (!fm.CanElementParameterBeAssociated(parameter)) throw new InvalidOperationException($"Cannot transfer association to '{target.Definition.Name}'.");
            fm.AssociateElementParameterToFamilyParameter(parameter, null);
            fm.AssociateElementParameterToFamilyParameter(parameter, target);
        }
        foreach (var dimension in dimensions) dimension.FamilyLabel = target;
        foreach (var array in arrays) array.Label = target;
        foreach (var dependent in source.GetDependents(fm.Parameters).ToList())
            fm.SetFormula(dependent, dependent.Formula.Replace(temporary, target.Definition.Name));
        if (source.HasAnyAssociation(document)) throw new InvalidOperationException($"Source '{temporary}' still has dependencies.");
        fm.RemoveParameter(source);
        if (transaction.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Source transfer did not commit.");
    }
}
