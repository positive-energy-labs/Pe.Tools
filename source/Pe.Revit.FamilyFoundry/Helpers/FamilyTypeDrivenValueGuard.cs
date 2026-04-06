using Autodesk.Revit.DB;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;

namespace Pe.Revit.FamilyFoundry.Helpers;

internal static class FamilyTypeDrivenValueGuard {
    private const double ZeroTolerance = 1e-6;

    public static List<LogEntry> ValidateLengthDrivenParameters(
        FamilyDocument famDoc,
        IEnumerable<string> parameterNames,
        string scope
    ) {
        var fm = famDoc.FamilyManager;
        var familyTypes = fm.Types.Cast<FamilyType>().OrderBy(type => type.Name, StringComparer.Ordinal).ToList();
        var logs = new List<LogEntry>();

        foreach (var parameterName in parameterNames
                     .Where(name => !string.IsNullOrWhiteSpace(name))
                     .Select(name => name.Trim())
                     .Distinct(StringComparer.Ordinal)) {
            var parameter = fm.FindParameter(parameterName);
            if (parameter == null) {
                logs.Add(new LogEntry(scope).Error(
                    $"Required driving parameter '{parameterName}' was not found."));
                continue;
            }

            if (!IsLengthLike(parameter.Definition.GetDataType()))
                continue;

            foreach (var familyType in familyTypes) {
                if (!familyType.HasValue(parameter)) {
                    logs.Add(new LogEntry(scope).Error(
                        $"Family type '{familyType.Name}' has no value for required driving parameter '{parameterName}'."));
                    continue;
                }

                var value = familyType.AsDouble(parameter);
                if (value == null || Math.Abs(value.Value) <= ZeroTolerance) {
                    logs.Add(new LogEntry(scope).Error(
                        $"Family type '{familyType.Name}' has a zero length value for required driving parameter '{parameterName}'. " +
                        "This usually means a newly added parameter defaulted to an unsafe seed value before FF geometry authoring."));
                }
            }
        }

        return logs;
    }

    private static bool IsLengthLike(ForgeTypeId dataType) =>
        dataType == SpecTypeId.Length
        || dataType == SpecTypeId.PipeSize
        || dataType == SpecTypeId.PipeDimension
        || dataType == SpecTypeId.DuctSize
        || dataType == SpecTypeId.CableTraySize
        || dataType == SpecTypeId.ConduitSize
        || dataType == SpecTypeId.SectionDimension
        || dataType == SpecTypeId.BarDiameter;
}
