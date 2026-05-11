namespace Build;

public sealed record BuildPackagePolicy(
    string PackageId,
    string Version,
    string? PrivateAssets,
    string? TargetFramework,
    IReadOnlyList<ModuleClass> ModuleClasses,
    string? ProjectName
);
