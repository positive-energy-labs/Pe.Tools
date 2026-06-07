using Autodesk.Revit.DB;
using Newtonsoft.Json.Linq;
using Pe.Revit;
using Pe.Revit.Extensions.FamDocument.SetValue;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Shared.RevitData;

namespace Pe.Revit.FamilyFoundry.DesiredState;

public static class DesiredParameterCompiler {
    public static FamilyMigrationReconciliationPlan Compile(
        BaseProfile profile,
        IDesiredParameterProfile parameterProfile,
        IEnumerable<SharedParameterDefinition> sharedParameters,
        IEnumerable<MappingData>? mappingData = null
    ) {
        var sharedByName = sharedParameters
            .GroupBy(parameter => parameter.ExternalDefinition.Name, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var selectedSharedNames = sharedByName.Values
            .Select(parameter => parameter.ExternalDefinition.Name)
            .Where(profile.SharedParameterSelection.Matches)
            .ToHashSet(StringComparer.Ordinal);
        var mappings = MergeMappingData(mappingData ?? []);

        var sharedDeclarations = BuildSharedDeclarations(
            parameterProfile.SharedParameters,
            selectedSharedNames,
            mappings.Values);
        var familyDeclarations = parameterProfile.FamilyParameters;
        ValidateUniqueDeclaredNames(sharedDeclarations, familyDeclarations);

        var declaredNames = sharedDeclarations.Keys
            .Concat(familyDeclarations.Select(parameter => RequireName(parameter.Name, "Family parameter declaration")))
            .ToHashSet(StringComparer.Ordinal);
        var perTypeAssignments = BuildPerTypeAssignments(parameterProfile.PerTypeAssignmentsTable, declaredNames);

        var resolved = new List<ResolvedDesiredParameter>();
        resolved.AddRange(sharedDeclarations.Values.Select(parameter =>
            ResolveShared(parameter, sharedByName, mappings.GetValueOrDefault(parameter.Name), perTypeAssignments)));
        resolved.AddRange(familyDeclarations.Select(parameter => ResolveFamily(parameter, perTypeAssignments)));

        resolved = resolved
            .OrderBy(parameter => parameter.Definition.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var requiredApsParameterNames = resolved
            .Where(parameter => parameter.IsShared)
            .Select(parameter => parameter.Definition.Name)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var familyParameterNames = resolved
            .Where(parameter => !parameter.IsShared)
            .Select(parameter => parameter.Definition.Name)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var actions = BuildActionSummary(resolved).ToList();
        if (parameterProfile.ParamDrivenSolids.HasContent) {
            actions.Add(new LoweredDesiredMigrationAction(
                "ParamDrivenSolids",
                "ParamDrivenSolids",
                [],
                "Desired param-driven solids are compiled after desired parameter reconciliation so referenced parameters are resolved before geometry execution."));
        }

        return new FamilyMigrationReconciliationPlan(
            resolved,
            requiredApsParameterNames,
            familyParameterNames,
            actions
        );
    }

    public static IReadOnlyList<string> GetExplicitSharedParameterNames(
        IDesiredParameterProfile parameterProfile,
        IEnumerable<MappingData>? mappingData = null
    ) => parameterProfile.SharedParameters
        .Select(parameter => parameter.Name)
        .Concat((mappingData ?? []).Select(mapping => mapping.NewName))
        .Where(name => !string.IsNullOrWhiteSpace(name))
        .Select(name => name.Trim())
        .Distinct(StringComparer.Ordinal)
        .ToList();

    private static Dictionary<string, DesiredSharedParameterDeclaration> BuildSharedDeclarations(
        IEnumerable<DesiredSharedParameterDeclaration> authored,
        IEnumerable<string> selectedSharedNames,
        IEnumerable<MappingData> mappings
    ) {
        var declarations = new Dictionary<string, DesiredSharedParameterDeclaration>(StringComparer.Ordinal);
        foreach (var parameter in authored) {
            var name = RequireName(parameter.Name, "Shared parameter declaration");
            if (!declarations.TryAdd(name, WithName(parameter, name)))
                throw new InvalidOperationException($"Duplicate shared parameter declaration for '{name}'.");
        }

        foreach (var mapping in mappings) {
            var name = RequireName(mapping.NewName, "MappingData.NewName");
            if (declarations.TryGetValue(name, out var existing)) {
                declarations[name] = WithMapping(existing, mapping);
                continue;
            }

            declarations[name] = new DesiredSharedParameterDeclaration {
                Name = name,
                SourceNames = CleanNames(mapping.CurrNames),
                OnlyAddIfSourceExists = mapping.OnlyAddIfSourceExists,
                MappingStrategy = string.IsNullOrWhiteSpace(mapping.MappingStrategy)
                    ? nameof(BuiltInCoercionStrategy.CoerceByStorageType)
                    : mapping.MappingStrategy.Trim()
            };
        }

        foreach (var name in selectedSharedNames) {
            var cleanName = RequireName(name, "SharedParameterSelection");
            declarations.TryAdd(cleanName, new DesiredSharedParameterDeclaration { Name = cleanName });
        }

        return declarations;
    }

    private static DesiredSharedParameterDeclaration WithName(
        DesiredSharedParameterDeclaration parameter,
        string name
    ) => new() {
        Name = name,
        PropertiesGroup = parameter.PropertiesGroup,
        IsInstance = parameter.IsInstance,
        Value = parameter.Value,
        Formula = parameter.Formula,
        SourceNames = CleanNames(parameter.SourceNames),
        OnlyAddIfSourceExists = parameter.OnlyAddIfSourceExists,
        MappingStrategy = string.IsNullOrWhiteSpace(parameter.MappingStrategy)
            ? nameof(BuiltInCoercionStrategy.CoerceByStorageType)
            : parameter.MappingStrategy.Trim()
    };

    private static DesiredSharedParameterDeclaration WithMapping(
        DesiredSharedParameterDeclaration parameter,
        MappingData mapping
    ) {
        var mergedSourceNames = parameter.SourceNames
            .Concat(mapping.CurrNames)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return new DesiredSharedParameterDeclaration {
            Name = parameter.Name,
            PropertiesGroup = parameter.PropertiesGroup,
            IsInstance = parameter.IsInstance,
            Value = parameter.Value,
            Formula = parameter.Formula,
            SourceNames = mergedSourceNames,
            OnlyAddIfSourceExists = parameter.OnlyAddIfSourceExists || mapping.OnlyAddIfSourceExists,
            MappingStrategy = string.IsNullOrWhiteSpace(parameter.MappingStrategy)
                ? mapping.MappingStrategy
                : parameter.MappingStrategy
        };
    }

    private static ResolvedDesiredParameter ResolveShared(
        DesiredSharedParameterDeclaration parameter,
        IReadOnlyDictionary<string, SharedParameterDefinition> sharedByName,
        MappingData? mapping,
        IReadOnlyDictionary<string, Dictionary<string, string?>> perTypeAssignments
    ) {
        var name = RequireName(parameter.Name, "Shared parameter declaration");
        if (!sharedByName.TryGetValue(name, out var sharedParameter))
            throw new InvalidOperationException(
                $"Shared parameter '{name}' was requested, but no APS/shared-parameter definition was resolved for it. " +
                "Shared parameter declarations cannot create local fallback definitions; add the parameter to the shared parameter source or declare it as a FamilyParameters entry.");

        var authoredPropertiesGroup = ResolvePropertyGroup(parameter.PropertiesGroup, $"Shared parameter '{name}' PropertiesGroup");
        var identity = CreateSharedGuidIdentity(name, sharedParameter.ExternalDefinition.GUID);
        var migration = BuildMigration(parameter, mapping);
        var tooltip = string.IsNullOrWhiteSpace(sharedParameter.ExternalDefinition.Description)
            ? null
            : sharedParameter.ExternalDefinition.Description;

        return new ResolvedDesiredParameter(
            new ResolvedParameterDefinition(
                identity,
                name,
                sharedParameter.ExternalDefinition.GetDataType(),
                authoredPropertiesGroup ?? sharedParameter.GroupTypeId,
                parameter.IsInstance ?? sharedParameter.IsInstance,
                tooltip),
            true,
            BuildAssignment(parameter),
            GetPerTypeAssignments(perTypeAssignments, name),
            migration,
            new ResolvedParameterMetadataProvenanceSet(
                ResolvedParameterMetadataProvenance.ParameterService,
                ResolvedParameterMetadataProvenance.ParameterService,
                authoredPropertiesGroup != null ? ResolvedParameterMetadataProvenance.Authored : ResolvedParameterMetadataProvenance.ParameterService,
                parameter.IsInstance != null ? ResolvedParameterMetadataProvenance.Authored : ResolvedParameterMetadataProvenance.ParameterService,
                tooltip == null ? ResolvedParameterMetadataProvenance.Unresolved : ResolvedParameterMetadataProvenance.ParameterService)
        );
    }

    private static ResolvedDesiredParameter ResolveFamily(
        DesiredFamilyParameterDeclaration parameter,
        IReadOnlyDictionary<string, Dictionary<string, string?>> perTypeAssignments
    ) {
        var name = RequireName(parameter.Name, "Family parameter declaration");
        var authoredDataType = ResolveDataType(parameter.DataType, $"Family parameter '{name}' DataType");
        var authoredPropertiesGroup = ResolvePropertyGroup(parameter.PropertiesGroup, $"Family parameter '{name}' PropertiesGroup");
        return new ResolvedDesiredParameter(
            new ResolvedParameterDefinition(
                CreateNameFallbackIdentity(name),
                name,
                authoredDataType ?? SpecTypeId.String.Text,
                authoredPropertiesGroup ?? new ForgeTypeId(""),
                parameter.IsInstance ?? true,
                parameter.Tooltip),
            false,
            BuildAssignment(parameter),
            GetPerTypeAssignments(perTypeAssignments, name),
            null,
            new ResolvedParameterMetadataProvenanceSet(
                ResolvedParameterMetadataProvenance.FamilyFoundryDefault,
                authoredDataType != null ? ResolvedParameterMetadataProvenance.Authored : ResolvedParameterMetadataProvenance.FamilyFoundryDefault,
                authoredPropertiesGroup != null ? ResolvedParameterMetadataProvenance.Authored : ResolvedParameterMetadataProvenance.FamilyFoundryDefault,
                parameter.IsInstance != null ? ResolvedParameterMetadataProvenance.Authored : ResolvedParameterMetadataProvenance.FamilyFoundryDefault,
                string.IsNullOrWhiteSpace(parameter.Tooltip) ? ResolvedParameterMetadataProvenance.Unresolved : ResolvedParameterMetadataProvenance.Authored)
        );
    }

    private static DesiredParameterAssignmentSpec? BuildAssignment(AuthoredParameterDeclaration parameter) {
        var assignment = parameter.GetAssignment();
        if (assignment == null)
            return null;

        return new DesiredParameterAssignmentSpec(
            assignment.Kind == AuthoredParameterAssignmentKind.Formula
                ? ParamAssignmentKind.Formula
                : ParamAssignmentKind.Value,
            assignment.Value);
    }

    private static ForgeTypeId? ResolveDataType(string? value, string fieldName) =>
        ResolveForgeTypeId(value, fieldName, SpecNamesValueDomain.GetLabelToForgeMap(), allowOther: false);

    private static ForgeTypeId? ResolvePropertyGroup(string? value, string fieldName) =>
        ResolveForgeTypeId(value, fieldName, PropertyGroupNamesValueDomain.GetLabelForgeMap(), allowOther: true);

    private static ForgeTypeId? ResolveForgeTypeId(
        string? value,
        string fieldName,
        IReadOnlyDictionary<string, ForgeTypeId> labelMap,
        bool allowOther
    ) {
        var trimmed = value?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            return null;

        if (allowOther && trimmed.Equals("Other", StringComparison.OrdinalIgnoreCase))
            return new ForgeTypeId("");

        if (labelMap.TryGetValue(trimmed, out var mapped))
            return mapped;

        if (trimmed.StartsWith("autodesk.", StringComparison.OrdinalIgnoreCase))
            return new ForgeTypeId(trimmed);

        throw new InvalidOperationException($"{fieldName} '{trimmed}' is not a recognized Revit label or Forge type id.");
    }

    private static Dictionary<string, string?> GetPerTypeAssignments(
        IReadOnlyDictionary<string, Dictionary<string, string?>> assignmentsByParameter,
        string parameterName
    ) => assignmentsByParameter.TryGetValue(parameterName, out var assignments)
        ? assignments
        : new Dictionary<string, string?>(StringComparer.Ordinal);

    private static DesiredParameterMigrationSpec? BuildMigration(
        DesiredSharedParameterDeclaration parameter,
        MappingData? mapping
    ) {
        var sourceNames = parameter.SourceNames
            .Concat(mapping?.CurrNames ?? [])
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToList();
        if (sourceNames.Count == 0 && mapping == null && !parameter.OnlyAddIfSourceExists)
            return null;

        return new DesiredParameterMigrationSpec {
            SourceNames = sourceNames,
            OnlyAddIfSourceExists = parameter.OnlyAddIfSourceExists || mapping?.OnlyAddIfSourceExists == true,
            MappingStrategy = string.IsNullOrWhiteSpace(parameter.MappingStrategy)
                ? mapping?.MappingStrategy ?? nameof(BuiltInCoercionStrategy.CoerceByStorageType)
                : parameter.MappingStrategy.Trim()
        };
    }

    private static Dictionary<string, Dictionary<string, string?>> BuildPerTypeAssignments(
        IEnumerable<DesiredPerTypeAssignmentRow> rows,
        HashSet<string> declaredNames
    ) {
        var valuesByParameter = new Dictionary<string, Dictionary<string, string?>>(StringComparer.Ordinal);
        var rowNumber = 0;
        foreach (var row in rows) {
            rowNumber++;
            var parameterName = RequireName(row.Parameter,
                $"Per-type assignments table row {rowNumber} {DesiredPerTypeAssignmentRow.ParameterColumn}");
            if (!declaredNames.Contains(parameterName))
                throw new InvalidOperationException(
                    $"Per-type assignments table row {rowNumber} references undeclared parameter '{parameterName}'. Declare it in SharedParameters, FamilyParameters, or MappingData first.");
            if (!valuesByParameter.TryGetValue(parameterName, out var valuesByType)) {
                valuesByType = new Dictionary<string, string?>(StringComparer.Ordinal);
                valuesByParameter[parameterName] = valuesByType;
            }

            foreach (var kvp in row.ValuesByType) {
                var typeName = kvp.Key?.Trim();
                if (string.IsNullOrWhiteSpace(typeName))
                    continue;
                if (valuesByType.ContainsKey(typeName))
                    throw new InvalidOperationException(
                        $"Duplicate per-type assignment for parameter '{parameterName}' and type '{typeName}'.");
                valuesByType[typeName] = kvp.Value?.Type == JTokenType.Null ? null : kvp.Value?.ToString();
            }
        }

        return valuesByParameter;
    }

    private static Dictionary<string, MappingData> MergeMappingData(IEnumerable<MappingData> mappingData) {
        var mappings = new Dictionary<string, MappingData>(StringComparer.Ordinal);
        foreach (var mapping in mappingData) {
            var name = RequireName(mapping.NewName, "MappingData.NewName");
            if (!mappings.TryGetValue(name, out var existing)) {
                mappings[name] = WithNewName(mapping, name);
                continue;
            }

            mappings[name] = new MappingData {
                NewName = name,
                CurrNames = CleanNames(existing.CurrNames.Concat(mapping.CurrNames)),
                OnlyAddIfSourceExists = existing.OnlyAddIfSourceExists || mapping.OnlyAddIfSourceExists,
                MappingStrategy = string.IsNullOrWhiteSpace(existing.MappingStrategy)
                    ? mapping.MappingStrategy
                    : existing.MappingStrategy
            };
        }

        return mappings;
    }

    private static MappingData WithNewName(MappingData mapping, string name) => new() {
        NewName = name,
        CurrNames = CleanNames(mapping.CurrNames),
        OnlyAddIfSourceExists = mapping.OnlyAddIfSourceExists,
        MappingStrategy = string.IsNullOrWhiteSpace(mapping.MappingStrategy)
            ? nameof(BuiltInCoercionStrategy.CoerceByStorageType)
            : mapping.MappingStrategy.Trim()
    };

    private static IEnumerable<LoweredDesiredMigrationAction> BuildActionSummary(
        IReadOnlyList<ResolvedDesiredParameter> parameters
    ) {
        foreach (var parameter in parameters) {
            var parameterName = parameter.Definition.Name;
            if (parameter.IsShared) {
                yield return new LoweredDesiredMigrationAction(
                    "AddAndMapSharedParams",
                    parameterName,
                    parameter.Migration?.SourceNames ?? [],
                    parameter.Migration?.SourceNames.Count > 0
                        ? "Desired shared parameter has mapping sources."
                        : "Desired shared parameter is required from SharedParameters, SharedParameterSelection, or MappingData.");
            } else {
                yield return new LoweredDesiredMigrationAction(
                    "AddFamilyParams",
                    parameterName,
                    [],
                    "Desired local family parameter requires family creation metadata.");
            }

            if (parameter.Assignment != null || parameter.ValuesByType.Count > 0) {
                yield return new LoweredDesiredMigrationAction(
                    "SetKnownParams",
                    parameterName,
                    [],
                    "Desired parameter has authored value, formula, or per-type assignments.");
            }
        }
    }

    private static void ValidateUniqueDeclaredNames(
        IReadOnlyDictionary<string, DesiredSharedParameterDeclaration> sharedDeclarations,
        IEnumerable<DesiredFamilyParameterDeclaration> familyDeclarations
    ) {
        var seen = new HashSet<string>(sharedDeclarations.Keys, StringComparer.Ordinal);
        foreach (var parameter in familyDeclarations) {
            var name = RequireName(parameter.Name, "Family parameter declaration");
            if (!seen.Add(name))
                throw new InvalidOperationException(
                    $"Parameter '{name}' is declared more than once. A name can appear in either SharedParameters or FamilyParameters, not both.");
        }
    }

    private static List<string> CleanNames(IEnumerable<string> names) => names
        .Where(name => !string.IsNullOrWhiteSpace(name))
        .Select(name => name.Trim())
        .Distinct(StringComparer.Ordinal)
        .ToList();

    private static string RequireName(string? name, string fieldName) {
        var trimmed = name?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(trimmed))
            throw new InvalidOperationException($"{fieldName} is missing a required parameter name.");
        return trimmed;
    }

    private static ParameterIdentity CreateSharedGuidIdentity(string name, Guid sharedGuid) {
        var guid = sharedGuid.ToString("D");
        return new ParameterIdentity($"shared-guid:{guid}", ParameterIdentityKind.SharedGuid, name, null, guid, null);
    }

    private static ParameterIdentity CreateNameFallbackIdentity(string name) =>
        new($"name:{NormalizeName(name)}", ParameterIdentityKind.NameFallback, name, null, null, null);

    private static string NormalizeName(string name) => name.Trim().ToLowerInvariant();
}
