using Pe.Extensions.FamDocument;
using Pe.Extensions.FamParameter.Formula;
using Pe.Global.PolyFill;

namespace Pe.Extensions.FamParameter;

public static class FamilyParameterGetAssociated {
    /// <summary>
    ///     Get the associated linear, radial, and angular dimensions for a family parameter
    /// </summary>
    /// <param name="param">The family parameter</param>
    /// <param name="doc">The family document</param>
    /// <returns>The associated dimensions</returns>
    public static IEnumerable<Dimension> AssociatedDimensions(this FamilyParameter param, FamilyDocument doc) {
        var provider = new ParameterValueProvider(new ElementId(BuiltInParameter.DIM_LABEL));
        var rule = new FilterElementIdRule(provider, new FilterNumericEquals(), param.Id);
        var paramFilter = new ElementParameterFilter(rule);

        var dimensionTypes = new List<Type> { typeof(Dimension) };
        var dimensionFilter = new ElementMulticlassFilter(dimensionTypes);

        var combinedFilter = new LogicalAndFilter(dimensionFilter, paramFilter);

        return new FilteredElementCollector(doc)
            .WherePasses(combinedFilter)
            .Cast<Dimension>();
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

        return new FilteredElementCollector(doc)
            .OfClass(typeof(BaseArray))
            .Cast<BaseArray>()
            .Where(array => array.Label?.Id == param.Id);
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
            .Cast<Parameter>().Any(p => p.Id.Value() >= 0 && doc.Document.GetElement(p.Id) != null) ||
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