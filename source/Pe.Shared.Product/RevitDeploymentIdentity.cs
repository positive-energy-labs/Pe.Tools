namespace Pe.Shared.Product;

public static class RevitDeploymentIdentity {
    public const string AddinManifestFileName = "Pe.App.addin";
    public const string RuntimeDescriptorFileName = "Pe.App.runtime.json";
    public const string AddinAssemblyDirectoryName = "Pe.App";
    public const string AutodeskDirectoryName = "Autodesk";
    public const string RevitDirectoryName = "Revit";
    public const string AddinsDirectoryName = "Addins";

    public static string ResolvePerUserAddinsRootPath(string? applicationData = null) =>
        Path.Combine(
            ProductPathing.ResolveApplicationData(applicationData),
            AutodeskDirectoryName,
            RevitDirectoryName,
            AddinsDirectoryName
        );

    public static string ResolvePerUserAddinDirectoryPath(int revitYear, string? applicationData = null) =>
        Path.Combine(ResolvePerUserAddinsRootPath(applicationData), revitYear.ToString());

    public static string ResolvePerUserAddinManifestPath(int revitYear, string? applicationData = null) =>
        Path.Combine(ResolvePerUserAddinDirectoryPath(revitYear, applicationData), AddinManifestFileName);

    public static string ResolvePerUserAddinAssemblyDirectoryPath(int revitYear, string? applicationData = null) =>
        Path.Combine(ResolvePerUserAddinDirectoryPath(revitYear, applicationData), AddinAssemblyDirectoryName);

    public static string ResolvePerUserRuntimeDescriptorPath(int revitYear, string? applicationData = null) =>
        Path.Combine(ResolvePerUserAddinAssemblyDirectoryPath(revitYear, applicationData), RuntimeDescriptorFileName);

    public static string ResolveRuntimeDescriptorPathForAssembly(string assemblyPath) =>
        Path.Combine(
            Path.GetDirectoryName(Path.GetFullPath(assemblyPath))
            ?? throw new InvalidOperationException("Assembly path did not have a directory."),
            RuntimeDescriptorFileName
        );
}
