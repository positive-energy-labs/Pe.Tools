using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Json.FieldOptions;
using Pe.Shared.StorageRuntime.Json.SchemaProviders;

namespace Pe.Shared.StorageRuntime.Core.Json.SchemaProviders;

/// <summary>
///     Provides schedule field names available for a schedule category in the active Revit document.
/// </summary>
public class ScheduleFieldNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(ScheduleFieldNamesProvider),
        SettingsOptionsResolverKind.Remote,
        SettingsOptionsMode.Suggestion,
        true,
        [new FieldOptionsDependency(OptionContextKeys.CategoryName, SettingsOptionsDependencyScope.Sibling)],
        SettingsRuntimeMode.LiveDocument
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null || doc.IsFamilyDocument)
                return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);

            var items = GetFieldNames(doc, GetSelectedCategoryName(context))
                .Select(value => new FieldOptionItem(value, value, null))
                .ToList();

            return new ValueTask<IReadOnlyList<FieldOptionItem>>(items);
        } catch {
            return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);
        }
    }

    private static string? GetSelectedCategoryName(FieldOptionsExecutionContext context) {
        if (context.TryGetContextValue(OptionContextKeys.CategoryName, out var categoryName) &&
            !string.IsNullOrWhiteSpace(categoryName))
            return categoryName;

        if (context.TryGetContextValue(OptionContextKeys.SelectedCategoryName, out categoryName) &&
            !string.IsNullOrWhiteSpace(categoryName))
            return categoryName;

        return null;
    }

    internal static IReadOnlyList<string> GetFieldNames(Document doc, string? categoryName) {
        var schedules = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => !schedule.IsTemplate)
            .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase));

        if (!string.IsNullOrWhiteSpace(categoryName)) {
            schedules = schedules.Where(schedule =>
                string.Equals(
                    Category.GetCategory(doc, schedule.Definition.CategoryId)?.Name,
                    categoryName,
                    StringComparison.OrdinalIgnoreCase
                ));
        }

        return schedules
            .SelectMany(schedule => GetFieldNames(schedule, doc))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static IEnumerable<string> GetFieldNames(ViewSchedule schedule, Document doc) {
        try {
            return schedule.Definition
                .GetSchedulableFields()
                .Select(field => field.GetName(doc))
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        } catch {
            return [];
        }
    }
}

/// <summary>
///     Provides schedule names scoped to a selected category in the active Revit document.
/// </summary>
public class ScheduleNamesByCategoryProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(ScheduleNamesByCategoryProvider),
        SettingsOptionsResolverKind.Remote,
        SettingsOptionsMode.Suggestion,
        true,
        [new FieldOptionsDependency(OptionContextKeys.CategoryName, SettingsOptionsDependencyScope.Sibling)],
        SettingsRuntimeMode.LiveDocument
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null || doc.IsFamilyDocument)
                return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);

            var categoryName = context.TryGetContextValue(OptionContextKeys.CategoryName, out var selectedCategoryName)
                ? selectedCategoryName
                : null;

            var items = new FilteredElementCollector(doc)
                .OfClass(typeof(ViewSchedule))
                .Cast<ViewSchedule>()
                .Where(schedule => !schedule.IsTemplate)
                .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))
                .Where(schedule => string.IsNullOrWhiteSpace(categoryName) ||
                    string.Equals(
                        Category.GetCategory(doc, schedule.Definition.CategoryId)?.Name,
                        categoryName,
                        StringComparison.OrdinalIgnoreCase
                    ))
                .Select(schedule => schedule.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .Select(value => new FieldOptionItem(value, value, null))
                .ToList();

            return new ValueTask<IReadOnlyList<FieldOptionItem>>(items);
        } catch {
            return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);
        }
    }
}
