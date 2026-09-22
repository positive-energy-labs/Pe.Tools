using Pe.Revit.DocumentData.Families.Loaded.Models;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Shared.RevitData;
namespace Pe.Revit.DocumentData.Families.Loaded.Collectors;

public static class ProjectParameterBindingsCollector {
    public static ProjectParameterBindingsData Collect(
        Document doc,
        LoadedFamiliesFilter? filter = null,
        ProjectParameterBindingsFilter? bindingFilter = null,
        RevitDataProjectionRequest? projection = null,
        RevitDataOutputBudget? budget = null
    ) {
        var effectiveBudget = RevitDataOutputBudgets.WithDefaults(budget, maxEntries: 50);
        var allFamilies = LoadedFamiliesCatalogCollector.CollectCanonical(doc);
        var selectedFamilies = LoadedFamiliesCollectorSupport.ApplyFilter(allFamilies, filter).ToList();
        var categoryFilter = BuildCategoryFilter(selectedFamilies, filter, bindingFilter);
        var issues = new List<CollectedIssue>();

        var allBindings = doc.GetProjectParameterBindings()
            .Select(binding => MapBinding(doc, binding.definition, binding.binding, categoryFilter, issues))
            .Where(binding => binding != null)
            .Cast<CollectedProjectParameterBindingRecord>()
            .Where(binding => MatchesBindingFilter(binding, bindingFilter))
            .OrderBy(binding => binding.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var maxEntries = effectiveBudget.MaxEntries;
        var truncated = maxEntries is > 0 && allBindings.Count > maxEntries.Value;
        var bindings = truncated
            ? allBindings.Take(maxEntries!.Value).ToList()
            : allBindings;
        var includeCategories = projection?.View is RevitDataResultView.Rows or RevitDataResultView.Full
                                || budget?.IncludeDiagnostics == true;
        var contractIssues = issues.Select(LoadedFamiliesCollectorSupport.ToContractIssue).Distinct().ToList();
        AddFilterDiagnostics(filter, bindingFilter, allFamilies, selectedFamilies, allBindings, contractIssues);
        if (truncated) {
            contractIssues.Add(new RevitDataIssue(
                "ProjectParameterBindingsTruncated",
                RevitDataIssueSeverity.Warning,
                $"Returned {bindings.Count} of {allBindings.Count} matching project parameter binding(s). Increase budget.maxEntries to expand."
            ));
        }

        return new ProjectParameterBindingsData(
            new ProjectParameterBindingsSummary(
                allBindings.Count,
                allBindings.Count(binding => string.Equals(binding.BindingKind, nameof(ProjectParameterBindingKind.Instance), StringComparison.Ordinal)),
                allBindings.Count(binding => string.Equals(binding.BindingKind, nameof(ProjectParameterBindingKind.Type), StringComparison.Ordinal)),
                allBindings.SelectMany(binding => binding.CategoryNames)
                    .GroupBy(name => name, StringComparer.OrdinalIgnoreCase)
                    .OrderBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase),
                truncated
            ),
            bindings.Select(binding => ToContractEntry(binding, includeCategories)).ToList(),
            RevitDataOutputBudgets.ProjectIssues(contractIssues, effectiveBudget),
            new RevitDataResultPage(allBindings.Count, bindings.Count, truncated)
        );
    }

    private static CollectedProjectParameterBindingRecord? MapBinding(
        Document doc,
        Definition definition,
        ElementBinding binding,
        HashSet<string> categoryFilter,
        List<CollectedIssue> issues
    ) {
        try {
            var categoryNames = binding.Categories?.Cast<Category>()
                .Select(category => category.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToList() ?? [];

            if (categoryFilter.Count != 0 &&
                !categoryNames.Any(categoryFilter.Contains))
                return null;

            var dataTypeId = NormalizeForgeTypeId(definition.GetDataType());
            var groupTypeId = NormalizeForgeTypeId(definition.GetGroupTypeId());
            var bindingIdentity = ParameterIdentityFactory.FromDefinition(doc, definition);

            return new CollectedProjectParameterBindingRecord {
                Definition = new ParameterDefinitionDescriptor(
                    bindingIdentity,
                    binding is InstanceBinding,
                    dataTypeId,
                    dataTypeId == null ? null : RevitLabelCatalog.GetLabelForSpec(definition.GetDataType()),
                    groupTypeId,
                    groupTypeId == null ? null : RevitLabelCatalog.GetLabelForPropertyGroup(definition.GetGroupTypeId())
                ),
                BindingKind =
                    binding is InstanceBinding
                        ? nameof(ProjectParameterBindingKind.Instance)
                        : nameof(ProjectParameterBindingKind.Type),
                CategoryNames = categoryNames
            };
        } catch (Exception ex) {
            issues.Add(new CollectedIssue(
                "ProjectParameterBindingReadFailed",
                CollectedIssueSeverity.Warning,
                ex.Message,
                null,
                null,
                definition?.Name
            ));
            return null;
        }
    }

    private static void AddFilterDiagnostics(
        LoadedFamiliesFilter? familyFilter,
        ProjectParameterBindingsFilter? bindingFilter,
        IReadOnlyList<CollectedLoadedFamilyRecord> allFamilies,
        IReadOnlyList<CollectedLoadedFamilyRecord> selectedFamilies,
        IReadOnlyList<CollectedProjectParameterBindingRecord> bindings,
        List<RevitDataIssue> issues
    ) {
        if (familyFilter != null && HasFamilyFilter(familyFilter) && selectedFamilies.Count == 0) {
            issues.Add(new RevitDataIssue(
                "ProjectParameterBindingsLoadedFamilyFilterMatchedZeroFamilies",
                RevitDataIssueSeverity.Warning,
                $"Loaded-family filter matched zero families out of {allFamilies.Count}; project binding category filtering may be over-constrained."
            ));
        }

        if (bindingFilter != null && HasBindingFilter(bindingFilter) && bindings.Count == 0) {
            issues.Add(new RevitDataIssue(
                "ProjectParameterBindingsFilterMatchedZeroBindings",
                RevitDataIssueSeverity.Warning,
                "Project-parameter binding filter matched zero bindings. Check parameter/category names, shared GUIDs, or bindingKind."
            ));
        }
    }

    private static bool HasFamilyFilter(LoadedFamiliesFilter filter) =>
        filter.FamilyNames.Any(name => !string.IsNullOrWhiteSpace(name))
        || filter.CategoryNames.Any(name => !string.IsNullOrWhiteSpace(name))
        || !string.IsNullOrWhiteSpace(filter.FamilyNameContains)
        || !string.IsNullOrWhiteSpace(filter.CategoryNameContains)
        || filter.PlacementScope != LoadedFamilyPlacementScope.AllLoaded;

    private static bool HasBindingFilter(ProjectParameterBindingsFilter filter) =>
        filter.Parameters.Any(parameter => parameter.Identity != null || !string.IsNullOrWhiteSpace(parameter.Name) || !string.IsNullOrWhiteSpace(parameter.SharedGuid))
        || !string.IsNullOrWhiteSpace(filter.ParameterNameContains)
        || filter.CategoryNames.Any(name => !string.IsNullOrWhiteSpace(name))
        || filter.BindingKind != null;

    private static ProjectParameterBindingEntry ToContractEntry(
        CollectedProjectParameterBindingRecord binding,
        bool includeCategories
    ) =>
        new(
            new ParameterDefinitionDescriptor(
                ParameterIdentityEngine.FromCanonical(binding.Identity),
                string.Equals(binding.BindingKind, nameof(ProjectParameterBindingKind.Instance), StringComparison.Ordinal),
                binding.DataTypeId,
                binding.DataTypeLabel,
                binding.GroupTypeId,
                binding.GroupTypeLabel
            ),
            string.Equals(binding.BindingKind, nameof(ProjectParameterBindingKind.Instance), StringComparison.Ordinal)
                ? ProjectParameterBindingKind.Instance
                : ProjectParameterBindingKind.Type,
            includeCategories ? binding.CategoryNames : []
        );

    private static bool MatchesBindingFilter(
        CollectedProjectParameterBindingRecord binding,
        ProjectParameterBindingsFilter? filter
    ) {
        if (filter == null)
            return true;
        var parameters = ParameterReferenceResolver.Resolve(filter.Parameters);
        if (parameters.Count != 0 && !ParameterReferenceResolver.Matches(binding.Identity, parameters))
            return false;
        if (!string.IsNullOrWhiteSpace(filter.ParameterNameContains) &&
            !binding.Name.Contains(filter.ParameterNameContains.Trim(), StringComparison.OrdinalIgnoreCase))
            return false;
        if (filter.BindingKind != null &&
            !string.Equals(binding.BindingKind, filter.BindingKind.Value.ToString(), StringComparison.Ordinal))
            return false;
        return true;
    }

    private static HashSet<string> BuildCategoryFilter(
        IReadOnlyList<CollectedLoadedFamilyRecord> selectedFamilies,
        LoadedFamiliesFilter? filter,
        ProjectParameterBindingsFilter? bindingFilter
    ) {
        var categories = selectedFamilies
            .Select(family => family.CategoryName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Cast<string>()
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (categories.Count != 0)
            return categories;

        if (filter?.CategoryNames.Count != 0)
            return filter!.CategoryNames
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return bindingFilter?.CategoryNames == null
            ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            : bindingFilter.CategoryNames
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static string? NormalizeForgeTypeId(ForgeTypeId forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;
}
