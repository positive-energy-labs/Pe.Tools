using Autodesk.Revit.DB.Structure;
using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.Tests;

internal static class FamilyFoundryMatrixFixtureBuilder {
    public const string SetValueMatrixFamilyName = "FF Matrix - SetValue Mechanical Equipment";
    public const string MetadataStateFamilyName = "FF Matrix - Parameter Metadata Mechanical Equipment";
    public const string NestedFamilyName = "FF Matrix - Nested Generic Model";

    public static readonly string[] MatrixTypeNames = ["Matrix Type A", "Matrix Type B", "Matrix Type C"];
    public static readonly string[] MetadataTypeNames = ["Metadata Type A", "Metadata Type B"];

    public static readonly Guid MetadataSharedTypeTextGuid = new("22222222-3333-4444-5555-666666666601");
    public static readonly Guid MetadataSharedInstanceLengthGuid = new("22222222-3333-4444-5555-666666666602");
    public static readonly Guid MetadataProjectBoundSharedGuid = new("22222222-3333-4444-5555-666666666603");

    public const string SourceText = "FF Matrix Source Text";
    public const string SourceBlankText = "FF Matrix Source Blank Text";
    public const string SourceFallbackText = "FF Matrix Source Fallback Text";
    public const string SourceInteger = "FF Matrix Source Integer";
    public const string SourceYesNo = "FF Matrix Source YesNo";
    public const string SourceNumberText = "FF Matrix Source Number Text";
    public const string SourceLengthText = "FF Matrix Source Length Text";
    public const string SourceVoltageText = "FF Matrix Source Voltage Text";
    public const string SourceCurrentText = "FF Matrix Source Current Text";
    public const string SourceFormulaBase = "FF Matrix Source Formula Base";
    public const string SourceFormulaNested = "FF Matrix Source Formula Nested";
    public const string SourceLinearDimension = "FF Matrix Source Linear Dimension";
    public const string SourceAngularDimension = "FF Matrix Source Angular Dimension";
    public const string SourceRadialDimension = "FF Matrix Source Radial Dimension";
    public const string SourceArrayCount = "FF Matrix Source Array Count";
    public const string SourceNestedWidth = "FF Matrix Source Nested Width";

    public const string NestedWidth = "FF Matrix Nested Width";

    public const string TargetText = "FF Matrix Target Text";
    public const string TargetBlankFallbackNumber = "FF Matrix Target Blank Fallback Number";
    public const string TargetInteger = "FF Matrix Target Integer";
    public const string TargetYesNo = "FF Matrix Target YesNo";
    public const string TargetNumber = "FF Matrix Target Number";
    public const string TargetLength = "FF Matrix Target Length";
    public const string TargetVoltage = "FF Matrix Target Voltage";
    public const string TargetCurrent = "FF Matrix Target Current";
    public const string TargetFormulaUnwrappedLength = "FF Matrix Target Formula Unwrapped Length";
    public const string TargetLinearDimension = "FF Matrix Target Linear Dimension";
    public const string TargetAngularDimension = "FF Matrix Target Angular Dimension";
    public const string TargetRadialDimension = "FF Matrix Target Radial Dimension";
    public const string TargetArrayCount = "FF Matrix Target Array Count";
    public const string TargetNestedWidth = "FF Matrix Target Nested Width";
    public const string TargetExistingFormulaLength = "FF Matrix Target Existing Formula Length";
    public const string TargetPerTypeText = "FF Matrix Target Per-Type Text";
    public const string TargetGlobalText = "FF Matrix Target Global Text";
    public const string TargetInvalidNumber = "FF Matrix Target Invalid Number";

    public const string MetadataAppliedLocalText = "FF Metadata Applied Local Text";

    public const string MetadataLocalTypeText = "FF Metadata Local Type Text";
    public const string MetadataLocalInstanceNumber = "FF Metadata Local Instance Number";
    public const string MetadataLocalTooltip = "FF Metadata Local Tooltip";
    public const string MetadataSharedTypeText = "FF Metadata Shared Type Text";
    public const string MetadataSharedInstanceLength = "FF Metadata Shared Instance Length";
    public const string MetadataProjectBoundShared = "FF Metadata Project-Bound Shared Text";

    public const string MetadataLocalTooltipDescription = "Local family parameter tooltip set by FamilyManager.SetDescription.";
    public const string MetadataSharedTypeTextDescription = "Shared type text definition tooltip from the shared parameter file.";
    public const string MetadataSharedInstanceLengthDescription = "Shared instance length definition tooltip from the shared parameter file.";
    public const string MetadataProjectBoundSharedDescription = "Project binding override shared parameter tooltip.";

    public static Family BuildAndLoadSetValueMatrixFamily(
        Application application,
        Document projectDocument,
        string outputDirectory
    ) {
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_MechanicalEquipment,
            SetValueMatrixFamilyName);

        try {
            var nestedFamily = BuildAndLoadNestedFamily(application, familyDocument, outputDirectory);
            BuildSetValueMatrixFamilyDocument(familyDocument, nestedFamily);
            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                outputDirectory,
                SetValueMatrixFamilyName);
            return RevitFamilyFixtureHarness.LoadFamilyIntoProject(
                application,
                projectDocument,
                familyPath,
                new DefaultFamilyLoadOptions());
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    public static Family BuildAndLoadMetadataStateFamily(
        Application application,
        Document projectDocument,
        string outputDirectory
    ) {
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_MechanicalEquipment,
            MetadataStateFamilyName);

        try {
            BuildMetadataStateFamilyDocument(familyDocument);
            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                outputDirectory,
                MetadataStateFamilyName);
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(
                application,
                projectDocument,
                familyPath,
                new DefaultFamilyLoadOptions());
            BindMetadataProjectParameters(projectDocument);
            return loadedFamily;
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    public static void BindMetadataProjectParameters(Document projectDocument) {
        var definition = RevitFamilyFixtureHarness.CreateSharedParameterDefinition(
            projectDocument,
            MetadataProjectBoundSharedDefinition());
        var (_, bindingSucceeded, _) = RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
            projectDocument,
            definition,
            true,
            GroupTypeId.Electrical,
            BuiltInCategory.OST_MechanicalEquipment);

        if (!bindingSucceeded)
            throw new InvalidOperationException($"Failed to bind shared metadata parameter '{MetadataProjectBoundShared}'.");
    }

    private static RevitFamilyFixtureHarness.SharedDefinitionSpec MetadataSharedTypeTextDefinition() =>
        new(
            MetadataSharedTypeText,
            SpecTypeId.String.Text,
            "FF Matrix Metadata",
            MetadataSharedTypeTextDescription,
            MetadataSharedTypeTextGuid);

    private static RevitFamilyFixtureHarness.SharedDefinitionSpec MetadataSharedInstanceLengthDefinition() =>
        new(
            MetadataSharedInstanceLength,
            SpecTypeId.Length,
            "FF Matrix Metadata",
            MetadataSharedInstanceLengthDescription,
            MetadataSharedInstanceLengthGuid);

    private static RevitFamilyFixtureHarness.SharedDefinitionSpec MetadataProjectBoundSharedDefinition() =>
        new(
            MetadataProjectBoundShared,
            SpecTypeId.String.Text,
            "FF Matrix Metadata",
            MetadataProjectBoundSharedDescription,
            MetadataProjectBoundSharedGuid);

    private static Family BuildAndLoadNestedFamily(
        Application application,
        Document hostFamilyDocument,
        string outputDirectory
    ) {
        var nestedDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_GenericModel,
            NestedFamilyName);

        try {
            using (var transaction = new Transaction(nestedDocument, "Build FF matrix nested family")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.EnsureFamilyType(nestedDocument, "Nested Type A");
                var nestedWidth = RevitFamilyFixtureHarness.AddFamilyParameter(
                    nestedDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        NestedWidth,
                        SpecTypeId.Length,
                        GroupTypeId.Geometry,
                        true));
                nestedDocument.FamilyManager.CurrentType = RevitFamilyFixtureHarness.EnsureFamilyType(
                    nestedDocument,
                    "Nested Type A");
                nestedDocument.FamilyManager.Set(nestedWidth, 1.0);
                _ = transaction.Commit();
            }

            return nestedDocument.LoadFamily(hostFamilyDocument, new DefaultFamilyLoadOptions());
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(nestedDocument);
        }
    }

    private static void BuildSetValueMatrixFamilyDocument(Document familyDocument, Family nestedFamily) {
        using var transaction = new Transaction(familyDocument, "Build FF set-value matrix family");
        _ = transaction.Start();

        var familyDoc = new FamilyDocument(familyDocument);
        var manager = familyDocument.FamilyManager;
        foreach (var typeName in MatrixTypeNames)
            _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, typeName);

        var sourceText = AddFamilyParameter(familyDocument, SourceText, SpecTypeId.String.Text, GroupTypeId.Text, false);
        var sourceBlankText = AddFamilyParameter(familyDocument, SourceBlankText, SpecTypeId.String.Text, GroupTypeId.Text, false);
        var sourceFallbackText = AddFamilyParameter(familyDocument, SourceFallbackText, SpecTypeId.String.Text, GroupTypeId.Text, false);
        var sourceInteger = AddFamilyParameter(familyDocument, SourceInteger, SpecTypeId.Int.Integer, GroupTypeId.IdentityData, false);
        var sourceYesNo = AddFamilyParameter(familyDocument, SourceYesNo, SpecTypeId.Boolean.YesNo, GroupTypeId.IdentityData, false);
        var sourceNumberText = AddFamilyParameter(familyDocument, SourceNumberText, SpecTypeId.String.Text, GroupTypeId.Text, false);
        var sourceLengthText = AddFamilyParameter(familyDocument, SourceLengthText, SpecTypeId.String.Text, GroupTypeId.Text, false);
        var sourceVoltageText = AddFamilyParameter(familyDocument, SourceVoltageText, SpecTypeId.String.Text, GroupTypeId.Electrical, false);
        var sourceCurrentText = AddFamilyParameter(familyDocument, SourceCurrentText, SpecTypeId.String.Text, GroupTypeId.Electrical, false);
        var sourceFormulaBase = AddFamilyParameter(familyDocument, SourceFormulaBase, SpecTypeId.Length, GroupTypeId.Geometry, false);
        var sourceFormulaNested = AddFamilyParameter(familyDocument, SourceFormulaNested, SpecTypeId.Length, GroupTypeId.Geometry, false);
        var sourceLinearDimension = AddFamilyParameter(familyDocument, SourceLinearDimension, SpecTypeId.Length, GroupTypeId.Geometry, false);
        var sourceAngularDimension = AddFamilyParameter(familyDocument, SourceAngularDimension, SpecTypeId.Angle, GroupTypeId.Geometry, false);
        var sourceRadialDimension = AddFamilyParameter(familyDocument, SourceRadialDimension, SpecTypeId.Length, GroupTypeId.Geometry, false);
        var sourceArrayCount = AddFamilyParameter(familyDocument, SourceArrayCount, SpecTypeId.Int.Integer, GroupTypeId.Geometry, false);
        var sourceNestedWidth = AddFamilyParameter(familyDocument, SourceNestedWidth, SpecTypeId.Length, GroupTypeId.Geometry, true);
        var targetExistingFormulaLength = AddFamilyParameter(familyDocument, TargetExistingFormulaLength, SpecTypeId.Length, GroupTypeId.Geometry, false);

        AssertFormulaSet(familyDoc, sourceFormulaNested, $"{SourceFormulaBase} * 2");
        AssertFormulaSet(familyDoc, targetExistingFormulaLength, $"{SourceFormulaBase} + 1");

        SeedMatrixValues(
            manager,
            sourceText,
            sourceBlankText,
            sourceFallbackText,
            sourceInteger,
            sourceYesNo,
            sourceNumberText,
            sourceLengthText,
            sourceVoltageText,
            sourceCurrentText,
            sourceFormulaBase,
            sourceLinearDimension,
            sourceAngularDimension,
            sourceRadialDimension,
            sourceArrayCount,
            sourceNestedWidth);

        CreateLabeledDimensionTopology(
            familyDocument,
            sourceLinearDimension,
            sourceAngularDimension,
            sourceRadialDimension);
        CreateLabeledArrayTopology(familyDocument, sourceArrayCount);
        CreateNestedParameterAssociation(familyDocument, nestedFamily, sourceNestedWidth);

        familyDocument.Regenerate();
        _ = transaction.Commit();
    }

    private static void BuildMetadataStateFamilyDocument(Document familyDocument) {
        using var transaction = new Transaction(familyDocument, "Build FF parameter metadata family");
        _ = transaction.Start();

        var manager = familyDocument.FamilyManager;
        foreach (var typeName in MetadataTypeNames)
            _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, typeName);

        var localTypeText = AddFamilyParameter(
            familyDocument,
            MetadataLocalTypeText,
            SpecTypeId.String.Text,
            GroupTypeId.Text,
            false);
        var localInstanceNumber = AddFamilyParameter(
            familyDocument,
            MetadataLocalInstanceNumber,
            SpecTypeId.Number,
            GroupTypeId.IdentityData,
            true);
        var localTooltip = AddFamilyParameter(
            familyDocument,
            MetadataLocalTooltip,
            SpecTypeId.String.Text,
            GroupTypeId.IdentityData,
            true);
        manager.SetDescription(localTooltip, MetadataLocalTooltipDescription);

        var sharedTypeText = RevitFamilyFixtureHarness.AddSharedFamilyParameter(
            familyDocument,
            MetadataSharedTypeTextDefinition(),
            GroupTypeId.Text,
            false);
        var sharedInstanceLength = RevitFamilyFixtureHarness.AddSharedFamilyParameter(
            familyDocument,
            MetadataSharedInstanceLengthDefinition(),
            GroupTypeId.Geometry,
            true);
        var projectBoundShared = RevitFamilyFixtureHarness.AddSharedFamilyParameter(
            familyDocument,
            MetadataProjectBoundSharedDefinition(),
            GroupTypeId.Text,
            false);

        SeedMetadataValues(
            manager,
            localTypeText,
            localInstanceNumber,
            localTooltip,
            sharedTypeText,
            sharedInstanceLength,
            projectBoundShared);

        familyDocument.Regenerate();
        _ = transaction.Commit();
    }

    private static FamilyParameter AddFamilyParameter(
        Document familyDocument,
        string name,
        ForgeTypeId dataType,
        ForgeTypeId groupTypeId,
        bool isInstance
    ) => RevitFamilyFixtureHarness.AddFamilyParameter(
        familyDocument,
        new RevitFamilyFixtureHarness.ParameterDefinitionSpec(name, dataType, groupTypeId, isInstance));

    private static void AssertFormulaSet(FamilyDocument familyDocument, FamilyParameter parameter, string formula) {
        if (!familyDocument.TrySetFormula(parameter, formula, out var errorMessage))
            throw new InvalidOperationException($"Failed to set formula on '{parameter.Definition.Name}': {errorMessage}");
    }

    private static void SeedMatrixValues(
        FamilyManager manager,
        FamilyParameter sourceText,
        FamilyParameter sourceBlankText,
        FamilyParameter sourceFallbackText,
        FamilyParameter sourceInteger,
        FamilyParameter sourceYesNo,
        FamilyParameter sourceNumberText,
        FamilyParameter sourceLengthText,
        FamilyParameter sourceVoltageText,
        FamilyParameter sourceCurrentText,
        FamilyParameter sourceFormulaBase,
        FamilyParameter sourceLinearDimension,
        FamilyParameter sourceAngularDimension,
        FamilyParameter sourceRadialDimension,
        FamilyParameter sourceArrayCount,
        FamilyParameter sourceNestedWidth
    ) {
        for (var index = 0; index < MatrixTypeNames.Length; index++) {
            manager.CurrentType = manager.Types.Cast<FamilyType>()
                .First(type => string.Equals(type.Name, MatrixTypeNames[index], StringComparison.Ordinal));
            manager.Set(sourceText, $"matrix-text-{index + 1}");
            manager.Set(sourceBlankText, string.Empty);
            manager.Set(sourceFallbackText, (index + 20).ToString());
            manager.Set(sourceInteger, index + 2);
            manager.Set(sourceYesNo, index % 2 == 0 ? 1 : 0);
            manager.Set(sourceNumberText, index == 0 ? "42.5" : index == 1 ? "0" : "-7.25");
            manager.Set(sourceLengthText, index == 0 ? "18 in" : index == 1 ? "2\"" : "2' - 6\"");
            manager.Set(sourceVoltageText, index == 0 ? "208V" : index == 1 ? "240 V" : "120V");
            manager.Set(sourceCurrentText, index == 0 ? "12 A" : index == 1 ? "0 A" : "18.5 A");
            manager.Set(sourceFormulaBase, index + 1.0);
            manager.Set(sourceLinearDimension, index + 2.0);
            manager.Set(sourceAngularDimension, Math.PI / (index + 4));
            manager.Set(sourceRadialDimension, 0.5 + index);
            manager.Set(sourceArrayCount, index + 2);
            manager.Set(sourceNestedWidth, 1.25 + index);
        }
    }

    private static void SeedMetadataValues(
        FamilyManager manager,
        FamilyParameter localTypeText,
        FamilyParameter localInstanceNumber,
        FamilyParameter localTooltip,
        FamilyParameter sharedTypeText,
        FamilyParameter sharedInstanceLength,
        FamilyParameter projectBoundShared
    ) {
        for (var index = 0; index < MetadataTypeNames.Length; index++) {
            manager.CurrentType = manager.Types.Cast<FamilyType>()
                .First(type => string.Equals(type.Name, MetadataTypeNames[index], StringComparison.Ordinal));
            manager.Set(localTypeText, $"metadata-local-type-{index + 1}");
            manager.Set(localInstanceNumber, 100.0 + index);
            manager.Set(localTooltip, $"tooltip-backed-value-{index + 1}");
            manager.Set(sharedTypeText, $"metadata-shared-type-{index + 1}");
            manager.Set(sharedInstanceLength, 2.0 + index);
            manager.Set(projectBoundShared, $"project-bound-family-value-{index + 1}");
        }
    }

    private static void CreateLabeledDimensionTopology(
        Document familyDocument,
        FamilyParameter linearLabel,
        FamilyParameter angularLabel,
        FamilyParameter radialLabel
    ) {
        var view = GetPlanView(familyDocument);
        var factory = familyDocument.FamilyCreate;
        var sketchPlane = SketchPlane.Create(familyDocument, Plane.CreateByNormalAndOrigin(XYZ.BasisZ, XYZ.Zero));

        var linearA = factory.NewModelCurve(Line.CreateBound(new XYZ(0, -5, 0), new XYZ(0, 5, 0)), sketchPlane);
        var linearB = factory.NewModelCurve(Line.CreateBound(new XYZ(4, -5, 0), new XYZ(4, 5, 0)), sketchPlane);
        var linearReferences = new ReferenceArray();
        linearReferences.Append(linearA.GeometryCurve.Reference);
        linearReferences.Append(linearB.GeometryCurve.Reference);
        var linearDimension = factory.NewLinearDimension(
            view,
            Line.CreateBound(new XYZ(0, -4, 0), new XYZ(4, -4, 0)),
            linearReferences);
        linearDimension.FamilyLabel = linearLabel;

        var angleA = factory.NewModelCurve(Line.CreateBound(XYZ.Zero, new XYZ(4, 0, 0)), sketchPlane);
        var angleB = factory.NewModelCurve(Line.CreateBound(XYZ.Zero, new XYZ(4, 4, 0)), sketchPlane);
        var angularDimension = factory.NewAngularDimension(
            view,
            Arc.Create(XYZ.Zero, 3.0, 0.0, Math.PI / 4.0, XYZ.BasisX, XYZ.BasisY),
            angleA.GeometryCurve.Reference,
            angleB.GeometryCurve.Reference);
        angularDimension.FamilyLabel = angularLabel;

        var radialModelCurve = factory.NewModelCurve(
            Arc.Create(new XYZ(8, 0, 0), 1.0, 0.0, Math.PI, XYZ.BasisX, XYZ.BasisY),
            sketchPlane);
        var radialDimension = factory.NewRadialDimension(
            view,
            radialModelCurve.GeometryCurve.Reference,
            new XYZ(9.0, 0.0, 0.0));
        radialDimension.FamilyLabel = radialLabel;
    }

    private static void CreateLabeledArrayTopology(Document familyDocument, FamilyParameter arrayLabel) {
        var view = GetPlanView(familyDocument);
        var sketchPlane = SketchPlane.Create(familyDocument, Plane.CreateByNormalAndOrigin(XYZ.BasisZ, XYZ.Zero));
        var seedLine = familyDocument.FamilyCreate.NewModelCurve(
            Line.CreateBound(new XYZ(-1, 7, 0), new XYZ(1, 7, 0)),
            sketchPlane);

        if (!LinearArray.IsElementArrayable(familyDocument, seedLine.Id))
            throw new InvalidOperationException("The FF matrix model line was not arrayable.");

        var array = LinearArray.Create(
            familyDocument,
            view,
            seedLine.Id,
            3,
            new XYZ(0, 1, 0),
            (ArrayAnchorMember)0);
        array.Label = arrayLabel;
    }

    private static void CreateNestedParameterAssociation(Document familyDocument, Family nestedFamily, FamilyParameter hostLabel) {
        var nestedSymbol = nestedFamily.GetFamilySymbolIds()
                               .Select(id => familyDocument.GetElement(id))
                               .OfType<FamilySymbol>()
                               .FirstOrDefault()
                           ?? throw new InvalidOperationException($"Nested family '{nestedFamily.Name}' has no symbols.");

        if (!nestedSymbol.IsActive)
            nestedSymbol.Activate();

        var nestedInstance = familyDocument.FamilyCreate.NewFamilyInstance(
            new XYZ(0, 0, 0),
            nestedSymbol,
            StructuralType.NonStructural);
        var nestedWidth = nestedInstance.LookupParameter(NestedWidth)
                          ?? throw new InvalidOperationException($"Nested parameter '{NestedWidth}' was not found.");

        if (!familyDocument.FamilyManager.CanElementParameterBeAssociated(nestedWidth))
            throw new InvalidOperationException($"Nested parameter '{NestedWidth}' cannot be associated.");

        familyDocument.FamilyManager.AssociateElementParameterToFamilyParameter(nestedWidth, hostLabel);
    }

    private static void SetStrongReference(ReferencePlane referencePlane) =>
        referencePlane.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME)?.Set(13);

    private static View GetPlanView(Document familyDocument) {
        if (familyDocument.ActiveView is { IsTemplate: false } activeView &&
            activeView.ViewType is ViewType.FloorPlan or ViewType.CeilingPlan or ViewType.EngineeringPlan)
            return activeView;

        return new FilteredElementCollector(familyDocument)
                   .OfClass(typeof(ViewPlan))
                   .Cast<ViewPlan>()
                   .Where(view => !view.IsTemplate)
                   .OrderBy(view => view.Name, StringComparer.Ordinal)
                   .FirstOrDefault()
               ?? new FilteredElementCollector(familyDocument)
                   .OfClass(typeof(View))
                   .Cast<View>()
                   .Where(view => !view.IsTemplate && view.ViewType != ViewType.ThreeD)
                   .OrderBy(view => view.Name, StringComparer.Ordinal)
                   .FirstOrDefault()
               ?? throw new InvalidOperationException("No usable family view was found for FF matrix topology creation.");
    }
}
