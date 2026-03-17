using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.Operations;
using Pe.FamilyFoundry.OperationSettings;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;
using System.Runtime.CompilerServices;

namespace Pe.FamilyFoundry.SchemaDefinitions;

internal sealed class MappingDataSchemaDefinition : SettingsSchemaDefinition<MappingData> {
    public override void Configure(ISettingsSchemaBuilder<MappingData> builder) {
        builder.Property(item => item.CurrNames, property => property.UseFieldOptions<FamilyParameterNamesProvider>());
        builder.Property(item => item.NewName, property => property.UseFieldOptions<SharedParameterNamesProvider>());
    }
}

internal sealed class IncludeFamiliesSchemaDefinition : SettingsSchemaDefinition<IncludeFamilies> {
    public override void Configure(ISettingsSchemaBuilder<IncludeFamilies> builder) {
        builder.Property(item => item.Equaling, property => property.UseFieldOptions<FamilyNamesProvider>());
        builder.Property(item => item.Containing, property => property.UseFieldOptions<FamilyNamesProvider>());
        builder.Property(item => item.StartingWith, property => property.UseFieldOptions<FamilyNamesProvider>());
    }
}

internal sealed class ExcludeFamiliesSchemaDefinition : SettingsSchemaDefinition<ExcludeFamilies> {
    public override void Configure(ISettingsSchemaBuilder<ExcludeFamilies> builder) {
        builder.Property(item => item.Equaling, property => property.UseFieldOptions<FamilyNamesProvider>());
        builder.Property(item => item.Containing, property => property.UseFieldOptions<FamilyNamesProvider>());
        builder.Property(item => item.StartingWith, property => property.UseFieldOptions<FamilyNamesProvider>());
    }
}

internal sealed class IncludeSharedParameterSchemaDefinition : SettingsSchemaDefinition<IncludeSharedParameter> {
    public override void Configure(ISettingsSchemaBuilder<IncludeSharedParameter> builder) {
        builder.Property(item => item.Equaling, property => property.UseFieldOptions<SharedParameterNamesProvider>());
        builder.Property(item => item.Containing, property => property.UseFieldOptions<SharedParameterNamesProvider>());
        builder.Property(item => item.StartingWith,
            property => property.UseFieldOptions<SharedParameterNamesProvider>());
    }
}

internal sealed class ExcludeSharedParameterSchemaDefinition : SettingsSchemaDefinition<ExcludeSharedParameter> {
    public override void Configure(ISettingsSchemaBuilder<ExcludeSharedParameter> builder) {
        builder.Property(item => item.Equaling, property => property.UseFieldOptions<SharedParameterNamesProvider>());
        builder.Property(item => item.Containing, property => property.UseFieldOptions<SharedParameterNamesProvider>());
        builder.Property(item => item.StartingWith,
            property => property.UseFieldOptions<SharedParameterNamesProvider>());
    }
}

internal sealed class ParamDefinitionBaseSchemaDefinition : SettingsSchemaDefinition<ParamDefinitionBase> {
    public override void Configure(ISettingsSchemaBuilder<ParamDefinitionBase> builder) =>
        builder.Property(item => item.Name, property => property.UseFieldOptions<SharedParameterNamesProvider>());
}

internal sealed class PerTypeValueRowSchemaDefinition : SettingsSchemaDefinition<PerTypeValueRow> {
    public override void Configure(ISettingsSchemaBuilder<PerTypeValueRow> builder) =>
        builder.Property(item => item.Parameter, property => property.UseFieldOptions<SharedParameterNamesProvider>());
}

internal sealed class AddAndSetParamsSettingsSchemaDefinition : SettingsSchemaDefinition<AddAndSetParamsSettings> {
    public override void Configure(ISettingsSchemaBuilder<AddAndSetParamsSettings> builder) =>
        builder.Property(item => item.PerTypeValuesTable, property => property.Ui(ui => {
            ui.Renderer(SchemaUiRendererKeys.Table);
            ui.Layout(layout => layout.Section("Parameters"));
            ui.Behavior(behavior => {
                behavior.FixedColumns<PerTypeValueRow>(row => row.Parameter);
                behavior.DynamicColumnsFromAdditionalProperties();
                behavior.MissingValue(string.Empty);
                behavior.DynamicColumnOrder<FamilyManagerTypesSchemaUiDynamicColumnOrderSource>();
            });
        }));
}

internal sealed class MakeElecConnectorParametersSchemaDefinition
    : SettingsSchemaDefinition<MakeElecConnectorSettings.Parameters> {
    public override void Configure(ISettingsSchemaBuilder<MakeElecConnectorSettings.Parameters> builder) {
        builder.Property(item => item.NumberOfPoles,
            property => property.UseFieldOptions<SharedParameterNamesProvider>());
        builder.Property(item => item.ApparentPower,
            property => property.UseFieldOptions<SharedParameterNamesProvider>());
        builder.Property(item => item.Voltage, property => property.UseFieldOptions<SharedParameterNamesProvider>());
        builder.Property(item => item.MinimumCircuitAmpacity,
            property => property.UseFieldOptions<SharedParameterNamesProvider>());
    }
}

internal static class FamilyFoundrySchemaDefinitionBootstrapper {
    [ModuleInitializer]
    internal static void Register() {
        SettingsSchemaDefinitionRegistry.Shared.Register(new MappingDataSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new IncludeFamiliesSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new ExcludeFamiliesSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new IncludeSharedParameterSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new ExcludeSharedParameterSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new ParamDefinitionBaseSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new PerTypeValueRowSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new AddAndSetParamsSettingsSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new MakeElecConnectorParametersSchemaDefinition());
    }
}