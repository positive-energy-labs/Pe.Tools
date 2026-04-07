using Pe.Revit.FamilyFoundry.Aggregators.Snapshots;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.Global.Revit.Lib.Schedules.Filters;
using Pe.Shared.StorageRuntime.Core.Json.SchemaProviders;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using Pe.Shared.StorageRuntime.Json.SchemaProviders;
using System.Runtime.CompilerServices;

namespace Pe.Revit.FamilyFoundry.SchemaDefinitions;

internal sealed class MappingDataSchemaDefinition : SettingsSchemaDefinition<MappingData> {
    public override void Configure(ISettingsSchemaBuilder<MappingData> builder) {
        builder.Property(item => item.CurrNames, property => {
            property.DependsOnContext(OptionContextKeys.SelectedFamilyNames);
            property.UseDatasetOptions(
                SchemaDatasetIds.ParameterCatalog,
                SchemaProjectionKeys.FamilyParameterNames
            );
        });
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

internal sealed class FilterFamiliesSettingsSchemaDefinition : SettingsSchemaDefinition<BaseProfileSettings.FilterFamiliesSettings> {
    public override void Configure(ISettingsSchemaBuilder<BaseProfileSettings.FilterFamiliesSettings> builder) =>
        builder.Property(item => item.IncludeByCondition,
            property => property.WithDescription(
                "Optional conditional filter based on family parameter values. Uses schedule filter logic to evaluate parameter conditions. Leave FieldName empty to disable this filter."));
}

internal sealed class ScheduleFilterSpecFamilyFoundrySchemaDefinition : SettingsSchemaDefinition<ScheduleFilterSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleFilterSpec> builder) =>
        builder.Property(item => item.FieldName, property => {
            property.DependsOnSibling(OptionContextKeys.CategoryName);
            property.UseFieldOptions<ScheduleFieldNamesProvider>();
        });
}

internal sealed class GlobalParamAssignmentSchemaDefinition : SettingsSchemaDefinition<GlobalParamAssignment> {
    public override void Configure(ISettingsSchemaBuilder<GlobalParamAssignment> builder) =>
        builder.Property(item => item.Parameter,
            property => property.UseFieldOptions<SharedParameterNamesProvider>());
}

internal sealed class PerTypeAssignmentRowSchemaDefinition : SettingsSchemaDefinition<PerTypeAssignmentRow> {
    public override void Configure(ISettingsSchemaBuilder<PerTypeAssignmentRow> builder) =>
        builder.Property(item => item.Parameter,
            property => property.UseFieldOptions<SharedParameterNamesProvider>());
}

internal sealed class SetKnownParamsSettingsSchemaDefinition : SettingsSchemaDefinition<SetKnownParamsSettings> {
    public override void Configure(ISettingsSchemaBuilder<SetKnownParamsSettings> builder) {
        builder.Property(item => item.GlobalAssignments,
            property => property.WithDisplayName("Global Assignments"));
        builder.Property(item => item.PerTypeAssignmentsTable, property => property.Ui(ui => {
            ui.Renderer(SchemaUiRendererKeys.Table);
            ui.Layout(layout => layout.Section("Parameters"));
            ui.Behavior(behavior => {
                behavior.FixedColumns<PerTypeAssignmentRow>(row => row.Parameter);
                behavior.DynamicColumnsFromAdditionalProperties();
                behavior.MissingValue(string.Empty);
                behavior.DynamicColumnOrder<FamilyManagerTypesSchemaUiDynamicColumnOrderSource>();
            });
        }));
    }
}

internal sealed class SetLookupTablesSettingsSchemaDefinition : SettingsSchemaDefinition<SetLookupTablesSettings> {
    public override void Configure(ISettingsSchemaBuilder<SetLookupTablesSettings> builder) {
    }
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
        SettingsSchemaDefinitionRegistry.Shared.Register(new FilterFamiliesSettingsSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleFilterSpecFamilyFoundrySchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new GlobalParamAssignmentSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new PerTypeAssignmentRowSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new SetKnownParamsSettingsSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new SetLookupTablesSettingsSchemaDefinition());
        SettingsSchemaDefinitionRegistry.Shared.Register(new MakeElecConnectorParametersSchemaDefinition());
    }
}
