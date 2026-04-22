using Pe.Revit.Extensions.FamManager;

namespace Pe.Revit.Extensions.FamDocument;

public static class FamilyDocumentAddParameter {
    /// <summary>
    ///     Add a family parameter. Returns the existing parameter if it already exists. PropertiesGroup must be a
    ///     <c>GroupTypeId</c> and DataType must be a <c>SpecTypeId</c>.
    ///     NOTE: To get a groupTypeId for "Other", use <c> new ForgeTypeId("")</c>
    /// </summary>
    public static FamilyParameter AddFamilyParameter(
        this FamilyDocument famDoc,
        string name,
        ForgeTypeId? propertiesGroup = null,
        ForgeTypeId? dataType = null,
        bool isInstance = true
    ) {
        if (dataType == null) dataType = SpecTypeId.String.Text;
        if (propertiesGroup == null) propertiesGroup = new ForgeTypeId("");

        var fm = famDoc.FamilyManager;

        var parameter = fm.FindParameter(name);
        parameter ??= fm.AddParameter(name, propertiesGroup, dataType, isInstance);
        return parameter;
    }
    public static FamilyParameter AddSharedParameter(
        this FamilyDocument famDoc,
        SharedParameterDefinition sharedParam
    ) {
        var sharedParamElement = famDoc.FamilyManager.FindParameter(sharedParam.ExternalDefinition.GUID);
        if (sharedParamElement != null) return sharedParamElement;

        return famDoc.FamilyManager.AddParameter(sharedParam.ExternalDefinition, sharedParam.GroupTypeId,
            sharedParam.IsInstance);
    }
}
