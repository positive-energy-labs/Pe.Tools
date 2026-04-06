using Pe.Shared.SettingsCatalog.Manifests.Schedules;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using System.Runtime.CompilerServices;

namespace Pe.Tools.Commands.FamilyFoundry.ScheduleManagerUi;

internal sealed class BatchScheduleSettingsSchemaDefinition : SettingsSchemaDefinition<BatchScheduleSettings> {
    public override void Configure(ISettingsSchemaBuilder<BatchScheduleSettings> builder) =>
        builder.Property(item => item.ScheduleFiles, property => property.UseStaticExamples(
            "equipment/air-handlers.json",
            "equipment/rooftop-units.json",
            "plumbing/fixtures.json"
        ));
}

internal static class BatchScheduleSchemaDefinitionBootstrapper {
    [ModuleInitializer]
    internal static void Register() =>
        SettingsSchemaDefinitionRegistry.Shared.Register(new BatchScheduleSettingsSchemaDefinition());
}
