using Autodesk.Revit.DB.Structure;
using Pe.Revit.DocumentData.Schedules.Collect;
using Pe.Shared.RevitData;
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
                            ParameterReference.FromName("Discipline"),
                            "Mechanical",
                            ScheduleCustomParameterMatchKind.Equals
                        )
                    ],
                    Projection = new ScheduleCatalogProjection { IncludeVisibleFamilies = true }
                }
            );

            var entry = data.Entries.SingleOrDefault(item =>
                string.Equals(item.Name, scheduleName, StringComparison.Ordinal));
            Assert.Multiple(() => {
                Assert.That(entry, Is.Not.Null);
                Assert.That(entry!.VisibleFamilyCount, Is.EqualTo(1));
                Assert.That(entry.VisibleInstanceCount, Is.EqualTo(1));
                Assert.That(entry.VisibleBodyRowCount, Is.GreaterThan(0));
                Assert.That(entry.VisibleFamilies.Select(item => item.FamilyName), Is.EqualTo(new[] { loadedFamily!.Name }));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Schedule_query_collector_binds_rows_to_subjects_for_explicit_family_field(
        UIApplication uiApplication
    ) {
        const string familyName = "_PE_DA_MechEquip";
        const string scheduleName = "Mechanical Equipment With Family";

        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Schedule_query_collector_binds_rows_to_subjects_for_explicit_family_field)
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
            var firstRow = entry.Rows.First();
            var referencedSubjects = entry.Subjects
                .Where(subject => firstRow.SubjectIds.Contains(subject.SubjectId))
                .ToList();

            Assert.Multiple(() => {
                Assert.That(entry.SubjectCount, Is.EqualTo(1));
                Assert.That(entry.BindingStatus, Is.EqualTo(ScheduleRenderedBindingStatus.Complete));
                Assert.That(entry.Columns.Count, Is.EqualTo(firstRow.Values.Count));
                Assert.That(entry.Columns.Any(column => string.Equals(column.Key, "synthetic:families", StringComparison.Ordinal)), Is.False);
                Assert.That(firstRow.BindingKind, Is.EqualTo(ScheduleRenderedRowBindingKind.SingleSubject));
                Assert.That(firstRow.SubjectIds.Count, Is.EqualTo(1));
                Assert.That(referencedSubjects.Select(item => item.FamilyName), Is.EqualTo(new[] { familyName }));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Schedule_query_collector_binds_rows_to_subjects_without_needing_a_family_column(
        UIApplication uiApplication
    ) {
        const string familyName = "_PE_DA_MechEquip";
        const string scheduleName = "Mechanical Equipment Without Family";

        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Schedule_query_collector_binds_rows_to_subjects_without_needing_a_family_column)
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
            var firstRow = entry.Rows.First();
            var referencedSubjects = entry.Subjects
                .Where(subject => firstRow.SubjectIds.Contains(subject.SubjectId))
                .ToList();

            Assert.Multiple(() => {
                Assert.That(entry.SubjectCount, Is.EqualTo(1));
                Assert.That(entry.BindingStatus, Is.EqualTo(ScheduleRenderedBindingStatus.Complete));
                Assert.That(entry.Columns.Any(column => string.Equals(column.Key, "synthetic:families", StringComparison.Ordinal)), Is.False);
                Assert.That(firstRow.BindingKind, Is.EqualTo(ScheduleRenderedRowBindingKind.SingleSubject));
                Assert.That(firstRow.SubjectIds.Count, Is.EqualTo(1));
                Assert.That(referencedSubjects.Select(item => item.FamilyName), Is.EqualTo(new[] { familyName }));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Schedule_query_collector_binds_rows_when_visible_field_reads_from_type_parameter(
        UIApplication uiApplication
    ) {
        const string familyName = "_PE_DA_MechEquip";
        const string scheduleName = "Mechanical Equipment Type Parameter";
        const string typeMarkValue = "TM-01";

        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Schedule_query_collector_binds_rows_when_visible_field_reads_from_type_parameter)
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
                "mechanical-equipment-type-parameter"
            );
            var loadedFamily =
                RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var schedule = CreateScheduleWithPlacedFamily(projectDocument, loadedFamily!, scheduleName, "Type Mark");
            using (var transaction = new Transaction(projectDocument, "Set type mark")) {
                _ = transaction.Start();
                var symbolId = loadedFamily.GetFamilySymbolIds().First();
                var symbol = (FamilySymbol)projectDocument.GetElement(symbolId);
                var typeMark = symbol.get_Parameter(BuiltInParameter.ALL_MODEL_TYPE_MARK);
                Assert.That(typeMark, Is.Not.Null);
                _ = typeMark!.Set(typeMarkValue);
                _ = transaction.Commit();
            }

            projectDocument.Regenerate();

            var data = ScheduleQueryCollector.Collect(
                projectDocument,
                new ScheduleQuery { Kind = ScheduleQueryKind.ScheduleReferences, ScheduleIds = [schedule.Id.Value()] }
            );

            var entry = data.Entries.Single();
            var firstRow = entry.Rows.First();
            var referencedSubjects = entry.Subjects
                .Where(subject => firstRow.SubjectIds.Contains(subject.SubjectId))
                .ToList();

            Assert.Multiple(() => {
                Assert.That(entry.SubjectCount, Is.EqualTo(1));
                Assert.That(entry.BindingStatus, Is.EqualTo(ScheduleRenderedBindingStatus.Complete));
                Assert.That(firstRow.Values, Does.Contain(typeMarkValue));
                Assert.That(firstRow.BindingKind, Is.EqualTo(ScheduleRenderedRowBindingKind.SingleSubject));
                Assert.That(firstRow.SubjectIds.Count, Is.EqualTo(1));
                Assert.That(referencedSubjects.Select(item => item.FamilyName), Is.EqualTo(new[] { familyName }));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Schedule_query_collector_marks_empty_schedule_as_empty_without_subjects(
        UIApplication uiApplication
    ) {
        const string scheduleName = "Empty Mechanical Equipment Schedule";

        var application = uiApplication.Application;
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);

        try {
            ViewSchedule? schedule;
            using (var transaction = new Transaction(projectDocument, $"Create schedule '{scheduleName}'")) {
                _ = transaction.Start();
                schedule = ViewSchedule.CreateSchedule(projectDocument,
                    new ElementId(BuiltInCategory.OST_MechanicalEquipment));
                schedule.Name = scheduleName;
                schedule.Definition.IsItemized = true;

                var schedulableField = schedule.Definition.GetSchedulableFields()
                    .First(field =>
                        string.Equals(field.GetName(projectDocument), "Mark", StringComparison.OrdinalIgnoreCase));
                _ = schedule.Definition.AddField(schedulableField);

                _ = transaction.Commit();
            }

            projectDocument.Regenerate();

            var data = ScheduleQueryCollector.Collect(
                projectDocument,
                new ScheduleQuery { Kind = ScheduleQueryKind.ScheduleReferences, ScheduleIds = [schedule!.Id.Value()] }
            );

            var entry = data.Entries.Single();
            Assert.Multiple(() => {
                Assert.That(entry.IsEmpty, Is.True);
                Assert.That(entry.BindingStatus, Is.EqualTo(ScheduleRenderedBindingStatus.None));
                Assert.That(entry.NotApplicableRowCount, Is.Zero);
                Assert.That(entry.NonBindableRowCount, Is.Zero);
                Assert.That(entry.BindableRowCount, Is.Zero);
                Assert.That(entry.BoundRowCount, Is.Zero);
                Assert.That(entry.UnboundRowCount, Is.Zero);
                Assert.That(entry.SubjectCount, Is.Zero);
                Assert.That(entry.Rows, Is.Empty);
                Assert.That(entry.Subjects, Is.Empty);
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Schedule_query_projection_proves_family_and_type_is_a_bindable_derived_schedule_field(
        UIApplication uiApplication
    ) {
        const string familyName = "_PE_DA_MechEquip";
        const string typeName = "ProofType";
        const string scheduleName = "Mechanical Equipment Family And Type";

        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Schedule_query_projection_proves_family_and_type_is_a_bindable_derived_schedule_field)
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
                _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, typeName);
                _ = transaction.Commit();
            }

            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                outputDirectory,
                "mechanical-equipment-family-and-type"
            );
            var loadedFamily =
                RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var schedule = CreateScheduleWithPlacedFamily(
                projectDocument,
                loadedFamily!,
                scheduleName,
                "Family and Type",
                typeName
            );
            var data = ScheduleQueryCollector.Collect(
                projectDocument,
                new ScheduleQuery { Kind = ScheduleQueryKind.ScheduleReferences, ScheduleIds = [schedule.Id.Value()] }
            );

            var entry = data.Entries.Single();
            var row = entry.Rows.Single();

            Assert.Multiple(() => {
                Assert.That(row.Values, Does.Contain($"{familyName}: {typeName}"));
                Assert.That(row.BindingKind, Is.EqualTo(ScheduleRenderedRowBindingKind.SingleSubject));
                Assert.That(row.ResolutionStatus, Is.EqualTo(ScheduleRenderedRowSubjectResolutionStatus.Bound));
                Assert.That(row.ResolutionReason, Is.EqualTo(ScheduleRenderedRowSubjectResolutionReason.None));
                Assert.That(row.SubjectIds.Count, Is.EqualTo(1));
                Assert.That(entry.BindingStatus, Is.EqualTo(ScheduleRenderedBindingStatus.Complete));
                Assert.That(entry.BindableRowCount, Is.EqualTo(1));
                Assert.That(entry.BoundRowCount, Is.EqualTo(1));
                Assert.That(entry.UnboundRowCount, Is.Zero);
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Schedule_query_projection_proves_non_itemized_varies_rows_bind_multiple_subjects_while_footers_do_not(
        UIApplication uiApplication
    ) {
        const string familyName = "_PE_DA_MechEquip";
        const string typeName = "GroupedType";
        const string scheduleName = "Mechanical Equipment Grouped Varies Proof";
        const string variesText = "VARIES-PROOF";

        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Schedule_query_projection_proves_non_itemized_varies_rows_bind_multiple_subjects_while_footers_do_not)
        );
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_MechanicalEquipment,
            familyName
        );

        try {
            using (var transaction = new Transaction(familyDocument, "Seed grouped mechanical equipment family")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, typeName);
                _ = transaction.Commit();
            }

            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                outputDirectory,
                "mechanical-equipment-grouped-varies"
            );
            var loadedFamily =
                RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            ViewSchedule? schedule;
            using (var transaction = new Transaction(projectDocument, $"Create schedule '{scheduleName}'")) {
                _ = transaction.Start();
                var symbolId = loadedFamily!.GetFamilySymbolIds().First();
                var symbol = (FamilySymbol)projectDocument.GetElement(symbolId);
                if (!symbol.IsActive)
                    symbol.Activate();

                projectDocument.Regenerate();

                var level = new FilteredElementCollector(projectDocument)
                    .OfClass(typeof(Level))
                    .Cast<Level>()
                    .OrderBy(level => level.Elevation)
                    .First();
                var firstInstance = (FamilyInstance)projectDocument.Create.NewFamilyInstance(
                    XYZ.Zero,
                    symbol,
                    level,
                    StructuralType.NonStructural);
                var secondInstance = (FamilyInstance)projectDocument.Create.NewFamilyInstance(
                    new XYZ(10, 0, 0),
                    symbol,
                    level,
                    StructuralType.NonStructural);
                _ = firstInstance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.Set("MK-01");
                _ = secondInstance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)!.Set("MK-02");

                schedule = ViewSchedule.CreateSchedule(projectDocument,
                    new ElementId(BuiltInCategory.OST_MechanicalEquipment));
                schedule.Name = scheduleName;
                schedule.Definition.IsItemized = false;

                var typeField = AddSchedulableField(schedule, "Type");
                var markField = AddSchedulableField(schedule, "Mark");
                markField.MultipleValuesDisplayType = ScheduleFieldMultipleValuesDisplayType.Custom;
                markField.MultipleValuesCustomText = variesText;
                schedule.Definition.AddSortGroupField(new ScheduleSortGroupField(
                    typeField.FieldId,
                    ScheduleSortOrder.Ascending) { ShowFooter = true });

                _ = transaction.Commit();
            }

            projectDocument.Regenerate();

            var data = ScheduleQueryCollector.Collect(
                projectDocument,
                new ScheduleQuery { Kind = ScheduleQueryKind.ScheduleReferences, ScheduleIds = [schedule!.Id.Value()] }
            );

            var entry = data.Entries.Single();
            var dataRow = entry.Rows.Single(row => row.Kind == ScheduleRenderedRowKind.Data);
            var footerRow = entry.Rows.Single(row => row.Kind == ScheduleRenderedRowKind.GroupFooter);

            Assert.Multiple(() => {
                Assert.That(entry.SubjectCount, Is.EqualTo(2));
                Assert.That(entry.BindingStatus, Is.EqualTo(ScheduleRenderedBindingStatus.Complete));
                Assert.That(entry.NotApplicableRowCount, Is.EqualTo(1));
                Assert.That(entry.NonBindableRowCount, Is.Zero);
                Assert.That(entry.BindableRowCount, Is.EqualTo(1));
                Assert.That(entry.BoundRowCount, Is.EqualTo(1));
                Assert.That(entry.UnboundRowCount, Is.Zero);

                Assert.That(dataRow.Values, Does.Contain(variesText));
                Assert.That(dataRow.BindingKind, Is.EqualTo(ScheduleRenderedRowBindingKind.MultipleSubjects));
                Assert.That(dataRow.ResolutionStatus, Is.EqualTo(ScheduleRenderedRowSubjectResolutionStatus.Bound));
                Assert.That(dataRow.ResolutionReason, Is.EqualTo(ScheduleRenderedRowSubjectResolutionReason.None));
                Assert.That(dataRow.SubjectIds.Count, Is.EqualTo(2));

                Assert.That(footerRow.BindingKind, Is.EqualTo(ScheduleRenderedRowBindingKind.None));
                Assert.That(footerRow.ResolutionStatus, Is.EqualTo(ScheduleRenderedRowSubjectResolutionStatus.NotApplicable));
                Assert.That(footerRow.ResolutionReason,
                    Is.EqualTo(ScheduleRenderedRowSubjectResolutionReason.NonDataRow));
                Assert.That(footerRow.SubjectIds, Is.Empty);
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Schedule_query_projection_proves_numeric_binding_uses_semantic_value_when_schedule_format_hides_unit_symbols(
        UIApplication uiApplication
    ) {
        const string familyName = "_PE_DA_MechEquip";
        const string typeName = "NumericProof";
        const string scheduleName = "Mechanical Equipment Numeric Format Proof";
        const string parameterName = "_PE_Proof_AirFlow";

        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Schedule_query_projection_proves_numeric_binding_uses_semantic_value_when_schedule_format_hides_unit_symbols)
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
                _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, typeName);
                _ = transaction.Commit();
            }

            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                outputDirectory,
                "mechanical-equipment-numeric-proof"
            );
            var loadedFamily =
                RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var sharedDefinition = RevitFamilyFixtureHarness.CreateSharedParameterDefinition(
                projectDocument,
                new RevitFamilyFixtureHarness.SharedDefinitionSpec(
                    parameterName,
                    SpecTypeId.AirFlow,
                    "Schedules",
                    "Schedule numeric proof parameter.",
                    Guid.NewGuid()
                )
            );
            _ = RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
                projectDocument,
                sharedDefinition,
                true,
                GroupTypeId.Data,
                BuiltInCategory.OST_MechanicalEquipment
            );

            ViewSchedule? schedule;
            FamilyInstance? instance;
            using (var transaction = new Transaction(projectDocument, $"Create schedule '{scheduleName}'")) {
                _ = transaction.Start();
                var symbolId = loadedFamily!.GetFamilySymbolIds().First();
                var symbol = (FamilySymbol)projectDocument.GetElement(symbolId);
                if (!symbol.IsActive)
                    symbol.Activate();

                projectDocument.Regenerate();

                var level = new FilteredElementCollector(projectDocument)
                    .OfClass(typeof(Level))
                    .Cast<Level>()
                    .OrderBy(level => level.Elevation)
                    .First();
                instance = (FamilyInstance)projectDocument.Create.NewFamilyInstance(
                    XYZ.Zero,
                    symbol,
                    level,
                    StructuralType.NonStructural);

                var parameter = instance.LookupParameter(parameterName);
                Assert.That(parameter, Is.Not.Null);
                _ = parameter!.SetValueString("249 CFM");

                schedule = ViewSchedule.CreateSchedule(projectDocument,
                    new ElementId(BuiltInCategory.OST_MechanicalEquipment));
                schedule.Name = scheduleName;
                schedule.Definition.IsItemized = true;

                var field = AddSchedulableField(schedule, parameterName);
                var formatOptions = new FormatOptions(UnitTypeId.CubicFeetPerMinute) {
                    Accuracy = 1.0
                };
                if (formatOptions.CanHaveSymbol())
                    formatOptions.SetSymbolTypeId(new ForgeTypeId());
                field.SetFormatOptions(formatOptions);

                _ = transaction.Commit();
            }

            projectDocument.Regenerate();

            var parameterDisplayValue = instance!.LookupParameter(parameterName)!.AsValueString();
            var data = ScheduleQueryCollector.Collect(
                projectDocument,
                new ScheduleQuery { Kind = ScheduleQueryKind.ScheduleReferences, ScheduleIds = [schedule!.Id.Value()] }
            );

            var entry = data.Entries.Single();
            var row = entry.Rows.Single();
            var renderedValue = row.Values.Single();

            Assert.Multiple(() => {
                Assert.That(parameterDisplayValue, Does.Contain("CFM"));
                Assert.That(renderedValue, Does.Not.Contain("CFM"));
                Assert.That(renderedValue, Is.Not.EqualTo(parameterDisplayValue));
                Assert.That(row.BindingKind, Is.EqualTo(ScheduleRenderedRowBindingKind.SingleSubject));
                Assert.That(row.ResolutionStatus, Is.EqualTo(ScheduleRenderedRowSubjectResolutionStatus.Bound));
                Assert.That(row.ResolutionReason, Is.EqualTo(ScheduleRenderedRowSubjectResolutionReason.None));
                Assert.That(row.SubjectIds.Count, Is.EqualTo(1));
                Assert.That(entry.BindingStatus, Is.EqualTo(ScheduleRenderedBindingStatus.Complete));
                Assert.That(entry.BindableRowCount, Is.EqualTo(1));
                Assert.That(entry.BoundRowCount, Is.EqualTo(1));
                Assert.That(entry.UnboundRowCount, Is.Zero);
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
        string fieldName,
        string typeName = "Primary"
    ) {
        ViewSchedule? schedule;

        using (var transaction = new Transaction(projectDocument, $"Create schedule '{scheduleName}'")) {
            _ = transaction.Start();
            var symbolId = loadedFamily.GetFamilySymbolIds().First();
            var symbol = (FamilySymbol)projectDocument.GetElement(symbolId);
            if (!string.Equals(symbol.Name, typeName, StringComparison.Ordinal)) {
                var matchingSymbolId = loadedFamily.GetFamilySymbolIds()
                    .Select(id => projectDocument.GetElement(id))
                    .OfType<FamilySymbol>()
                    .First(item => string.Equals(item.Name, typeName, StringComparison.Ordinal));
                symbol = matchingSymbolId;
            }

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

            _ = AddSchedulableField(schedule, fieldName);

            _ = transaction.Commit();
        }

        return schedule!;
    }

    private static ScheduleField AddSchedulableField(
        ViewSchedule schedule,
        string fieldName
    ) {
        var schedulableField = schedule.Definition.GetSchedulableFields()
            .First(field =>
                string.Equals(field.GetName(schedule.Document), fieldName, StringComparison.OrdinalIgnoreCase));
        return schedule.Definition.AddField(schedulableField);
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
            BuiltInCategory.OST_Schedules
        );

        using var transaction = new Transaction(projectDocument, "Set schedule discipline");
        _ = transaction.Start();
        projectDocument.Regenerate();
        var parameter = schedule.LookupParameter("Discipline")
                        ?? throw new InvalidOperationException("Discipline parameter was not bound to the schedule.");
        _ = parameter.Set(disciplineValue);
        _ = transaction.Commit();
    }
}
