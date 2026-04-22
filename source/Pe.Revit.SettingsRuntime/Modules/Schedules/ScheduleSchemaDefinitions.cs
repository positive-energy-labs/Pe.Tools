using Pe.Revit.DocumentData.Schedules.Runtime;
using Pe.Revit.DocumentData.Schedules.Runtime.Fields;
using Pe.Revit.DocumentData.Schedules.Runtime.Filters;
using Pe.Revit.DocumentData.Schedules.Runtime.SortGroup;
using Pe.Revit.DocumentData.Schedules.Runtime.TitleStyle;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Revit.SettingsRuntime.Json.SchemaProviders;
using System.Runtime.CompilerServices;

namespace Pe.Revit.SettingsRuntime.Modules.Schedules;

internal sealed class ScheduleProfileSchemaDefinition : SettingsSchemaDefinition<ScheduleProfile> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleProfile> builder) {
        builder.Property(item => item.CategoryName, property => property.UseFieldOptions<CategoryNamesProvider>());
        builder.Property(item => item.ViewTemplateName,
            property => property.UseFieldOptions<ScheduleViewTemplateNamesProvider>());
        builder.Property(item => item.Fields, property => property.WithDisplayName("Fields"));
    }
}

internal sealed class ScheduleFieldSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleFieldSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleFieldSpec> builder) {
        builder.Property(item => item.ParameterName, property => {
            property.DependsOnSibling(OptionContextKeys.CategoryName);
            property.UseFieldOptions<ScheduleFieldNamesProvider>();
        });
        builder.Property(item => item.PercentageOfField, property => {
            property.DependsOnSibling(OptionContextKeys.CategoryName);
            property.UseFieldOptions<ScheduleFieldNamesProvider>();
        });
    }
}

internal sealed class CombinedParameterSpecSchemaDefinition : SettingsSchemaDefinition<CombinedParameterSpec> {
    public override void Configure(ISettingsSchemaBuilder<CombinedParameterSpec> builder) =>
        builder.Property(item => item.ParameterName, property => {
            property.DependsOnSibling(OptionContextKeys.CategoryName);
            property.UseFieldOptions<ScheduleFieldNamesProvider>();
        });
}

internal sealed class ScheduleFilterSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleFilterSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleFilterSpec> builder) =>
        builder.Property(item => item.FieldName, property => {
            property.DependsOnSibling(OptionContextKeys.CategoryName);
            property.UseFieldOptions<ScheduleFieldNamesProvider>();
        });
}

internal sealed class ScheduleSortGroupSpecSchemaDefinition : SettingsSchemaDefinition<ScheduleSortGroupSpec> {
    public override void Configure(ISettingsSchemaBuilder<ScheduleSortGroupSpec> builder) =>
        builder.Property(item => item.FieldName, property => {
            property.DependsOnSibling(OptionContextKeys.CategoryName);
            property.UseFieldOptions<ScheduleFieldNamesProvider>();
        });
}

internal sealed class TitleBorderStyleSpecSchemaDefinition : SettingsSchemaDefinition<TitleBorderStyleSpec> {
    public override void Configure(ISettingsSchemaBuilder<TitleBorderStyleSpec> builder) {
        builder.Property(item => item.TopLineStyleName, property => property.UseFieldOptions<LineStyleNamesProvider>());
        builder.Property(item => item.BottomLineStyleName,
            property => property.UseFieldOptions<LineStyleNamesProvider>());
        builder.Property(item => item.LeftLineStyleName,
            property => property.UseFieldOptions<LineStyleNamesProvider>());
        builder.Property(item => item.RightLineStyleName,
            property => property.UseFieldOptions<LineStyleNamesProvider>());
    }
}

public static class ScheduleSchemaDefinitionBootstrapper {
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

            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleProfileSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleFieldSpecSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new CombinedParameterSpecSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleFilterSpecSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new ScheduleSortGroupSpecSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new TitleBorderStyleSpecSchemaDefinition());
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


