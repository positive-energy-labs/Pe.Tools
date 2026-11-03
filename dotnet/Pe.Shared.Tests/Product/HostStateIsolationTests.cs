using Pe.Shared.HostContracts.Transport;
using Pe.Shared.Product;
using Pe.Revit.ServiceClient;
using System.Diagnostics;

namespace Pe.Revit.Tests;

[TestFixture, NonParallelizable]
public sealed class HostStateIsolationTests {
    private string _root = null!;
    private string _checkout = null!;
    private string? _previousHome;
    private string? _previousLocal;
    private string? _previousLane;
    private string? _previousSource;

    [SetUp]
    public void SetUp() {
        _root = Path.Combine(Path.GetTempPath(), "pe-isofix-" + Guid.NewGuid().ToString("N"));
        _checkout = Path.Combine(_root, "checkout");
        _previousHome = Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable);
        _previousLocal = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        _previousLane = HostEndpoint.ConfiguredLane;
        _previousSource = HostEndpoint.ConfiguredSourceRoot;
        Directory.CreateDirectory(_checkout);
        File.WriteAllText(Path.Combine(_checkout, ".git"), "gitdir: fixture");
        File.WriteAllText(Path.Combine(_checkout, "Pe.Tools.slnx"), "");
        Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, null);
        Environment.SetEnvironmentVariable("LOCALAPPDATA", Path.Combine(_root, "local"));
        HostEndpoint.ConfiguredLane = "dev";
        HostEndpoint.ConfiguredSourceRoot = _checkout;
    }

    [TearDown]
    public void TearDown() {
        Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, _previousHome);
        Environment.SetEnvironmentVariable("LOCALAPPDATA", _previousLocal);
        HostEndpoint.ConfiguredLane = _previousLane;
        HostEndpoint.ConfiguredSourceRoot = _previousSource;
        Directory.Delete(_root, true);
    }

    [Test]
    public void Dev_launcher_and_bridge_use_checkout_state_without_an_override() {
        AssertSharedRoot(Path.Combine(_checkout, ".artifacts", "pe-tools"));
    }

    [Test]
    public void Installed_launcher_and_bridge_keep_the_installed_namespace() {
        HostEndpoint.ConfiguredLane = "installed";
        HostEndpoint.ConfiguredSourceRoot = null;
        AssertSharedRoot(InstalledRoot);
    }

    [Test]
    public void Dev_override_is_honored_but_installed_descendants_are_refused() {
        Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, Path.Combine(_root, "home"));
        AssertSharedRoot(Path.Combine(_root, "home", ".local-state"));
        Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, InstalledRoot);
        Assert.That(() => Pe.App.Host.TsHostLauncher.ServiceAppBase,
            Throws.InvalidOperationException.With.Message.Contains("installed product state"));
    }

    [Test]
    public void Dev_state_cannot_follow_a_junction_into_installed_state() {
        var home = Path.Combine(_root, "linked-home");
        var link = Path.Combine(home, ".local-state");
        Directory.CreateDirectory(home);
        Directory.CreateDirectory(InstalledRoot);
        using var junction = Process.Start(new ProcessStartInfo("cmd.exe", $"/d /c mklink /J \"{link}\" \"{InstalledRoot}\"") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
        })!;
        junction.WaitForExit();
        Assert.That(junction.ExitCode, Is.Zero, junction.StandardError.ReadToEnd());
        try {
            Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, home);
            Assert.That(() => HostEndpoint.RuntimeRootPath,
                Throws.InvalidOperationException.With.Message.Contains("installed product state"));
        } finally { Directory.Delete(link); }
    }

    [Test]
    public void Dev_state_requires_a_checkout_even_with_an_override() {
        HostEndpoint.ConfiguredSourceRoot = _root;
        Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, Path.Combine(_root, "home"));
        Assert.That(() => HostEndpoint.RuntimeRootPath, Throws.ArgumentException.With.Message.Contains("checkout"));
    }

    private string InstalledRoot => Path.Combine(_root, "local", "Positive Energy", "Pe.Tools");

    private static void AssertSharedRoot(string expected) {
        Assert.That(Pe.App.Host.TsHostLauncher.ServiceAppBase, Is.EqualTo(expected));
        Assert.That(HostEndpoint.RuntimeRootPath, Is.EqualTo(expected));
        var serviceName = HostEndpoint.ResolveServiceName(HostEndpoint.ConfiguredLane!, HostEndpoint.ConfiguredSourceRoot);
        var receipt = PeServiceDiscovery.ServiceFilePath(HostEndpoint.RuntimeRootPath, serviceName);
        Assert.That(receipt, Is.EqualTo(Path.Combine(expected, "state", "service", serviceName + ".json")));
        Directory.CreateDirectory(Path.GetDirectoryName(receipt)!);
        File.WriteAllText(receipt, System.Text.Json.JsonSerializer.Serialize(new {
            schemaVersion = 3, pid = Environment.ProcessId, port = 58040, version = "isolation-law",
            lane = HostEndpoint.ConfiguredLane, sourceRoot = HostEndpoint.ConfiguredSourceRoot
        }));
        var discovered = PeServiceDiscovery.TryDiscover(HostEndpoint.RuntimeRootPath, serviceName);
        Assert.That(discovered, Is.Not.Null);
        Assert.That(discovered!.Lane, Is.EqualTo(HostEndpoint.ConfiguredLane));
        Assert.That(discovered.SourceRoot, Is.EqualTo(HostEndpoint.ConfiguredSourceRoot));
    }
}
