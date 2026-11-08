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
            var response = (RevitLensData)method.Invoke(null, [request, wrapper])!;
            var settings = RevitDataJson.CreateSerializerSettings();
            settings.DefaultValueHandling = DefaultValueHandling.Include;
            settings.NullValueHandling = NullValueHandling.Include;
            File.WriteAllText(Path.Combine(output, "lens.json"), JsonConvert.SerializeObject(new {
                operation = "revit.context.lens", entryPoint = "LensCore", request, response,
                modelCopy = model, date = DateTime.UtcNow.ToString("O"), rung = "fresh"
            }, Formatting.Indented, settings));
            Assert.That(response.Boxed, Is.EqualTo(1));
        } finally { RevitFamilyFixtureHarness.CloseDocument(doc); }
    }
}
