using System.IO;
using System.Reflection;
using Newtonsoft.Json;
using Pe.Revit.Global.Services.Host;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Revit.Tests;

/// <summary>Retain the actual lens DTO on an owned model copy; never synthesize a reply.</summary>
public sealed class NativeLensFixtureRecorder {
    [Test]
    public void Record_lens_DTO_on_an_owned_project_copy(UIApplication ui) {
        var output = Environment.GetEnvironmentVariable("PE_NATIVE_FIXTURE_OUTPUT")
            ?? Path.Combine(Path.GetTempPath(), "pe-lens-native-fixture");
        Directory.CreateDirectory(output);
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
        try {
            Wall wall;
            using (var tx = new Transaction(doc, "Seed lens recording geometry")) {
                tx.Start();
                var level = Level.Create(doc, 0);
                var type = new FilteredElementCollector(doc).OfClass(typeof(WallType)).FirstElementId();
                wall = Wall.Create(doc, Line.CreateBound(XYZ.Zero, new XYZ(10, 0, 0)), type, level.Id, 10, 0, false, false);
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var model = RevitFamilyFixtureHarness.SaveDocumentCopy(doc, output, "lens-fixture-model");
            var request = new RevitLensRequest([wall.Id.Value()], "Recorded lens");
            var method = typeof(RevitDataRequestService).GetMethod("LensCore", BindingFlags.Static | BindingFlags.NonPublic)!;
            var wrapper = Activator.CreateInstance(method.GetParameters()[1].ParameterType,
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance, null, [doc], null);
            var response = (RevitLensData)method.Invoke(null, [request, wrapper, new Pe.Revit.Operations.SessionWrite(doc)])!;
            var settings = RevitDataJson.CreateSerializerSettings();
            settings.DefaultValueHandling = DefaultValueHandling.Include;
            settings.NullValueHandling = NullValueHandling.Include;
            File.WriteAllText(Path.Combine(output, "lens.json"), JsonConvert.SerializeObject(new {
                operation = "revit.context.lens", entryPoint = "LensCore", request, response,
                modelCopy = model, date = DateTime.UtcNow.ToString("O"), rung = "fresh"
            }, Formatting.Indented, settings));
            Assert.That(response.Boxed, Is.EqualTo(1));
            Assert.That(response.Lens.Basis, Is.EqualTo(LensBasis.PeDefault));
            var view = (View)doc.GetElement(response.ViewId!.Value.ToElementId());
            foreach (var item in Pe.Revit.DocumentData.AgentContext.RevitViewImageExporter.LensCategories) {
                if (!view.CanCategoryBeHidden(new ElementId(item.Category))) continue;
                Assert.That(view.GetCategoryHidden(new ElementId(item.Category)), Is.True);
                Assert.That(response.Hidden.Single(h => h.What == item.Kind).Count,
                    Is.EqualTo(new FilteredElementCollector(doc).OfCategory(item.Category).WhereElementIsNotElementType().GetElementCount()));
            }
            var transactions = new List<string>();
            void Changed(object sender, Autodesk.Revit.DB.Events.DocumentChangedEventArgs args) {
                if (args.GetDocument().Equals(doc)) transactions.AddRange(args.GetTransactionNames());
            }
            ui.Application.DocumentChanged += Changed;
            RevitViewImageData image;
            try {
                // Planted offender proves this monitor would reject a committed crop/category transaction.
                using (var offender = new Transaction(doc, "SI-S3 mutant unfocused-write")) {
                    offender.Start();
                    view.DetailLevel = ViewDetailLevel.Fine;
                    offender.Commit();
                }
                var red = Assert.Throws<AssertionException>(() => Assert.That(transactions, Is.Empty));
                Console.WriteLine($"[PE_LENS_MUTANT_RED] unfocused-write: {red!.Message}");
                using (var cleanup = new Transaction(doc, "SI-S3 mutant cleanup")) {
                    cleanup.Start();
                    view.DetailLevel = ViewDetailLevel.Medium;
                    cleanup.Commit();
                }
                transactions.Clear();
                image = Pe.Revit.DocumentData.AgentContext.RevitViewImageExporter.Export(doc, view, 600);
            } finally { ui.Application.DocumentChanged -= Changed; }
            Assert.That(transactions, Is.Empty, "unfocused capture must open no transaction");
            File.WriteAllText(Path.Combine(output, "image.json"), JsonConvert.SerializeObject(image, Formatting.Indented, settings));
            Console.WriteLine($"[PE_LENS_CAPTURE] output={output} links={new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).GetElementCount()} transactions={transactions.Count}");
        } finally { RevitFamilyFixtureHarness.CloseDocument(doc); }
    }
}
