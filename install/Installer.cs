using Installer;
using WixSharp;
using WixSharp.CommonTasks;
using WixSharp.Controls;

if (args.Length < 2) {
    throw new InvalidOperationException(
        "Installer requires a version followed by one or more publish directories. " +
        "Example: dotnet run -c Release -- 1.0.0 ..\\source\\Pe.App\\bin\\Release.R25\\publish");
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

var wixEntities = Generator.GenerateWixEntities(args[1..]);
project.RemoveDialogsBetween(NativeDialogs.WelcomeDlg, NativeDialogs.CustomizeDlg);

BuildSingleUserMsi();
BuildMultiUserUserMsi();

void BuildSingleUserMsi() {
    project.Scope = InstallScope.perUser;
    project.OutFileName = $"{configuration.ProductName}-{resolvedVersioning.Version}-SingleUser";
    project.Dirs = [
        new InstallDir(@"%AppDataFolder%\Autodesk\Revit\Addins\", wixEntities)
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
                : @"%CommonAppDataFolder%\Autodesk\Revit\Addins", wixEntities)
    ];
    project.BuildMsi();
}
