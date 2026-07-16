using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Revit.SettingsRuntime.Json.SchemaProviders;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime.Capabilities;
using System.Runtime.CompilerServices;

namespace Pe.Revit.FamilyFoundry.SchemaDefinitions;

internal sealed class MappingDataSchemaDefinition : SettingsSchemaDefinition<MappingData> {
    public override void Configure(ISettingsSchemaBuilder<MappingData> builder) {
        builder.Property(item => item.CurrNames, property => {
            property.DependsOnContext(ValueDomainContextKeys.SelectedFamilyNames);
            property.UseDatasetOptions(
                SchemaDatasetIds.ParameterCatalog,
                SchemaProjectionKeys.FamilyParameterNames
            );
        });
        builder.Property(item => item.NewName, property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
    }
}

internal sealed class IncludeFamiliesSchemaDefinition : SettingsSchemaDefinition<IncludeFamilies> {
    public override void Configure(ISettingsSchemaBuilder<IncludeFamilies> builder) {
        builder.Property(item => item.Equaling, property => property.UseValueDomain(ValueDomainKeys.FamilyNames));
        builder.Property(item => item.Containing, property => property.UseValueDomain(ValueDomainKeys.FamilyNames));
        builder.Property(item => item.StartingWith, property => property.UseValueDomain(ValueDomainKeys.FamilyNames));
    }
}

internal sealed class ExcludeFamiliesSchemaDefinition : SettingsSchemaDefinition<ExcludeFamilies> {
    public override void Configure(ISettingsSchemaBuilder<ExcludeFamilies> builder) {
        builder.Property(item => item.Equaling, property => property.UseValueDomain(ValueDomainKeys.FamilyNames));
        builder.Property(item => item.Containing, property => property.UseValueDomain(ValueDomainKeys.FamilyNames));
        builder.Property(item => item.StartingWith, property => property.UseValueDomain(ValueDomainKeys.FamilyNames));
    }
}

internal sealed class IncludeSharedParameterSchemaDefinition : SettingsSchemaDefinition<IncludeSharedParameter> {
    public override void Configure(ISettingsSchemaBuilder<IncludeSharedParameter> builder) {
        builder.Property(item => item.Equaling, property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
        builder.Property(item => item.Containing, property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
        builder.Property(item => item.StartingWith,
            property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
    }
}

internal sealed class ExcludeSharedParameterSchemaDefinition : SettingsSchemaDefinition<ExcludeSharedParameter> {
    public override void Configure(ISettingsSchemaBuilder<ExcludeSharedParameter> builder) {
        builder.Property(item => item.Equaling, property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
        builder.Property(item => item.Containing, property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
        builder.Property(item => item.StartingWith,
            property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
    }
}

internal sealed class
    FilterFamiliesSettingsSchemaDefinition : SettingsSchemaDefinition<BaseProfile.FilterFamiliesSettings> {
    public override void Configure(ISettingsSchemaBuilder<BaseProfile.FilterFamiliesSettings> builder) {
        builder.Property(item => item.IncludeCategoriesEqualing,
            property => property.UseValueDomain(ValueDomainKeys.CategoryNames));
        builder.Property(item => item.IncludeByCondition,
            property => property.WithDescription(
                "Optional conditional filter based on family parameter values. Uses schedule filter logic to evaluate parameter conditions. Leave FieldName empty to disable this filter."));
    }
}

internal sealed class GlobalParamAssignmentSchemaDefinition : SettingsSchemaDefinition<GlobalParamAssignment> {
    public override void Configure(ISettingsSchemaBuilder<GlobalParamAssignment> builder) =>
        builder.Property(item => item.Parameter,
            property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
}

internal sealed class PerTypeAssignmentRowSchemaDefinition : SettingsSchemaDefinition<PerTypeAssignmentRow> {
    public override void Configure(ISettingsSchemaBuilder<PerTypeAssignmentRow> builder) =>
        builder.Property(item => item.Parameter,
            property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
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

internal sealed class SharedParameterSelectionFilterSchemaDefinition : SettingsSchemaDefinition<SharedParameterSelectionFilter> {
    public override void Configure(ISettingsSchemaBuilder<SharedParameterSelectionFilter> builder) {
        builder.Property(item => item.Names, property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
        builder.Property(item => item.Containing, property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
        builder.Property(item => item.StartingWith, property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
    }
}

internal sealed class DesiredSharedParameterDeclarationSchemaDefinition
    : SettingsSchemaDefinition<DesiredSharedParameterDeclaration> {
    public override void Configure(ISettingsSchemaBuilder<DesiredSharedParameterDeclaration> builder) {
        builder.Property(item => item.Name, property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
        builder.Property(item => item.SourceNames, property => {
            property.DependsOnContext(ValueDomainContextKeys.SelectedFamilyNames);
            property.UseDatasetOptions(
                SchemaDatasetIds.ParameterCatalog,
                SchemaProjectionKeys.FamilyParameterNames
            );
        });
        builder.Property(item => item.PropertiesGroup,
            property => property.UseValueDomain(ValueDomainKeys.PropertyGroupNames));
    }
}

internal sealed class DesiredFamilyParameterDeclarationSchemaDefinition
    : SettingsSchemaDefinition<DesiredFamilyParameterDeclaration> {
    public override void Configure(ISettingsSchemaBuilder<DesiredFamilyParameterDeclaration> builder) {
        builder.Property(item => item.DataType, property => property.UseValueDomain(ValueDomainKeys.SpecNames));
        builder.Property(item => item.PropertiesGroup,
            property => property.UseValueDomain(ValueDomainKeys.PropertyGroupNames));
    }
}

internal sealed class DesiredPerTypeAssignmentRowSchemaDefinition : SettingsSchemaDefinition<DesiredPerTypeAssignmentRow> {
    public override void Configure(ISettingsSchemaBuilder<DesiredPerTypeAssignmentRow> builder) =>
        builder.Property(item => item.Parameter,
            property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
}

internal sealed class FamilyModelHeaderSchemaDefinition : SettingsSchemaDefinition<FamilyModelHeader> {
    public override void Configure(ISettingsSchemaBuilder<FamilyModelHeader> builder) =>
        builder.Property(item => item.Category,
            property => property.UseValueDomain(ValueDomainKeys.CategoryNames));
}

internal sealed class FamilyModelFamilyParameterSchemaDefinition
    : SettingsSchemaDefinition<FamilyModelFamilyParameter> {
    public override void Configure(ISettingsSchemaBuilder<FamilyModelFamilyParameter> builder) {
        builder.Property(item => item.DataType, property => property.UseValueDomain(ValueDomainKeys.SpecNames));
        builder.Property(item => item.PropertiesGroup,
            property => property.UseValueDomain(ValueDomainKeys.PropertyGroupNames));
    }
}

internal sealed class FamilyModelSharedParameterSchemaDefinition
    : SettingsSchemaDefinition<FamilyModelSharedParameter> {
    public override void Configure(ISettingsSchemaBuilder<FamilyModelSharedParameter> builder) =>
        builder.Property(item => item.PropertiesGroup,
            property => property.UseValueDomain(ValueDomainKeys.PropertyGroupNames));
}

internal sealed class DeleteParamsSettingsSchemaDefinition : SettingsSchemaDefinition<DeleteParamsSettings> {
    public override void Configure(ISettingsSchemaBuilder<DeleteParamsSettings> builder) =>
        builder.Property(item => item.Names, property =>
            property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
}

internal sealed class MakeElecConnectorParametersSchemaDefinition
    : SettingsSchemaDefinition<MakeElecConnectorSettings.Parameters> {
    public override void Configure(ISettingsSchemaBuilder<MakeElecConnectorSettings.Parameters> builder) {
        builder.Property(item => item.NumberOfPoles,
            property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
        builder.Property(item => item.ApparentPower,
            property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
        builder.Property(item => item.Voltage, property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
        builder.Property(item => item.MinimumCircuitAmpacity,
            property => property.UseValueDomain(ValueDomainKeys.SharedParameterNames));
    }
}

public static class FamilyFoundrySchemaDefinitionBootstrapper {
    private static readonly object SyncRoot = new();
    private static bool _registered;

    [ModuleInitializer]
    internal static void RegisterOnModuleLoad() => TryRegister();

    public static void EnsureRegistered() {
        if (_registered)
            return;

        lock (SyncRoot) {
            if (_registered)
                return;

            SettingsSchemaDefinitionRegistry.Shared.Register(new MappingDataSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new IncludeFamiliesSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ExcludeFamiliesSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new IncludeSharedParameterSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ExcludeSharedParameterSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new FilterFamiliesSettingsSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new GlobalParamAssignmentSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new PerTypeAssignmentRowSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new SetKnownParamsSettingsSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new SetLookupTablesSettingsSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new SharedParameterSelectionFilterSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new DesiredSharedParameterDeclarationSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new DesiredFamilyParameterDeclarationSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new DesiredPerTypeAssignmentRowSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new FamilyModelHeaderSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new FamilyModelFamilyParameterSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new FamilyModelSharedParameterSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new DeleteParamsSettingsSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new MakeElecConnectorParametersSchemaDefinition());
            _registered = true;
        }
    }

    private static void TryRegister() {
        try {
            EnsureRegistered();
        } catch (Exception ex) when (IsMissingRevitAssembly(ex)) {
        }
    }

    private static bool IsMissingRevitAssembly(Exception ex) =>
        (ex is FileNotFoundException fileNotFoundException &&
         string.Equals(fileNotFoundException.FileName?.Split(',')[0], "RevitAPI",
             StringComparison.OrdinalIgnoreCase)) ||
        (ex.InnerException is not null && IsMissingRevitAssembly(ex.InnerException));
}
