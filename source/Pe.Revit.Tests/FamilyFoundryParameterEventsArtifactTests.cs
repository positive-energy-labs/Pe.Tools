using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FamilyFoundryParameterEventsArtifactTests {
    [Test]
    public void WriteSingleFamilyOutput_emits_standalone_parameter_events_artifact() {
        var outputPath = Path.Combine(Path.GetTempPath(), $"ff-parameter-events-{Guid.NewGuid():N}");
        try {
            var builder = new ProcessingResultBuilder(OutputStorage.ExactDir(outputPath))
                .WithCustomProfile(new { Name = "TestProfile" }, "TestProfile");
            var ctx = new FamilyProcessingContext { FamilyName = "Event Family" };
            SetOperationLogs(ctx, [
                new OperationLog("MapParams", [
                    new LogEntry("Width")
                        .WithParameterEvent(
                            ParameterEventOutcome.ValueMapped,
                            sourceParameter: "OldWidth",
                            targetParameter: "Width",
                            mappingKey: "Width")
                        .Defer("Set OldWidth → Width")
                ])
            ]);

            _ = builder.WriteSingleFamilyOutput(ctx);

            Assert.That(ctx.Artifacts?.ParameterEventsPath, Is.EqualTo(Path.Combine("Event Family", "parameter-events.json")));
            var eventPath = Path.Combine(outputPath, ctx.Artifacts!.ParameterEventsPath);
            Assert.That(File.Exists(eventPath), Is.True);

            var json = JObject.Parse(File.ReadAllText(eventPath));
            var firstEvent = json["Events"]?.First;

            Assert.Multiple(() => {
                Assert.That((string?)json["Family"], Is.EqualTo("Event Family"));
                Assert.That((string?)json["Profile"], Is.EqualTo("TestProfile"));
                Assert.That((int?)json["EventModelVersion"], Is.EqualTo(1));
                Assert.That((string?)firstEvent?["OperationName"], Is.EqualTo("MapParams"));
                Assert.That((string?)firstEvent?["OperationStatus"], Is.EqualTo("Deferred"));
                Assert.That((string?)firstEvent?["Outcome"], Is.EqualTo(nameof(ParameterEventOutcome.ValueMapped)));
                Assert.That((string?)firstEvent?["Reason"], Is.EqualTo(nameof(ParameterEventReason.NotApplicable)));
                Assert.That((string?)firstEvent?["SourceParameter"], Is.EqualTo("OldWidth"));
                Assert.That((string?)firstEvent?["TargetParameter"], Is.EqualTo("Width"));
                Assert.That((string?)firstEvent?["Message"], Does.Contain("OldWidth"));
            });
        } finally {
            if (Directory.Exists(outputPath))
                Directory.Delete(outputPath, true);
        }
    }

    private static void SetOperationLogs(FamilyProcessingContext context, List<OperationLog> logs) {
        var property = typeof(FamilyProcessingContext).GetProperty(nameof(FamilyProcessingContext.OperationLogs));
        property!.SetValue(context, (Pe.Revit.Global.Result<List<OperationLog>>)logs);
    }
}
