using Pe.Revit.Global.Revit.Documents.Schedules.TitleStyle;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using Pe.Shared.StorageRuntime.Core.Json.SchemaProviders;
using System.Runtime.CompilerServices;

namespace Pe.Revit.Global.Revit.Documents.Schedules;

internal sealed class ScheduleProfileSchemaDefinition : SettingsSchemaDefinition<ScheduleProfile> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleProfile> builder) {
        builder.Property(item => item.ViewTemplateName, property => property.UseFieldOptions<ScheduleViewTemplateNamesProvider>());
    }
}

internal sealed class TitleBorderStyleSpecSchemaDefinition : SettingsSchemaDefinition<TitleBorderStyleSpec> {
    public override void Configure(ISettingsSchemaBuilder<TitleBorderStyleSpec> builder) {
        builder.Property(item => item.TopLineStyleName, property => property.UseFieldOptions<LineStyleNamesProvider>());
        builder.Property(item => item.BottomLineStyleName, property => property.UseFieldOptions<LineStyleNamesProvider>());
        builder.Property(item => item.LeftLineStyleName, property => property.UseFieldOptions<LineStyleNamesProvider>());
        builder.Property(item => item.RightLineStyleName, property => property.UseFieldOptions<LineStyleNamesProvider>());
    }
}

internal static class ScheduleSchemaDefinitionBootstrapper {
    [ModuleInitializer]
    internal static void Register() {
        SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleProfileSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new TitleBorderStyleSpecSchemaDefinition());
    }
}
