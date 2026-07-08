namespace Pe.Shared.Product;

/// <summary>
///     Naming constants for the classic per-user Revit add-in layout that the build projection still
///     targets (<see cref="ProductBuildLayoutProjection" />). The pre-loader descriptor model and the
///     <c>Addins\&lt;year&gt;\Pe.App</c> runtime-path helpers were removed in Phase 2 — the installed
///     lane now resolves its layout through <c>Pe.Revit.Loader.InstalledProduct</c>, and the dev lane
///     is self-hosted (no descriptor, no versioned Addins tree).
/// </summary>
public static class RevitDeploymentIdentity {
    public const string AddinManifestFileName = "Pe.App.addin";
    public const string AutodeskDirectoryName = "Autodesk";
    public const string RevitDirectoryName = "Revit";
    public const string AddinsDirectoryName = "Addins";
}
