using Pe.Shared.RevitData;
using System.Runtime.CompilerServices;

namespace Pe.Revit.SettingsRuntime.Core.Json.SchemaDefinitions;

internal sealed class LoadedFamiliesFilterSchemaDefinition
    : SettingsSchemaDefinition<LoadedFamiliesFilter> {
    public override void Configure(ISettingsSchemaBuilder<LoadedFamiliesFilter> builder) {
        builder.Data(SchemaDatasetIds.LoadedFamiliesCatalog, data => {
            data.Provider(SchemaDatasetIds.LoadedFamiliesCatalog);
            data.Load(SettingsSchemaDatasetLoadMode.Eager);
            data.StaleOn(SchemaInvalidationKeys.DocumentChanged);
            data.SupportsProjection(SchemaProjectionKeys.FamilyNames, SchemaProjectionKeys.CategoryNames);
        });

        builder.Property(item => item.FamilyNames, property =>
            property.UseDatasetOptions(SchemaDatasetIds.LoadedFamiliesCatalog, SchemaProjectionKeys.FamilyNames));
        builder.Property(item => item.CategoryNames, property =>
            property.UseDatasetOptions(SchemaDatasetIds.LoadedFamiliesCatalog, SchemaProjectionKeys.CategoryNames));
    }
}

internal static class LoadedFamiliesFilterSchemaDefinitionBootstrapper {
    private static readonly object SyncRoot = new();
    private static bool _registered;

    [ModuleInitializer]
    internal static void RegisterOnModuleLoad() => TryRegister();

    internal static void EnsureRegistered() {
        if (_registered)
            return;

        lock (SyncRoot) {
            if (_registered)
                return;

            SettingsSchemaDefinitionRegistry.Shared.Register(new LoadedFamiliesFilterSchemaDefinition());
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