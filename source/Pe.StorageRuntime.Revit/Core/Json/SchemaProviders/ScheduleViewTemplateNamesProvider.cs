using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

/// <summary>
///     Provides schedule view template names from the active Revit document.
/// </summary>
public class ScheduleViewTemplateNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(ScheduleViewTemplateNamesProvider),
        SettingsOptionsResolverKind.Remote,
        null,
        SettingsOptionsMode.Suggestion,
        true,
        [],
        SettingsRuntimeCapabilityProfiles.LiveDocument
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null || doc.IsFamilyDocument)
                return ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>([]);

            var items = new FilteredElementCollector(doc)
                .OfClass(typeof(ViewSchedule))
                .Cast<ViewSchedule>()
                .Where(view => view.IsTemplate)
                .Select(view => view.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .Select(value => new FieldOptionItem(value, value, null))
                .ToList();
            return ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>(items);
        } catch {
            return ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>([]);
        }
    }
}
