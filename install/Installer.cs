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
InstallerLog.WriteLine($"Revit payloads: {string.Join(", ", installerPayload.RevitPublishDirectories)}");
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

var layout = Generator.GenerateWixEntities(installerPayload);
InstallerLog.WriteLine("Installer payload harvest finished.");
project.RemoveDialogsBetween(NativeDialogs.WelcomeDlg, NativeDialogs.CustomizeDlg);
project.Actions = [
    new ManagedAction(
        CustomActions.RemovePeaPayloadVersions,
        Return.check,
        When.After,
        Step.RemoveFiles,
        Condition.BeingUninstalled
    ) {
        Execute = Execute.deferred,
        UsesProperties = "INSTALLPEA=[INSTALLPEA]"
    },
    new ManagedAction(
        CustomActions.InstallPeaPayload,
        Return.check,
        When.After,
        Step.InstallFiles,
        Condition.NOT_Installed
    ) {
        Execute = Execute.deferred,
        UsesProperties = "INSTALLPEA=[INSTALLPEA]"
    }
];

BuildSingleUserMsi();

void BuildSingleUserMsi() {
    project.Scope = InstallScope.perUser;
    project.OutFileName = $"{configuration.ProductName}-{resolvedVersioning.Version}";
    project.Dirs = [
        new InstallDir(configuration.GetSingleUserRevitAddinsInstallDirectory(), layout.RevitEntities),
        new Dir(configuration.GetSingleUserHostInstallDirectory(), layout.HostEntities),
        new Dir(new Id("INSTALLPEA"), configuration.GetSingleUserPeaInstallDirectory(), layout.PeaEntities)
    ];
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
