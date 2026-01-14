using Pe.Extensions.FamManager;
using Pe.Global;
using ParamModelRes = Pe.Global.Services.Aps.Models.ParametersApi.Parameters.ParametersResult;

namespace Pe.Extensions.FamDocument;

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


#if REVIT2025 || REVIT2026
    public static Result<SharedParameterElement> AddApsParameterSlow(
        this FamilyDocument famDoc,
        ParamModelRes apsParamModel
    ) {
        var dlOptsSource = apsParamModel.DownloadOptions;
        var parameterTypeId = dlOptsSource.GetParameterTypeId();
        var dlOpts = new ParameterDownloadOptions(
            new HashSet<ElementId>(),
            dlOptsSource.IsInstance,
            dlOptsSource.Visible,
            dlOptsSource.GetGroupTypeId());

        try {
            return ParameterUtils.DownloadParameter(famDoc, dlOpts, parameterTypeId);
        } catch (Exception downloadErr) {
            var paramMsg = $"\n{apsParamModel.Name} ({parameterTypeId})";

            switch (downloadErr.Message) {
            case { } msg when msg.Contains("Parameter with a matching name"):
                try {
                    var fm = famDoc.FamilyManager;
                    var currentParam = fm.FindParameter(apsParamModel.Name ?? string.Empty);
                    fm.RemoveParameter(currentParam);
                    return ParameterUtils.DownloadParameter(famDoc, dlOpts, parameterTypeId);
                } catch (Exception ex) {
                    return new Exception($"Recovery failed for \"matching name\" error with parameter: {paramMsg}", ex);
                }
            case { } msg when msg.Contains("Parameter with a matching GUID"):
                try {
                    return famDoc.FindParameter(parameterTypeId);
                } catch (Exception ex) {
                    return new Exception($"Recovery failed for \"matching GUID\" error with parameter: {paramMsg}", ex);
                }
            default:
                return new Exception($"Recovery skipped for unknown error: {downloadErr.Message} ", downloadErr);
            }
        }
    }
#else
    public static Result<SharedParameterElement> AddApsParameterSlow(
#pragma warning disable IDE0060 // Remove unused parameter
        this FamilyDocument famDoc,
        ParamModelRes apsParamModel
#pragma warning restore IDE0060 // Remove unused parameter
    ) => new Exception("This functionality is not available in this Revit version.");
#endif

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