using Pe.Revit.Global.Revit.Lib.Schedules.TitleStyle;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using Pe.Shared.StorageRuntime.Core.Json.SchemaProviders;
using System.Runtime.CompilerServices;

namespace Pe.Revit.Global.Revit.Lib.Schedules;

internal sealed class ScheduleSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleSpec> builder) {
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
        SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleSpecSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new TitleBorderStyleSpecSchemaDefinition());
    }
}
