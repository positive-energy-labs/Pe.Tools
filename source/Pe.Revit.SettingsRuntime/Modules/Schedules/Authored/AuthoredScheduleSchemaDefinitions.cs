using Pe.Revit.SettingsRuntime.Json.FieldOptions;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.StorageRuntime.Capabilities;
using System.Runtime.CompilerServices;

namespace Pe.Revit.SettingsRuntime.Modules.Schedules.Authored;

internal sealed class ScheduleProfileSchemaDefinition : SettingsSchemaDefinition<ScheduleProfile> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleProfile> builder) {
        builder.Property(
            item => item.CategoryName,
            property => property.UseFieldOptions(
                FieldOptionsProviderKeys.CategoryNames,
                SettingsRuntimeMode.LiveDocument
            )
        );
        builder.Property(
            item => item.ViewTemplateName,
            property => property.UseFieldOptions(
                FieldOptionsProviderKeys.ScheduleViewTemplateNames,
                SettingsRuntimeMode.LiveDocument
            )
        );
        builder.Property(item => item.Fields, property => property.WithDisplayName("Fields"));
    }
}

internal sealed class ScheduleFieldSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleFieldSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleFieldSpec> builder) {
        builder.Property(item => item.ParameterName, property => {
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseFieldOptions(
                FieldOptionsProviderKeys.ScheduleFieldNames,
                SettingsRuntimeMode.LiveDocument
            );
        });
        builder.Property(item => item.PercentageOfField, property => {
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseFieldOptions(
                FieldOptionsProviderKeys.ScheduleFieldNames,
                SettingsRuntimeMode.LiveDocument
            );
        });
    }
}

internal sealed class CombinedParameterSpecSchemaDefinition : SettingsSchemaDefinition<CombinedParameterSpec> {
    public override void Configure(ISettingsSchemaBuilder<CombinedParameterSpec> builder) =>
        builder.Property(item => item.ParameterName, property => {
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseFieldOptions(
                FieldOptionsProviderKeys.ScheduleFieldNames,
                SettingsRuntimeMode.LiveDocument
            );
        });
}

internal sealed class ScheduleFilterSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleFilterSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleFilterSpec> builder) =>
        builder.Property(item => item.FieldName, property => {
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseFieldOptions(
                FieldOptionsProviderKeys.ScheduleFieldNames,
                SettingsRuntimeMode.LiveDocument
            );
        });
}

internal sealed class ScheduleSortGroupSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleSortGroupSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleSortGroupSpec> builder) =>
        builder.Property(item => item.FieldName, property => {
            property.DependsOnSibling(nameof(ScheduleProfile.CategoryName));
            property.UseFieldOptions(
                FieldOptionsProviderKeys.ScheduleFieldNames,
                SettingsRuntimeMode.LiveDocument
            );
        });
}

internal sealed class
    ScheduleTitleStyleSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleTitleStyleSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleTitleStyleSpec> builder) {
    }
}

internal sealed class
    ScheduleTitleBorderSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleTitleBorderSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleTitleBorderSpec> builder) {
        builder.Property(
            item => item.TopLineStyleName,
            property => property.UseFieldOptions(
                FieldOptionsProviderKeys.LineStyleNames,
                SettingsRuntimeMode.LiveDocument
            )
        );
        builder.Property(
            item => item.BottomLineStyleName,
            property => property.UseFieldOptions(
                FieldOptionsProviderKeys.LineStyleNames,
                SettingsRuntimeMode.LiveDocument
            )
        );
        builder.Property(
            item => item.LeftLineStyleName,
            property => property.UseFieldOptions(
                FieldOptionsProviderKeys.LineStyleNames,
                SettingsRuntimeMode.LiveDocument
            )
        );
        builder.Property(
            item => item.RightLineStyleName,
            property => property.UseFieldOptions(
                FieldOptionsProviderKeys.LineStyleNames,
                SettingsRuntimeMode.LiveDocument
            )
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

