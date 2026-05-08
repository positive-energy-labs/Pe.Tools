using Pe.Aps.DataManagement;
using Pe.Shared.RevitAutomation;
using Autodesk.DataManagement.Model;
using Newtonsoft.Json.Linq;
using Pe.Dev.RevitAutomation;
using Pe.Aps.Core;
using Pe.Aps.DesignAutomation;
using Pe.Shared.RevitVersions;
using ContractScheduleCatalogRequest = Pe.Shared.RevitData.Schedules.ScheduleCatalogRequest;

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
            Assert.That(roundTripped.SourceKind, Is.EqualTo(AutomationDocumentSourceKind.CloudModel));
            Assert.That(roundTripped.GetNormalizedRegion(), Is.EqualTo("US"));
            Assert.That(roundTripped.GetProjectGuid().ToString("D"), Is.EqualTo(projectGuid));
            Assert.That(roundTripped.GetModelGuid().ToString("D"), Is.EqualTo(modelGuid));
            Assert.That(roundTripped.RunId, Is.EqualTo(runId));
            Assert.That(roundTripped.ParameterCollection, Is.Not.Null);
            Assert.That(roundTripped.ParameterCollection!.Filter, Is.Not.Null);
            Assert.That(roundTripped.ParameterCollection.Filter!.CategoryNames,
                Is.EqualTo(new[] { "Duct Accessories" }));
            Assert.That(roundTripped.ParameterCollection.Filter.FamilyNames,
                Is.EqualTo(new[] { "_PE_DA_DuctAccessory" }));
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
                new ContractScheduleCatalogRequest {
                    CustomParameterFilters = [
                        new ScheduleCustomParameterFilter(
                            "Discipline",
                            "Mechanical",
                            ScheduleCustomParameterMatchKind.Equals
                        )
                    ]
                },
                new ContractScheduleCatalogRequest { CategoryNames = ["Mechanical Equipment", "Duct Accessories"] }
            )
        };

        var roundTripped = AutomationJobInput.FromJson(input.ToJson());

        Assert.Multiple(() => {
            Assert.That(roundTripped.JobType, Is.EqualTo(AutomationJobType.ScheduleCollection));
            Assert.That(roundTripped.SourceKind, Is.EqualTo(AutomationDocumentSourceKind.CloudModel));
            Assert.That(roundTripped.GetNormalizedRegion(), Is.EqualTo("US"));
            Assert.That(roundTripped.GetProjectGuid().ToString("D"), Is.EqualTo(projectGuid));
            Assert.That(roundTripped.GetModelGuid().ToString("D"), Is.EqualTo(modelGuid));
            Assert.That(roundTripped.RunId, Is.EqualTo(runId));
            Assert.That(roundTripped.ScheduleCollection, Is.Not.Null);
            Assert.That(roundTripped.ScheduleCollection!.PrimaryCatalogRequest, Is.Not.Null);
            Assert.That(roundTripped.ScheduleCollection.PrimaryCatalogRequest!.CustomParameterFilters.Count,
                Is.EqualTo(1));
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
    public void Automation_job_input_round_trips_local_file_schedule_payload() {
        var runId = Guid.NewGuid().ToString("D");
        var input = new AutomationJobInput {
            JobType = AutomationJobType.ScheduleCollection,
            SourceKind = AutomationDocumentSourceKind.LocalFile,
            Engine = "Autodesk.Revit+2024",
            LocalModelPath = "input-model.rvt",
            RunId = runId,
            ScheduleCollection = new ScheduleCollectionRequest(
                new ContractScheduleCatalogRequest(),
                new ContractScheduleCatalogRequest { CategoryNames = ["Mechanical Equipment"] }
            )
        };

        var roundTripped = AutomationJobInput.FromJson(input.ToJson());

        Assert.Multiple(() => {
            Assert.That(roundTripped.SourceKind, Is.EqualTo(AutomationDocumentSourceKind.LocalFile));
            Assert.That(roundTripped.GetRequiredLocalModelPath(), Is.EqualTo("input-model.rvt"));
            Assert.That(roundTripped.RunId, Is.EqualTo(runId));
            Assert.That(roundTripped.ScheduleCollection, Is.Not.Null);
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
            var options = manifest.Models.Single().ToOptions(manifest, manifest.Models.Single().ResolveSpec(manifest.Engine).DesignAutomationEngine);

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
            var defaultOptions = manifest.Models[0].ToOptions(manifest, manifest.Models[0].ResolveSpec(manifest.Engine).DesignAutomationEngine);
            var overrideOptions = manifest.Models[1].ToOptions(manifest, manifest.Models[1].ResolveSpec(manifest.Engine).DesignAutomationEngine);

            Assert.Multiple(() => {
                Assert.That(manifest.Engine, Is.EqualTo("Autodesk.Revit+2025"));
                Assert.That(manifest.MaxConcurrency, Is.EqualTo(2));
                Assert.That(defaultOptions.Request, Is.Not.Null);
                Assert.That(defaultOptions.Request!.PrimaryCatalogRequest, Is.Not.Null);
                Assert.That(defaultOptions.Request.PrimaryCatalogRequest!.CustomParameterFilters.Count, Is.EqualTo(1));
                Assert.That(overrideOptions.Request, Is.Not.Null);
                Assert.That(overrideOptions.Request!.PrimaryCatalogRequest, Is.Not.Null);
                Assert.That(overrideOptions.Request.PrimaryCatalogRequest!.CustomParameterFilters.Count, Is.EqualTo(1));
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

    [Test]
    public void Schedule_collection_batch_manifest_entry_primary_request_overrides_manifest_primary_request() {
        var manifestPath = Path.Combine(
            Path.GetTempPath(),
            $"pe-da-schedule-primary-override-{Guid.NewGuid():N}.json"
        );

        try {
            File.WriteAllText(
                manifestPath,
                """
                {
                  "engine": "Autodesk.Revit+2025",
                  "request": {
                    "primaryCatalogRequest": {
                      "customParameterFilters": [
                        {
                          "parameterName": "Discipline",
                          "expectedValue": "Mechanical",
                          "matchKind": "Equals"
                        }
                      ]
                    }
                  },
                  "models": [
                    {
                      "region": "US",
                      "projectGuid": "11111111-1111-1111-1111-111111111111",
                      "modelGuid": "22222222-2222-2222-2222-222222222222",
                      "request": {
                        "primaryCatalogRequest": {
                          "customParameterFilters": [
                            {
                              "parameterName": "Discipline",
                              "expectedValue": "Electrical",
                              "matchKind": "Equals"
                            }
                          ]
                        }
                      }
                    }
                  ]
                }
                """
            );

            var manifest = ScheduleCollectionBatchManifest.LoadFromFile(manifestPath);
            var entry = manifest.Models.Single();
            var options = entry.ToOptions(manifest, entry.ResolveSpec(manifest.Engine).DesignAutomationEngine);

            Assert.That(
                options.Request!.PrimaryCatalogRequest!.CustomParameterFilters.Single().ExpectedValue,
                Is.EqualTo("Electrical")
            );
        } finally {
            if (File.Exists(manifestPath))
                File.Delete(manifestPath);
        }
    }

    [Test]
    public void Schedule_collection_batch_manifest_preserves_manifest_include_templates_when_entry_leaves_it_unset() {
        var manifestPath = Path.Combine(
            Path.GetTempPath(),
            $"pe-da-schedule-include-templates-default-{Guid.NewGuid():N}.json"
        );

        try {
            File.WriteAllText(
                manifestPath,
                """
                {
                  "engine": "Autodesk.Revit+2025",
                  "request": {
                    "fallbackCatalogRequest": {
                      "categoryNames": [ "Mechanical Equipment", "Duct Accessories" ],
                      "includeTemplates": true
                    }
                  },
                  "models": [
                    {
                      "region": "US",
                      "projectGuid": "11111111-1111-1111-1111-111111111111",
                      "modelGuid": "22222222-2222-2222-2222-222222222222",
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
            var entry = manifest.Models.Single();
            var options = entry.ToOptions(manifest, entry.ResolveSpec(manifest.Engine).DesignAutomationEngine);

            Assert.That(options.Request!.FallbackCatalogRequest!.IncludeTemplates, Is.True);
        } finally {
            if (File.Exists(manifestPath))
                File.Delete(manifestPath);
        }
    }

    [Test]
    public void Schedule_collection_batch_manifest_entry_can_disable_include_templates() {
        var manifestPath = Path.Combine(
            Path.GetTempPath(),
            $"pe-da-schedule-include-templates-override-{Guid.NewGuid():N}.json"
        );

        try {
            File.WriteAllText(
                manifestPath,
                """
                {
                  "engine": "Autodesk.Revit+2025",
                  "request": {
                    "fallbackCatalogRequest": {
                      "categoryNames": [ "Mechanical Equipment", "Duct Accessories" ],
                      "includeTemplates": true
                    }
                  },
                  "models": [
                    {
                      "region": "US",
                      "projectGuid": "11111111-1111-1111-1111-111111111111",
                      "modelGuid": "22222222-2222-2222-2222-222222222222",
                      "request": {
                        "fallbackCatalogRequest": {
                          "includeTemplates": false
                        }
                      }
                    }
                  ]
                }
                """
            );

            var manifest = ScheduleCollectionBatchManifest.LoadFromFile(manifestPath);
            var entry = manifest.Models.Single();
            var options = entry.ToOptions(manifest, entry.ResolveSpec(manifest.Engine).DesignAutomationEngine);

            Assert.That(options.Request!.FallbackCatalogRequest!.IncludeTemplates, Is.False);
        } finally {
            if (File.Exists(manifestPath))
                File.Delete(manifestPath);
        }
    }

    [Test]
    public void Revit_version_catalog_resolves_supported_design_automation_years() {
        Assert.Multiple(() => {
            Assert.That(RevitVersionCatalog.RequireByYear(2023).DesignAutomationEngine, Is.EqualTo("Autodesk.Revit+2023"));
            Assert.That(RevitVersionCatalog.RequireByYear(2024).TargetFramework, Is.EqualTo("net48"));
            Assert.That(RevitVersionCatalog.RequireByYear(2025).ConfigurationSuffix, Is.EqualTo("R25"));
            Assert.That(RevitVersionCatalog.RequireByAutomationEngine("Autodesk.Revit+2026").Year, Is.EqualTo(2026));
            Assert.That(RevitVersionCatalog.TryResolveFromConfiguration("Release.R24", out var spec), Is.True);
            Assert.That(spec!.Year, Is.EqualTo(2024));
        });
    }

    [Test]
    public void Schedule_audit_manifest_entry_loads_revit_year_hint() {
        var manifestPath = Path.Combine(Path.GetTempPath(), $"pe-da-audit-hint-{Guid.NewGuid():N}.json");

        try {
            File.WriteAllText(
                manifestPath,
                """
                {
                  "hub": "Positive Energy",
                  "models": [
                    {
                      "project": "PE 2023 Projects",
                      "modelPath": "Project Files/Spring St/MEP_WittArchitecture_SpringSt_R23",
                      "revitYearHint": 2023
                    }
                  ]
                }
                """
            );

            var manifest = ScheduleAuditManifest.LoadFromFile(manifestPath);
            Assert.That(manifest.Models.Single().RevitYearHint, Is.EqualTo(2023));
        } finally {
            if (File.Exists(manifestPath))
                File.Delete(manifestPath);
        }
    }

    [Test]
    public void Automation_processing_route_prefers_aps_year_for_direct_cloud() {
        var route = new AutomationProcessingRouteService().ResolveRoute(
            new ScheduleAuditManifestEntry {
                Project = "PE 2025 Projects",
                ModelPath = "Project Files/Cargo House/MEP_Kapstone_Cargo_R25"
            },
            new ModelResolutionResult {
                ModelPath = "Project Files/Cargo House/MEP_Kapstone_Cargo_R25",
                RevitYear = 2025
            }
        );

        Assert.Multiple(() => {
            Assert.That(route.SourceRevitYear, Is.EqualTo(2025));
            Assert.That(route.ExecutionRevitYear, Is.EqualTo(2025));
            Assert.That(route.YearResolutionSource, Is.EqualTo(AutomationManifestYearResolutionSource.Aps));
            Assert.That(route.ProcessingMode, Is.EqualTo(AutomationProcessingMode.DirectCloud));
        });
    }

    [Test]
    public void Automation_processing_route_uses_manifest_hint_for_legacy_upgrade() {
        var route = new AutomationProcessingRouteService().ResolveRoute(
            new ScheduleAuditManifestEntry {
                Project = "PE 2023 Projects",
                ModelPath = "Project Files/Spring St/MEP_WittArchitecture_SpringSt_R23",
                RevitYearHint = 2023
            },
            new ModelResolutionResult {
                ModelPath = "Project Files/Spring St/MEP_WittArchitecture_SpringSt_R23",
                RevitYear = null
            }
        );

        Assert.Multiple(() => {
            Assert.That(route.SourceRevitYear, Is.EqualTo(2023));
            Assert.That(route.ExecutionRevitYear, Is.EqualTo(2024));
            Assert.That(route.YearResolutionSource, Is.EqualTo(AutomationManifestYearResolutionSource.ManifestHint));
            Assert.That(route.ProcessingMode, Is.EqualTo(AutomationProcessingMode.TransientLocalUpgrade));
        });
    }

    [Test]
    public void Automation_processing_route_rejects_conflicting_hint_and_aps_year() {
        Assert.That(
            () => new AutomationProcessingRouteService().ResolveRoute(
                new ScheduleAuditManifestEntry {
                    Project = "PE 2023 Projects",
                    ModelPath = "Project Files/Spring St/MEP_WittArchitecture_SpringSt_R23",
                    RevitYearHint = 2023
                },
                new ModelResolutionResult {
                    ModelPath = "Project Files/Spring St/MEP_WittArchitecture_SpringSt_R23",
                    RevitYear = 2024
                }
            ),
            Throws.InstanceOf<InvalidDataException>()
        );
    }

    [Test]
    public void Parameter_collection_batch_manifest_prefers_entry_revit_year_when_present() {
        var manifestPath = Path.Combine(Path.GetTempPath(), $"pe-da-batch-year-{Guid.NewGuid():N}.json");

        try {
            File.WriteAllText(
                manifestPath,
                """
                {
                  "timeoutSeconds": 900,
                  "maxConcurrency": 2,
                  "models": [
                    {
                      "region": "US",
                      "projectGuid": "11111111-1111-1111-1111-111111111111",
                      "modelGuid": "22222222-2222-2222-2222-222222222222",
                      "revitYear": 2024
                    }
                  ]
                }
                """
            );

            var manifest = ParameterCollectionBatchManifest.LoadFromFile(manifestPath);
            var entry = manifest.Models.Single();
            var spec = entry.ResolveSpec(manifest.Engine);
            var options = entry.ToOptions(manifest, spec.DesignAutomationEngine);

            Assert.Multiple(() => {
                Assert.That(entry.RevitYear, Is.EqualTo(2024));
                Assert.That(spec.DesignAutomationEngine, Is.EqualTo("Autodesk.Revit+2024"));
                Assert.That(options.Engine, Is.EqualTo("Autodesk.Revit+2024"));
            });
        } finally {
            if (File.Exists(manifestPath))
                File.Delete(manifestPath);
        }
    }

    [Test]
    public void Schedule_collection_batch_manifest_rejects_conflicting_year_and_engine() {
        var manifestPath = Path.Combine(Path.GetTempPath(), $"pe-da-schedule-conflict-{Guid.NewGuid():N}.json");

        try {
            File.WriteAllText(
                manifestPath,
                """
                {
                  "engine": "Autodesk.Revit+2025",
                  "models": [
                    {
                      "region": "US",
                      "projectGuid": "11111111-1111-1111-1111-111111111111",
                      "modelGuid": "22222222-2222-2222-2222-222222222222",
                      "revitYear": 2024
                    }
                  ]
                }
                """
            );

            Assert.That(
                () => ScheduleCollectionBatchManifest.LoadFromFile(manifestPath),
                Throws.InstanceOf<InvalidDataException>()
            );
        } finally {
            if (File.Exists(manifestPath))
                File.Delete(manifestPath);
        }
    }

    [Test]
    public void Automation_job_report_parser_classifies_title_mismatch() {
        var parser = new AutomationJobReportParser();
        var parsed = parser.Parse(
            """
            PE_AUTOMATION_JOB DOCUMENT_OPENED {"title":"Correct Model","expectedTitleMatched":false}
            PE_AUTOMATION_JOB JOB_FAIL_TITLE_MISMATCH {"jobType":"ScheduleCollection","documentTitle":"Correct Model","expectedTitle":"Expected Model","message":"Opened document title 'Correct Model' did not match expected title 'Expected Model'."}
            """
        );

        Assert.Multiple(() => {
            Assert.That(parsed.Classification, Is.EqualTo(nameof(ProbeAccessClassification.ExpectedTitleMismatch)));
            Assert.That(parsed.DocumentTitle, Is.EqualTo("Correct Model"));
        });
    }

    [Test]
    public void Data_management_versions_parse_revit_project_version() {
        var version = new VersionData {
            Id = "version-1",
            Attributes = new VersionAttributes {
                Name = "Model.rvt",
                LastModifiedTime = new DateTime(2026, 4, 23, 12, 0, 0, DateTimeKind.Utc),
                Extension = new VersionExtensionWithSchemaLink {
                    Type = "versions:autodesk.bim360:C4RModel",
                    Data = new Dictionary<string, object> {
                        ["projectGuid"] = "11111111-1111-1111-1111-111111111111",
                        ["modelGuid"] = "22222222-2222-2222-2222-222222222222",
                        ["revitProjectVersion"] = 2024,
                        ["isCompositeDesign"] = false,
                        ["compositeParentFile"] = "Model.rvt"
                    }
                }
            },
            Relationships = new VersionDataRelationships {
                Storage = new VersionDataRelationshipsStorage {
                    Data = new JsonApiTypeId { Id = "urn:adsk.objects:os.object:wip.dm.prod/model.rvt" },
                    Meta = new JsonApiMetaLink {
                        Link = new JsonApiLink {
                            Href = "https://developer.api.autodesk.com/oss/v2/buckets/wip.dm.prod/objects/model.rvt?scopes=example"
                        }
                    }
                }
            }
        };

        var entry = DataManagementApiClient.ReadVersionEntry(version);

        Assert.That(entry.RevitProjectVersion, Is.EqualTo(2024));
        Assert.That(entry.StorageId, Does.Contain("wip.dm.prod/model.rvt"));
        Assert.That(entry.StorageDownloadUrl, Does.Contain("/oss/v2/buckets/wip.dm.prod/objects/model.rvt"));
    }

    [Test]
    public void Automation_receipt_round_trips_new_route_fields() {
        var receiptPath = Path.Combine(Path.GetTempPath(), $"pe-da-receipt-{Guid.NewGuid():N}.json");

        try {
            File.WriteAllText(
                receiptPath,
                """
                {
                  "hub": "Positive Energy",
                  "entries": [
                    {
                      "project": "PE 2023 Projects",
                      "modelPath": "Project Files/Spring St/MEP_WittArchitecture_SpringSt_R23",
                      "processingMode": "transient-local-upgrade",
                      "sourceRevitYear": 2023,
                      "executionRevitYear": 2024,
                      "yearResolutionSource": "manifest-hint",
                      "stagedInputKind": "rvt",
                      "fallbackReason": "legacy"
                    }
                  ]
                }
                """
            );

            var receipt = AutomationRunReceipt.LoadFromFile(receiptPath);
            var entry = receipt.Entries.Single();
            Assert.Multiple(() => {
                Assert.That(entry.ProcessingMode, Is.EqualTo(AutomationProcessingMode.TransientLocalUpgrade));
                Assert.That(entry.SourceRevitYear, Is.EqualTo(2023));
                Assert.That(entry.ExecutionRevitYear, Is.EqualTo(2024));
                Assert.That(entry.YearResolutionSource, Is.EqualTo(AutomationManifestYearResolutionSource.ManifestHint));
                Assert.That(entry.StagedInputKind, Is.EqualTo(AutomationStagedInputKind.Rvt));
            });
        } finally {
            if (File.Exists(receiptPath))
                File.Delete(receiptPath);
        }
    }

    [Test]
    public void Revit_automation_shell_definitions_include_optional_input_model_parameter() {
        var settings = RevitAutomationSettings.Load("test-client");
        var shellIds = RevitAutomationShellDefinitions.ForYear(settings, 2024);
        var spec = RevitAutomationShellDefinitions.CreateActivitySpec(shellIds, "Autodesk.Revit+2024");

        Assert.Multiple(() => {
            Assert.That(spec.Parameters.ContainsKey("inputModel"), Is.True);
            Assert.That(spec.Parameters["inputModel"].Required, Is.False);
            Assert.That(spec.Parameters["inputModel"].LocalName, Is.EqualTo(RevitAutomationShellDefinitions.InputModelLocalName));
        });
    }

    [Test]
    public void Schedule_audit_manifest_rejects_empty_model_list() {
        var manifestPath = Path.Combine(Path.GetTempPath(), $"pe-da-empty-audit-{Guid.NewGuid():N}.json");

        try {
            File.WriteAllText(
                manifestPath,
                """
                {
                  "hub": "Positive Energy",
                  "models": []
                }
                """
            );

            Assert.That(
                () => ScheduleAuditManifest.LoadFromFile(manifestPath),
                Throws.InstanceOf<InvalidDataException>()
                    .With.Message.Contains("at least one model")
            );
        } finally {
            if (File.Exists(manifestPath))
                File.Delete(manifestPath);
        }
    }

    [Test]
    public void Automation_parameter_specs_serialize_with_design_automation_contract_casing() {
        var settings = RevitAutomationSettings.Load("test-client");
        var shellIds = RevitAutomationShellDefinitions.ForYear(settings, 2024);
        var spec = RevitAutomationShellDefinitions.CreateActivitySpec(shellIds, "Autodesk.Revit+2024");
        var json = JObject.Parse(Newtonsoft.Json.JsonConvert.SerializeObject(spec.Parameters));
        var inputModel = json["inputModel"]!;

        Assert.Multiple(() => {
            Assert.That(inputModel["verb"]?.Value<string>(), Is.EqualTo("get"));
            Assert.That(inputModel["localName"]?.Value<string>(), Is.EqualTo(RevitAutomationShellDefinitions.InputModelLocalName));
            Assert.That(inputModel["required"]?.Value<bool>(), Is.False);
            Assert.That(inputModel["Verb"], Is.Null);
            Assert.That(inputModel["LocalName"], Is.Null);
        });
    }

    [Test]
    public void Object_storage_urn_round_trips_encoded_object_keys() {
        const string bucketKey = "wip.dm.prod";
        const string objectKey = "folder with spaces/model one.rvt";
        var urn = ObjectStorageApiClient.BuildObjectUrn(bucketKey, objectKey);
        var parsed = ObjectStorageApiClient.ParseObjectUrn(urn);

        Assert.Multiple(() => {
            Assert.That(urn, Does.Contain("folder%20with%20spaces%2Fmodel%20one.rvt"));
            Assert.That(parsed.BucketKey, Is.EqualTo(bucketKey));
            Assert.That(parsed.ObjectKey, Is.EqualTo(objectKey));
            Assert.That(ObjectStorageApiClient.EncodeObjectKeyForSdk(parsed.ObjectKey), Is.EqualTo("folder%20with%20spaces%2Fmodel%20one.rvt"));
        });
    }

    [Test]
    public void Design_automation_get_arguments_use_oss_urn_and_bearer_header() {
        var argument = DesignAutomationWorkItemArguments.BuildObjectGetArgument(
            "pe-tools-test",
            "inputs/model.rvt",
            "artifact-token"
        );

        Assert.Multiple(() => {
            Assert.That(argument["verb"], Is.EqualTo("get"));
            Assert.That(argument["url"], Is.EqualTo("urn:adsk.objects:os.object:pe-tools-test/inputs%2Fmodel.rvt"));
            var headers = (IReadOnlyDictionary<string, string>)argument["headers"];
            Assert.That(headers["Authorization"], Is.EqualTo("Bearer artifact-token"));
        });
    }

    [Test]
    public void Automation_run_orchestrator_builds_shared_artifact_keys() {
        var parameterKey = AutomationRunOrchestrator.BuildArtifactObjectKey(
            AutomationJobType.ParameterCollection,
            "us",
            "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
            "11111111-2222-3333-4444-555555555555",
            "run-1"
        );
        var scheduleKey = AutomationRunOrchestrator.BuildArtifactObjectKey(
            AutomationJobType.ScheduleCollection,
            "emea",
            "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
            "11111111-2222-3333-4444-555555555555",
            "run-2"
        );

        Assert.Multiple(() => {
            Assert.That(parameterKey, Does.StartWith("parameter-collections/"));
            Assert.That(parameterKey, Does.EndWith("/US/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/11111111-2222-3333-4444-555555555555/run-1.json"));
            Assert.That(scheduleKey, Does.StartWith("schedule-collections/"));
            Assert.That(scheduleKey, Does.EndWith("/EMEA/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/11111111-2222-3333-4444-555555555555/run-2.json"));
        });
    }

    [Test]
    public void Automation_run_orchestrator_builds_da_arguments_with_optional_staged_input() {
        var input = new AutomationJobInput {
            JobType = AutomationJobType.ScheduleCollection,
            SourceKind = AutomationDocumentSourceKind.LocalFile,
            Engine = "Autodesk.Revit+2024",
            LocalModelPath = RevitAutomationShellDefinitions.InputModelLocalName,
            RunId = Guid.NewGuid().ToString("D"),
            ExpectedTitle = "Model",
            ScheduleCollection = ScheduleCollectionDefaults.CreateDefaultRequest()
        };
        var inputModel = DesignAutomationWorkItemArguments.BuildObjectGetArgument(
            "pe-tools-test",
            "inputs/model.rvt",
            "artifact-token"
        );

        var arguments = AutomationRunOrchestrator.BuildWorkItemArguments(
            input,
            "pe-tools-test",
            "results/result.json",
            "artifact-token",
            "user-token",
            inputModel
        );

        Assert.Multiple(() => {
            Assert.That(arguments["adsk3LeggedToken"], Is.EqualTo("user-token"));
            var resultJson = (IReadOnlyDictionary<string, object>)arguments["resultJson"];
            Assert.That(resultJson["url"], Is.EqualTo("urn:adsk.objects:os.object:pe-tools-test/results%2Fresult.json"));
            var stagedInput = (IReadOnlyDictionary<string, object>)arguments["inputModel"];
            Assert.That(stagedInput["url"], Is.EqualTo("urn:adsk.objects:os.object:pe-tools-test/inputs%2Fmodel.rvt"));
            var inputParams = (IReadOnlyDictionary<string, object>)arguments["inputParams"];
            Assert.That(inputParams["url"].ToString(), Does.StartWith("data:application/json,"));
        });
    }

    [Test]
    public async Task Automation_model_staging_detects_zip_as_unsupported_package() {
        var tempPath = Path.Combine(Path.GetTempPath(), $"pe-da-input-{Guid.NewGuid():N}.zip");

        try {
            await File.WriteAllBytesAsync(tempPath, [0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);
            var kind = await AutomationModelStagingService.DetectStagedInputKindAsync(
                tempPath,
                new DataManagementVersionEntry(
                    "version-1",
                    "Model.rvt",
                    "rvt",
                    "application/vnd.autodesk.r360",
                    "versions:autodesk.bim360:C4RModel",
                    DateTimeOffset.UtcNow,
                    null,
                    null,
                    2023,
                    true,
                    "Model.rvt",
                    null,
                    null
                ),
                CancellationToken.None
            );

            Assert.That(kind, Is.EqualTo(AutomationStagedInputKind.UnsupportedPackage));
        } finally {
            if (File.Exists(tempPath))
                File.Delete(tempPath);
        }
    }
}
