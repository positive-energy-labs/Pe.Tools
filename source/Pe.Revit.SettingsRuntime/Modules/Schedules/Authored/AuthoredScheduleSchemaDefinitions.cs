using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.StorageRuntime.Capabilities;
using System.Runtime.CompilerServices;

namespace Pe.Revit.SettingsRuntime.Modules.Schedules.Authored;

internal sealed class ScheduleProfileSchemaDefinition : SettingsSchemaDefinition<ScheduleProfile> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleProfile> builder) {
        builder.Property(
            item => item.CategoryName,
            property => {
                property.WithDescription("Revit category label to schedule, such as 'Air Terminals'.");
                property.UseValueDomain(ValueDomainKeys.CategoryNames);
            }
        );
        builder.Property(
            item => item.ViewTemplateName,
            property => {
                property.WithDescription("Optional schedule view template name. Omit to leave the schedule untemplated.");
                property.UseValueDomain(ValueDomainKeys.ScheduleViewTemplateNames);
            }
        );
        builder.Property(item => item.Fields, property => {
            property.WithDisplayName("Fields");
            property.WithDescription("Schedule fields to add. Omit or use an empty array for a schedule with no authored fields.");
        });
        builder.Property(
            item => item.TitleStyle,
            property => property.WithDescription("Optional title style overrides. Omit to skip title styling.")
        );
        builder.Property(
            item => item.SortGroup,
            property => property.WithDescription("Optional sort/group rules. Omit to apply no sort/group rules.")
        );
        builder.Property(
            item => item.Filters,
            property => property.WithDescription("Optional filters. Omit to apply no filters.")
        );
    }
}

internal sealed class ScheduleFieldSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleFieldSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleFieldSpec> builder) {
        builder.Property(item => item.ParameterName, property => {
            property.WithDescription("Schedule field parameter name.");
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseValueDomain(ValueDomainKeys.ScheduleFieldNames);
        });
        builder.Property(item => item.PercentageOfField, property => {
            property.WithDescription("Required only when CalculatedType is Percentage.");
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseValueDomain(ValueDomainKeys.ScheduleFieldNames);
        });
        builder.Property(
            item => item.DisplayType,
            property => property.WithDescription("Optional display aggregation. Omit for Standard.")
        );
        builder.Property(
            item => item.HorizontalAlignment,
            property => property.WithDescription("Optional field value alignment. Omit for Center.")
        );
        builder.Property(
            item => item.ColumnWidth,
            property => property.WithDescription("Optional sheet column width in feet. Omit to keep Revit's default width.")
        );
        builder.Property(
            item => item.IsHidden,
            property => property.WithDescription("Optional hidden flag. Omit for false.")
        );
    }
}

internal sealed class CombinedParameterSpecSchemaDefinition : SettingsSchemaDefinition<CombinedParameterSpec> {
    public override void Configure(ISettingsSchemaBuilder<CombinedParameterSpec> builder) =>
        builder.Property(item => item.ParameterName, property => {
            property.WithDescription("Parameter name to include in the combined field.");
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseValueDomain(ValueDomainKeys.ScheduleFieldNames);
        });
}

internal sealed class ScheduleFilterSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleFilterSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleFilterSpec> builder) {
        builder.Property(item => item.FieldName, property => {
            property.WithDescription("Schedule field to filter on.");
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseValueDomain(ValueDomainKeys.ScheduleFieldNames);
        });
        builder.Property(
            item => item.FilterType,
            property => property.WithDescription("Optional filter comparison. Omit for Equal.")
        );
        builder.Property(
            item => item.Value,
            property => property.WithDescription("Filter value as authored text. Omit for HasParameter, HasValue, and HasNoValue.")
        );
    }
}

internal sealed class ScheduleSortGroupSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleSortGroupSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleSortGroupSpec> builder) {
        builder.Property(item => item.FieldName, property => {
            property.WithDescription("Schedule field to sort or group by.");
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseValueDomain(ValueDomainKeys.ScheduleFieldNames);
        });
        builder.Property(
            item => item.SortOrder,
            property => property.WithDescription("Optional sort direction. Omit for Ascending.")
        );
    }
}

internal sealed class
    ScheduleTitleStyleSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleTitleStyleSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleTitleStyleSpec> builder) =>
        builder.Property(
            item => item.HorizontalAlignment,
            property => property.WithDescription("Optional title text alignment. Omit to leave alignment unchanged.")
        );
}

internal sealed class
    ScheduleTitleBorderSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleTitleBorderSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleTitleBorderSpec> builder) {
        builder.Property(
            item => item.TopLineStyleName,
            property => {
                property.WithDescription("Optional top border line style name.");
                property.UseValueDomain(ValueDomainKeys.LineStyleNames);
            }
        );
        builder.Property(
            item => item.BottomLineStyleName,
            property => {
                property.WithDescription("Optional bottom border line style name.");
                property.UseValueDomain(ValueDomainKeys.LineStyleNames);
            }
        );
        builder.Property(
            item => item.LeftLineStyleName,
            property => {
                property.WithDescription("Optional left border line style name.");
                property.UseValueDomain(ValueDomainKeys.LineStyleNames);
            }
        );
        builder.Property(
            item => item.RightLineStyleName,
            property => {
                property.WithDescription("Optional right border line style name.");
                property.UseValueDomain(ValueDomainKeys.LineStyleNames);
            }
        );
    }
}

internal sealed class BatchScheduleSettingsSchemaDefinition : SettingsSchemaDefinition<BatchScheduleSettings> {
    public override void Configure(ISettingsSchemaBuilder<BatchScheduleSettings> builder) =>
        builder.Property(item => item.ScheduleFiles, property => property.UseStaticExamples(
            "equipment/air-handlers.json",
            "equipment/rooftop-units.json",
            "plumbing/fixtures.json"
        ));
}

public static class ScheduleSchemaDefinitionBootstrapper {
    private static readonly object SyncRoot = new();
    private static bool _registered;

    [ModuleInitializer]
    internal static void RegisterOnModuleLoad() => EnsureRegistered();

    public static void EnsureRegistered() {
        if (_registered)
            return;

        lock (SyncRoot) {
            if (_registered)
                return;

            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleProfileSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleFieldSpecSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new CombinedParameterSpecSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleFilterSpecSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleSortGroupSpecSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleTitleStyleSpecSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleTitleBorderSpecSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new BatchScheduleSettingsSchemaDefinition());
            _registered = true;
        }
    }
}

