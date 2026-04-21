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
    public void Automation_job_input_round_trips_schedule_collection_payload() {
        var runId = Guid.NewGuid().ToString("D");
        var projectGuid = Guid.NewGuid().ToString("D");
        var modelGuid = Guid.NewGuid().ToString("D");
        var input = new AutomationJobInput {
            JobType = AutomationJobType.ScheduleCollection,
            Engine = "Autodesk.Revit+2025",
            Region = "us",
            ProjectGuid = projectGuid,
            ModelGuid = modelGuid,
            RunId = runId,
            ScheduleCollection = new ScheduleCollectionRequest(
                new ScheduleCatalogRequest {
                    CustomParameterFilters = [
                        new ScheduleCustomParameterFilter(
                            "Discipline",
                            "Mechanical",
                            ScheduleCustomParameterMatchKind.Equals
                        )
                    ]
                },
                new ScheduleCatalogRequest {
                    CategoryNames = ["Mechanical Equipment", "Duct Accessories"]
                }
            )
        };

        var roundTripped = AutomationJobInput.FromJson(input.ToJson());

        Assert.Multiple(() => {
            Assert.That(roundTripped.JobType, Is.EqualTo(AutomationJobType.ScheduleCollection));
            Assert.That(roundTripped.GetNormalizedRegion(), Is.EqualTo("US"));
            Assert.That(roundTripped.GetProjectGuid().ToString("D"), Is.EqualTo(projectGuid));
            Assert.That(roundTripped.GetModelGuid().ToString("D"), Is.EqualTo(modelGuid));
            Assert.That(roundTripped.RunId, Is.EqualTo(runId));
            Assert.That(roundTripped.ScheduleCollection, Is.Not.Null);
            Assert.That(roundTripped.ScheduleCollection!.PrimaryCatalogRequest, Is.Not.Null);
            Assert.That(roundTripped.ScheduleCollection.PrimaryCatalogRequest!.CustomParameterFilters.Count, Is.EqualTo(1));
            Assert.That(
                roundTripped.ScheduleCollection.PrimaryCatalogRequest.CustomParameterFilters[0].ParameterName,
                Is.EqualTo("Discipline")
            );
            Assert.That(roundTripped.ScheduleCollection.FallbackCatalogRequest, Is.Not.Null);
            Assert.That(
                roundTripped.ScheduleCollection.FallbackCatalogRequest!.CategoryNames,
                Is.EqualTo(new[] { "Mechanical Equipment", "Duct Accessories" })
            );
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

    [Test]
    public void Schedule_collection_batch_manifest_loads_default_request_and_entry_override() {
        var manifestPath = Path.Combine(
            Path.GetTempPath(),
            $"pe-da-schedule-batch-{Guid.NewGuid():N}.json"
        );

        try {
            File.WriteAllText(
                manifestPath,
                """
                {
                  "engine": "Autodesk.Revit+2025",
                  "timeoutSeconds": 900,
                  "maxConcurrency": 2,
                  "request": {
                    "primaryCatalogRequest": {
                      "customParameterFilters": [
                        {
                          "parameterName": "Discipline",
                          "expectedValue": "Mechanical",
                          "matchKind": "Equals"
                        }
                      ]
                    },
                    "fallbackCatalogRequest": {
                      "categoryNames": [ "Mechanical Equipment", "Duct Accessories" ]
                    }
                  },
                  "models": [
                    {
                      "region": "US",
                      "projectGuid": "11111111-1111-1111-1111-111111111111",
                      "modelGuid": "22222222-2222-2222-2222-222222222222"
                    },
                    {
                      "region": "US",
                      "projectGuid": "33333333-3333-3333-3333-333333333333",
                      "modelGuid": "44444444-4444-4444-4444-444444444444",
                      "request": {
                        "fallbackCatalogRequest": {
                          "categoryNames": [ "Mechanical Equipment" ]
                        }
                      }
                    }
                  ]
                }
                """
            );

            var manifest = ScheduleCollectionBatchManifest.LoadFromFile(manifestPath);
            var defaultOptions = manifest.Models[0].ToOptions(manifest);
            var overrideOptions = manifest.Models[1].ToOptions(manifest);

            Assert.Multiple(() => {
                Assert.That(manifest.Engine, Is.EqualTo("Autodesk.Revit+2025"));
                Assert.That(manifest.MaxConcurrency, Is.EqualTo(2));
                Assert.That(defaultOptions.Request, Is.Not.Null);
                Assert.That(defaultOptions.Request!.PrimaryCatalogRequest, Is.Not.Null);
                Assert.That(defaultOptions.Request.PrimaryCatalogRequest!.CustomParameterFilters.Count, Is.EqualTo(1));
                Assert.That(overrideOptions.Request, Is.Not.Null);
                Assert.That(overrideOptions.Request!.FallbackCatalogRequest, Is.Not.Null);
                Assert.That(
                    overrideOptions.Request.FallbackCatalogRequest!.CategoryNames,
                    Is.EqualTo(new[] { "Mechanical Equipment" })
                );
            });
        } finally {
            if (File.Exists(manifestPath))
                File.Delete(manifestPath);
        }
    }
}
