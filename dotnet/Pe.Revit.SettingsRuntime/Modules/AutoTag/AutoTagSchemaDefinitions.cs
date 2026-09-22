using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Shared.StorageRuntime.Capabilities;
using System.Runtime.CompilerServices;

namespace Pe.Revit.SettingsRuntime.Modules.AutoTag;

internal sealed class AutoTagConfigurationSchemaDefinition : SettingsSchemaDefinition<AutoTagConfiguration> {
    public override void Configure(ISettingsSchemaBuilder<AutoTagConfiguration> builder) {
        builder.Property(config => config.BuiltInCategory,
            property => property.UseValueDomain(ValueDomainKeys.CategoryNames));
        builder.Property(config => config.TagFamilyName,
            property => property.UseValueDomain(ValueDomainKeys.AnnotationTagFamilyNames));
        builder.Property(config => config.TagTypeName,
            property => property.UseValueDomain(ValueDomainKeys.AnnotationTagTypeNames));
    }
}

public static class AutoTagSchemaDefinitionBootstrapper {
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

            SettingsSchemaDefinitionRegistry.Shared.Register(new AutoTagConfigurationSchemaDefinition());
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
