using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using System.Runtime.CompilerServices;

namespace Pe.Revit.SettingsRuntime.Modules.Schedules.Authored;

internal sealed class ScheduleProfileSchemaDefinition : SettingsSchemaDefinition<ScheduleProfile> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleProfile> builder) {
        builder.Property(
            item => item.CategoryName,
            property => {
                property.WithDescription("Revit category label to schedule, such as 'Air Terminals', 'Mechanical Equipment', 'Plumbing Fixtures', etc.");
                property.UseValueDomain(ValueDomainKeys.CategoryNames);
            }
        );
        builder.Property(
            item => item.ViewTemplateName,
            property => {
                property.WithDescription("Optional schedule view template name. Omit to leave the schedule untemplated.");
                property.DisallowNull();
                property.UseValueDomain(ValueDomainKeys.ScheduleViewTemplateNames);
            }
        );
        builder.Property(item => item.Fields, property => {
            property.WithDisplayName("Fields");
            property.WithDescription("Schedule fields to add. Omit or use an empty array for a schedule with no authored fields.");
            property.DisallowNull();
            property.AllowIncludes(IncludableFragmentRoot.Fields);
        });
        builder.Property(
            item => item.TitleStyle,
            property => {
                property.WithDescription("Optional title style overrides. Omit for the default PE title style: left-aligned text with only a bottom border.");
                property.DisallowNull();
            }
        );
        builder.Property(
            item => item.ColumnHeaderVerticalAlignment,
            property => property.WithDescription("Vertical alignment applied to all column headers. Defaults to Bottom.")
        );
        builder.Property(
            item => item.SortGroup,
            property => {
                property.WithDescription("Sort/group rules. Defaults to an empty list.");
                property.DisallowNull();
            }
        );
        builder.Property(
            item => item.Filters,
            property => {
                property.WithDescription("Filters. Defaults to an empty list.");
                property.DisallowNull();
            }
        );
    }
}

internal sealed class ParameterReferenceSchemaDefinition : SettingsSchemaDefinition<ParameterReference> {
    public override void Configure(ISettingsSchemaBuilder<ParameterReference> builder) {
        builder.Property(item => item.Name, property => {
            property.WithDescription("Optional parameter display name fallback. Prefer identity or sharedGuid when available.");
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseValueDomain(ValueDomainKeys.ScheduleFieldNames);
            property.DisallowNull();
        });
        builder.Property(item => item.SharedGuid, property => {
            property.WithDescription("Optional shared parameter GUID. Prefer identity when carrying a previously observed parameter.");
            property.DisallowNull();
        });
        builder.Property(item => item.Identity, property => {
            property.WithDescription("Optional observed parameter identity.");
            property.DisallowNull();
        });
    }
}

internal sealed class ScheduleFieldSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleFieldSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleFieldSpec> builder) {
        builder.Property(item => item.Parameter, property => {
            property.WithDescription("Schedule field parameter reference. Prefer identity or sharedGuid when available; use name as a fallback.");
        });
        builder.Property(item => item.ParameterName, property => {
            property.WithDescription("Human-authored schedule field parameter name. Used when Parameter is omitted or empty.");
            property.DisallowNull();
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseValueDomain(ValueDomainKeys.ScheduleFieldNames);
        });
        builder.Property(item => item.PercentageOfField, property => {
            property.WithDescription("Required only when CalculatedType is Percentage.");
            property.DisallowNull();
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseValueDomain(ValueDomainKeys.ScheduleFieldNames);
        });
        builder.Property(
            item => item.DisplayType,
            property => property.WithDescription("Display aggregation. Defaults to Standard.")
        );
        builder.Property(
            item => item.HorizontalAlignment,
            property => property.WithDescription("Field value alignment. Defaults to Center.")
        );
        builder.Property(
            item => item.ColumnHeaderOverride,
            property => {
                property.WithDescription("Optional column header text override. Omit to use Revit's field heading.");
                property.DisallowNull();
            }
        );
        builder.Property(
            item => item.HeaderGroup,
            property => {
                property.WithDescription("Optional grouped header label for this field. Adjacent fields with the same value are grouped together.");
                property.DisallowNull();
            }
        );
        builder.Property(
            item => item.ColumnWidth,
            property => property.WithDescription("Optional sheet column width in feet. Omit to keep Revit's default width.")
        );
        builder.Property(
            item => item.IsHidden,
            property => property.WithDescription("Hidden flag. Defaults to false.")
        );
        builder.Property(
            item => item.FormatOptions,
            property => {
                property.WithDescription("Optional field formatting overrides. Omit to keep Revit's default field formatting.");
                property.DisallowNull();
            }
        );
        builder.Property(
            item => item.CombinedParameters,
            property => {
                property.WithDescription("Component parameters for a combined schedule field. Defaults to an empty list for a normal single-parameter field.");
                property.DisallowNull();
            }
        );
    }
}

internal sealed class ScheduleFieldFormatSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleFieldFormatSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleFieldFormatSpec> builder) {
        builder.Property(item => item.UnitTypeId, property => {
            property.WithDescription("Optional Revit unit label to use for field formatting, such as Feet or Square Feet. Omit to keep default project units.");
            property.DisallowNull();
            property.UseValueDomain(ValueDomainKeys.UnitTypeIds);
        });
        builder.Property(item => item.SymbolTypeId, property => {
            property.WithDescription("Optional Revit unit symbol label to show with the formatted value. Choose a symbol valid for UnitTypeId; omit to keep the unit's default symbol behavior.");
            property.DisallowNull();
            property.DependsOnSibling(ValueDomainContextKeys.UnitTypeId);
            property.UseValueDomain(ValueDomainKeys.SymbolTypeIds);
        });
        builder.Property(
            item => item.Accuracy,
            property => {
                property.WithDescription("Optional rounding accuracy for the formatted field. Omit to keep Revit's default accuracy.");
                property.DisallowNull();
            }
        );
    }
}

internal sealed class CombinedParameterSpecSchemaDefinition : SettingsSchemaDefinition<CombinedParameterSpec> {
    public override void Configure(ISettingsSchemaBuilder<CombinedParameterSpec> builder) {
        builder.Property(item => item.Parameter, property => {
            property.WithDescription("Parameter reference to include in the combined field. Prefer identity or sharedGuid when available; use name as a fallback.");
        });
        builder.Property(item => item.ParameterName, property => {
            property.WithDescription("Human-authored parameter name to include in the combined field. Used when Parameter is omitted or empty.");
            property.DisallowNull();
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseValueDomain(ValueDomainKeys.ScheduleFieldNames);
        });
        builder.Property(item => item.Prefix, property => {
            property.WithDescription("Optional text to add before this combined-parameter value. Omit for no prefix.");
            property.DisallowNull();
        });
        builder.Property(item => item.Suffix, property => {
            property.WithDescription("Optional text to add after this combined-parameter value. Omit for no suffix.");
            property.DisallowNull();
        });
        builder.Property(item => item.Separator, property => {
            property.WithDescription("Separator after this combined-parameter value. Defaults to \" / \".");
            property.DisallowNull();
        });
    }
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
            property => property.WithDescription("Filter comparison. Defaults to Equal.")
        );
        builder.Property(
            item => item.Value,
            property => {
                property.WithDescription("Filter value as authored text. Omit for HasParameter, HasValue, and HasNoValue.");
                property.DisallowNull();
            }
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
            property => property.WithDescription("Sort direction. Defaults to Ascending.")
        );
    }
}

internal sealed class
    ScheduleTitleStyleSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleTitleStyleSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleTitleStyleSpec> builder) =>
        builder.Property(
            item => item.HorizontalAlignment,
            property => property.WithDescription("Title text alignment. Defaults to Left.")
        );
}

internal sealed class
    ScheduleTitleBorderSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleTitleBorderSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleTitleBorderSpec> builder) {
        builder.Property(
            item => item.TopLineStyleName,
            property => {
                property.WithDescription("Optional top border line style name. Use null or omit to remove the top border.");
                property.UseValueDomain(ValueDomainKeys.LineStyleNames);
            }
        );
        builder.Property(
            item => item.BottomLineStyleName,
            property => {
                property.WithDescription("Optional bottom border line style name. Use null or omit to remove the bottom border when BorderStyle is authored.");
                property.UseValueDomain(ValueDomainKeys.LineStyleNames);
            }
        );
        builder.Property(
            item => item.LeftLineStyleName,
            property => {
                property.WithDescription("Optional left border line style name. Use null or omit to remove the left border.");
                property.UseValueDomain(ValueDomainKeys.LineStyleNames);
            }
        );
        builder.Property(
            item => item.RightLineStyleName,
            property => {
                property.WithDescription("Optional right border line style name. Use null or omit to remove the right border.");
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

            SettingsSchemaDefinitionRegistry.Shared.Register(new ParameterReferenceSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleProfileSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleFieldSpecSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleFieldFormatSpecSchemaDefinition());
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
