using Pe.Revit.Global.Revit.Lib.Schedules;
using Pe.Revit.Global.Revit.Lib.Schedules.Fields;
using Pe.Revit.Global.Revit.Lib.Schedules.Filters;
using Pe.Revit.Global.Revit.Lib.Schedules.SortGroup;
using Pe.Shared.StorageRuntime.Core.Json.SchemaProviders;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using Pe.Shared.StorageRuntime.Json.SchemaProviders;
using System.Runtime.CompilerServices;

namespace Pe.Shared.SettingsCatalog.Manifests.Schedules;

internal sealed class ScheduleSpecRootSchemaDefinition : SettingsSchemaDefinition<ScheduleSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleSpec> builder) {
        builder.Property(item => item.CategoryName, property => property.UseFieldOptions<CategoryNamesProvider>());
        builder.Property(item => item.ViewTemplateName,
            property => property.UseFieldOptions<ScheduleViewTemplateNamesProvider>());
        builder.Property(item => item.Fields, property => property.WithDisplayName("Fields"));
    }
}

internal sealed class ScheduleFieldSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleFieldSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleFieldSpec> builder) {
        builder.Property(item => item.ParameterName,
            property => property.UseFieldOptions<ScheduleFieldNamesProvider>());
        builder.Property(item => item.PercentageOfField,
            property => property.UseFieldOptions<ScheduleFieldNamesProvider>());
    }
}

internal sealed class CombinedParameterSpecSchemaDefinition : SettingsSchemaDefinition<CombinedParameterSpec> {
    public override void Configure(ISettingsSchemaBuilder<CombinedParameterSpec> builder) =>
        builder.Property(item => item.ParameterName,
            property => property.UseFieldOptions<ScheduleFieldNamesProvider>());
}

internal sealed class ScheduleFilterSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleFilterSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleFilterSpec> builder) =>
        builder.Property(item => item.FieldName,
            property => property.UseFieldOptions<ScheduleFieldNamesProvider>());
}

internal sealed class ScheduleSortGroupSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleSortGroupSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleSortGroupSpec> builder) =>
        builder.Property(item => item.FieldName,
            property => property.UseFieldOptions<ScheduleFieldNamesProvider>());
}

internal static class ScheduleManagerSchemaDefinitionBootstrapper {
    [ModuleInitializer]
    internal static void Register() {
        SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleSpecRootSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleFieldSpecSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new CombinedParameterSpecSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleFilterSpecSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleSortGroupSpecSchemaDefinition());
    }
}
