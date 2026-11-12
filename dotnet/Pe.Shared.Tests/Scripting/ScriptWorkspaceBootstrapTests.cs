using System.Diagnostics;
using System.Text.RegularExpressions;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.References;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;

namespace Pe.Revit.Tests;

/// <summary>
///     Homes freeze shape 8. A pod may sit in a home other machines share, so bootstrap writes into it only
///     authored seeds, each create-exclusive. Everything a machine derives lands outside the pod.
/// </summary>
[TestFixture]
public sealed class ScriptWorkspaceBootstrapTests {
    private string _root = null!;
    private string _pod = null!;

    [SetUp]
    public void SetUp() {
        this._root = Path.Combine(Path.GetTempPath(), $"pe-bootstrap-{Guid.NewGuid():N}");
        // The pod sits outside the user home on purpose: a shared home, named to bootstrap by absolute folder.
        this._pod = Path.Combine(this._root, "shared drive", "04 PE Software Files", "Pe.Tools", "Pods", "sample-pod");
    }

    [TearDown]
    public void TearDown() {
        try {
            if (Directory.Exists(this._root)) Directory.Delete(this._root, true);
        } catch (IOException) {
            // A locked temp file is not a test failure.
        }
    }

    // Two machines differ in everything a machine can differ in: state root, props path, target framework and
    // the assembly paths. Mutant, run red once: overwrite instead of create-exclusive (`FileMode.CreateNew` to
    // `FileMode.Create`) fails the byte-identical assert, because machine B then rewrites a person's edits.
    [Test]
    public void Two_machines_bootstrap_one_shared_pod_and_write_only_create_exclusive_seeds_into_it() {
        var first = this.Machine("A", "net8.0-windows");
        var second = this.Machine("B", "net48");
        Assert.That((first.Agent, first.Props), Is.Not.EqualTo((second.Agent, second.Props)), "the two machines must differ");

        var firstRun = first.Bootstrap();
        Assert.That(this.PodFiles().Keys, Is.EquivalentTo(new[] { "AGENTS.md", "PeScripts.csproj", "pod.json", "README.md" }));
        Assert.That(Directory.GetDirectories(this._pod).Select(Path.GetFileName), Is.EquivalentTo(new[] { "assets", "settings", "src" }));
        Assert.That(firstRun.GeneratedFiles, Is.SupersetOf(this.PodFiles().Keys.Select(name => Path.Combine(this._pod, name))));

        // A person edits every seed on machine A; machine B then bootstraps the same folder.
        foreach (var name in this.PodFiles().Keys.ToList())
            File.AppendAllText(Path.Combine(this._pod, name), "\n<!-- edited by a person -->");
        var before = this.PodFiles();
        var secondRun = second.Bootstrap();

        Assert.Multiple(() => {
            Assert.That(this.PodFiles(), Is.EqualTo(before), "the pod is byte-identical after a second machine bootstraps it");
            Assert.That(secondRun.GeneratedFiles.Where(path => path.StartsWith(this._pod, StringComparison.OrdinalIgnoreCase)), Is.Empty);
            Assert.That(secondRun.GeneratedFiles, Is.EquivalentTo(new[] { second.Props, Path.Combine(second.Agent, "AGENTS.md") }));
            Assert.That(secondRun.WorkspaceRootPath, Is.EqualTo(this._pod));
            Assert.That(secondRun.MachinePropsPath, Is.EqualTo(second.Props));
            Assert.That(secondRun.ProductAgentsPath, Is.EqualTo(Path.Combine(second.Agent, "AGENTS.md")));
            // The machine half differs between the machines, which is why it is not in the pod.
            Assert.That(File.ReadAllText(first.Props), Is.Not.EqualTo(File.ReadAllText(second.Props)));
            Assert.That(File.ReadAllText(second.Props), Does.Contain("<TargetFramework>net48</TargetFramework>").And.Contain(second.Runtime));
        });
    }

    // Mutants, each run red once: bake the machine path into the import (`MachinePropsImport` to
    // `MachinePropsPath`) fails the exact-import assert and the no-absolute-path assert; write the machine
    // references into the seeded project (`Seed(projectFilePath, GenerateMachineProps(...))`) fails every assert here.
    [Test]
    public void The_authored_project_holds_one_machine_independent_import_and_no_machine_path() {
        var machine = this.Machine("A", "net8.0-windows");
        var project = File.ReadAllText(machine.Bootstrap().ProjectFilePath);
        var read = new CsProjReader().Read(project, this._pod);

        Assert.Multiple(() => {
            Assert.That(Regex.Matches(project, "<Import ").Count, Is.EqualTo(1));
            Assert.That(project, Does.Contain("""<Import Project="$(LOCALAPPDATA)\Positive Energy\PeScripts.props" />"""));
            Assert.That(Regex.IsMatch(project, @"[A-Za-z]:\\|\\\\"), Is.False, "no drive letter and no UNC path");
            Assert.That(project, Does.Not.Contain(machine.Runtime).And.Not.Contain("TargetFramework").And.Not.Contain("HintPath"));
            Assert.That(read.References, Is.Empty);
            // The machine half carries what the authored half dropped.
            Assert.That(File.ReadAllText(machine.Props), Does.Contain("<Private>false</Private>").And.Contain(machine.Runtime));
        });
    }

    [Test]
    public void A_later_bootstrap_rewrites_only_the_two_machine_files() {
        var machine = this.Machine("A", "net8.0-windows");
        _ = machine.Bootstrap();
        var guide = Path.Combine(machine.Agent, "AGENTS.md");
        File.WriteAllText(guide, "stale guidance from an older build");
        File.WriteAllText(machine.Props, "<Project />");

        var again = machine.Bootstrap();
        var text = File.ReadAllText(guide);

        Assert.Multiple(() => {
            Assert.That(again.GeneratedFiles, Is.EquivalentTo(new[] { machine.Props, guide }));
            Assert.That(machine.Bootstrap().GeneratedFiles, Is.Empty, "an unchanged machine writes nothing");
            // The guide is the one high-level guide: concepts, pointers, and the bootstrap contract.
            Assert.That(text, Does.Contain("## Bootstrap").And.Contain("pea script execute").And.Contain("/pods"));
            Assert.That(text, Does.Contain(".agents/skills/").And.Contain("$schema").And.Contain(ScriptingWorkspaceLayout.ProjectFileName));
            Assert.That(text, Does.Contain("state/Runs/").And.Not.Contain("workspace").And.Not.Contain("output/"));
            Assert.That(File.ReadAllText(Path.Combine(this._pod, "AGENTS.md")), Does.Not.Contain("../../").And.Not.Contain("workspace"));
        });
    }

    // The offline validation path kaitpw values: no host, no Revit, one `dotnet build` in the pod. The probe
    // script compiles only if the import supplied the build settings and a machine reference (Newtonsoft.Json).
    // Mutant, run red once: drop the import from the seeded project fails the build.
    [Test]
    public void An_offline_dotnet_build_of_a_bootstrapped_pod_succeeds() {
        // The child build reads LOCALAPPDATA, so the test's own value stands in for this machine's.
        var localAppData = Path.Combine(this._root, "LocalAppData");
        var service = new ScriptWorkspaceBootstrapService(
            new ScriptProjectGenerator(new CsProjReader()), _ => this._pod, Path.Combine(this._root, "Agent"),
            Path.Combine(localAppData, ProductIdentity.VendorName, ScriptingWorkspaceLayout.MachinePropsFileName));
        var bootstrap = service.Bootstrap("sample-pod", "2026", "net8.0-windows", typeof(PeScriptContainer).Assembly.Location);
        File.WriteAllText(Path.Combine(this._pod, "src", "Probe.cs"),
            "public static class Probe { public static string Json() => Newtonsoft.Json.JsonConvert.SerializeObject(new[] { 1 }); }");
        // This lane has no Revit, so the props file names no RevitAPI.dll while its default usings still name
        // Autodesk namespaces. Empty namespaces stand in for the missing assembly; inside Revit the reference is real.
        var revitUsings = Regex.Matches(File.ReadAllText(bootstrap.MachinePropsPath), "<Using Include=\"(Autodesk[^\"]*)\"").Select(match => match.Groups[1].Value).ToList();
        Assert.That(revitUsings, Is.Not.Empty, "the import must supply the default usings");
        File.WriteAllText(Path.Combine(this._pod, "src", "RevitStandIn.cs"), string.Concat(revitUsings.Select(name => $"namespace {name} {{ }}\n")));

        var start = new ProcessStartInfo("dotnet", "build PeScripts.csproj -nologo -nodeReuse:false -v:q") {
            WorkingDirectory = this._pod, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false
        };
        start.Environment["LOCALAPPDATA"] = localAppData;
        using var build = Process.Start(start)!;
        var output = build.StandardOutput.ReadToEndAsync();
        var error = build.StandardError.ReadToEndAsync();
        Assert.That(build.WaitForExit(180_000), Is.True, "dotnet build did not finish in 180 s");

        Assert.That(build.ExitCode, Is.EqualTo(0), $"{bootstrap.ProjectFilePath}\n{output.Result}\n{error.Result}");
        Assert.That(Directory.EnumerateFiles(Path.Combine(this._pod, "bin"), "PeScripts.dll", SearchOption.AllDirectories), Is.Not.Empty);
    }

    private (string Agent, string Props, string Runtime, Func<ScriptWorkspaceBootstrapData> Bootstrap) Machine(string name, string targetFramework) {
        var agent = Path.Combine(this._root, name, "state", "Agent");
        var props = Path.Combine(this._root, name, "LocalAppData", ProductIdentity.VendorName, ScriptingWorkspaceLayout.MachinePropsFileName);
        var runtime = Path.Combine(this._root, name, "install", "Pe.Revit.Scripting.dll");
        var service = new ScriptWorkspaceBootstrapService(new ScriptProjectGenerator(new CsProjReader()), _ => this._pod, agent, props);
        return (agent, props, runtime, () => service.Bootstrap("sample-pod", "2026", targetFramework, runtime));
    }

    private Dictionary<string, string> PodFiles() => Directory.EnumerateFiles(this._pod, "*", SearchOption.AllDirectories)
        .ToDictionary(path => Path.GetRelativePath(this._pod, path), path => Convert.ToHexString(File.ReadAllBytes(path)));
}
