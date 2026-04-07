using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Operations;
using System.Globalization;

namespace Pe.Revit.Tests;

internal static class LookupTableTestSupport {
    public const string LookupTableNameParameterName = "LookupTableName";

    internal sealed record LookupCase(
        string Name,
        ForgeTypeId DataType,
        string ParameterName,
        string ResultValue
    );

    internal sealed record AppliedLookupCaseResult(
        LookupCase LookupCase,
        string LookupCarrierParameterName,
        string LookupFormula,
        bool LookupFormulaAccepted,
        string? LookupErrorMessage,
        string? TargetFormula,
        bool TargetFormulaAccepted,
        string? TargetErrorMessage,
        RevitFamilyFixtureHarness.ParameterValueSnapshot Snapshot
    );

    public static void EnsureLookupSupportParameters(Document familyDocument, LookupCase lookupCase) {
        EnsureTypeParameter(familyDocument, GetLookupCarrierParameterName(lookupCase), SpecTypeId.Number);

        var unitBasisParameterName = GetUnitBasisParameterName(lookupCase);
        if (!string.IsNullOrWhiteSpace(unitBasisParameterName))
            EnsureTypeParameter(familyDocument, unitBasisParameterName, lookupCase.DataType);
    }

    public static string GetLookupCarrierParameterName(LookupCase lookupCase) => $"{lookupCase.ParameterName}LookupRaw";

    public static void EnsureTypeParameter(Document familyDocument, string name, ForgeTypeId dataType) {
        var existing = familyDocument.FamilyManager.get_Parameter(name);
        if (existing != null)
            return;

        _ = RevitFamilyFixtureHarness.AddFamilyParameter(
            familyDocument,
            new RevitFamilyFixtureHarness.ParameterDefinitionSpec(name, dataType, GroupTypeId.Data, false));
    }

    public static void ConfigureUnits(
        Document familyDocument,
        params (ForgeTypeId SpecTypeId, ForgeTypeId UnitTypeId)[] unitOverrides
    ) {
        using var transaction = new Transaction(familyDocument, "Configure lookup test units");
        _ = transaction.Start();

        var units = familyDocument.GetUnits();
        foreach (var (specTypeId, unitTypeId) in unitOverrides)
            units.SetFormatOptions(specTypeId, new FormatOptions(unitTypeId));

        familyDocument.SetUnits(units);
        _ = transaction.Commit();
    }

    public static LookupTableDefinition BuildLookupTable(
        Document familyDocument,
        string tableName,
        string keyColumnName,
        string rowName,
        string lookupValue,
        IReadOnlyList<LookupCase> cases
    ) => new() {
        Schema = new LookupTableSchema {
            Name = tableName,
            Columns = [
                new LookupTableColumn {
                    Name = keyColumnName,
                    LogicalType = LookupTableLogicalType.Number,
                    RevitTypeToken = "number",
                    Role = LookupTableColumnRole.LookupKey,
                    UnitToken = "general"
                },
                .. cases.Select(lookupCase => BuildLookupValueColumn(familyDocument, lookupCase))
            ]
        },
        Rows = [
            new LookupTableRow {
                RowName = rowName,
                ValuesByColumn = new[] {
                    new KeyValuePair<string, string>(keyColumnName, lookupValue)
                }
                .Concat(cases.Select(lookupCase => new KeyValuePair<string, string>(GetLookupCarrierParameterName(lookupCase), lookupCase.ResultValue)))
                .ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal)
            }
        ]
    };

    public static void ImportLookupTable(Document familyDocument, LookupTableDefinition table) {
        using var transaction = new Transaction(familyDocument, $"Import lookup table '{table.Schema.Name}'");
        _ = transaction.Start();

        var operation = new SetLookupTables(new SetLookupTablesSettings {
            Tables = [table]
        });
        var log = operation.Execute(
            new FamilyDocument(familyDocument),
            new FamilyProcessingContext { FamilyName = familyDocument.Title },
            new OperationContext());

        _ = transaction.Commit();

        Assert.That(
            log.Entries.Any(entry => entry.Status == LogStatus.Success),
            Is.True,
            $"Expected lookup-table import to succeed for '{table.Schema.Name}'.");
    }

    public static IReadOnlyList<AppliedLookupCaseResult> ApplyLookupFormulasAndCapture(
        Document familyDocument,
        string typeName,
        string lookupParameterName,
        string lookupValue,
        string tableName,
        IReadOnlyList<LookupCase> cases
    ) {
        var formulaResults = new List<(
            LookupCase LookupCase,
            string lookupCarrierParameterName,
            string lookupFormula,
            bool lookupAccepted,
            string? lookupErrorMessage,
            string? targetFormula,
            bool targetAccepted,
            string? targetErrorMessage,
            RevitFamilyFixtureHarness.ParameterValueSnapshot snapshot)>(cases.Count);

        using (var transaction = new Transaction(familyDocument, "Apply lookup formulas")) {
            _ = transaction.Start();

            RevitFamilyFixtureHarness.SetCurrentType(familyDocument, typeName);
            var familyDoc = new FamilyDocument(familyDocument);
            var familyManager = familyDocument.FamilyManager;
            var lookupParameter = familyManager.get_Parameter(lookupParameterName)
                ?? throw new InvalidOperationException($"Lookup parameter '{lookupParameterName}' was not found.");
            var lookupTableNameParameter = familyManager.get_Parameter(LookupTableNameParameterName)
                ?? throw new InvalidOperationException($"Lookup table-name parameter '{LookupTableNameParameterName}' was not found.");
            SetLookupKeyValue(familyManager, lookupParameter, lookupValue);
            SetLookupTableNameValue(familyManager, lookupTableNameParameter, tableName);

            foreach (var lookupCase in cases) {
                var lookupCarrierParameterName = GetLookupCarrierParameterName(lookupCase);
                var lookupCarrierParameter = familyManager.get_Parameter(lookupCarrierParameterName)
                    ?? throw new InvalidOperationException($"Lookup carrier parameter '{lookupCarrierParameterName}' was not found.");
                var (lookupAccepted, lookupFormula, lookupErrorMessage) = TrySetLookupFormula(
                    familyDoc,
                    lookupCarrierParameter,
                    tableName,
                    lookupCarrierParameterName,
                    SpecTypeId.Number,
                    lookupParameterName);

                Assert.That(
                    lookupAccepted,
                    Is.True,
                    $"Expected size_lookup formula to be accepted for carrier '{lookupCarrierParameterName}'. Error: {lookupErrorMessage ?? "<null>"}");

                var targetParameter = familyManager.get_Parameter(lookupCase.ParameterName)
                    ?? throw new InvalidOperationException($"Lookup target parameter '{lookupCase.ParameterName}' was not found.");
                ApplyUnitBasisValueIfNeeded(familyDocument, familyManager, lookupCase);

                var targetFormula = BuildTargetFormula(lookupCase);
                var targetAccepted = familyDoc.TrySetFormula(targetParameter, targetFormula, out var targetErrorMessage);
                Assert.That(
                    targetAccepted,
                    Is.True,
                    $"Expected target coercion formula to be accepted for '{lookupCase.ParameterName}'. Error: {targetErrorMessage ?? "<null>"}");

                familyDocument.Regenerate();
                var snapshot = RevitFamilyFixtureHarness.CaptureParameterSnapshots(
                    familyDocument,
                    lookupCase.ParameterName,
                    [typeName]).Single();

                formulaResults.Add((
                    lookupCase,
                    lookupCarrierParameterName,
                    lookupFormula,
                    lookupAccepted,
                    lookupErrorMessage,
                    targetFormula,
                    targetAccepted,
                    targetErrorMessage,
                    snapshot));
            }

            _ = transaction.Commit();
        }

        return formulaResults.Select(result => new AppliedLookupCaseResult(
            result.LookupCase,
            result.lookupCarrierParameterName,
            result.lookupFormula,
            result.lookupAccepted,
            result.lookupErrorMessage,
            result.targetFormula,
            result.targetAccepted,
            result.targetErrorMessage,
            result.snapshot)).ToList();
    }

    public static object GetExpectedRawValue(Document familyDocument, LookupCase lookupCase) {
        if (lookupCase.DataType == SpecTypeId.Boolean.YesNo)
            return int.Parse(lookupCase.ResultValue, CultureInfo.InvariantCulture);

        if (lookupCase.DataType == SpecTypeId.Number)
            return double.Parse(lookupCase.ResultValue, CultureInfo.InvariantCulture);

        if (UnitUtils.IsMeasurableSpec(lookupCase.DataType)) {
            if (UnitFormatUtils.TryParse(familyDocument.GetUnits(), lookupCase.DataType, lookupCase.ResultValue, out var parsedValue))
                return parsedValue;

            var unitTypeId = familyDocument.GetUnits().GetFormatOptions(lookupCase.DataType).GetUnitTypeId();
            return UnitUtils.ConvertToInternalUnits(
                double.Parse(lookupCase.ResultValue, CultureInfo.InvariantCulture),
                unitTypeId);
        }

        return lookupCase.ResultValue;
    }

    public static string GetExpectedHeaderFragment(Document familyDocument, LookupCase lookupCase) {
        if (lookupCase.DataType == SpecTypeId.Boolean.YesNo
            || lookupCase.DataType == SpecTypeId.Number
            || UnitUtils.IsMeasurableSpec(lookupCase.DataType)) {
            return $"{GetLookupCarrierParameterName(lookupCase)}##number##general";
        }

        throw new InvalidOperationException(
            $"Lookup-table test support does not yet handle spec '{lookupCase.DataType.TypeId}'.");
    }

    private static LookupTableColumn BuildLookupValueColumn(Document familyDocument, LookupCase lookupCase) {
        if (lookupCase.DataType == SpecTypeId.Boolean.YesNo
            || lookupCase.DataType == SpecTypeId.Number
            || UnitUtils.IsMeasurableSpec(lookupCase.DataType)) {
            return new LookupTableColumn {
                Name = GetLookupCarrierParameterName(lookupCase),
                LogicalType = LookupTableLogicalType.Number,
                RevitTypeToken = "number",
                Role = LookupTableColumnRole.Value,
                UnitToken = "general"
            };
        }

        throw new InvalidOperationException(
            $"Lookup-table test support does not yet handle spec '{lookupCase.DataType.TypeId}'.");
    }

    private static void SetLookupKeyValue(FamilyManager familyManager, FamilyParameter lookupParameter, string rawValue) {
        switch (lookupParameter.StorageType) {
        case StorageType.Integer:
            familyManager.Set(lookupParameter, int.Parse(rawValue, CultureInfo.InvariantCulture));
            break;
        case StorageType.Double:
            familyManager.Set(lookupParameter, double.Parse(rawValue, CultureInfo.InvariantCulture));
            break;
        case StorageType.String:
            familyManager.Set(lookupParameter, rawValue);
            break;
        default:
            throw new InvalidOperationException(
                $"Lookup-key test parameter '{lookupParameter.Definition.Name}' uses unsupported StorageType.{lookupParameter.StorageType}.");
        }
    }

    private static void SetLookupTableNameValue(
        FamilyManager familyManager,
        FamilyParameter lookupTableNameParameter,
        string tableName
    ) {
        if (lookupTableNameParameter.StorageType != StorageType.String) {
            throw new InvalidOperationException(
                $"Lookup table-name parameter '{lookupTableNameParameter.Definition.Name}' must use StorageType.String, but was '{lookupTableNameParameter.StorageType}'.");
        }

        familyManager.Set(lookupTableNameParameter, tableName);
    }

    private static void ApplyUnitBasisValueIfNeeded(
        Document familyDocument,
        FamilyManager familyManager,
        LookupCase lookupCase
    ) {
        var unitBasisParameterName = GetUnitBasisParameterName(lookupCase);
        if (string.IsNullOrWhiteSpace(unitBasisParameterName))
            return;

        var unitBasisParameter = familyManager.get_Parameter(unitBasisParameterName)
            ?? throw new InvalidOperationException($"Lookup unit-basis parameter '{unitBasisParameterName}' was not found.");

        var unitTypeId = familyDocument.GetUnits().GetFormatOptions(lookupCase.DataType).GetUnitTypeId();
        var oneUnitInInternalUnits = UnitUtils.ConvertToInternalUnits(1, unitTypeId);
        familyManager.Set(unitBasisParameter, oneUnitInInternalUnits);
    }

    private static string BuildTargetFormula(LookupCase lookupCase) {
        var lookupCarrierParameterName = GetLookupCarrierParameterName(lookupCase);

        if (lookupCase.DataType == SpecTypeId.Boolean.YesNo)
            return $"{lookupCarrierParameterName} > 0";

        var unitBasisParameterName = GetUnitBasisParameterName(lookupCase);
        if (!string.IsNullOrWhiteSpace(unitBasisParameterName))
            return $"{lookupCarrierParameterName} * {unitBasisParameterName}";

        return lookupCarrierParameterName;
    }

    private static string? GetUnitBasisParameterName(LookupCase lookupCase) =>
        UnitUtils.IsMeasurableSpec(lookupCase.DataType)
            ? $"{lookupCase.ParameterName}LookupUnit"
            : null;

    private static (bool Accepted, string Formula, string? ErrorMessage) TrySetLookupFormula(
        FamilyDocument familyDoc,
        FamilyParameter resultParameter,
        string tableName,
        string resultColumnName,
        ForgeTypeId dataType,
        string lookupParameterName
    ) {
        var formulas = BuildLookupFormulaCandidates(
            familyDoc.Document,
            tableName,
            resultColumnName,
            dataType,
            lookupParameterName).ToList();
        string? lastError = null;

        foreach (var formula in formulas) {
            if (familyDoc.TrySetFormula(resultParameter, formula, out var errorMessage))
                return (true, formula, null);

            lastError = errorMessage;
        }

        var fallbackFormula = formulas.First();
        var attemptedFormulas = string.Join(" | ", formulas);
        var compositeError = string.IsNullOrWhiteSpace(lastError)
            ? $"Attempted formulas: {attemptedFormulas}"
            : $"{lastError} Attempted formulas: {attemptedFormulas}";
        return (false, fallbackFormula, compositeError);
    }

    private static IEnumerable<string> BuildLookupFormulaCandidates(
        Document familyDocument,
        string tableName,
        string resultColumnName,
        ForgeTypeId dataType,
        string lookupParameterName
    ) {
        var defaultValues = BuildDefaultFallbackValues(familyDocument, dataType).Distinct(StringComparer.Ordinal);
        var tableNames = new[] { LookupTableNameParameterName }.Distinct(StringComparer.Ordinal);
        var resultColumns = new[] { resultColumnName, $"\"{resultColumnName}\"" }.Distinct(StringComparer.Ordinal);

        foreach (var defaultValue in defaultValues) {
            foreach (var currentTableName in tableNames) {
                foreach (var resultColumn in resultColumns)
                    yield return $"size_lookup({currentTableName}, {resultColumn}, {defaultValue}, {lookupParameterName})";
            }
        }
    }

    private static IEnumerable<string> BuildDefaultFallbackValues(Document familyDocument, ForgeTypeId dataType) {
        if (dataType == SpecTypeId.Boolean.YesNo) {
            yield return "0";
            yield break;
        }

        yield return "0";

        if (!UnitUtils.IsMeasurableSpec(dataType))
            yield break;

        var unitTypeId = familyDocument.GetUnits().GetFormatOptions(dataType).GetUnitTypeId();
        var zeroInInternalUnits = UnitUtils.ConvertToInternalUnits(0, unitTypeId);
        var formattedForFormula = UnitFormatUtils.Format(familyDocument.GetUnits(), dataType, zeroInInternalUnits, true);
        var formattedForDisplay = UnitFormatUtils.Format(familyDocument.GetUnits(), dataType, zeroInInternalUnits, false);

        yield return formattedForFormula;
        yield return formattedForDisplay;
    }
}
