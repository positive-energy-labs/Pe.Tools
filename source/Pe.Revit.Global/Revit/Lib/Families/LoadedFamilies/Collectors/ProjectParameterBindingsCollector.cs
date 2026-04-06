using Pe.Shared.HostContracts.RevitData;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Models;
using Pe.Revit.Global.Revit.Lib.Parameters;
using Pe.Revit.Global.Services.Document;
using Pe.Shared.RevitData.Parameters;

namespace Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;

public static class ProjectParameterBindingsCollector {
    public static ProjectParameterBindingsData Collect(
        Document doc,
        LoadedFamiliesFilter? filter = null
    ) {
        var selectedFamilies = LoadedFamiliesCatalogCollector.CollectCanonical(doc, filter);
        var categoryFilter = BuildCategoryFilter(selectedFamilies, filter);
        var issues = new List<CollectedIssue>();

        var bindings = DocumentManager.GetProjectParameterBindings(doc)
            .Select(binding => MapBinding(doc, binding.def, binding.binding, categoryFilter, issues))
            .Where(binding => binding != null)
            .Cast<CollectedProjectParameterBindingRecord>()
            .OrderBy(binding => binding.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new ProjectParameterBindingsData(
            bindings.Select(ToContractEntry).ToList(),
            issues.Select(LoadedFamiliesCollectorSupport.ToContractIssue).Distinct().ToList()
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
            var bindingIdentity = RevitParameterIdentityFactory.FromDefinition(doc, definition);

            return new CollectedProjectParameterBindingRecord {
                Identity = bindingIdentity,
                BindingKind =
                    binding is InstanceBinding
                        ? nameof(ProjectParameterBindingKind.Instance)
                        : nameof(ProjectParameterBindingKind.Type),
                DataTypeId = dataTypeId,
                DataTypeLabel =
                    dataTypeId == null ? null : RevitTypeLabelCatalog.GetLabelForSpec(definition.GetDataType()),
                GroupTypeId = groupTypeId,
                GroupTypeLabel =
                    groupTypeId == null
                        ? null
                        : RevitTypeLabelCatalog.GetLabelForPropertyGroup(definition.GetGroupTypeId()),
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

    private static ProjectParameterBindingEntry ToContractEntry(CollectedProjectParameterBindingRecord binding) =>
        new(
            ParameterIdentityEngine.FromCanonical(binding.Identity),
            string.Equals(binding.BindingKind, nameof(ProjectParameterBindingKind.Instance), StringComparison.Ordinal)
                ? ProjectParameterBindingKind.Instance
                : ProjectParameterBindingKind.Type,
            binding.DataTypeId,
            binding.DataTypeLabel,
            binding.GroupTypeId,
            binding.GroupTypeLabel,
            binding.CategoryNames
        );

    private static HashSet<string> BuildCategoryFilter(
        IReadOnlyList<CollectedLoadedFamilyRecord> selectedFamilies,
        LoadedFamiliesFilter? filter
    ) {
        var categories = selectedFamilies
            .Select(family => family.CategoryName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Cast<string>()
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (categories.Count != 0)
            return categories;

        return filter?.CategoryNames == null
            ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            : filter.CategoryNames
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static string? NormalizeForgeTypeId(ForgeTypeId forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;
}
