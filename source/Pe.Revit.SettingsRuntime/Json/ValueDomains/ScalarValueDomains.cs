using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;
using Pe.Revit.SettingsRuntime.Json.SchemaProviders;
using Pe.Revit.SettingsRuntime.Modules.AutoTag;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.ValueDomains;

public abstract class SettingsValueDomainBase : ISettingsValueDomain {
    protected SettingsValueDomainBase(
        string key,
        SettingsRuntimeMode requiredRuntimeMode,
        IReadOnlyList<SettingsOptionsDependency>? dependsOn = null,
        SettingsOptionsMode mode = SettingsOptionsMode.Suggestion,
        bool allowsCustomValue = true
    ) {
        this.Descriptor = new SettingsValueDomainDescriptor(
            key,
            SettingsOptionsResolverKind.Remote,
            mode,
            allowsCustomValue,
            dependsOn ?? [],
            requiredRuntimeMode
        );
    }

    protected SettingsValueDomainDescriptor Descriptor { get; }

    public SettingsValueDomainDescriptor Describe() => this.Descriptor;

    public abstract ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    );

    protected static ValueTask<IReadOnlyList<ValueDomainOptionItem>> ToItems(IEnumerable<string> values) =>
        new(values
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => new ValueDomainOptionItem(value, value, null))
            .ToList());
}

public sealed class CategoryNamesValueDomain()
    : SettingsValueDomainBase(ValueDomainKeys.CategoryNames, SettingsRuntimeMode.HostOnly) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) => ToItems(ScheduleCategoryValueDomain.GetOptions());

    public static Dictionary<string, BuiltInCategory> GetLabelToBuiltInCategoryMap() =>
        RevitLabelCatalog.GetLabelToBuiltInCategoryMap();

    public static Dictionary<BuiltInCategory, string> GetBuiltInCategoryToLabelMap() =>
        RevitLabelCatalog.GetBuiltInCategoryToLabelMap();

    public static string GetLabelForBuiltInCategory(BuiltInCategory bic) =>
        RevitLabelCatalog.GetLabelForBuiltInCategory(bic);

    public static Category? TryFindCategoryByName(Document doc, string? categoryName) =>
        ScheduleCategoryValueDomain.TryFindCategoryByName(doc, categoryName);
}

public sealed class SpecNamesValueDomain()
    : SettingsValueDomainBase(ValueDomainKeys.SpecNames, SettingsRuntimeMode.HostOnly) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) => ToItems(RevitLabelCatalog.GetLabelToSpecMap().Keys);

    public static Dictionary<string, ForgeTypeId> GetLabelToForgeMap() =>
        RevitLabelCatalog.GetLabelToSpecMap();

    public static Dictionary<ForgeTypeId, string> GetForgeToLabelMap() =>
        RevitLabelCatalog.GetSpecToLabelMap();

    public static string GetLabelForForge(ForgeTypeId forge) =>
        RevitLabelCatalog.GetLabelForSpec(forge);
}

public sealed class PropertyGroupNamesValueDomain()
    : SettingsValueDomainBase(ValueDomainKeys.PropertyGroupNames, SettingsRuntimeMode.HostOnly) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) => ToItems(RevitLabelCatalog.GetLabelToPropertyGroupMap().Keys);

    public static Dictionary<string, ForgeTypeId> GetLabelForgeMap() =>
        RevitLabelCatalog.GetLabelToPropertyGroupMap();

    public static Dictionary<ForgeTypeId, string> GetForgeLabelMap() =>
        RevitLabelCatalog.GetPropertyGroupToLabelMap();

    public static string GetLabelForForge(ForgeTypeId forge) =>
        RevitLabelCatalog.GetLabelForPropertyGroup(forge);
}

public sealed class FamilyNamesValueDomain()
    : SettingsValueDomainBase(ValueDomainKeys.FamilyNames, SettingsRuntimeMode.LiveDocument) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null)
                return ToItems([]);

            return ToItems(new FilteredElementCollector(doc)
                .OfClass(typeof(Family))
                .Cast<Family>()
                .Select(family => family.Name)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase));
        } catch {
            return ToItems([]);
        }
    }
}

public sealed class SharedParameterNamesValueDomain()
    : SettingsValueDomainBase(
        ValueDomainKeys.SharedParameterNames,
        SettingsRuntimeMode.LiveDocument,
        [new SettingsOptionsDependency(ValueDomainContextKeys.SelectedFamilyNames, SettingsOptionsDependencyScope.Context)]
    ) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var apsNames = ApsParameterCacheReader.ReadEntries()
            .Where(entry => !entry.IsArchived)
            .Select(entry => entry.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (apsNames.Count == 0)
            return ToItems([]);

        IEnumerable<string> values = apsNames;

        if (context.TryGetContextValue(ValueDomainContextKeys.SelectedFamilyNames, out var rawFamilyNames)) {
            var selectedFamilyNames = ParseDelimitedFamilyNames(rawFamilyNames);
            if (selectedFamilyNames.Count != 0) {
                var doc = context.GetActiveDocument();
                if (doc != null) {
                    var familyParameterNames = ProjectParameterCatalogCollector.Collect(doc, selectedFamilyNames)
                        .Select(item => item.Identity.Name)
                        .ToHashSet(StringComparer.OrdinalIgnoreCase);
                    if (familyParameterNames.Count != 0) {
                        values = apsNames
                            .Where(familyParameterNames.Contains)
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
                    }
                }
            }
        }

        return ToItems(values);
    }

    private static HashSet<string> ParseDelimitedFamilyNames(string rawNames) =>
        rawNames
            .Trim()
            .Trim('[', ']')
            .Split([',', ';', '|'], StringSplitOptions.RemoveEmptyEntries)
            .Select(name => name.Trim().Trim('"'))
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
}

public sealed class ScheduleFieldNamesValueDomain()
    : SettingsValueDomainBase(
        ValueDomainKeys.ScheduleFieldNames,
        SettingsRuntimeMode.LiveDocument,
        [new SettingsOptionsDependency(ValueDomainContextKeys.CategoryName, SettingsOptionsDependencyScope.Sibling)]
    ) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        try {
            return ToItems(ScheduleFieldNameValueDomain.GetOptions(context.GetActiveDocument(), GetSelectedCategoryName(context)));
        } catch {
            return ToItems([]);
        }
    }

    private static string? GetSelectedCategoryName(ValueDomainExecutionContext context) {
        if (context.TryGetContextValue(ValueDomainContextKeys.CategoryName, out var categoryName) &&
            !string.IsNullOrWhiteSpace(categoryName))
            return categoryName;

        if (context.TryGetContextValue(ValueDomainContextKeys.SelectedCategoryName, out categoryName) &&
            !string.IsNullOrWhiteSpace(categoryName))
            return categoryName;

        return null;
    }
}

public sealed class ScheduleViewTemplateNamesValueDomain()
    : SettingsValueDomainBase(ValueDomainKeys.ScheduleViewTemplateNames, SettingsRuntimeMode.LiveDocument) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        try {
            return ToItems(ScheduleViewTemplateValueDomain.GetOptions(context.GetActiveDocument()));
        } catch {
            return ToItems([]);
        }
    }
}

public sealed class LineStyleNamesValueDomain()
    : SettingsValueDomainBase(ValueDomainKeys.LineStyleNames, SettingsRuntimeMode.LiveDocument) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        try {
            return ToItems(ScheduleLineStyleValueDomain.GetOptions(context.GetActiveDocument()));
        } catch {
            return ToItems(ScheduleLineStyleValueDomain.GetOptions(null));
        }
    }
}
