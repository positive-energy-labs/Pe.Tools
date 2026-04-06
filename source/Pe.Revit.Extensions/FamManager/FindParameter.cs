namespace Pe.Extensions.FamManager;

public static class FamilyManagerFindParameter {
    /// <summary>
    ///     Find a parameter by ForgeTypeId identifier
    /// </summary>
    /// <param name="familyManager">The family manager</param>
    /// <param name="parameter">Identifier of the built-in parameter</param>
    /// <exception cref="T:Autodesk.Revit.Exceptions.ArgumentException">
    ///     ForgeTypeId does not identify a built-in parameter.
    /// </exception>
    public static FamilyParameter? FindParameter(this FamilyManager familyManager, ForgeTypeId parameter) {
        if (parameter == null) return null;
        return familyManager.GetParameter(parameter);
    }

    /// <summary>
    ///     Find a parameter by built-in parameter identifier. Returns null if the parameter is not found
    /// </summary>
    /// <param name="familyManager">The family manager</param>
    /// <param name="parameter">The built-in parameter ID</param>
    public static FamilyParameter? FindParameter(this FamilyManager familyManager, BuiltInParameter parameter) {
        if (parameter == BuiltInParameter.INVALID) return null;
        return familyManager.get_Parameter(parameter);
    }

    /// <summary>
    ///     Find a parameter by definition. Returns null if the parameter is not found
    /// </summary>
    /// <param name="familyManager">The family manager</param>
    /// <param name="definition">The internal or external definition of the parameter</param>
    public static FamilyParameter? FindParameter(this FamilyManager familyManager, Definition definition) {
        if (definition == null) return null;
        return familyManager.get_Parameter(definition);
    }

    /// <summary>
    ///     Find a shared parameter by GUID. Returns null if the parameter is not found
    /// </summary>
    /// <param name="familyManager">The family manager</param>
    /// <param name="guid">The unique id associated with the shared parameter</param>
    public static FamilyParameter? FindParameter(this FamilyManager familyManager, Guid guid) {
        if (guid == Guid.Empty) return null;
        return familyManager.get_Parameter(guid);
    }

    /// <summary>
    ///     Find a parameter by name. Returns null if the parameter is not found
    /// </summary>
    /// <param name="familyManager">The family manager</param>
    /// <param name="name">The name of the parameter to be found</param>
    public static FamilyParameter? FindParameter(this FamilyManager familyManager, string name) {
        if (name == null) return null;
        return familyManager.get_Parameter(name);
    }
}