using Pe.Revit.FamilyFoundry.Operations;

namespace Pe.Revit.FamilyFoundry.OperationGroups;

public class CleanFamilyDocument(
    CleanFamilyDocumentSettings settings,
    IEnumerable<string> ExcludeParamNames
) : OperationGroup<CleanFamilyDocumentSettings>(
    "Clean family document.",
    InitializeOperations(settings, ExcludeParamNames),
    []
) {
    public static List<IOperation> InitializeOperations(CleanFamilyDocumentSettings settings,
        IEnumerable<string> ExcludeParamNames) => [
        new PurgeNestedFamilies(new DefaultOperationSettings { Enabled = settings.Enabled && settings.EnablePurgeNestedFamilies }),
        new PurgeReferencePlanes(new PurgeReferencePlanesSettings { Enabled = settings.Enabled && settings.EnablePurgeReferencePlanes }),
        new PurgeModelLines(new DefaultOperationSettings { Enabled = settings.Enabled && settings.EnablePurgeModelLines }),
        new PurgeParams(new PurgeParamsSettings {
            Enabled = settings.Enabled && settings.EnablePurgeParams,
            DirectDeleteEmptyParameters = settings.PurgeParamsSettings.DirectDeleteEmptyParameters,
            ConsiderZeroValueAsEmpty = settings.PurgeParamsSettings.ConsiderZeroValueAsEmpty,
            ConsiderEmptyStringAsEmpty = settings.PurgeParamsSettings.ConsiderEmptyStringAsEmpty,
            ExcludeNames = settings.PurgeParamsSettings.ExcludeNames
        }, ExcludeParamNames)
    ];
}
