using Installer;
using WixSharp;
using WixSharp.CommonTasks;
using WixSharp.Controls;

if (args.Length < 4) {
    throw new InvalidOperationException(
        "Installer requires a version, a --runtime publish directory, and one or more Revit publish directories. " +
        "Example: dotnet run -c Release -- 1.0.0 --runtime ..\\.artifacts\\publish\\host\\Release\\Host ..\\.artifacts\\publish\\revit\\Release.R25");
}

if (!Versioning.TryCreateFromVersionString(args[0], out var versioning)) {
    if (args[0].Equals("pack", StringComparison.OrdinalIgnoreCase)) {
        throw new InvalidOperationException(
            "Received build pipeline arguments in the installer entrypoint. " +
            "Run 'dotnet run -c Release -- pack publish' from the build directory, not install.");
    }

    throw new InvalidOperationException(
        $"Installer version argument '{args[0]}' is not a valid semantic version. " +
        "Example: 1.0.0 or 1.0.0-beta.1");
}

var resolvedVersioning = versioning!;
var configuration = InstallerConfiguration.Load();
var installerInputs = ParseInstallerInputs(args[1..]);
var project = new Project {
    OutDir = configuration.OutputDirectory,
    Name = configuration.ProductName,
    Platform = Platform.x64,
    UI = WUI.WixUI_FeatureTree,
    MajorUpgrade = MajorUpgrade.Default,
    GUID = configuration.UpgradeCode,
    BannerImage = configuration.BannerImagePath,
    BackgroundImage = configuration.BackgroundImagePath,
    Version = resolvedVersioning.VersionPrefix,
    ControlPanelInfo = { Manufacturer = configuration.Manufacturer, ProductIcon = configuration.ProductIconPath }
};

var layout =
    Generator.GenerateWixEntities(installerInputs.RuntimePublishDirectory, installerInputs.RevitPublishDirectories);
project.RemoveDialogsBetween(NativeDialogs.WelcomeDlg, NativeDialogs.CustomizeDlg);

BuildSingleUserMsi();

void BuildSingleUserMsi() {
    project.Scope = InstallScope.perUser;
    project.OutFileName = $"{configuration.ProductName}-{resolvedVersioning.Version}";
    project.Dirs = [
        new InstallDir(@"%AppDataFolder%\Autodesk\Revit\Addins\", layout.RevitEntities),
        new Dir(configuration.GetSingleUserHostInstallDirectory(), layout.HostEntities)
    ];
    project.BuildMsi();
}

static InstallerInputs ParseInstallerInputs(string[] args) {
    string? runtimePublishDirectory = null;
    var revitPublishDirectories = new List<string>();

    for (var index = 0; index < args.Length; index++) {
        if (args[index].Equals("--runtime", StringComparison.OrdinalIgnoreCase)) {
            if (index + 1 >= args.Length)
                throw new InvalidOperationException("Installer argument '--runtime' requires a publish directory.");

            runtimePublishDirectory = args[index + 1];
            index++;
            continue;
        }

        revitPublishDirectories.Add(args[index]);
    }

    if (string.IsNullOrWhiteSpace(runtimePublishDirectory))
        throw new InvalidOperationException("Installer requires a runtime publish directory via '--runtime <path>'.");

    if (revitPublishDirectories.Count == 0)
        throw new InvalidOperationException("Installer requires at least one Revit publish directory.");

    return new InstallerInputs(runtimePublishDirectory, revitPublishDirectories.ToArray());
}

namespace Installer {
    file sealed record InstallerInputs(
        string RuntimePublishDirectory,
        string[] RevitPublishDirectories
    );
}
