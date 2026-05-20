namespace Pe.Revit.Extensions.Id;

public static class LabelExtensions {
    /// <summary>
    ///     Gets the user-visible name for a ForgeTypeId
    /// </summary>
    /// <exception cref="T:Autodesk.Revit.Exceptions.ArgumentException">
    ///     The ForgeTypeId is not valid in the context of the current API version
    /// </exception>
    /// <remarks>This is a modified version of the Nice3point.Revit.Extensions.LabelUtilsExtensions.ToLabel method. </remarks>
    public static string ToReadableLabel(this ForgeTypeId typeId) {
        {
            if (typeId.Empty()) return string.Empty;

            if (ParameterUtils.IsBuiltInParameter(typeId)) return LabelUtils.GetLabelForBuiltInParameter(typeId);
            if (ParameterUtils.IsBuiltInGroup(typeId)) return LabelUtils.GetLabelForGroup(typeId);
            if (typeId.TypeId == "autodesk.parameter:group-1.0.0") return LabelUtils.GetLabelForGroup(new ForgeTypeId()); // shim the incorrect APS Param Service group ForgeTypeId
            if (UnitUtils.IsUnit(typeId)) return LabelUtils.GetLabelForUnit(typeId);
            if (UnitUtils.IsSymbol(typeId)) return LabelUtils.GetLabelForSymbol(typeId);
            if (SpecUtils.IsSpec(typeId)) return LabelUtils.GetLabelForSpec(typeId);
            if (Category.IsBuiltInCategory(typeId)) return LabelUtils.GetLabelFor(Category.GetBuiltInCategory(typeId)); // Add category support
            return LabelUtils.GetLabelForDiscipline(typeId);
        }

    }
}
