using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using Pe.App.Host;
using Pe.Revit.Loader;
using Pe.Revit.ServiceClient;
using Pe.Shared.HostContracts.Transport;
using Pe.Shared.Product;

// Every shell configures its runtime once; this test assembly is one process, so it does the same,
// once, under a temp owner. Library paths (GlobalStorage, ModuleStorage, scratch) resolve under it.
[SetUpFixture]
public sealed class TestRuntime {
    public static readonly string Checkout = Path.Combine(Path.GetTempPath(), "pe-shared-tests-" + Guid.NewGuid().ToString("N"));

    [OneTimeSetUp]
    public void Configure() => ProductRuntimeLayout.Configure(ProductLane.Dev, Checkout);
}

namespace Pe.Revit.Tests {
    [TestFixture]
    public sealed class RuntimeOwnershipTests {
        private static readonly string ProductName = ProductIdentity.ProductName;
        private static readonly string VendorName = ProductIdentity.VendorName;

        private static IEnumerable<TestCaseData> StateRootRows() {
            using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "runtime-ownership.fixture.json")));
            foreach (var row in fixture.RootElement.GetProperty("stateRoots").EnumerateArray())
                yield return new TestCaseData(
                    row.GetProperty("lane").GetString() == "dev" ? ProductLane.Dev : ProductLane.Installed,
                    row.GetProperty("ownerRoot").GetString(),
                    row.GetProperty("productHome").GetString(),
                    row.TryGetProperty("sharedRoot", out var shared) ? shared.GetString() : null,
                    row.TryGetProperty("userRoot", out var user) ? user.GetString() : null,
                    row.TryGetProperty("stateRoot", out var root) ? root.GetString() : null,
                    row.TryGetProperty("error", out var error) ? error.GetString() : null
                ).SetName("StateRoot: " + row.GetProperty("name").GetString());
        }

        // The same table TS stateRoot and PowerShell Resolve-ProductRuntimeRoot assert: the languages cannot drift.
        [TestCaseSource(nameof(StateRootRows)), NonParallelizable]
        public void State_root_matches_the_shared_fixture(ProductLane lane, string owner, string? home, string? shared, string? user, string? expected, string? error) {
            var previous = Environment.GetEnvironmentVariable(ProductPathNames.SharedRootVariable);
            Environment.SetEnvironmentVariable(ProductPathNames.SharedRootVariable, shared);
            try {
                // A fixture user root is not this machine's Documents: only the pure resolver can take it.
                if (error is not null)
                {
                    Assert.That(() => ProductPathing.StateRoot(lane, owner, home, shared, user), Throws.ArgumentException.With.Message.Contains(error));
                    if (user is null) Assert.That(() => ProductRuntimeLayout.For(lane, owner, home), Throws.ArgumentException.With.Message.Contains(error));
                }
                else {
                    Assert.That(ProductPathing.StateRoot(lane, owner, home, shared, user), Is.EqualTo(expected));
                    if (user is null) Assert.That(ProductRuntimeLayout.For(lane, owner, home).RootPath, Is.EqualTo(expected));
                }
            } finally { Environment.SetEnvironmentVariable(ProductPathNames.SharedRootVariable, previous); }
        }

        private static IEnumerable<TestCaseData> ContentHomeRows() {
            using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "runtime-ownership.fixture.json")));
            foreach (var row in fixture.RootElement.GetProperty("contentHomes").EnumerateArray())
                yield return new TestCaseData(row.GetProperty("productHome").GetString(), row.GetProperty("sharedRoot").GetString(),
                    row.GetProperty("homes").EnumerateArray().Select(home => home.GetString()!).ToArray(),
                    row.GetProperty("firm").GetString(), row.GetProperty("keys").GetString()).SetName("ContentHomes: " + row.GetProperty("name").GetString());
        }

        [TestCaseSource(nameof(ContentHomeRows)), NonParallelizable]
        public void Content_homes_match_the_shared_fixture(string? home, string? shared, string[] homes, string? firm, string? keys) {
            var previousHome = Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable);
            var previousShared = Environment.GetEnvironmentVariable(ProductPathNames.SharedRootVariable);
            Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, home);
            Environment.SetEnvironmentVariable(ProductPathNames.SharedRootVariable, shared);
            try {
                var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
                Assert.That(ProductPathing.ContentHomes(), Is.EqualTo(homes.Select(path => path.Replace("%DOCUMENTS%", documents)).ToArray()));
                Assert.That(ProductPathing.SharedFirmDir(), Is.EqualTo(firm));
                Assert.That(ProductPathing.SharedKeysPath(), Is.EqualTo(keys));
            } finally {
                Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, previousHome);
                Environment.SetEnvironmentVariable(ProductPathNames.SharedRootVariable, previousShared);
            }
        }

        // Upgrade safety: an installed user's existing state must be found byte-for-byte where v0.7.30 put it.
        // Frozen from `git show v0.7.30:dotnet/Pe.Shared.Product/ProductPathing.cs` (ResolveRuntimeRoot(null))
        // and ProductRuntimeLayout.ForCurrentUser(); the SDK install root is what Pe.App now receives.
        [Test]
        public void Installed_paths_are_byte_identical_to_v0_7_30() {
            var v0730 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), VendorName, ProductName);
            var now = ProductRuntimeLayout.For(ProductLane.Installed, InstalledProduct.AppBaseFor(ProductName, VendorName), null);
            var expected = new Dictionary<string, string> {
                ["root"] = v0730,
                ["state"] = Path.Combine(v0730, "state"),
                ["global"] = Path.Combine(v0730, "state", "Global"),
                ["aps-auth"] = Path.Combine(v0730, "state", "aps-auth"),
                ["aps tokens"] = Path.Combine(v0730, "state", "aps-auth", "tokens.json"),
                ["aps credentials"] = Path.Combine(v0730, "state", "aps-auth", "credentials.json"),
                ["module AutoTag"] = Path.Combine(v0730, "state", "AutoTag"),
                ["module placement"] = Path.Combine(v0730, "state", "placement"),
                ["logs"] = Path.Combine(v0730, "logs"),
                ["host log"] = Path.Combine(v0730, "logs", "host.log.txt"),
                ["revit log"] = Path.Combine(v0730, "logs", "revit.log.txt"),
                ["cache"] = Path.Combine(v0730, "cache"),
                ["cache space-scenes"] = Path.Combine(v0730, "cache", "space-scenes"),
                ["cache linked geometry"] = Path.Combine(v0730, "cache", "space-linked-geometry"),
                ["scratch"] = Path.Combine(v0730, "scratch"),
                ["service files"] = Path.Combine(v0730, "state", "service", "host.json")
            };
            var actual = new Dictionary<string, string> {
                ["root"] = now.RootPath,
                ["state"] = now.State.RootPath,
                ["global"] = now.State.GlobalStatePath,
                ["aps-auth"] = now.State.ApsAuthStatePath,
                ["aps tokens"] = now.State.ApsTokenStorePath,
                ["aps credentials"] = now.State.ApsCredentialsPath,
                ["module AutoTag"] = now.State.ResolveModuleStatePath("AutoTag"),
                ["module placement"] = now.State.ResolveModuleStatePath("placement"),
                ["logs"] = now.Logs.RootPath,
                ["host log"] = now.Logs.HostLogPath,
                ["revit log"] = now.Logs.RevitAppLogPath,
                ["cache"] = now.Cache.RootPath,
                ["cache space-scenes"] = now.Cache.ResolveModuleCachePath("space-scenes"),
                ["cache linked geometry"] = now.Cache.ResolveModuleCachePath("space-linked-geometry"),
                ["scratch"] = now.ScratchPath,
                ["service files"] = PeServiceDiscovery.ServiceFilePath(now.RootPath, HostEndpoint.ResolveServiceName(now))
            };
            foreach (var (name, path) in expected)
                Assert.That(Encoding(actual[name]), Is.EqualTo(Encoding(path)), name);
        }

        private static string Encoding(string path) => Convert.ToHexString(System.Text.Encoding.UTF8.GetBytes(path));

        // F1: env LOCALAPPDATA spelled differently from the shell folder must not move installed state.
        [Test, NonParallelizable]
        public void Sdk_install_root_wins_over_a_differently_spelled_LOCALAPPDATA() {
            var previous = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            var sdkRoot = @"C:\Users\ALICE~1\AppData\Local\Positive Energy\Pe.Tools";
            try {
                Environment.SetEnvironmentVariable("LOCALAPPDATA", @"D:\Redirected\alice\AppData\Local");
                var (lane, root) = TsHostLauncher.Owner("installed", sdkRoot, null);
                var runtime = ProductRuntimeLayout.For(lane, root, null);
                Assert.That(runtime.RootPath, Is.EqualTo(sdkRoot));
                Assert.That(runtime.State.ApsTokenStorePath, Is.EqualTo(sdkRoot + @"\state\aps-auth\tokens.json"));
            } finally {
                Environment.SetEnvironmentVariable("LOCALAPPDATA", previous);
            }
        }

        [Test]
        public void Owner_comes_from_the_sdk_and_a_descriptorless_dev_payload_refuses() {
            Assert.That(TsHostLauncher.Owner("dev", null, @"C:\src\Pe.Tools"), Is.EqualTo((ProductLane.Dev, @"C:\src\Pe.Tools")));
            Assert.That(() => TsHostLauncher.Owner("dev", null, null),
                Throws.InvalidOperationException.With.Message.Contains("pe-revit session start --project Pe.App"));
            Assert.That(() => TsHostLauncher.Owner("installed", null, null), Throws.InvalidOperationException);
            Assert.That(() => TsHostLauncher.Owner("beta", @"C:\x", @"C:\x"), Throws.InvalidOperationException);
        }

        [Test]
        public void Dev_override_cannot_aim_at_installed_state_and_installed_refuses_an_override() {
            var installed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), VendorName, ProductName);
            Assert.That(() => ProductRuntimeLayout.For(ProductLane.Dev, @"C:\src\Pe.Tools", installed),
                Throws.InvalidOperationException.With.Message.Contains("installed product state"));
            Assert.That(() => ProductRuntimeLayout.For(ProductLane.Dev, @"C:\src\Pe.Tools", Path.Combine(installed, "nested")),
                Throws.InvalidOperationException.With.Message.Contains("installed product state"));
            Assert.That(() => ProductRuntimeLayout.For(ProductLane.Installed, installed, @"D:\pe-home"),
                Throws.ArgumentException.With.Message.Contains(ProductPathNames.ProductHomeVariable));
        }

        [Test]
        public void The_runtime_is_configured_once_and_launcher_and_endpoint_share_it() {
            Assert.That(() => ProductRuntimeLayout.Configure(ProductLane.Dev, TestRuntime.Checkout),
                Throws.InvalidOperationException.With.Message.Contains("already configured"));
            Assert.That(TsHostLauncher.ServiceAppBase, Is.EqualTo(ProductRuntimeLayout.Current.RootPath));
            Assert.That(HostEndpoint.RuntimeServiceName, Is.EqualTo(HostEndpoint.SourceServiceName(TestRuntime.Checkout)));
        }

        // A fresh load context has fresh statics: an unconfigured process reads nothing, it refuses.
        [Test]
        public void An_unconfigured_process_refuses_instead_of_guessing() {
            var context = new AssemblyLoadContext("unconfigured-runtime", isCollectible: true);
            try {
                var assembly = context.LoadFromAssemblyPath(typeof(ProductRuntimeLayout).Assembly.Location);
                var current = assembly.GetType(typeof(ProductRuntimeLayout).FullName!)!.GetProperty(nameof(ProductRuntimeLayout.Current))!;
                var error = Assert.Throws<TargetInvocationException>(() => current.GetValue(null))!.InnerException;
                Assert.That(error, Is.InstanceOf<InvalidOperationException>().With.Message.Contains("did not configure"));
            } finally {
                context.Unload();
            }
        }
    }
}
