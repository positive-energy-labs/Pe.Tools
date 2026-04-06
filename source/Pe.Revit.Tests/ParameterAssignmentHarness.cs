using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamDocument.GetValue;
using Pe.Revit.Extensions.FamDocument.SetValue;

namespace Pe.Revit.Tests;

internal static class ParameterAssignmentHarness {
    internal sealed record AssignmentBenchmarkResult(
        string Label,
        string ParameterName,
        int TypeCount,
        string? Formula,
        object? RawValue,
        string? ValueString,
        bool HasValue,
        double IterationActionMs
    );

    public static AssignmentBenchmarkResult RunGlobalValueAssignment(
        Document familyDocument,
        string parameterName,
        string value,
        IReadOnlyList<string> typeNames,
        double iterationActionMs
    ) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");
        if (typeNames.Count == 0)
            throw new ArgumentException("At least one family type is required.", nameof(typeNames));

        var familyDoc = new FamilyDocument(familyDocument);
        var parameter = familyDocument.FamilyManager.get_Parameter(parameterName)
            ?? throw new InvalidOperationException($"Family parameter '{parameterName}' was not found.");

        if (!familyDoc.TrySetUnsetFormula(parameter, value, out var errorMessage)) {
            throw new InvalidOperationException(
                $"Global value assignment failed for '{parameterName}': {errorMessage}");
        }

        RevitFamilyFixtureHarness.SetCurrentType(familyDocument, typeNames[0]);
        familyDocument.Regenerate();

        return new AssignmentBenchmarkResult(
            "GlobalValueFastPath",
            parameterName,
            typeNames.Count,
            parameter.Formula,
            familyDoc.GetValue(parameter),
            familyDoc.GetValueString(parameter),
            familyDoc.HasValue(parameter),
            iterationActionMs);
    }

    public static AssignmentBenchmarkResult RunPerTypeValueAssignment(
        Document familyDocument,
        string parameterName,
        IReadOnlyDictionary<string, string> valuesByType,
        double iterationActionMs
    ) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");
        if (valuesByType.Count == 0)
            throw new ArgumentException("At least one per-type value is required.", nameof(valuesByType));

        var familyDoc = new FamilyDocument(familyDocument);
        var parameter = familyDocument.FamilyManager.get_Parameter(parameterName)
            ?? throw new InvalidOperationException($"Family parameter '{parameterName}' was not found.");

        foreach (var (typeName, value) in valuesByType) {
            RevitFamilyFixtureHarness.SetCurrentType(familyDocument, typeName);
            _ = familyDoc.SetValue(parameter, value, nameof(BuiltInCoercionStrategy.CoerceByStorageType));
        }

        RevitFamilyFixtureHarness.SetCurrentType(familyDocument, valuesByType.Keys.First());
        familyDocument.Regenerate();

        return new AssignmentBenchmarkResult(
            "PerTypeCoercionPath",
            parameterName,
            valuesByType.Count,
            parameter.Formula,
            familyDoc.GetValue(parameter),
            familyDoc.GetValueString(parameter),
            familyDoc.HasValue(parameter),
            iterationActionMs);
    }
}
