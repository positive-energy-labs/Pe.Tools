using Pe.Revit.DocumentData.ParameterLinks;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Global.Services.ParameterLinks;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ParameterLinksBehaviorTests {
    [Test]
    public void Electrical_template_probe(UIApplication uiApplication) {
        var template = Directory.GetFiles(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                    $"Autodesk\\RVT {uiApplication.Application.VersionNumber}\\Templates"),
                "Electrical-Default.rte",
                SearchOption.AllDirectories)
            .First();
        var document = uiApplication.Application.NewProjectDocument(template);
        try {
            var lines = new FilteredElementCollector(document)
                .OfClass(typeof(FamilySymbol))
                .Cast<FamilySymbol>()
                .Where(symbol => symbol.Category?.Id.Value() is
                    (long)BuiltInCategory.OST_ElectricalEquipment or
                    (long)BuiltInCategory.OST_ElectricalFixtures)
                .Select(symbol => $"SYMBOL {symbol.Category?.Name} | {symbol.FamilyName} | {symbol.Name}")
                .Concat(new FilteredElementCollector(document)
                    .OfClass(typeof(MEPSystemType))
                    .Select(systemType => $"SYSTEM {systemType.GetType().Name} | {systemType.Name}"));
            Assert.Fail(string.Join(Environment.NewLine, lines));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    [Test]
    public void Empty_and_malformed_profiles_fail_closed_as_structured_issues() {
        var empty = ParameterLinksEngine.Validate(new ParameterLinkProfile());
        var malformed = ParameterLinksEngine.Validate(new ParameterLinkProfile {
            Definitions = [new ParameterLinkDefinition {
                Id = "broken",
                SourceCategoryId = (int)BuiltInCategory.OST_ProjectInformation,
                SourceParameter = null!,
                Relationship = (ParameterLinkRelationship)999,
                TargetParameter = null!,
                Reducer = (ParameterLinkReducer)999
            }],
            Assignments = [new ParameterLinkAssignment {
                Id = "broken-assignment",
                DefinitionId = "broken"
            }]
        });

        Assert.Multiple(() => {
            Assert.That(empty.Select(issue => issue.Code), Does.Contain("DefinitionsRequired"));
            Assert.That(malformed.Select(issue => issue.Code), Does.Contain("SourceParameterRequired"));
            Assert.That(malformed.Select(issue => issue.Code), Does.Contain("TargetParameterRequired"));
            Assert.That(malformed.Select(issue => issue.Code), Does.Contain("RelationshipUnsupported"));
            Assert.That(malformed.Select(issue => issue.Code), Does.Contain("ReducerUnsupported"));
        });
    }

    [Test]
    public void Same_storage_different_specs_are_rejected(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var sourceGuid = Guid.NewGuid();
        var targetGuid = Guid.NewGuid();
        try {
            BindParameter(document, "_PE_ParameterLinks_Integer", sourceGuid, SpecTypeId.Int.Integer);
            BindParameter(document, "_PE_ParameterLinks_YesNo", targetGuid, SpecTypeId.Boolean.YesNo);
            using (var transaction = new Transaction(document, "Seed incompatible parameter-link values")) {
                _ = transaction.Start();
                Assert.That(document.ProjectInformation.get_Parameter(sourceGuid).Set(7), Is.True);
                Assert.That(document.ProjectInformation.get_Parameter(targetGuid).Set(0), Is.True);
                _ = transaction.Commit();
            }

            var evaluation = ParameterLinksEngine.Evaluate(document, new ParameterLinkProfile {
                Definitions = [new ParameterLinkDefinition {
                    Id = "integer-to-yes-no",
                    SourceCategoryId = (int)BuiltInCategory.OST_ProjectInformation,
                    SourceParameter = ParameterReference.FromSharedGuid(sourceGuid.ToString("D")),
                    Relationship = ParameterLinkRelationship.SameElement,
                    TargetParameter = ParameterReference.FromSharedGuid(targetGuid.ToString("D")),
                    Reducer = ParameterLinkReducer.First
                }],
                Assignments = [new ParameterLinkAssignment {
                    Id = "all-project-info",
                    DefinitionId = "integer-to-yes-no"
                }]
            });

            Assert.Multiple(() => {
                Assert.That(evaluation.Issues.Select(issue => issue.Code), Does.Contain("IncompatibleParameters"));
                Assert.That(evaluation.Writes, Is.Empty);
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    [Test]
    public void Updater_rolls_back_all_link_writes_when_a_later_write_fails(
        UIApplication uiApplication
    ) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var sourceGuid = Guid.NewGuid();
        var targetGuid = Guid.NewGuid();
        ParameterLinksUpdater? updater = null;

        try {
            BindParameter(document, "_PE_ParameterLinks_AtomicSource", sourceGuid, SpecTypeId.Number);
            BindParameter(document, "_PE_ParameterLinks_AtomicTarget", targetGuid, SpecTypeId.Number);

            ViewSheet firstSheet;
            ViewSheet secondSheet;
            using (var transaction = new Transaction(document, "Seed updater rollback fixture")) {
                _ = transaction.Start();
                Assert.That(document.ProjectInformation.get_Parameter(sourceGuid).Set(1), Is.True);
                Assert.That(document.ProjectInformation.get_Parameter(targetGuid).Set(0), Is.True);
                firstSheet = ViewSheet.Create(document, ElementId.InvalidElementId);
                secondSheet = ViewSheet.Create(document, ElementId.InvalidElementId);
                firstSheet.SheetNumber = "PE-A100";
                secondSheet.SheetNumber = "PE-A200";
                secondSheet.Name = "Initial source";
                _ = transaction.Commit();
            }

            var sheetName = secondSheet.get_Parameter(BuiltInParameter.SHEET_NAME);
            var sheetNumber = secondSheet.get_Parameter(BuiltInParameter.SHEET_NUMBER);
            Assert.That(sheetName, Is.Not.Null);
            Assert.That(sheetNumber, Is.Not.Null);
            var profile = new ParameterLinkProfile {
                Definitions = [
                    new ParameterLinkDefinition {
                        Id = "first-successful-write",
                        SourceCategoryId = (int)BuiltInCategory.OST_ProjectInformation,
                        SourceParameter = ParameterReference.FromSharedGuid(sourceGuid.ToString("D")),
                        Relationship = ParameterLinkRelationship.SameElement,
                        TargetParameter = ParameterReference.FromSharedGuid(targetGuid.ToString("D"))
                    },
                    new ParameterLinkDefinition {
                        Id = "later-rejected-write",
                        SourceCategoryId = (int)BuiltInCategory.OST_Sheets,
                        SourceParameter = ParameterReference.FromIdentity(
                            ParameterIdentityFactory.FromParameter(sheetName!)),
                        Relationship = ParameterLinkRelationship.SameElement,
                        TargetParameter = ParameterReference.FromIdentity(
                            ParameterIdentityFactory.FromParameter(sheetNumber!))
                    }
                ],
                Assignments = [
                    new ParameterLinkAssignment {
                        Id = "project-info",
                        DefinitionId = "first-successful-write",
                        SourceElementUniqueIds = [document.ProjectInformation.UniqueId]
                    },
                    new ParameterLinkAssignment {
                        Id = "second-sheet",
                        DefinitionId = "later-rejected-write",
                        SourceElementUniqueIds = [secondSheet.UniqueId]
                    }
                ]
            };

            updater = new ParameterLinksUpdater(uiApplication.ActiveAddInId, _ => profile, Guid.NewGuid());
            UpdaterRegistry.RegisterUpdater(updater, true);
            UpdaterRegistry.AddTrigger(
                updater.GetUpdaterId(),
                document,
                new ElementCategoryFilter(BuiltInCategory.OST_ProjectInformation),
                Element.GetChangeTypeAny());
            UpdaterRegistry.AddTrigger(
                updater.GetUpdaterId(),
                document,
                new ElementCategoryFilter(BuiltInCategory.OST_Sheets),
                Element.GetChangeTypeAny());

            using (var transaction = new Transaction(document, "Trigger atomic parameter links")) {
                _ = transaction.Start();
                Assert.That(document.ProjectInformation.get_Parameter(sourceGuid).Set(99), Is.True);
                secondSheet.Name = firstSheet.SheetNumber;
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }

            Assert.Multiple(() => {
                Assert.That(document.ProjectInformation.get_Parameter(sourceGuid).AsDouble(), Is.EqualTo(99));
                Assert.That(document.ProjectInformation.get_Parameter(targetGuid).AsDouble(), Is.Zero);
                Assert.That(secondSheet.Name, Is.EqualTo(firstSheet.SheetNumber));
                Assert.That(secondSheet.SheetNumber, Is.EqualTo("PE-A200"));
            });
        } finally {
            if (updater != null && UpdaterRegistry.IsUpdaterRegistered(updater.GetUpdaterId()))
                UpdaterRegistry.UnregisterUpdater(updater.GetUpdaterId());
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    [Test]
    public void Stored_profile_and_same_element_reconcile_round_trip_in_project(
        UIApplication uiApplication
    ) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var sourceGuid = Guid.NewGuid();
        var targetGuid = Guid.NewGuid();
        ParameterLinksUpdater? updater = null;

        try {
            BindParameter(document, "_PE_ParameterLinks_Source", sourceGuid, SpecTypeId.Number);
            BindParameter(document, "_PE_ParameterLinks_Target", targetGuid, SpecTypeId.Number);

            using (var transaction = new Transaction(document, "Seed parameter-link values")) {
                _ = transaction.Start();
                Assert.That(document.ProjectInformation.get_Parameter(sourceGuid).Set(42.5), Is.True);
                Assert.That(document.ProjectInformation.get_Parameter(targetGuid).Set(0), Is.True);
                _ = transaction.Commit();
            }

            var profile = new ParameterLinkProfile {
                Definitions = [new ParameterLinkDefinition {
                    Id = "project-info-number",
                    SourceCategoryId = (int)BuiltInCategory.OST_ProjectInformation,
                    SourceParameter = ParameterReference.FromSharedGuid(sourceGuid.ToString("D")),
                    Relationship = ParameterLinkRelationship.SameElement,
                    TargetParameter = ParameterReference.FromSharedGuid(targetGuid.ToString("D")),
                    Reducer = ParameterLinkReducer.First
                }],
                Assignments = [new ParameterLinkAssignment {
                    Id = "all-project-info",
                    DefinitionId = "project-info-number"
                }]
            };

            var storage = new ParameterLinksProfileStorage();
            using (var transaction = new Transaction(document, "Store parameter-links profile")) {
                _ = transaction.Start();
                Assert.That(storage.Write(document, profile), Is.True);
                _ = transaction.Commit();
            }

            var read = storage.Read(document);
            var preview = ParameterLinksEngine.Evaluate(document, read.Profile!);
            ParameterLinkEvaluation appliedEvaluation;
            int applied;
            using (var transaction = new Transaction(document, "Reconcile parameter links")) {
                _ = transaction.Start();
                (appliedEvaluation, applied) = ParameterLinksEngine.Reconcile(document, read.Profile!);
                _ = transaction.Commit();
            }

            using (var transaction = new Transaction(document, "Seed blocked reconcile")) {
                _ = transaction.Start();
                Assert.That(document.ProjectInformation.get_Parameter(sourceGuid).Set(51.5), Is.True);
                Assert.That(document.ProjectInformation.get_Parameter(targetGuid).Set(0), Is.True);
                _ = transaction.Commit();
            }

            var projectName = document.ProjectInformation.get_Parameter(BuiltInParameter.PROJECT_NAME);
            Assert.That(projectName, Is.Not.Null);
            var blockedProfile = profile with {
                Definitions = [..profile.Definitions, new ParameterLinkDefinition {
                    Id = "incompatible-project-name",
                    SourceCategoryId = (int)BuiltInCategory.OST_ProjectInformation,
                    SourceParameter = ParameterReference.FromSharedGuid(sourceGuid.ToString("D")),
                    Relationship = ParameterLinkRelationship.SameElement,
                    TargetParameter = ParameterReference.FromIdentity(
                        ParameterIdentityFactory.FromParameter(projectName!)),
                    Reducer = ParameterLinkReducer.First
                }],
                Assignments = [..profile.Assignments, new ParameterLinkAssignment {
                    Id = "blocked-project-name",
                    DefinitionId = "incompatible-project-name"
                }]
            };
            ParameterLinkEvaluation blockedEvaluation;
            int blockedApplied;
            using (var transaction = new Transaction(document, "Reject partial reconcile")) {
                _ = transaction.Start();
                (blockedEvaluation, blockedApplied) = ParameterLinksEngine.Reconcile(document, blockedProfile);
                _ = transaction.Commit();
            }

            Assert.Multiple(() => {
                Assert.That(blockedEvaluation.Issues.Select(issue => issue.Code),
                    Does.Contain("IncompatibleParameters"));
                Assert.That(blockedApplied, Is.Zero);
                Assert.That(document.ProjectInformation.get_Parameter(targetGuid).AsDouble(), Is.Zero);
            });

            updater = new ParameterLinksUpdater(uiApplication.ActiveAddInId, _ => profile, Guid.NewGuid());
            UpdaterRegistry.RegisterUpdater(updater, true);
            UpdaterRegistry.AddTrigger(
                updater.GetUpdaterId(),
                document,
                new ElementCategoryFilter(BuiltInCategory.OST_ProjectInformation),
                Element.GetChangeTypeAny());
            using (var transaction = new Transaction(document, "Change linked source")) {
                _ = transaction.Start();
                Assert.That(document.ProjectInformation.get_Parameter(sourceGuid).Set(73.25), Is.True);
                _ = transaction.Commit();
            }

            using (var transaction = new Transaction(document, "Override linked target")) {
                _ = transaction.Start();
                Assert.That(document.ProjectInformation.get_Parameter(targetGuid).Set(11), Is.True);
                _ = transaction.Commit();
            }

            var profileParameter = document.ProjectInformation.get_Parameter(
                ParameterLinksProfileStorage.ProfileParameterGuid);
            Assert.Multiple(() => {
                Assert.That(read.Error, Is.Null);
                Assert.That(read.HasStoredProfile, Is.True);
                Assert.That(read.Profile?.Definitions, Has.Count.EqualTo(1));
                Assert.That(profileParameter, Is.Not.Null);
                Assert.That(profileParameter.IsShared, Is.True);
                Assert.That(profileParameter.UserModifiable, Is.False);
                Assert.That(preview.ChangedWriteCount, Is.EqualTo(1));
                Assert.That(preview.Issues, Is.Empty);
                Assert.That(applied, Is.EqualTo(1));
                Assert.That(appliedEvaluation.Issues, Is.Empty);
                Assert.That(document.ProjectInformation.get_Parameter(targetGuid).AsDouble(), Is.EqualTo(73.25));
            });
        } finally {
            if (updater != null && UpdaterRegistry.IsUpdaterRegistered(updater.GetUpdaterId()))
                UpdaterRegistry.UnregisterUpdater(updater.GetUpdaterId());
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    private static void BindParameter(Document document, string name, Guid guid, ForgeTypeId dataType) {
        var definition = RevitFamilyFixtureHarness.CreateSharedParameterDefinition(
            document,
            new RevitFamilyFixtureHarness.SharedDefinitionSpec(
                name,
                dataType,
                "ParameterLinks",
                "Parameter Links behavior fixture.",
                guid));
        var result = RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
            document,
            definition,
            true,
            GroupTypeId.Data,
            BuiltInCategory.OST_ProjectInformation);
        Assert.That(result.BindingSucceeded, Is.True);
    }
}
