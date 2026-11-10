using System.IO;
using Newtonsoft.Json;
using Pe.Revit.Global.Lib.Mep;
using Pe.Shared.RevitData.Ducts;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Revit.Tests;

/// <summary>Capture actual native refusal DTOs on an owned copy, for admission-only replay.</summary>
public sealed class NativeHealFixtureRecorder {
    [Test]
    public void Record_heal_rehearsal_and_apply_DTOs_on_an_owned_copy(UIApplication ui) {
        var output = Environment.GetEnvironmentVariable("PE_NATIVE_FIXTURE_OUTPUT")
            ?? throw new InvalidOperationException("Explicit capture output required");
        var requestPath = Environment.GetEnvironmentVariable("PE_NATIVE_HEAL_REQUEST")
            ?? throw new InvalidOperationException("Recorded-snapshot request required");
        Directory.CreateDirectory(output);
        var settings = RevitDataJson.CreateSerializerSettings();
        settings.DefaultValueHandling = DefaultValueHandling.Include;
        settings.NullValueHandling = NullValueHandling.Include;
        var request = JsonConvert.DeserializeObject<DuctHealRequest>(File.ReadAllText(requestPath), settings)!;
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(ui.Application);
        try {
            var model = RevitFamilyFixtureHarness.SaveDocumentCopy(doc, output, "heal-fixture-model");
            foreach (var preview in new[] { true, false }) {
                // The request names elements from the retained Driver snapshot, absent in this owned copy.
                // Keep the real native refusal; this capture asserts no successful geometry repair.
                var response = DuctHealer.Heal(doc, request, preview);
                Assert.That(response.Counts.Refused, Is.GreaterThan(0));
                var operation = preview ? "ducts.heal.preview" : "ducts.heal";
                File.WriteAllText(Path.Combine(output, operation + ".json"), JsonConvert.SerializeObject(new {
                    operation, entryPoint = "DuctHealer.Heal", request, response,
                    modelCopy = model, date = DateTime.UtcNow.ToString("O"), rung = "fresh"
                }, Formatting.Indented, settings));
            }
        } finally { RevitFamilyFixtureHarness.CloseDocument(doc); }
    }
}
