using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Scripting.Execution;
using Pe.Revit.Scripting.References;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Shared.Scripting.Execution;
using Autodesk.Revit.DB.Plumbing;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class HydronicHealTests {
    // The second stale pipe must not permit a partial first write. Readback uses native
    // parameters, independent of the script's receipt and its claimed status.
    [TestCase(0)]
    [TestCase(1)]
    [TestCase(-1)]
    public void Declared_hydronic_heal_refuses_stale_evidence_atomically_and_reads_back_good_sizes(UIApplication ui, int stale) {
        var home = Path.Combine(Path.GetTempPath(), "pe-hydronic-" + Guid.NewGuid().ToString("N"));
        var id = "heal-proof-" + Guid.NewGuid().ToString("N");
        var root = Path.Combine(home, "Pods", id);
        var runs = Path.Combine(ProductRuntimeLayout.Current.State.RunsPath, id);
        Document? document = null;
        try {
            Directory.CreateDirectory(Path.Combine(root, "pages", "sizing"));
            var example = Example();
            File.Copy(Path.Combine(example, "pages", "sizing", "Heal.cs"), Path.Combine(root, "pages", "sizing", "Heal.cs"));
            var manifest = JObject.Parse(File.ReadAllText(Path.Combine(example, "pod.json")));
            manifest["id"] = id;
            File.WriteAllText(Path.Combine(root, "pod.json"), manifest.ToString());
            ScriptPodSourceBundle Captured() => new(Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
                .Select(path => new ScriptPodSourceFile(Path.GetRelativePath(root, path).Replace('\\', '/'), Convert.ToBase64String(File.ReadAllBytes(path)))).ToList());
            var pods = new Pe.Revit.Scripting.Pods.ScriptPodPreparationService((key, _) => key == "pod.capture"
                ? JObject.FromObject(new { id, folder = id, directory = root, contributions = Array.Empty<object>(), memberBundle = Captured(), sourceBundle = Captured() })
                : throw new InvalidOperationException(key));
            var reader = new CsProjReader();
            var service = new RevitScriptExecutionService(new ScriptProjectGenerator(reader), new ScriptReferenceResolver(reader),
                new ScriptAssemblyLoadService(), new ScriptCompilationService(ScriptFileTemplates.DefaultUsings), () => ui, pods: pods);
            document = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
            Pipe[] pipes;
            using (var tx = new Transaction(document, "Seed two pipes")) {
                tx.Start();
                var level = new FilteredElementCollector(document).OfClass(typeof(Level)).FirstElementId();
                var type = new FilteredElementCollector(document).OfClass(typeof(PipeType)).FirstElementId();
                var system = new FilteredElementCollector(document).OfClass(typeof(PipingSystemType)).FirstElementId();
                Assert.That(type, Is.Not.EqualTo(ElementId.InvalidElementId), "fixture needs a pipe type");
                Assert.That(system, Is.Not.EqualTo(ElementId.InvalidElementId), "fixture needs a piping system type");
                pipes = new[] { 0.0, 10.0 }.Select(y => Pipe.Create(document, system, type, level, new XYZ(0, y, 0), new XYZ(10, y, 0))).ToArray();
                foreach (var pipe in pipes) Diameter(pipe).Set(25 / 304.8);
                tx.Commit();
            }
            var reading = pipes.Select(pipe => Diameter(pipe).AsDouble() * 304.8).ToArray();
            if (stale >= 0) {
                using var tx = new Transaction(document, "Edit behind the reading");
                tx.Start(); Diameter(pipes[stale]).Set(40 / 304.8); tx.Commit();
            }
            Dictionary<string, double> Snapshot() => new FilteredElementCollector(document).OfClass(typeof(Pipe)).Cast<Pipe>()
                .ToDictionary(pipe => pipe.UniqueId, pipe => Diameter(pipe).AsDouble());
            var before = Snapshot();
            var edits = pipes.Select((pipe, i) => new { uniqueId = pipe.UniqueId, expected = reading[i], diameter = i == 0 ? 32.0 : 50.0 }).ToArray();
            var result = service.Execute(document, new ExecuteRevitScriptRequest(SourcePath: "pages/sizing/Heal.cs", WorkspaceKey: id,
                SourceBundle: Captured(), Input: JObject.FromObject(new { edits })), id);
            var words = string.Join("; ", result.Diagnostics.Select(d => d.Message));
            if (stale >= 0) {
                Assert.Multiple(() => {
                    Assert.That(words, Does.Contain("Diameter changed. Read the system again"));
                    Assert.That(result.Status, Is.Not.EqualTo(ScriptExecutionStatus.Succeeded), words);
                    Assert.That(Snapshot(), Is.EqualTo(before), "refusal changed a user's pipes");
                });
            } else {
                Assert.That(result.Status, Is.EqualTo(ScriptExecutionStatus.Succeeded), words);
                Assert.That(Diameter(pipes[0]).AsDouble() * 304.8, Is.EqualTo(32).Within(0.11));
                Assert.That(Diameter(pipes[1]).AsDouble() * 304.8, Is.EqualTo(50).Within(0.11));
            }
        } finally {
            document?.Close(false);
            if (Directory.Exists(home)) Directory.Delete(home, true);
            if (Directory.Exists(runs)) Directory.Delete(runs, true);
        }
    }

    private static Parameter Diameter(Pipe pipe) => pipe.get_Parameter(BuiltInParameter.RBS_PIPE_DIAMETER_PARAM);
    private static string Example([System.Runtime.CompilerServices.CallerFilePath] string source = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(source)!, "../../../..", "examples/pods/hydronic"));
}
