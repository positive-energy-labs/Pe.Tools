using Autodesk.Revit.DB.Events;
using Newtonsoft.Json;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Operations;
using Pe.Revit.Scripting.Execution;
using Pe.Revit.Scripting.Transport;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Tests;

/// <summary>
///     SPIKE, a measurement and not a landing: what Revit does to the model when a NoTransaction script commits
///     and then throws, under each closing of the run's transaction group. Closing 1 is Assimilate (the code as
///     it is); closing 2 is RollBack when the script threw (RevitScriptExecutionService.SpikeRollBackOnThrow).
///     Every arm runs a real script on a blank project of its own through <see cref="OpRunner" /> under a
///     ModelWrite scope, the scope scripting.execute declares; the op here runs the script in place on the API
///     thread, as the SDK op queue does, because the real op waits for an external event a test cannot pump.
///     The tests assert almost nothing: each prints one [PE_SPIKE] JSON row, and the row is the product.
/// </summary>
[TestFixture]
public sealed class ScriptGroupCloseSpikeTests {
    private const string FamilyName = "PeSpikeFam";
    private const string OpenTransactionKey = "pe-spike-open-transaction";
    private static UIApplication _ui = null!;
    private static ScriptingBridgeMessageHandler _scripting = null!;
    private static string _familyPath = null!;
    private static string _rows = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) {
        _ui = ui;
        OperationMonitor.Attach(ui.Application);
        _ = OpRegistry.RegisterFrom(typeof(ScriptGroupCloseSpikeTests).Assembly);
        _scripting = new ScriptingBridgeMessageHandler(() => _ui);
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(ScriptGroupCloseSpikeTests));
        _rows = Path.Combine(output, "rows.jsonl");
        _familyPath = Path.Combine(output, FamilyName + ".rfa");
        var family = RevitFamilyFixtureHarness.CreateFamilyDocument(ui.Application, BuiltInCategory.OST_GenericModel, FamilyName);
        using (var transaction = new Transaction(family, "Seed family type")) {
            _ = transaction.Start();
            _ = family.FamilyManager.NewType("A");
            Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
        }
        family.SaveAs(_familyPath, new SaveAsOptions { OverwriteExistingFile = true });
        _ = family.Close(false);
    }

    [OneTimeTearDown]
    public void TearDown() => _scripting?.Dispose();

    [Op("test.spike.script", OpSubject.None, OpTouches.Metadata, Does = "Run a script in place under a ModelWrite scope.", Actor = OpActor.Any, IsPublic = false, Thread = OpThread.Revit)]
    private static ExecuteRevitScriptData SpikeScript(ExecuteRevitScriptRequest request, RevitDocument target, ModelWrite scope) =>
        _scripting.ExecuteOnApiThread(request, target, CancellationToken.None);

    private const string Walls = """
        var level = new FilteredElementCollector(doc!).OfClass(typeof(Level)).FirstElementId();
        using (var t = new Transaction(doc, "Spike 1 add+modify")) {
            _ = t.Start();
            _ = Wall.Create(doc, Line.CreateBound(new XYZ(0, 100, 0), new XYZ(10, 100, 0)), level, false);
            _ = Wall.Create(doc, Line.CreateBound(new XYZ(0, 105, 0), new XYZ(10, 105, 0)), level, false);
            doc.ProjectInformation.Name = "__spike_modified__";
            WriteLine("commit 1: " + t.Commit());
        }
        """;

    private const string DeleteAndModify = """
        using (var t = new Transaction(doc, "Spike 2 delete+modify")) {
            _ = t.Start();
            _ = doc.Delete(new ElementId(SEED_DELETEL));
            _ = doc.GetElement(new ElementId(SEED_KEEPL)).get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS).Set("__spike_comment__");
            WriteLine("commit 2: " + t.Commit());
        }
        """;

    private const string LoadFamily = """
        using (var t = new Transaction(doc, "Spike 2 load family")) {
            _ = t.Start();
            var loaded = doc.LoadFamily(@"FAMILY_PATH", out var family);
            WriteLine("LoadFamily: " + loaded + " " + family?.Name);
            WriteLine("commit 2: " + t.Commit());
        }
        """;

    private const string RoundTrip = """
        public sealed class RoundTrip : PeScriptContainer {
            public override void Execute() {
                var level = new FilteredElementCollector(doc!).OfClass(typeof(Level)).FirstElementId();
                using (var t = new Transaction(doc, "Spike 1 add wall")) {
                    _ = t.Start();
                    _ = Wall.Create(doc, Line.CreateBound(new XYZ(0, 100, 0), new XYZ(10, 100, 0)), level, false);
                    WriteLine("commit 1: " + t.Commit());
                }
                var family = new FilteredElementCollector(doc).OfClass(typeof(Family)).Cast<Family>().First(each => each.Name == "PeSpikeFam");
                var familyDocument = doc.EditFamily(family);
                try {
                    using (var t = new Transaction(familyDocument, "Spike touch family")) {
                        _ = t.Start();
                        _ = familyDocument.FamilyManager.NewType("spike-type");
                        WriteLine("family commit: " + t.Commit());
                    }
                    WriteLine("loaded back: " + familyDocument.LoadFamily(doc, new Overwrite())?.Name);
                } finally { _ = familyDocument.Close(false); }
                throw new System.InvalidOperationException("SPIKE-THROW C: after EditFamily and load back");
            }
            private sealed class Overwrite : IFamilyLoadOptions {
                public bool OnFamilyFound(bool familyInUse, out bool overwriteParameterValues) { overwriteParameterValues = true; return true; }
                public bool OnSharedFamilyFound(Family sharedFamily, bool familyInUse, out FamilySource source, out bool overwriteParameterValues) {
                    source = FamilySource.Family; overwriteParameterValues = true; return true;
                }
            }
        }
        """;

    // D: the second transaction is never committed, rolled back or disposed, so it is open when the group closes.
    private const string LeftOpen = """
        var open = new Transaction(doc, "Spike 2 left open");
        _ = open.Start();
        _ = Wall.Create(doc, Line.CreateBound(new XYZ(0, 110, 0), new XYZ(10, 110, 0)), level, false);
        System.AppDomain.CurrentDomain.SetData("pe-spike-open-transaction", open);
        throw new System.InvalidOperationException("SPIKE-THROW D: a transaction is still open");
        """;

    // D2: the same throw inside a `using`, so the unwind disposes the transaction before the group closes.
    private const string OpenInUsing = """
        using (var t = new Transaction(doc, "Spike 2 open in using")) {
            _ = t.Start();
            _ = Wall.Create(doc, Line.CreateBound(new XYZ(0, 110, 0), new XYZ(10, 110, 0)), level, false);
            throw new System.InvalidOperationException("SPIKE-THROW D2: thrown inside a using transaction");
        }
        """;

    private static string Script(string arm) => arm switch {
        "A" => Walls + DeleteAndModify + "throw new System.InvalidOperationException(\"SPIKE-THROW A: after two commits\");",
        "B" => Walls + LoadFamily + "throw new System.InvalidOperationException(\"SPIKE-THROW B: after a family load\");",
        "C" => RoundTrip,
        "D" => Walls + LeftOpen,
        "D2" => Walls + OpenInUsing,
        "E" => Walls + DeleteAndModify,
        _ => throw new ArgumentOutOfRangeException(nameof(arm))
    };

    [TestCase("A", false), TestCase("A", true), TestCase("B", false), TestCase("B", true), TestCase("C", false), TestCase("C", true)]
    [TestCase("D", false), TestCase("D", true), TestCase("D2", false), TestCase("D2", true), TestCase("E", false), TestCase("E", true)]
    public void Arm(string arm, bool rollBackOnThrow) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(_ui.Application);
        var events = new List<string>();
        void OnChanged(object? sender, DocumentChangedEventArgs args) => events.Add(
            $"{args.Operation} [{string.Join(", ", args.GetTransactionNames())}] +{args.GetAddedElementIds().Count} ~{args.GetModifiedElementIds().Count} -{args.GetDeletedElementIds().Count} in '{args.GetDocument()?.Title}'");
        try {
            // The seed is the test's own commit, before the run: two walls to delete and to modify, and for C the family to edit.
            long seedDelete, seedKeep;
            using (var transaction = new Transaction(document, "Spike seed")) {
                _ = transaction.Start();
                var level = new FilteredElementCollector(document).OfClass(typeof(Level)).FirstElementId();
                seedDelete = Wall.Create(document, Line.CreateBound(new XYZ(0, 0, 0), new XYZ(10, 0, 0)), level, false).Id.Value;
                seedKeep = Wall.Create(document, Line.CreateBound(new XYZ(0, 5, 0), new XYZ(10, 5, 0)), level, false).Id.Value;
                if (arm == "C") Assert.That(document.LoadFamily(_familyPath, out _), Is.True, "the seed family loads");
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }

            var script = Script(arm).Replace("SEED_DELETE", seedDelete.ToString()).Replace("SEED_KEEP", seedKeep.ToString()).Replace("FAMILY_PATH", _familyPath);
            var before = Snapshot.Of(document, seedDelete, seedKeep);
            Assert.That(OpRegistry.TryGet("test.spike.script", out var op), Is.True);
            RevitScriptExecutionService.SpikeRollBackOnThrow = rollBackOnThrow;
            RevitScriptExecutionService.SpikeLastClose = null;
            AppDomain.CurrentDomain.SetData(OpenTransactionKey, null);
            _ui.Application.DocumentChanged += OnChanged;
            OpRun ran;
            try {
                ran = OpRunner.RunAsync(op,
                    JsonConvert.SerializeObject(new ExecuteRevitScriptRequest(script, SourceName: "spike-" + arm, PermissionMode: ScriptPermissionMode.NoTransaction), SdkOperations.Json),
                    SdkOperations.Wrap(op.Definition.Needs, document), CancellationToken.None).GetAwaiter().GetResult();
            } finally {
                _ui.Application.DocumentChanged -= OnChanged;
                RevitScriptExecutionService.SpikeRollBackOnThrow = false;
            }
            var after = Snapshot.Of(document, seedDelete, seedKeep);

            // Only D leaves a transaction: say what the close did to it, end it, and read the document again.
            object? leaked = null;
            if (AppDomain.CurrentDomain.GetData(OpenTransactionKey) is Transaction open) {
                var statusAtClose = open.GetStatus().ToString();
                string ended;
                try { ended = open.HasStarted() ? open.RollBack().ToString() : "not started"; } catch (Exception ex) { ended = $"{ex.GetType().Name}: {ex.Message}"; }
                open.Dispose();
                leaked = new { statusAfterGroupClose = statusAtClose, testRollBack = ended, afterTestRollBack = Snapshot.Of(document, seedDelete, seedKeep).Versus(before) };
            }

            var result = ran.Response as ExecuteRevitScriptData;
            var row = JsonConvert.SerializeObject(new {
                arm,
                closing = rollBackOnThrow ? "RollBack on throw" : "Assimilate",
                close = RevitScriptExecutionService.SpikeLastClose,
                before = before.Counts,
                after = after.Counts,
                read = after.Versus(before),
                touched = ran.Touched,
                opError = ran.Error is null ? null : $"{ran.Error.GetType().FullName}: {ran.Error.Message}",
                status = result?.Status.ToString(),
                diagnostics = result?.Diagnostics.Select(diagnostic => new { diagnostic.Stage, severity = diagnostic.Severity.ToString(), diagnostic.Message }),
                changes = result?.Changes,
                failures = result?.Failures,
                output = result?.Output,
                events,
                leaked,
                undo = UndoProbe()
            }, Formatting.None);
            Console.WriteLine("[PE_SPIKE] " + row);
            File.AppendAllText(_rows, row + Environment.NewLine);
            Console.WriteLine("[PE_SPIKE_ROWS] " + _rows);
            Assert.That(result, Is.Not.Null, ran.Error?.ToString());
        } finally {
            _ = document.Close(false);
        }
    }

    /// <summary>What reading the document says, with no run report in it.</summary>
    private sealed record Snapshot(Dictionary<long, Guid> Versions, object Counts) {
        public static Snapshot Of(Document document, long seedDelete, long seedKeep) {
            var all = new FilteredElementCollector(document).WhereElementIsNotElementType().ToElements()
                .Concat(new FilteredElementCollector(document).WhereElementIsElementType().ToElements()).ToList();
            var family = new FilteredElementCollector(document).OfClass(typeof(Family)).Cast<Family>().FirstOrDefault(each => each.Name == FamilyName);
            return new Snapshot(all.GroupBy(element => element.Id.Value).ToDictionary(group => group.Key, group => group.First().VersionGuid), new {
                elements = all.Count,
                walls = new FilteredElementCollector(document).OfClass(typeof(Wall)).GetElementCount(),
                projectName = document.ProjectInformation.Name,
                seedDeleteExists = document.GetElement(new ElementId(seedDelete)) is not null,
                seedKeepComment = document.GetElement(new ElementId(seedKeep))?.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.AsString(),
                familyLoaded = family is not null,
                familySymbols = family?.GetFamilySymbolIds().Select(id => document.GetElement(id).Name).OrderBy(name => name).ToList(),
                document.IsModifiable
            });
        }

        public object Versus(Snapshot before) => new {
            added = this.Versions.Keys.Count(id => !before.Versions.ContainsKey(id)),
            deleted = before.Versions.Keys.Count(id => !this.Versions.ContainsKey(id)),
            modifiedByVersionGuid = this.Versions.Count(pair => before.Versions.TryGetValue(pair.Key, out var was) && was != pair.Value),
            now = this.Counts
        };
    }

    /// <summary>
    ///     Revit's API has no reader for a document's undo list. This looks for the Undo control on the quick access
    ///     toolbar by reflection and prints what it finds; a miss is printed as a miss.
    /// </summary>
    private static object UndoProbe() {
        try {
            var manager = AppDomain.CurrentDomain.GetAssemblies().Select(assembly => assembly.GetType("Autodesk.Windows.ComponentManager", false)).FirstOrDefault(type => type is not null);
            if (manager?.GetProperty("QuickAccessToolBar")?.GetValue(null) is not { } toolbar) return "no quick access toolbar";
            if (toolbar.GetType().GetProperty("Items")?.GetValue(toolbar) is not System.Collections.IEnumerable items) return "no toolbar items";
            return items.Cast<object>().Select(item => {
                object? Read(object from, string name) { try { return from.GetType().GetProperty(name)?.GetValue(from); } catch (Exception ex) { return ex.GetType().Name; } }
                var id = Read(item, "Id")?.ToString() ?? "";
                var children = Read(item, "Items") as System.Collections.IEnumerable;
                return new {
                    type = item.GetType().FullName, id, text = Read(item, "Text")?.ToString(), enabled = Read(item, "IsEnabled")?.ToString(),
                    children = children?.Cast<object>().Select(child => $"{child.GetType().Name}:{Read(child, "Id")}:{Read(child, "Text")}").ToList(),
                    properties = id.IndexOf("undo", StringComparison.OrdinalIgnoreCase) >= 0 || item.GetType().Name.IndexOf("undo", StringComparison.OrdinalIgnoreCase) >= 0
                        ? item.GetType().GetProperties().Select(property => property.Name).ToList() : null
                };
            }).ToList();
        } catch (Exception ex) {
            return $"probe failed: {ex.GetType().Name}: {ex.Message}";
        }
    }
}
