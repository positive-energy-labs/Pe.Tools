using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Shared.RevitData.Families;
using System.Runtime.CompilerServices;

namespace Pe.Revit.FamilyFoundry.SchemaDefinitions;

internal sealed class FamilyModelHeaderSchemaDefinition : SettingsSchemaDefinition<FamilyModelHeader> {
    public override void Configure(ISettingsSchemaBuilder<FamilyModelHeader> builder) =>
        builder.Property(item => item.Category, property => property.UseValueDomain(ValueDomainKeys.CategoryNames));
}

internal sealed class FamilyModelParameterSchemaDefinition : SettingsSchemaDefinition<FamilyModelParameter> {
    public override void Configure(ISettingsSchemaBuilder<FamilyModelParameter> builder) =>
        builder.Property(item => item.PropertiesGroup, property => property.UseValueDomain(ValueDomainKeys.PropertyGroupNames));
}

internal sealed class PatchSelectSchemaDefinition : SettingsSchemaDefinition<PatchSelect> {
    public override void Configure(ISettingsSchemaBuilder<PatchSelect> builder) =>
        builder.Property(item => item.Names, property => property.UseValueDomain(ValueDomainKeys.FamilyNames));
}

public static class FamilyFoundrySchemaDefinitionBootstrapper {
    private static readonly object SyncRoot = new();
    private static bool _registered;

    [ModuleInitializer]
    internal static void RegisterOnModuleLoad() => TryRegister();

    public static void EnsureRegistered() {
        if (_registered) return;
        lock (SyncRoot) {
            if (_registered) return;
            SettingsSchemaDefinitionRegistry.Shared.Register(new FamilyModelHeaderSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new FamilyModelParameterSchemaDefinition());
            SettingsSchemaDefinitionRegistry.Shared.Register(new PatchSelectSchemaDefinition());
            _registered = true;
        }
    }

    private static void TryRegister() {
        try { EnsureRegistered(); } catch (Exception ex) when (IsMissingRevitAssembly(ex)) { }
    }

    private static bool IsMissingRevitAssembly(Exception ex) =>
        (ex is FileNotFoundException f && string.Equals(f.FileName?.Split(',')[0], "RevitAPI", StringComparison.OrdinalIgnoreCase)) ||
        (ex.InnerException is not null && IsMissingRevitAssembly(ex.InnerException));
}
