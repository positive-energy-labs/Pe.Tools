using Pe.Dev.RevitAutomation;
using Pe.Revit.Global.Services.Aps.Models;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class RevitAutomationContractsTests {
    [Test]
    public void Automation_job_input_round_trips_parameter_collection_payload() {
        var runId = Guid.NewGuid().ToString("D");
        var projectGuid = Guid.NewGuid().ToString("D");
        var modelGuid = Guid.NewGuid().ToString("D");
        var input = new AutomationJobInput {
            JobType = AutomationJobType.ParameterCollection,
            Engine = "Autodesk.Revit+2025",
            Region = "us",
            ProjectGuid = projectGuid,
            ModelGuid = modelGuid,
            RunId = runId,
            ParameterCollection = new ParameterCollectionRequest(new LoadedFamiliesFilter {
                CategoryNames = ["Duct Accessories"],
                FamilyNames = ["_PE_DA_DuctAccessory"],
                PlacementScope = LoadedFamilyPlacementScope.AllLoaded
            })
        };

        var roundTripped = AutomationJobInput.FromJson(input.ToJson());

        Assert.Multiple(() => {
            Assert.That(roundTripped.JobType, Is.EqualTo(AutomationJobType.ParameterCollection));
            Assert.That(roundTripped.GetNormalizedRegion(), Is.EqualTo("US"));
            Assert.That(roundTripped.GetProjectGuid().ToString("D"), Is.EqualTo(projectGuid));
            Assert.That(roundTripped.GetModelGuid().ToString("D"), Is.EqualTo(modelGuid));
            Assert.That(roundTripped.RunId, Is.EqualTo(runId));
            Assert.That(roundTripped.ParameterCollection, Is.Not.Null);
            Assert.That(roundTripped.ParameterCollection!.Filter, Is.Not.Null);
            Assert.That(roundTripped.ParameterCollection.Filter!.CategoryNames, Is.EqualTo(new[] { "Duct Accessories" }));
            Assert.That(roundTripped.ParameterCollection.Filter.FamilyNames, Is.EqualTo(new[] { "_PE_DA_DuctAccessory" }));
        });
    }

    [Test]
    public void Parameter_collection_batch_manifest_loads_small_duct_accessory_scope() {
        var manifestPath = Path.Combine(
            Path.GetTempPath(),
            $"pe-da-batch-{Guid.NewGuid():N}.json"
        );

        try {
            File.WriteAllText(
                manifestPath,
                """
                {
                  "engine": "Autodesk.Revit+2025",
                  "timeoutSeconds": 900,
                  "maxConcurrency": 2,
                  "models": [
                    {
                      "region": "US",
                      "projectGuid": "11111111-1111-1111-1111-111111111111",
                      "modelGuid": "22222222-2222-2222-2222-222222222222",
                      "filter": {
                        "categoryNames": [ "Duct Accessories" ]
                      }
                    }
                  ]
                }
                """
            );

            var manifest = ParameterCollectionBatchManifest.LoadFromFile(manifestPath);
            var options = manifest.Models.Single().ToOptions(manifest);

            Assert.Multiple(() => {
                Assert.That(manifest.Engine, Is.EqualTo("Autodesk.Revit+2025"));
                Assert.That(manifest.MaxConcurrency, Is.EqualTo(2));
                Assert.That(options.Region, Is.EqualTo("US"));
                Assert.That(options.Filter, Is.Not.Null);
                Assert.That(options.Filter!.CategoryNames, Is.EqualTo(new[] { "Duct Accessories" }));
            });
        } finally {
            if (File.Exists(manifestPath))
                File.Delete(manifestPath);
        }
    }
}
