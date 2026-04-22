using Autodesk.Revit.DB.Structure;
using Pe.Revit.DocumentData.Schedules.Collect;
using ContractScheduleCatalogRequest = Pe.Shared.RevitData.Schedules.ScheduleCatalogRequest;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ScheduleCollectionCollectorTests {
    [Test]
    public void Schedule_catalog_collector_filters_by_custom_parameter_and_reports_visible_counts(
        UIApplication uiApplication
    ) {
        const string familyName = "_PE_DA_MechEquip";
        const string scheduleName = "Mechanical Equipment Audit";

        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Schedule_catalog_collector_filters_by_custom_parameter_and_reports_visible_counts)
        );
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_MechanicalEquipment,
            familyName
        );

        try {
            using (var transaction = new Transaction(familyDocument, "Seed mechanical equipment family")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Primary");
                _ = transaction.Commit();
            }

            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                outputDirectory,
                "mechanical-equipment"
            );
            var loadedFamily =
                RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var schedule = CreateScheduleWithPlacedFamily(projectDocument, loadedFamily!, scheduleName, "Family");
            BindAndSetScheduleDiscipline(projectDocument, schedule, "Mechanical");

            var data = ScheduleCatalogCollector.Collect(
                projectDocument,
                new ContractScheduleCatalogRequest {
                    CustomParameterFilters = [
                        new ScheduleCustomParameterFilter(
                            "Discipline",
                            "Mechanical",
                            ScheduleCustomParameterMatchKind.Equals
                        )
                    ]
                }
            );

            var entry = data.Entries.SingleOrDefault(item =>
                string.Equals(item.Name, scheduleName, StringComparison.Ordinal));
            Assert.Multiple(() => {
                Assert.That(entry, Is.Not.Null);
                Assert.That(entry!.VisibleFamilyCount, Is.EqualTo(1));
                Assert.That(entry.VisibleInstanceCount, Is.EqualTo(1));
                Assert.That(entry.VisibleBodyRowCount, Is.GreaterThan(0));
                Assert.That(entry.VisibleFamilies.Select(item => item.FamilyName), Is.EqualTo(new[] { familyName }));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Schedule_query_collector_adds_synthetic_families_cell_for_explicit_family_field(
        UIApplication uiApplication
    ) {
        const string familyName = "_PE_DA_MechEquip";
        const string scheduleName = "Mechanical Equipment With Family";

        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Schedule_query_collector_adds_synthetic_families_cell_for_explicit_family_field)
        );
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_MechanicalEquipment,
            familyName
        );

        try {
            using (var transaction = new Transaction(familyDocument, "Seed mechanical equipment family")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Primary");
                _ = transaction.Commit();
            }

            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                outputDirectory,
                "mechanical-equipment-family-field"
            );
            var loadedFamily =
                RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var schedule = CreateScheduleWithPlacedFamily(projectDocument, loadedFamily!, scheduleName, "Family");
            var data = ScheduleQueryCollector.Collect(
                projectDocument,
                new ScheduleQuery { Kind = ScheduleQueryKind.ScheduleReferences, ScheduleIds = [schedule.Id.Value()] }
            );

            var entry = data.Entries.Single();
            var familiesColumn = entry.Columns.Single(column =>
                string.Equals(column.Key, "synthetic:families", StringComparison.Ordinal));
            var familiesColumnIndex = entry.Columns.IndexOf(familiesColumn);
            var firstRow = entry.Rows.First();
            var referencedInstances = entry.VisibleInstances
                .Where(instance => firstRow.InstanceIds.Contains(instance.InstanceId))
                .ToList();

            Assert.Multiple(() => {
                Assert.That(entry.VisibleFamilyCount, Is.EqualTo(1));
                Assert.That(entry.VisibleInstanceCount, Is.EqualTo(1));
                Assert.That(entry.VisibleFamilies.Select(item => item.FamilyName), Is.EqualTo(new[] { familyName }));
                Assert.That(entry.Columns.Count, Is.EqualTo(firstRow.Values.Count));
                Assert.That(familiesColumn.HeaderText, Is.EqualTo("Families"));
                Assert.That(firstRow.Values[familiesColumnIndex], Is.EqualTo(familyName));
                Assert.That(firstRow.InstanceIds.Count, Is.EqualTo(1));
                Assert.That(referencedInstances.Select(item => item.FamilyName), Is.EqualTo(new[] { familyName }));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Schedule_query_collector_leaves_synthetic_families_blank_and_warns_without_family_field(
        UIApplication uiApplication
    ) {
        const string familyName = "_PE_DA_MechEquip";
        const string scheduleName = "Mechanical Equipment Without Family";

        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Schedule_query_collector_leaves_synthetic_families_blank_and_warns_without_family_field)
        );
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_MechanicalEquipment,
            familyName
        );

        try {
            using (var transaction = new Transaction(familyDocument, "Seed mechanical equipment family")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Primary");
                _ = transaction.Commit();
            }

            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                outputDirectory,
                "mechanical-equipment-no-family-field"
            );
            var loadedFamily =
                RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var schedule = CreateScheduleWithPlacedFamily(projectDocument, loadedFamily!, scheduleName, "Type");
            var data = ScheduleQueryCollector.Collect(
                projectDocument,
                new ScheduleQuery { Kind = ScheduleQueryKind.ScheduleReferences, ScheduleIds = [schedule.Id.Value()] }
            );

            var entry = data.Entries.Single();
            var familiesColumn = entry.Columns.Single(column =>
                string.Equals(column.Key, "synthetic:families", StringComparison.Ordinal));
            var familiesColumnIndex = entry.Columns.IndexOf(familiesColumn);
            var firstRow = entry.Rows.First();

            Assert.Multiple(() => {
                Assert.That(firstRow.Values[familiesColumnIndex], Is.Empty);
                Assert.That(firstRow.InstanceIds, Is.Empty);
                Assert.That(
                    data.Issues.Any(issue => string.Equals(issue.Code, "ScheduleRowInstanceReferencesUnavailable",
                        StringComparison.Ordinal)),
                    Is.True
                );
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    private static ViewSchedule CreateScheduleWithPlacedFamily(
        Document projectDocument,
        Family loadedFamily,
        string scheduleName,
        string fieldName
    ) {
        ViewSchedule? schedule;

        using (var transaction = new Transaction(projectDocument, $"Create schedule '{scheduleName}'")) {
            _ = transaction.Start();
            var symbolId = loadedFamily.GetFamilySymbolIds().First();
            var symbol = (FamilySymbol)projectDocument.GetElement(symbolId);
            if (!symbol.IsActive)
                symbol.Activate();

            projectDocument.Regenerate();

            var level = new FilteredElementCollector(projectDocument)
                .OfClass(typeof(Level))
                .Cast<Level>()
                .OrderBy(level => level.Elevation)
                .First();
            _ = projectDocument.Create.NewFamilyInstance(XYZ.Zero, symbol, level, StructuralType.NonStructural);

            schedule = ViewSchedule.CreateSchedule(projectDocument,
                new ElementId(BuiltInCategory.OST_MechanicalEquipment));
            schedule.Name = scheduleName;
            schedule.Definition.IsItemized = true;

            var schedulableField = schedule.Definition.GetSchedulableFields()
                .First(field =>
                    string.Equals(field.GetName(projectDocument), fieldName, StringComparison.OrdinalIgnoreCase));
            _ = schedule.Definition.AddField(schedulableField);

            _ = transaction.Commit();
        }

        projectDocument.Regenerate();
        return schedule!;
    }

    private static void BindAndSetScheduleDiscipline(
        Document projectDocument,
        ViewSchedule schedule,
        string disciplineValue
    ) {
        var sharedDefinition = RevitFamilyFixtureHarness.CreateSharedParameterDefinition(
            projectDocument,
            new RevitFamilyFixtureHarness.SharedDefinitionSpec(
                "Discipline",
                SpecTypeId.String.Text,
                "Schedules",
                "Schedule discipline test binding.",
                Guid.NewGuid()
            )
        );
        _ = RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
            projectDocument,
            sharedDefinition,
            true,
            GroupTypeId.IdentityData,
            BuiltInCategory.OST_Views
        );

        using var transaction = new Transaction(projectDocument, "Set schedule discipline");
        _ = transaction.Start();
        var parameter = schedule.LookupParameter("Discipline")
                        ?? throw new InvalidOperationException("Discipline parameter was not bound to the schedule.");
        _ = parameter.Set(disciplineValue);
        _ = transaction.Commit();
        projectDocument.Regenerate();
    }
}
