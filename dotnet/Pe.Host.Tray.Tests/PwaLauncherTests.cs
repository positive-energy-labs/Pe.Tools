using System.Text.Json;
using NUnit.Framework;
using Pe.Host.Tray;
namespace Pe.Host.Tray.Tests;
public class PwaLauncherTests {
    [Test]
    public void PackagedEdgeRegistrationRequiresExactManifestIdentityAndActualProfileResources() {
        var identity = new Uri("http://127.0.0.1:5175/?dev=e342bc78d3d4");
        var registration = new PackagedPwa(PwaLauncher.AppId(identity), "Default", "http://127.0.0.1:5175/open",
            "Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!MSEDGE");
        const string root = @"C:\edge-profile";
        Assert.That(PwaLauncher.MatchPackaged(identity, [registration], root, _ => true)?.AppId, Is.EqualTo(registration.AppId));
        Assert.That(PwaLauncher.MatchPackaged(identity, [registration], root, _ => false), Is.Null);
        Assert.That(PwaLauncher.MatchPackaged(new Uri("http://127.0.0.1:5175/"), [registration], root, _ => true), Is.Null);
        Assert.That(PwaLauncher.MatchPackaged(identity, [registration with { StartUrl = "http://127.0.0.1:5180/open" }], root, _ => true), Is.Null);
        Assert.That(PwaLauncher.MatchPackaged(identity, [registration with { EdgeIdentity = "foreign" }], root, _ => true), Is.Null);
        Assert.That(PwaLauncher.MatchPackaged(identity, [registration with { Profile = "..\\foreign" }], root, _ => true), Is.Null);
    }
    [Test]
    public void IdentityMatchesObservedChromiumIdAndSeparatesDevAndProduction() {
        Assert.That(PwaLauncher.AppId(new Uri("http://127.0.0.1:5175/")), Is.EqualTo("dpjcganhfcilifanhcmgkklilogmomnf"));
        Assert.That(PwaLauncher.AppId(new Uri("http://127.0.0.1:5175/?dev=e342bc78d3d4")), Is.EqualTo("fneiaplokelkkploflemnpjlkdffgjkn"));
        using var manifest = JsonDocument.Parse("{\"id\":\"https://foreign.test/\",\"start_url\":\"/open\"}");
        Assert.That(PwaLauncher.ManifestIdentity("http://127.0.0.1:5175", manifest.RootElement), Is.Null);
    }
    [Test]
    public void InstallationRequiresActualEdgeRegistrationExactIdentityProfileAndIcon() {
        var root=Path.Combine(Path.GetTempPath(),"edge-fixture");var edge=Path.Combine(root,"msedge.exe");
        var identity=new Uri("http://127.0.0.1:5175/?dev=e342bc78d3d4");var id=PwaLauncher.AppId(identity);
        var icon=Path.Combine(root,"Default","Web Applications","_crx_"+id,"app.ico");
        var registration=new PwaRegistration($"\"{edge}\" --profile-directory=Default --uninstall-app-id={id}",icon);
        Assert.That(PwaLauncher.Match(identity,edge,[root],[registration],_=>true)?.AppId,Is.EqualTo(id));
        Assert.That(PwaLauncher.Match(identity,edge,[root],[registration],_=>false),Is.Null);
        Assert.That(PwaLauncher.Match(new Uri("http://127.0.0.1:5175/"),edge,[root],[registration],_=>true),Is.Null);
        Assert.That(PwaLauncher.Match(identity,edge,[root+"foreign"],[registration],_=>true),Is.Null);
        Assert.That(PwaLauncher.Match(identity,edge,[root],[registration with {Command=registration.Command.Replace("msedge.exe","chrome.exe")}],_=>true),Is.Null);
    }
    [Test]
    public void LaunchKeepsDeepLinkOnlyForInstalledAppAndNeverUsesAppWindowFallback() {
        const string origin="http://127.0.0.1:5175";var destination=origin+"/pea?thread=one%2Ftwo&shell=tray#turn3";
        var app=new InstalledPwa("fneiaplokelkkploflemnpjlkdffgjkn",@"C:\profile","Default");
        var installed=PwaLauncher.Launch("msedge.exe",origin,destination,app,@"C:\profile");
        Assert.That(installed.ArgumentList,Does.Contain("--app-launch-url-for-shortcuts-menu-item="+origin+"/pea?thread=one%2Ftwo#turn3"));
        var absent=PwaLauncher.Launch("msedge.exe",origin,destination,null,@"C:\profile");
        Assert.That(absent.ArgumentList,Does.Contain(origin+"/settings?subject=machine&section=startup"));
        Assert.That(absent.ArgumentList.Any(arg=>arg.StartsWith("--app")),Is.False);
        Assert.Throws<ArgumentException>(()=>PwaLauncher.Launch("msedge.exe",origin,origin+"/?token=secret",app,@"C:\profile"));
    }
}
