using System.Text.Json;
using Installer;
using Pe.Shared.Product;
using WixSharp;
using WixSharp.CommonTasks;
using WixSharp.Controls;

var manifestPath = ParseManifestPath(args);
var installerPayload = ReadInstallerPayloadManifest(manifestPath);
ValidateInstallerPayload(installerPayload, manifestPath);

if (!Versioning.TryCreateFromVersionString(installerPayload.Version, out var versioning))
    throw new InvalidOperationException(
        $"Installer payload manifest version '{installerPayload.Version}' is not a valid semantic version. " +
        "Example: 1.0.0 or 1.0.0-beta.1");

var resolvedVersioning = versioning!;
var configuration = InstallerConfiguration.Load(installerPayload.OutputDirectory);
InstallerLog.Configure(configuration.OutputDirectory);
InstallerLog.WriteLine($"Installer authoring started for version {resolvedVersioning.Version}.");
InstallerLog.WriteLine($"Installer payload manifest: {manifestPath}");
InstallerLog.WriteLine($"Runtime payload: {installerPayload.RuntimePublishDirectory}");
InstallerLog.WriteLine($"pea bootstrap payload: {installerPayload.PeaBootstrapDirectory}");
InstallerLog.WriteLine($"pea payload archive: {installerPayload.PeaPayloadArchivePath}");
InstallerLog.WriteLine($"pea payload manifest: {installerPayload.PeaPayloadManifestPath}");
InstallerLog.WriteLine($"pe-dev payload: {installerPayload.PeDevPublishDirectory}");
InstallerLog.WriteLine($"Revit payloads: {string.Join(", ", installerPayload.RevitPublishDirectories)}");
var installerContext = new InstallerContext(installerPayload, configuration, resolvedVersioning);
var installableComponents = InstallerComponentCatalog.CreateDefault();
var project = new Project {
    OutDir = configuration.OutputDirectory,
    Name = configuration.ProductName,
    Platform = Platform.x64,
    UI = WUI.WixUI_FeatureTree,
    MajorUpgrade = new MajorUpgrade {
        Schedule = UpgradeSchedule.afterInstallInitialize,
        AllowDowngrades = true
    },
    GUID = configuration.UpgradeCode,
    BannerImage = configuration.BannerImagePath,
    BackgroundImage = configuration.BackgroundImagePath,
    Version = resolvedVersioning.VersionPrefix,
    ControlPanelInfo = { Manufacturer = configuration.Manufacturer, ProductIcon = configuration.ProductIconPath }
};

InstallerLog.WriteLine(
    $"Installer product slices: {string.Join(", ", installableComponents.Select(component => component.ProductSlice).DistinctBy(slice => slice.Id).Select(slice => $"{slice.Id}:{slice.Kind}"))}");
InstallerLog.WriteLine(
    $"Installer components: {string.Join(", ", installableComponents.Select(component => $"{component.Id}:{component.ComponentKind}:{component.ProductSlice.Id}"))}");
var installDirectories = installableComponents
    .SelectMany(component => component.BuildDirectories(installerContext))
    .ToArray();
var installActions = installableComponents
    .SelectMany(component => component.BuildInstallActions(installerContext))
    .ToArray();
var uninstallActions = installableComponents
    .SelectMany(component => component.BuildUninstallActions(installerContext))
    .ToArray();
InstallerLog.WriteLine("Installer payload harvest finished.");
project.RemoveDialogsBetween(NativeDialogs.WelcomeDlg, NativeDialogs.CustomizeDlg);
project.Actions = uninstallActions.Concat(installActions).ToArray();

BuildSingleUserMsi();

void BuildSingleUserMsi() {
    project.Scope = InstallScope.perUser;
    project.OutFileName = $"{configuration.ProductName}-{resolvedVersioning.Version}";
    project.Dirs = installDirectories;
    var msiPath = Path.Combine(project.OutDir, $"{project.OutFileName}.msi");
    InstallerLog.WriteLine($"Building MSI: {msiPath}");
    var builtMsiPath = project.BuildMsi(msiPath);
    if (!System.IO.File.Exists(builtMsiPath))
        throw new FileNotFoundException("WiX authoring completed without producing the expected MSI.", builtMsiPath);

    InstallerLog.WriteLine($"MSI build finished: {builtMsiPath}");
}

static string ParseManifestPath(string[] args) {
    if (args.Length > 0 && args[0].Equals("pack", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException(
            "Received build pipeline arguments in the installer entrypoint. " +
            "Run 'dotnet run -c Release -- pack publish' from the build directory, not install.");

    if (args.Length != 2 || !args[0].Equals("--manifest", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Installer requires '--manifest <installer-payload.json>'.");

    return Path.GetFullPath(args[1]);
}

static InstallerPayloadManifest ReadInstallerPayloadManifest(string manifestPath) {
    if (!System.IO.File.Exists(manifestPath))
        throw new FileNotFoundException("Installer payload manifest was not found.", manifestPath);

    var json = System.IO.File.ReadAllText(manifestPath);
    return JsonSerializer.Deserialize<InstallerPayloadManifest>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
           ?? throw new InvalidOperationException($"Installer payload manifest '{manifestPath}' could not be deserialized.");
}

static void ValidateInstallerPayload(InstallerPayloadManifest manifest, string manifestPath) {
    if (manifest.SchemaVersion != InstallerPayloadManifest.CurrentSchemaVersion)
        throw new InvalidOperationException(
            $"Installer payload manifest '{manifestPath}' has unsupported schema version {manifest.SchemaVersion}.");

    if (!string.Equals(manifest.ProductName, ProductIdentity.ProductName, StringComparison.Ordinal))
        throw new InvalidOperationException(
            $"Installer payload manifest '{manifestPath}' is for product '{manifest.ProductName}', not '{ProductIdentity.ProductName}'.");

    if (manifest.RevitPublishDirectories.Length == 0)
        throw new InvalidOperationException($"Installer payload manifest '{manifestPath}' requires at least one Revit publish directory.");
}
