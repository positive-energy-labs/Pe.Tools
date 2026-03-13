using Installer;
using WixSharp;
using WixSharp.CommonTasks;
using WixSharp.Controls;
using Assembly = System.Reflection.Assembly;

const string outputName = "Pe.Tools";
const string projectName = "Pe.Tools";

var project = new Project {
    OutDir = "output",
    Name = projectName,
    Platform = Platform.x64,
    UI = WUI.WixUI_FeatureTree,
    MajorUpgrade = MajorUpgrade.Default,
    GUID = new Guid("DA2F1078-D093-4D58-B1DE-85A4402E49FF"),
    BannerImage = @"install\Resources\Icons\BannerImage.png",
    BackgroundImage = @"install\Resources\Icons\BackgroundImage.png",
    Version = Assembly.GetExecutingAssembly().GetName().Version.ClearRevision(),
    ControlPanelInfo = { Manufacturer = Environment.UserName, ProductIcon = @"install\Resources\Icons\ShellIcon.ico" }
};

var wixEntities = Generator.GenerateWixEntities(args);
project.RemoveDialogsBetween(NativeDialogs.WelcomeDlg, NativeDialogs.CustomizeDlg);

BuildSingleUserMsi();
BuildMultiUserUserMsi();

void BuildSingleUserMsi() {
    project.Scope = InstallScope.perUser;
    project.OutFileName = $"{outputName}-{project.Version}-SingleUser";
    project.Dirs = [
        new InstallDir(@"%AppDataFolder%\Autodesk\Revit\Addins\", wixEntities)
    ];
    _ = project.BuildMsi();
}

void BuildMultiUserUserMsi() {
    project.Scope = InstallScope.perMachine;
    project.OutFileName = $"{outputName}-{project.Version}-MultiUser";
    project.Dirs = [
        new InstallDir(@"%CommonAppDataFolder%\Autodesk\Revit\Addins\", wixEntities)
    ];
    _ = project.BuildMsi();
}