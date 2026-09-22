using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamParameter.Formula;

namespace Pe.Revit.Extensions.FamParameter;

public static class FamilyParameterGetAssociated {
    /// <summary>
    ///     Get the associated linear, radial, and angular dimensions for a family parameter
    /// </summary>
    /// <param name="param">The family parameter</param>
    /// <param name="doc">The family document</param>
    /// <returns>The associated dimensions</returns>
    public static IEnumerable<Dimension> AssociatedDimensions(this FamilyParameter param, FamilyDocument doc) {
        return new FilteredElementCollector(doc)
            .OfClass(typeof(Dimension))
            .Cast<Dimension>().Where(dimension => {
                try { return dimension.FamilyLabel?.Id == param.Id; }
                // Native dimensions that cannot be labeled have no family-parameter association.
                catch (Autodesk.Revit.Exceptions.InvalidOperationException) { return false; }
            }).ToList();
    }


    /// <summary>
    ///     Get the associated arrays for a family parameter
    /// </summary>
    /// <param name="param">The family parameter</param>
    /// <param name="doc">The family document</param>
    /// <returns>The associated arrays</returns>
    public static IEnumerable<BaseArray> AssociatedArrays(this FamilyParameter param, FamilyDocument doc) {
        if (param.Definition.GetDataType() != SpecTypeId.Int.Integer)
            return new List<BaseArray>();

        // ponytail: scan elements because BaseArray is not a supported native class filter; narrow after a proven filter exists.
        return new FilteredElementCollector(doc)
            .WhereElementIsNotElementType()
            .OfType<BaseArray>()
            .Where(array => array.Label?.Id == param.Id).ToList();
    }

    /// <summary>
    ///     Get the associated connectors (electrical, mechanical, piping) for a family parameter.
    ///     Returns connectors that have at least one parameter associated with the given family parameter.
    /// </summary>
    /// <param name="param">The family parameter</param>
    /// <param name="doc">The family document</param>
    /// <returns>The associated connector elements</returns>
    public static IEnumerable<ConnectorElement> AssociatedConnectors(this FamilyParameter param, FamilyDocument doc) {
        var connectors = new FilteredElementCollector(doc)
            .OfClass(typeof(ConnectorElement))
            .Cast<ConnectorElement>();

        foreach (var connector in connectors) {
            foreach (Parameter connectorParam in connector.Parameters) {
                var associated = doc.FamilyManager.GetAssociatedFamilyParameter(connectorParam);
                if (associated?.Id == param.Id) {
                    yield return connector;
                    break; // Found a match, no need to check other parameters on this connector
                }
            }
        }
    }

    /// <summary>
    ///     Checks if the family parameter has any DIRECT physical associations
    ///     (element parameters, dimensions, arrays, connectors).
    ///     Does NOT include formula dependencies - use <see cref="FormulaDependencies.GetDependents" /> for that.
    ///     Filters out phantom parameters (negative IDs or elements that don't exist in the document).
    /// </summary>
    /// <param name="param">The family parameter</param>
    /// <param name="doc">The family document</param>
    /// <returns>True if the parameter has any direct physical associations</returns>
    public static bool HasDirectAssociation(this FamilyParameter param, FamilyDocument doc) =>
        param.AssociatedParameters
            .Cast<Parameter>().Any(p => p.Element is { IsValidObject: true }) ||
        param.AssociatedArrays(doc).Any() ||
        param.AssociatedDimensions(doc).Any() ||
        param.AssociatedConnectors(doc).Any();

    /// <summary>
    ///     Checks if the family parameter has any associations
    ///     (direct physical associations OR formula dependents)
    /// </summary>
    /// <param name="param">The family parameter</param>
    /// <param name="doc">The family document</param>
    /// <returns>True if the parameter has any associations</returns>
    public static bool HasAnyAssociation(this FamilyParameter param, FamilyDocument doc) =>
        param.HasDirectAssociation(doc) || param.GetDependents(doc.FamilyManager.Parameters).Any();
}
