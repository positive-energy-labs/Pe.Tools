using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.Global;
using System.Text.RegularExpressions;

namespace Pe.Revit.FamilyFoundry.Resolution;

public sealed record KnownParamCatalog(
    IReadOnlyDictionary<string, FamilyParamDefinitionModel> FamilyDefinitions,
    HashSet<string> SharedParameterNames,
    IReadOnlyDictionary<string, ForgeTypeId> SharedDefinitions
);

public static class KnownParamResolver {
    public static KnownParamCatalog BuildCatalog(
        AddFamilyParamsSettings familyParams,
        IEnumerable<SharedParameterDefinition> sharedParams
    ) {
        ValidateFamilyDefinitions(familyParams);

        var familyDefinitions = familyParams.Parameters
            .Where(parameter => !string.IsNullOrWhiteSpace(parameter.Name))
            .ToDictionary(parameter => parameter.Name.Trim(), StringComparer.Ordinal);
        var sharedParameterNames = sharedParams
            .Select(sharedParam => sharedParam.ExternalDefinition.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(StringComparer.Ordinal);
        var sharedDefinitions = sharedParams
            .Where(sharedParam => !string.IsNullOrWhiteSpace(sharedParam.ExternalDefinition.Name))
            .GroupBy(sharedParam => sharedParam.ExternalDefinition.Name.Trim(), StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => group.First().ExternalDefinition.GetDataType(),
                StringComparer.Ordinal);

        return new KnownParamCatalog(familyDefinitions, sharedParameterNames, sharedDefinitions);
    }

    public static void ValidateFamilyDefinitions(AddFamilyParamsSettings familyParams) {
        var missingNames = familyParams.Parameters
            .Where(parameter => string.IsNullOrWhiteSpace(parameter.Name))
            .ToList();
        if (missingNames.Count > 0) {
            throw new InvalidOperationException(
                "AddFamilyParams.Parameters contains an item missing Name.");
        }

        var duplicateNames = familyParams.Parameters
            .Select(parameter => parameter.Name.Trim())
            .GroupBy(name => name, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (duplicateNames.Count > 0) {
            throw new InvalidOperationException(
                $"Duplicate parameter names in AddFamilyParams.Parameters: {string.Join(", ", duplicateNames)}. " +
                "Each family parameter definition name must appear only once in a profile.");
        }

        var invalidPeNames = familyParams.Parameters
            .Select(parameter => parameter.Name.Trim())
            .Where(IsPeParameterName)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (invalidPeNames.Count > 0) {
            throw new InvalidOperationException(
                $"AddFamilyParams.Parameters contains PE_ parameters, which are invalid family parameter definitions: {string.Join(", ", invalidPeNames)}. " +
                "PE_ parameters must come from APS/shared parameter provisioning.");
        }
    }

    public static void ValidateAssignments(
        SetKnownParamsSettings assignments,
        KnownParamCatalog catalog
    ) {
        ValidateGlobalAssignments(assignments.GlobalAssignments);
        ValidatePerTypeRows(assignments.PerTypeAssignmentsTable);
        ValidatePerTypeLengthValues(assignments.PerTypeAssignmentsTable, catalog);

        var globalAssignmentsByParameter = assignments.GetGlobalAssignmentsByParameter();
        var perTypeAssignmentsByParameter = assignments.GetPerTypeAssignmentsByParameter();

        foreach (var parameterName in globalAssignmentsByParameter.Keys) {
            if (perTypeAssignmentsByParameter.ContainsKey(parameterName)) {
                throw new InvalidOperationException(
                    $"SetKnownParams validation failed for parameter '{parameterName}': " +
                    $"cannot define both {nameof(SetKnownParamsSettings.GlobalAssignments)} and {nameof(SetKnownParamsSettings.PerTypeAssignmentsTable)} values. " +
                    "Use exactly one explicit assignment source per parameter.");
            }
        }

        foreach (var parameterName in globalAssignmentsByParameter.Keys.Concat(perTypeAssignmentsByParameter.Keys).Distinct(StringComparer.Ordinal)) {
            ValidateResolvedParameterName(parameterName, catalog);
        }
    }

    public static void ValidateResolvedParameterNames(
        IEnumerable<string> parameterNames,
        KnownParamCatalog catalog
    ) {
        foreach (var parameterName in parameterNames
                     .Where(name => !string.IsNullOrWhiteSpace(name))
                     .Select(name => name.Trim())
                     .Distinct(StringComparer.Ordinal)) {
            ValidateResolvedParameterName(parameterName, catalog);
        }
    }

    public static AddFamilyParamsSettings ExtractRequiredFamilyDefinitions(
        IEnumerable<string> referencedParameterNames,
        KnownParamCatalog catalog
    ) {
        var familyDefinitions = new List<FamilyParamDefinitionModel>();

        foreach (var parameterName in referencedParameterNames
                     .Where(name => !string.IsNullOrWhiteSpace(name))
                     .Select(name => name.Trim())
                     .Distinct(StringComparer.Ordinal)) {
            if (catalog.SharedParameterNames.Contains(parameterName))
                continue;

            if (IsPeParameterName(parameterName)) {
                throw new InvalidOperationException(
                    $"Referenced parameter '{parameterName}' is a PE_ parameter but is not available from FilterApsParams. " +
                    "Add it to the APS/shared parameter filter instead of defining it as a family parameter.");
            }

            if (!catalog.FamilyDefinitions.TryGetValue(parameterName, out var familyDefinition)) {
                throw new InvalidOperationException(
                    $"Referenced parameter '{parameterName}' must be defined in AddFamilyParams.Parameters before it can be used.");
            }

            familyDefinitions.Add(familyDefinition);
        }

        return new AddFamilyParamsSettings {
            Enabled = familyDefinitions.Count > 0,
            Parameters = familyDefinitions
        };
    }

    public static bool IsPeParameterName(string? parameterName) =>
        !string.IsNullOrWhiteSpace(parameterName)
        && parameterName.StartsWith("PE_", StringComparison.OrdinalIgnoreCase);

    private static void ValidateResolvedParameterName(string parameterName, KnownParamCatalog catalog) {
        if (IsPeParameterName(parameterName)) {
            if (!catalog.SharedParameterNames.Contains(parameterName)) {
                throw new InvalidOperationException(
                    $"SetKnownParams references PE_ parameter '{parameterName}', but FilterApsParams does not provide it. " +
                    "Add the parameter to the APS/shared parameter filter.");
            }

            return;
        }

        if (!catalog.FamilyDefinitions.ContainsKey(parameterName)) {
            throw new InvalidOperationException(
                $"SetKnownParams references non-PE parameter '{parameterName}', but no matching AddFamilyParams.Parameters definition exists.");
        }
    }

    private static void ValidateGlobalAssignments(List<GlobalParamAssignment> assignments) {
        var duplicateNames = assignments
            .Where(assignment => !string.IsNullOrWhiteSpace(assignment.Parameter))
            .GroupBy(assignment => assignment.Parameter, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (duplicateNames.Count > 0) {
            throw new InvalidOperationException(
                $"Duplicate parameter names in SetKnownParams.GlobalAssignments: {string.Join(", ", duplicateNames)}. " +
                "Each global assignment parameter must appear only once in a profile.");
        }

        foreach (var assignment in assignments) {
            if (string.IsNullOrWhiteSpace(assignment.Parameter)) {
                throw new InvalidOperationException(
                    "SetKnownParams.GlobalAssignments contains an entry with a missing parameter name.");
            }

            if (string.IsNullOrWhiteSpace(assignment.Value)) {
                throw new InvalidOperationException(
                    $"SetKnownParams.GlobalAssignments contains a blank value for parameter '{assignment.Parameter}'.");
            }
        }
    }

    private static void ValidatePerTypeRows(List<PerTypeAssignmentRow> rows) {
        var duplicateNames = rows
            .Where(row => !string.IsNullOrWhiteSpace(row.Parameter))
            .GroupBy(row => row.Parameter, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (duplicateNames.Count > 0) {
            throw new InvalidOperationException(
                $"Duplicate parameter names in SetKnownParams.PerTypeAssignmentsTable: {string.Join(", ", duplicateNames)}. " +
                "Each per-type assignment row must appear only once in a profile.");
        }

        for (var rowIndex = 0; rowIndex < rows.Count; rowIndex++) {
            if (!string.IsNullOrWhiteSpace(rows[rowIndex].Parameter))
                continue;

            throw new InvalidOperationException(
                $"SetKnownParams.PerTypeAssignmentsTable row {rowIndex + 1} is missing required parameter name.");
        }
    }

    private static void ValidatePerTypeLengthValues(
        List<PerTypeAssignmentRow> rows,
        KnownParamCatalog catalog
    ) {
        var zeroLengthErrors = new List<string>();

        foreach (var row in rows) {
            var parameterName = row.Parameter?.Trim();
            if (string.IsNullOrWhiteSpace(parameterName))
                continue;

            var dataType = ResolveDataType(parameterName, catalog);
            if (!IsLengthLikeDataType(dataType))
                continue;

            foreach (var (typeNameRaw, valueToken) in row.ValuesByType) {
                var typeName = typeNameRaw?.Trim();
                var value = valueToken?.ToString();
                if (string.IsNullOrWhiteSpace(typeName) || string.IsNullOrWhiteSpace(value))
                    continue;

                if (!IsAuthoredZeroLengthValue(value))
                    continue;

                zeroLengthErrors.Add($"[{typeName}] {parameterName} = {value}");
            }
        }

        if (zeroLengthErrors.Count == 0)
            return;

        throw new InvalidOperationException(
            "SetKnownParams.PerTypeAssignmentsTable contains zero-length authored values for length-like parameters. " +
            "This often produces invalid or too-thin family geometry. Fix the profile values instead of relying on runtime heuristics. " +
            $"Offending assignments: {string.Join("; ", zeroLengthErrors)}.");
    }

    private static ForgeTypeId? ResolveDataType(string parameterName, KnownParamCatalog catalog) {
        if (catalog.FamilyDefinitions.TryGetValue(parameterName, out var familyDefinition))
            return familyDefinition.DataType;

        return catalog.SharedDefinitions.TryGetValue(parameterName, out var sharedDataType)
            ? sharedDataType
            : null;
    }

    private static bool IsLengthLikeDataType(ForgeTypeId? dataType) {
        if (dataType == null)
            return false;

        return dataType == SpecTypeId.Length
               || dataType == SpecTypeId.PipeSize
               || dataType == SpecTypeId.PipeDimension
               || dataType == SpecTypeId.DuctSize
               || dataType == SpecTypeId.CableTraySize
               || dataType == SpecTypeId.ConduitSize
               || dataType == SpecTypeId.SectionDimension
               || dataType == SpecTypeId.BarDiameter;
    }

    private static bool IsAuthoredZeroLengthValue(string value) {
        var normalized = value.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
            return false;

        return Regex.IsMatch(
            normalized,
            @"^\(?\s*[+-]?0+(?:\.0+)?\s*(?:""|''|'|ft|feet|in|inch|inches|mm|cm|m)?\s*\)?$",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }
}
