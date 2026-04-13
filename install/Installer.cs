using Installer;
using WixSharp;
using WixSharp.CommonTasks;
using WixSharp.Controls;

if (args.Length < 4) {
    throw new InvalidOperationException(
        "Installer requires a version, a --host publish directory, and one or more Revit publish directories. " +
        "Example: dotnet run -c Release -- 1.0.0 --host ..\\source\\Pe.Host\\bin\\Release\\publish\\Host ..\\source\\Pe.App\\bin\\Release.R25\\publish");
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

var layout = Generator.GenerateWixEntities(installerInputs.HostPublishDirectory, installerInputs.RevitPublishDirectories);
project.RemoveDialogsBetween(NativeDialogs.WelcomeDlg, NativeDialogs.CustomizeDlg);

BuildSingleUserMsi();
BuildMultiUserUserMsi();

void BuildSingleUserMsi() {
    project.Scope = InstallScope.perUser;
    project.OutFileName = $"{configuration.ProductName}-{resolvedVersioning.Version}-SingleUser";
    project.Dirs = [
        new InstallDir(@"%AppDataFolder%\Autodesk\Revit\Addins\", layout.RevitEntities),
        new Dir(configuration.GetSingleUserHostInstallDirectory(), layout.HostEntities)
    ];
    project.BuildMsi();
}

void BuildMultiUserUserMsi() {
    project.Scope = InstallScope.perMachine;
    project.OutFileName = $"{configuration.ProductName}-{resolvedVersioning.Version}-MultiUser";
    project.Dirs = [
        new InstallDir(
            resolvedVersioning.VersionPrefix.Major >= 2027
                ? @"%ProgramFiles%\Autodesk\Revit\Addins"
                : @"%CommonAppDataFolder%\Autodesk\Revit\Addins", layout.RevitEntities),
        new Dir(configuration.GetMultiUserHostInstallDirectory(), layout.HostEntities)
    ];
    project.BuildMsi();
}

static InstallerInputs ParseInstallerInputs(string[] args) {
    string? hostPublishDirectory = null;
    var revitPublishDirectories = new List<string>();

    for (var index = 0; index < args.Length; index++) {
        if (args[index].Equals("--host", StringComparison.OrdinalIgnoreCase)) {
            if (index + 1 >= args.Length)
                throw new InvalidOperationException("Installer argument '--host' requires a publish directory.");

            hostPublishDirectory = args[index + 1];
            index++;
            continue;
        }

        revitPublishDirectories.Add(args[index]);
    }

    if (string.IsNullOrWhiteSpace(hostPublishDirectory))
        throw new InvalidOperationException("Installer requires a host publish directory via '--host <path>'.");

    if (revitPublishDirectories.Count == 0)
        throw new InvalidOperationException("Installer requires at least one Revit publish directory.");

    return new InstallerInputs(hostPublishDirectory, revitPublishDirectories.ToArray());
}

file sealed record InstallerInputs(
    string HostPublishDirectory,
    string[] RevitPublishDirectories
);
