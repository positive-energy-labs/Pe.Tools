using Pe.Global.PolyFill;

namespace Pe.Extensions.FamParameter;

public static class FamilyParameterParameterInfo {
    /// <summary>
    ///     Checks if the family parameter is a built-in Revit parameter
    /// </summary>
    /// <param name="param">The family parameter</param>
    /// <returns>True if the parameter is a built-in parameter</returns>
    public static bool IsBuiltInParameter(this FamilyParameter param) {
        var builtInParam = (BuiltInParameter)param.Id.Value();
        return builtInParam != BuiltInParameter.INVALID && Enum.IsDefined(typeof(BuiltInParameter), builtInParam);
    }


    // /// <summary>
    // ///     Checks if the parameter is a built-in Revit parameter
    // /// </summary>
    // /// <param name="param">The parameter</param>
    // /// <returns>True if the parameter is a built-in parameter</returns>
    // public static bool IsBuiltInParameter(this Parameter param) {
    //     if (param.Definition is not InternalDefinition internalDef)
    //         return false;
    //     var builtInParam = internalDef.BuiltInParameter;
    //     return builtInParam != BuiltInParameter.INVALID;
    // }

    /// <summary>
    ///     Gets the type/instance designation as a string ("Type" or "Instance")
    /// </summary>
    /// <param name="param">The family parameter</param>
    /// <returns>"Instance" if the parameter is an instance parameter, "Type" otherwise</returns>
    public static string GetTypeInstanceDesignation(this FamilyParameter param) =>
        param.IsInstance ? "Instance" : "Type";

    /// <summary>
    ///     Gets the type/instance designation as a string ("Type" or "Instance")
    /// </summary>
    /// <param name="isInstance">The <see cref="FamilyParameter.IsInstance" /> value</param>
    /// <returns>"Instance" if the parameter is an instance parameter, "Type" otherwise</returns>
    public static string GetTypeInstanceDesignation(bool isInstance) =>
        isInstance ? "Instance" : "Type";

    /// <summary>
    ///     Alias for Definition.Name, simply a convenience method to get the parameter name with less verbosity
    /// </summary>
    /// <param name="param">The family parameter</param>
    /// <returns>The parameter name</returns>
    public static string Name(this FamilyParameter param) => param.Definition.Name;
}