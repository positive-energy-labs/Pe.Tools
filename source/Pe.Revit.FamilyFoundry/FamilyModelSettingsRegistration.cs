using Pe.Revit.SettingsRuntime.Validation;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.FamilyFoundry;

public static class FamilyModelSettingsRegistration {
    public const string ModuleKey = "FamilyFoundry";
    public const string RootKey = "models";

    public static StructuralSettingsModuleDescriptor Module { get; } = new(
        ModuleKey,
        RootKey,
        [new SettingsRootDescriptor(RootKey, "Family Models")],
        SettingsStorageProfiles.SharedAuthoring,
        SettingsModuleHostScope.Session,
        SettingsModuleActiveDocumentKind.Any
    );

    public static ISettingsRootBinding<FamilyModel> Root { get; } =
        new SettingsRootBinding<FamilyModel>(Module, RootKey);

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = [Module];
    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = [Root];

    public static void RegisterValidator() =>
        SettingsDocumentValidatorRegistry.Shared.Register<FamilyModel>(Validate);

    private static IReadOnlyList<SettingsDocumentValidationIssue> Validate(
        SettingsDocumentValidationContext context
    ) {
        var raw = FamilyModelJson.Parse(context.RawContent);
        var result = raw.Value == null
            ? raw
            : FamilyModelJson.Parse(context.ComposedContent);
        return result.Diagnostics
            .Select(issue => new SettingsDocumentValidationIssue(
                issue.Path,
                issue.Code,
                "error",
                issue.Message))
            .ToList();
    }
}
