using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.FamilyFoundry.Snapshots;

namespace Pe.Tools.RevitTest.Tests;

internal static class FamilyFoundryRoundtripAssertions {
    private const double GeometryTolerance = 1e-4;

    public static void AssertAuthoredGraphCounts(
        AuthoredParamDrivenSolidsSettings authored,
        AuthoredGraphExpectation expected
    ) {
        Assert.That(authored.Planes, Has.Count.EqualTo(expected.PlaneCount));
        Assert.That(authored.Spans, Has.Count.EqualTo(expected.SpanCount));
        Assert.That(authored.Prisms, Has.Count.EqualTo(expected.PrismCount));
        Assert.That(authored.Cylinders, Has.Count.EqualTo(expected.CylinderCount));
        Assert.That(authored.Connectors, Has.Count.EqualTo(expected.ConnectorCount));
        Assert.That(
            authored.Planes.Keys.OrderBy(name => name, StringComparer.Ordinal).ToList(),
            Is.EqualTo(expected.PlaneNames));
        Assert.That(
            authored.Prisms.Select(spec => spec.Name).OrderBy(name => name, StringComparer.Ordinal).ToList(),
            Is.EqualTo(expected.PrismNames));
        Assert.That(
            authored.Cylinders.Select(spec => spec.Name).OrderBy(name => name, StringComparer.Ordinal).ToList(),
            Is.EqualTo(expected.CylinderNames));
        Assert.That(
            authored.Connectors.Select(spec => spec.Name).OrderBy(name => name, StringComparer.Ordinal).ToList(),
            Is.EqualTo(expected.ConnectorNames));
    }

    public static void AssertCompiledPlanMatchesAuthored(RoundtripArtifact artifact) {
        var authored = artifact.Authored;
        var compiled = artifact.Compiled;
        var expected = CompiledPlanExpectation.From(compiled);

        Assert.That(compiled.CanExecute, Is.True, string.Join(Environment.NewLine, compiled.Diagnostics.Select(d => d.ToDisplayMessage())));
        Assert.That(compiled.InternalExtrusions.Rectangles, Has.Count.EqualTo(authored.Prisms.Count));
        Assert.That(compiled.InternalExtrusions.Circles, Has.Count.EqualTo(authored.Cylinders.Count));
        Assert.That(compiled.Connectors.Connectors, Has.Count.EqualTo(authored.Connectors.Count));
        Assert.That(expected.ExpectedPlaneNames, Is.Not.Empty);
        Assert.That(expected.ExpectedPlaneNames.All(name => !string.IsNullOrWhiteSpace(name)), Is.True);
        Assert.That(
            compiled.RefPlanesAndDims.SymmetricPairs.All(spec => spec.Driver.IsLiteralDriven || !string.IsNullOrWhiteSpace(spec.Parameter)),
            Is.True);
        Assert.That(
            compiled.RefPlanesAndDims.Offsets.All(spec => spec.Driver.IsLiteralDriven || !string.IsNullOrWhiteSpace(spec.Parameter)),
            Is.True);
        Assert.That(artifact.Context.PostProcessSnapshot?.ParamDrivenSolids?.HasContent, Is.True);
    }

    public static void AssertSavedFamilyHasOnlyTypes(Document familyDocument, params string[] expectedTypeNames) {
        var actual = familyDocument.FamilyManager.Types
            .Cast<FamilyType>()
            .Select(type => type.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();
        var expected = expectedTypeNames
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        Assert.That(actual, Is.EqualTo(expected));
    }

    public static void AssertTypeNamesMatch(Document sourceDocument, Document savedDocument) {
        var sourceTypes = sourceDocument.FamilyManager.Types
            .Cast<FamilyType>()
            .Select(type => type.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();
        var savedTypes = savedDocument.FamilyManager.Types
            .Cast<FamilyType>()
            .Select(type => type.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        Assert.That(savedTypes, Is.EqualTo(sourceTypes));
    }

    public static void AssertOffsetPlanesTrackDriversAcrossStates(
        ParamDrivenSolidsCompileResult compiled,
        IReadOnlyList<(string TypeName, RuntimeStateProbe Result)> states
    ) {
        foreach (var offset in compiled.RefPlanesAndDims.Offsets) {
            foreach (var (typeName, state) in states) {
                var anchor = GetPlane(state, offset.AnchorPlaneName);
                var target = GetPlane(state, offset.PlaneName);
                var signedDistance = SignedDistance(anchor, target);
                var expectedMagnitude = ResolveDriverValue(offset.Driver, offset.Parameter, state);

                Assert.That(
                    Math.Abs(signedDistance),
                    Is.EqualTo(expectedMagnitude).Within(GeometryTolerance),
                    $"Offset plane '{offset.PlaneName}' did not track its driver in type '{typeName}'.");
                Assert.That(
                    offset.Direction == OffsetDirection.Positive ? signedDistance >= -GeometryTolerance : signedDistance <= GeometryTolerance,
                    Is.True,
                    $"Offset plane '{offset.PlaneName}' did not stay on the expected side of anchor '{offset.AnchorPlaneName}' in type '{typeName}'.");
            }
        }
    }

    public static void AssertSymmetricPairsTrackDriversAcrossStates(
        ParamDrivenSolidsCompileResult compiled,
        IReadOnlyList<(string TypeName, RuntimeStateProbe Result)> states
    ) {
        foreach (var pair in compiled.RefPlanesAndDims.SymmetricPairs) {
            foreach (var (typeName, state) in states) {
                var center = GetPlane(state, pair.CenterPlaneName);
                var negative = GetPlane(state, pair.NegativePlaneName);
                var positive = GetPlane(state, pair.PositivePlaneName);
                var fullDistance = Math.Abs(SignedDistance(negative, positive));
                var negativeHalf = Math.Abs(SignedDistance(negative, center));
                var positiveHalf = Math.Abs(SignedDistance(center, positive));
                var expected = ResolveDriverValue(pair.Driver, pair.Parameter, state);

                Assert.That(
                    fullDistance,
                    Is.EqualTo(expected).Within(GeometryTolerance),
                    $"Symmetric pair '{pair.PlaneNameBase}' did not track its driver in type '{typeName}'.");
                Assert.That(
                    negativeHalf,
                    Is.EqualTo(positiveHalf).Within(GeometryTolerance),
                    $"Center plane '{pair.CenterPlaneName}' was not centered between '{pair.NegativePlaneName}' and '{pair.PositivePlaneName}' in type '{typeName}'.");
            }
        }
    }

    public static void AssertDimensionLabelsMatchCompiledPlan(
        ParamDrivenSolidsCompileResult compiled,
        IReadOnlyList<(string TypeName, RuntimeStateProbe Result)> states
    ) {
        Assert.That(states, Is.Not.Empty);
        var probe = states[0].Result;

        foreach (var pair in compiled.RefPlanesAndDims.SymmetricPairs) {
            var paramDim = FindDimension(probe, pair.NegativePlaneName, pair.PositivePlaneName, areSegmentsEqual: false);
            Assert.That(paramDim, Is.Not.Null, $"Missing labeled dimension for symmetric pair '{pair.PlaneNameBase}'.");
            Assert.That(paramDim!.LabelParameterName, Is.EqualTo(pair.Parameter));

            var eqDim = FindDimension(probe, pair.NegativePlaneName, pair.CenterPlaneName, pair.PositivePlaneName, areSegmentsEqual: true);
            Assert.That(eqDim, Is.Not.Null, $"Missing EQ dimension for symmetric pair '{pair.PlaneNameBase}'.");
        }

        foreach (var offset in compiled.RefPlanesAndDims.Offsets) {
            var dim = FindDimension(probe, offset.AnchorPlaneName, offset.PlaneName, areSegmentsEqual: false);
            Assert.That(dim, Is.Not.Null, $"Missing labeled dimension for offset plane '{offset.PlaneName}'.");
            Assert.That(dim!.LabelParameterName, Is.EqualTo(offset.Parameter));
        }
    }

    public static void AssertPrismsTrackConstrainingPlanesAcrossStates(
        ParamDrivenSolidsCompileResult compiled,
        IReadOnlyList<(string TypeName, RuntimeStateProbe Result)> states
    ) {
        foreach (var (typeName, state) in states) {
            var unmatched = state.Prisms.ToList();
            foreach (var spec in compiled.InternalExtrusions.Rectangles) {
                var match = unmatched
                    .OrderBy(candidate => ScoreRectangleCandidate(candidate, spec, state))
                    .FirstOrDefault();
                Assert.That(match, Is.Not.Null, $"No runtime prism matched compiled prism '{spec.Name}' in type '{typeName}'.");
                unmatched.Remove(match!);
                AssertRectangleExtents(match!, spec, state, typeName);
            }
        }
    }

    public static void AssertCylindersTrackConstrainingPlanesAcrossStates(
        ParamDrivenSolidsCompileResult compiled,
        IReadOnlyList<(string TypeName, RuntimeStateProbe Result)> states
    ) {
        foreach (var (typeName, state) in states) {
            var unmatched = state.Cylinders.ToList();
            foreach (var spec in compiled.InternalExtrusions.Circles) {
                var match = unmatched
                    .OrderBy(candidate => ScoreCircleCandidate(candidate, spec, state))
                    .FirstOrDefault();
                Assert.That(match, Is.Not.Null, $"No runtime cylinder matched compiled cylinder '{spec.Name}' in type '{typeName}'.");
                unmatched.Remove(match!);

                var expectedDiameter = ResolveDriverValue(spec.DiameterDriver, spec.DiameterParameter, state);
                Assert.That(
                    match!.Diameter,
                    Is.EqualTo(expectedDiameter).Within(GeometryTolerance),
                    $"Cylinder '{spec.Name}' diameter did not track its driver in type '{typeName}'.");

                var center = GetCenter(match.Min, match.Max);
                AssertPointMatchesPlaneCoordinate(center, GetPlane(state, spec.CenterPlane1), typeName, $"Cylinder '{spec.Name}' center plane 1");
                AssertPointMatchesPlaneCoordinate(center, GetPlane(state, spec.CenterPlane2), typeName, $"Cylinder '{spec.Name}' center plane 2");
                AssertHeightExtents(match.Min, match.Max, spec.SketchPlaneName, spec.HeightControlMode, spec.StartOffset, spec.EndOffset, spec.HeightDriver, spec.HeightParameter, spec.HeightPlaneBottom, spec.HeightPlaneTop, state, typeName, $"Cylinder '{spec.Name}'");
            }
        }
    }

    public static void AssertConnectorsTrackFacesAndDriversAcrossStates(
        ParamDrivenSolidsCompileResult compiled,
        IReadOnlyList<(string TypeName, RuntimeStateProbe Result)> states
    ) {
        var expectations = compiled.Connectors.Connectors.Select(BuildConnectorExpectation).ToList();

        foreach (var (typeName, state) in states) {
            var unmatchedConnectors = state.Connectors.ToList();
            var unmatchedPrisms = state.Prisms.ToList();
            var unmatchedCylinders = state.Cylinders.ToList();

            foreach (var expectation in expectations) {
                var facePlane = GetPlane(state, expectation.FacePlaneName);
                var expectedAnchorPoint = BuildExpectedPoint(state, expectation.FacePlaneName, expectation.CenterPlane1, expectation.CenterPlane2);
                var faceAxisIndex = GetDominantAxisIndex(facePlane.Normal);
                var connector = unmatchedConnectors
                    .Where(candidate => CandidateMatchesExpectation(candidate, expectation))
                    .OrderBy(candidate => ScoreConnectorCandidate(candidate, expectation, expectedAnchorPoint, faceAxisIndex))
                    .FirstOrDefault();

                Assert.That(connector, Is.Not.Null, $"No runtime connector matched '{expectation.Name}' in type '{typeName}'.");
                unmatchedConnectors.Remove(connector!);

                Assert.That(
                    ComputeUnsignedAlignment(connector!.FaceNormal, facePlane.Normal),
                    Is.GreaterThan(0.99),
                    $"Connector '{expectation.Name}' face normal drifted away from face plane '{expectation.FacePlaneName}' in type '{typeName}'.");

                if (!string.IsNullOrWhiteSpace(expectation.CenterPlane1))
                    AssertPointMatchesPlaneCoordinate(connector.Origin, GetPlane(state, expectation.CenterPlane1!), typeName, $"Connector '{expectation.Name}' center plane 1");
                if (!string.IsNullOrWhiteSpace(expectation.CenterPlane2))
                    AssertPointMatchesPlaneCoordinate(connector.Origin, GetPlane(state, expectation.CenterPlane2!), typeName, $"Connector '{expectation.Name}' center plane 2");

                if (expectation.Profile == ParamDrivenConnectorProfile.Round) {
                    var expectedDiameter = ResolveParameterValue(expectation.SizeParameter1, state);
                    Assert.That(
                        connector.Diameter,
                        Is.EqualTo(expectedDiameter).Within(GeometryTolerance),
                        $"Connector '{expectation.Name}' diameter did not track its driver in type '{typeName}'.");

                    var stub = unmatchedCylinders
                        .OrderBy(candidate => ScoreStubCylinderCandidate(candidate, expectation, connector, facePlane, expectedDiameter, state))
                        .FirstOrDefault();
                    Assert.That(stub, Is.Not.Null, $"No round stub matched connector '{expectation.Name}' in type '{typeName}'.");
                    unmatchedCylinders.Remove(stub!);
                    AssertStubCylinder(stub!, expectation, connector, facePlane, state, typeName);
                } else {
                    var (expectedWidthAxis, expectedLengthAxis) = ResolveExpectedRectangularFrame(expectation, state, facePlane.Normal);
                    Assert.That(
                        ComputeSignedAlignment(connector.WidthAxis, expectedWidthAxis),
                        Is.GreaterThan(0.99),
                        $"Connector '{expectation.Name}' width axis drifted away from the authored frame in type '{typeName}'.");
                    Assert.That(
                        ComputeSignedAlignment(connector.LengthAxis, expectedLengthAxis),
                        Is.GreaterThan(0.99),
                        $"Connector '{expectation.Name}' length axis drifted away from the authored frame in type '{typeName}'.");

                    var expectedWidth = ResolveParameterValue(expectation.SizeParameter1, state);
                    var expectedLength = ResolveParameterValue(expectation.SizeParameter2, state);
                    Assert.That(connector.Width, Is.EqualTo(expectedWidth).Within(GeometryTolerance), $"Connector '{expectation.Name}' width did not track its driver in type '{typeName}'.");
                    Assert.That(connector.Length, Is.EqualTo(expectedLength).Within(GeometryTolerance), $"Connector '{expectation.Name}' length did not track its driver in type '{typeName}'.");

                    var stub = unmatchedPrisms
                        .OrderBy(candidate => ScoreStubPrismCandidate(candidate, expectation, connector, facePlane, expectedWidth, expectedLength, state))
                        .FirstOrDefault();
                    Assert.That(stub, Is.Not.Null, $"No rectangular stub matched connector '{expectation.Name}' in type '{typeName}'.");
                    unmatchedPrisms.Remove(stub!);
                    AssertStubPrism(stub!, expectation, connector, facePlane, state, typeName);
                }

                Assert.That(
                    connector.FlowDirection,
                    Is.EqualTo(expectation.FlowDirection),
                    $"Connector '{expectation.Name}' flow direction drifted in type '{typeName}'.");
                if (expectation.SystemClassification != null) {
                    Assert.That(
                        connector.SystemClassification,
                        Is.EqualTo(expectation.SystemClassification),
                        $"Connector '{expectation.Name}' system classification drifted in type '{typeName}'.");
                }
            }
        }
    }

    public static void AssertVerticalSpansMatchAcrossExistingTypes(Document sourceDocument, Document savedDocument) {
        using var sourceTransaction = new Transaction(sourceDocument, "Evaluate source vertical spans");
        using var savedTransaction = new Transaction(savedDocument, "Evaluate saved vertical spans");
        _ = sourceTransaction.Start();
        _ = savedTransaction.Start();

        try {
            var savedTypesByName = savedDocument.FamilyManager.Types
                .Cast<FamilyType>()
                .ToDictionary(type => type.Name, StringComparer.Ordinal);
            foreach (var sourceType in sourceDocument.FamilyManager.Types.Cast<FamilyType>().OrderBy(type => type.Name, StringComparer.Ordinal)) {
                Assert.That(savedTypesByName.ContainsKey(sourceType.Name), Is.True, $"Saved family did not contain type '{sourceType.Name}'.");
                sourceDocument.FamilyManager.CurrentType = sourceType;
                savedDocument.FamilyManager.CurrentType = savedTypesByName[sourceType.Name];
                sourceDocument.Regenerate();
                savedDocument.Regenerate();

                var sourceSpans = GetOrderedExtrusionVerticalSpans(sourceDocument);
                var savedSpans = GetOrderedExtrusionVerticalSpans(savedDocument);
                Assert.That(savedSpans, Has.Count.EqualTo(sourceSpans.Count));

                for (var index = 0; index < sourceSpans.Count; index++) {
                    Assert.That(savedSpans[index].IsSolid, Is.EqualTo(sourceSpans[index].IsSolid), $"Extrusion solidity mismatch at index {index} for type '{sourceType.Name}'.");
                    Assert.That(savedSpans[index].MinZ, Is.EqualTo(sourceSpans[index].MinZ).Within(GeometryTolerance), $"Extrusion min Z mismatch at index {index} for type '{sourceType.Name}'.");
                    Assert.That(savedSpans[index].MaxZ, Is.EqualTo(sourceSpans[index].MaxZ).Within(GeometryTolerance), $"Extrusion max Z mismatch at index {index} for type '{sourceType.Name}'.");
                }
            }
        } finally {
            _ = savedTransaction.RollBack();
            _ = sourceTransaction.RollBack();
        }
    }

    public static void AssertRectangularConnectorOrientationMatchesSourceAcrossExistingTypes(
        Document sourceDocument,
        Document savedDocument
    ) {
        using var sourceTransaction = new Transaction(sourceDocument, "Evaluate source connector orientation");
        using var savedTransaction = new Transaction(savedDocument, "Evaluate saved connector orientation");
        _ = sourceTransaction.Start();
        _ = savedTransaction.Start();

        try {
            var savedTypesByName = savedDocument.FamilyManager.Types
                .Cast<FamilyType>()
                .ToDictionary(type => type.Name, StringComparer.Ordinal);
            foreach (var sourceType in sourceDocument.FamilyManager.Types.Cast<FamilyType>().OrderBy(type => type.Name, StringComparer.Ordinal)) {
                Assert.That(savedTypesByName.ContainsKey(sourceType.Name), Is.True, $"Saved family did not contain type '{sourceType.Name}'.");
                sourceDocument.FamilyManager.CurrentType = sourceType;
                savedDocument.FamilyManager.CurrentType = savedTypesByName[sourceType.Name];
                sourceDocument.Regenerate();
                savedDocument.Regenerate();

                var sourceMeasurement = MeasureRectangularConnectorOrientation(sourceDocument);
                var savedMeasurement = MeasureRectangularConnectorOrientation(savedDocument);
                Assert.That(ComputeUnsignedAlignment(sourceMeasurement.WidthAxis, savedMeasurement.WidthAxis), Is.GreaterThan(0.99), $"Rectangular connector width axis drifted from the source in type '{sourceType.Name}'.");
                Assert.That(ComputeUnsignedAlignment(sourceMeasurement.LengthAxis, savedMeasurement.LengthAxis), Is.GreaterThan(0.99), $"Rectangular connector length axis drifted from the source in type '{sourceType.Name}'.");
            }
        } finally {
            _ = savedTransaction.RollBack();
            _ = sourceTransaction.RollBack();
        }
    }

    public static int CountExtrusions(Document familyDocument) =>
        new FilteredElementCollector(familyDocument)
            .OfClass(typeof(Extrusion))
            .GetElementCount();

    public static int CountAdditionalHorizontalReferencePlanes(Document familyDocument) =>
        new FilteredElementCollector(familyDocument)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .Count(IsAdditionalHorizontalReferencePlane);

    private static RuntimePlaneProbe GetPlane(RuntimeStateProbe state, string planeName) =>
        state.Planes.TryGetValue(planeName, out var plane)
            ? plane
            : throw new AssertionException($"Plane '{planeName}' was not found in type '{state.TypeName}'.");

    private static RuntimeDimensionProbe? FindDimension(
        RuntimeStateProbe state,
        string planeName1,
        string planeName2,
        bool areSegmentsEqual
    ) {
        var expected = new HashSet<string>(StringComparer.Ordinal) { planeName1, planeName2 };
        return state.Dimensions.FirstOrDefault(probe =>
            probe.AreSegmentsEqual == areSegmentsEqual &&
            probe.PlaneNames.Count == 2 &&
            probe.PlaneNames.ToHashSet(StringComparer.Ordinal).SetEquals(expected));
    }

    private static RuntimeDimensionProbe? FindDimension(
        RuntimeStateProbe state,
        string planeName1,
        string planeName2,
        string planeName3,
        bool areSegmentsEqual
    ) {
        var expected = new HashSet<string>(StringComparer.Ordinal) { planeName1, planeName2, planeName3 };
        return state.Dimensions.FirstOrDefault(probe =>
            probe.AreSegmentsEqual == areSegmentsEqual &&
            probe.PlaneNames.Count == 3 &&
            probe.PlaneNames.ToHashSet(StringComparer.Ordinal).SetEquals(expected));
    }

    private static double SignedDistance(RuntimePlaneProbe from, RuntimePlaneProbe to) =>
        (to.Midpoint - from.Midpoint).DotProduct(from.Normal);

    private static double ResolveDriverValue(LengthDriverSpec driver, string? fallbackParameter, RuntimeStateProbe state) {
        if (driver.IsLiteralDriven)
            return Math.Abs(driver.LiteralValue ?? 0.0);

        var parameterName = !string.IsNullOrWhiteSpace(driver.ParameterName)
            ? driver.ParameterName.Trim()
            : fallbackParameter?.Trim();
        return ResolveParameterValue(parameterName, state);
    }

    private static double ResolveSignedDriverValue(
        LengthDriverSpec driver,
        string? fallbackParameter,
        double signedSeedOffset,
        RuntimeStateProbe state
    ) {
        var magnitude = ResolveDriverValue(driver, fallbackParameter, state);
        return signedSeedOffset < 0.0 ? -magnitude : magnitude;
    }

    private static double ResolveParameterValue(string? parameterName, RuntimeStateProbe state) {
        if (string.IsNullOrWhiteSpace(parameterName))
            throw new AssertionException($"No parameter name was available in type '{state.TypeName}'.");

        if (!state.ParameterValues.TryGetValue(parameterName.Trim(), out var value))
            throw new AssertionException($"Parameter '{parameterName}' was not resolved in type '{state.TypeName}'.");

        return Math.Abs(value);
    }

    private static double ScoreRectangleCandidate(
        RuntimePrismProbe candidate,
        ConstrainedRectangleExtrusionSpec spec,
        RuntimeStateProbe state
    ) {
        var pairAScore = ScorePairAlignment(candidate.Min, candidate.Max, GetPlane(state, spec.PairAPlane1), GetPlane(state, spec.PairAPlane2));
        var pairBScore = ScorePairAlignment(candidate.Min, candidate.Max, GetPlane(state, spec.PairBPlane1), GetPlane(state, spec.PairBPlane2));
        var heightScore = ScoreHeightAlignment(candidate.Min, candidate.Max, spec.SketchPlaneName, spec.HeightControlMode, spec.StartOffset, spec.EndOffset, spec.HeightDriver, spec.HeightParameter, spec.HeightPlaneBottom, spec.HeightPlaneTop, state);
        var sketchPenalty = string.Equals(candidate.SketchPlaneName, spec.SketchPlaneName, StringComparison.Ordinal) ? 0.0 : 100.0;
        return pairAScore + pairBScore + heightScore + sketchPenalty;
    }

    private static void AssertRectangleExtents(
        RuntimePrismProbe candidate,
        ConstrainedRectangleExtrusionSpec spec,
        RuntimeStateProbe state,
        string typeName
    ) {
        AssertPairAlignment(candidate.Min, candidate.Max, GetPlane(state, spec.PairAPlane1), GetPlane(state, spec.PairAPlane2), typeName, $"{spec.Name} pair A");
        AssertPairAlignment(candidate.Min, candidate.Max, GetPlane(state, spec.PairBPlane1), GetPlane(state, spec.PairBPlane2), typeName, $"{spec.Name} pair B");
        AssertHeightExtents(candidate.Min, candidate.Max, spec.SketchPlaneName, spec.HeightControlMode, spec.StartOffset, spec.EndOffset, spec.HeightDriver, spec.HeightParameter, spec.HeightPlaneBottom, spec.HeightPlaneTop, state, typeName, $"Prism '{spec.Name}'");
    }

    private static double ScoreCircleCandidate(
        RuntimeCylinderProbe candidate,
        ConstrainedCircleExtrusionSpec spec,
        RuntimeStateProbe state
    ) {
        var expectedDiameter = ResolveDriverValue(spec.DiameterDriver, spec.DiameterParameter, state);
        var sizeScore = Math.Abs(candidate.Diameter - expectedDiameter);
        var centerPoint = GetCenter(candidate.Min, candidate.Max);
        var centerScore = ScorePointToPlaneCoordinate(centerPoint, GetPlane(state, spec.CenterPlane1)) +
                          ScorePointToPlaneCoordinate(centerPoint, GetPlane(state, spec.CenterPlane2));
        var heightScore = ScoreHeightAlignment(candidate.Min, candidate.Max, spec.SketchPlaneName, spec.HeightControlMode, spec.StartOffset, spec.EndOffset, spec.HeightDriver, spec.HeightParameter, spec.HeightPlaneBottom, spec.HeightPlaneTop, state);
        return sizeScore + centerScore + heightScore;
    }

    private static void AssertPairAlignment(
        XYZ min,
        XYZ max,
        RuntimePlaneProbe plane1,
        RuntimePlaneProbe plane2,
        string typeName,
        string label
    ) {
        var axisIndex = GetDominantAxisIndex(plane1.Normal);
        var actualMin = ProjectBounds(min, max, axisIndex, takeMax: false);
        var actualMax = ProjectBounds(min, max, axisIndex, takeMax: true);
        var expectedMin = Math.Min(GetCanonicalPlaneCoordinate(plane1), GetCanonicalPlaneCoordinate(plane2));
        var expectedMax = Math.Max(GetCanonicalPlaneCoordinate(plane1), GetCanonicalPlaneCoordinate(plane2));

        Assert.That(actualMin, Is.EqualTo(expectedMin).Within(GeometryTolerance), $"{label} minimum drifted in type '{typeName}'.");
        Assert.That(actualMax, Is.EqualTo(expectedMax).Within(GeometryTolerance), $"{label} maximum drifted in type '{typeName}'.");
    }

    private static double ScorePairAlignment(
        XYZ min,
        XYZ max,
        RuntimePlaneProbe plane1,
        RuntimePlaneProbe plane2
    ) {
        var axisIndex = GetDominantAxisIndex(plane1.Normal);
        var actualMin = ProjectBounds(min, max, axisIndex, takeMax: false);
        var actualMax = ProjectBounds(min, max, axisIndex, takeMax: true);
        var expectedMin = Math.Min(GetCanonicalPlaneCoordinate(plane1), GetCanonicalPlaneCoordinate(plane2));
        var expectedMax = Math.Max(GetCanonicalPlaneCoordinate(plane1), GetCanonicalPlaneCoordinate(plane2));
        return Math.Abs(actualMin - expectedMin) + Math.Abs(actualMax - expectedMax);
    }

    private static void AssertHeightExtents(
        XYZ min,
        XYZ max,
        string sketchPlaneName,
        ExtrusionHeightControlMode heightControlMode,
        double startOffset,
        double endOffset,
        LengthDriverSpec heightDriver,
        string? heightParameter,
        string? heightPlaneBottom,
        string? heightPlaneTop,
        RuntimeStateProbe state,
        string typeName,
        string label
    ) {
        var (axis, expectedMin, expectedMax) = ResolveHeightExpectation(sketchPlaneName, heightControlMode, startOffset, endOffset, heightDriver, heightParameter, heightPlaneBottom, heightPlaneTop, state);
        var actualMin = ProjectBounds(min, max, axis, takeMax: false);
        var actualMax = ProjectBounds(min, max, axis, takeMax: true);

        Assert.That(actualMin, Is.EqualTo(expectedMin).Within(GeometryTolerance), $"{label} bottom drifted in type '{typeName}'.");
        Assert.That(actualMax, Is.EqualTo(expectedMax).Within(GeometryTolerance), $"{label} top drifted in type '{typeName}'.");
    }

    private static double ScoreHeightAlignment(
        XYZ min,
        XYZ max,
        string sketchPlaneName,
        ExtrusionHeightControlMode heightControlMode,
        double startOffset,
        double endOffset,
        LengthDriverSpec heightDriver,
        string? heightParameter,
        string? heightPlaneBottom,
        string? heightPlaneTop,
        RuntimeStateProbe state
    ) {
        var (axis, expectedMin, expectedMax) = ResolveHeightExpectation(sketchPlaneName, heightControlMode, startOffset, endOffset, heightDriver, heightParameter, heightPlaneBottom, heightPlaneTop, state);
        var actualMin = ProjectBounds(min, max, axis, takeMax: false);
        var actualMax = ProjectBounds(min, max, axis, takeMax: true);
        return Math.Abs(actualMin - expectedMin) + Math.Abs(actualMax - expectedMax);
    }

    private static (XYZ Axis, double Min, double Max) ResolveHeightExpectation(
        string sketchPlaneName,
        ExtrusionHeightControlMode heightControlMode,
        double startOffset,
        double endOffset,
        LengthDriverSpec heightDriver,
        string? heightParameter,
        string? heightPlaneBottom,
        string? heightPlaneTop,
        RuntimeStateProbe state
    ) {
        if (heightControlMode == ExtrusionHeightControlMode.ReferencePlane &&
            !string.IsNullOrWhiteSpace(heightPlaneBottom) &&
            !string.IsNullOrWhiteSpace(heightPlaneTop)) {
            var bottom = GetPlane(state, heightPlaneBottom!);
            var top = GetPlane(state, heightPlaneTop!);
            var heightAxisIndex = GetDominantAxisIndex(bottom.Normal);
            return (
                GetCanonicalAxis(heightAxisIndex),
                Math.Min(GetCanonicalPlaneCoordinate(bottom), GetCanonicalPlaneCoordinate(top)),
                Math.Max(GetCanonicalPlaneCoordinate(bottom), GetCanonicalPlaneCoordinate(top)));
        }

        var sketchPlane = GetPlane(state, sketchPlaneName);
        var axisIndex = GetDominantAxisIndex(sketchPlane.Normal);
        var sketchCoordinate = GetCanonicalPlaneCoordinate(sketchPlane);
        var start = sketchCoordinate + startOffset;
        var resolvedEndOffset = heightControlMode == ExtrusionHeightControlMode.EndOffset
            ? ResolveSignedDriverValue(heightDriver, heightParameter, endOffset, state)
            : endOffset;
        var end = sketchCoordinate + resolvedEndOffset;
        return (GetCanonicalAxis(axisIndex), Math.Min(start, end), Math.Max(start, end));
    }

    private static double GetPlaneCoordinate(RuntimePlaneProbe plane) =>
        plane.Midpoint.DotProduct(plane.Normal);

    private static double GetCanonicalPlaneCoordinate(RuntimePlaneProbe plane) {
        var axisIndex = GetDominantAxisIndex(plane.Normal);
        double axisSign = Math.Sign(GetAxisComponent(plane.Normal, axisIndex));
        if (axisSign == 0.0)
            axisSign = 1.0;

        return GetPlaneCoordinate(plane) * axisSign;
    }

    private static double ProjectBounds(XYZ min, XYZ max, XYZ axis, bool takeMax) {
        var values = BuildBoundingCorners(min, max)
            .Select(corner => corner.DotProduct(axis))
            .ToList();
        return takeMax ? values.Max() : values.Min();
    }

    private static double ProjectBounds(XYZ min, XYZ max, int axisIndex, bool takeMax) {
        var values = BuildBoundingCorners(min, max)
            .Select(corner => GetCoordinate(corner, axisIndex))
            .ToList();
        return takeMax ? values.Max() : values.Min();
    }

    private static IEnumerable<XYZ> BuildBoundingCorners(XYZ min, XYZ max) {
        yield return new XYZ(min.X, min.Y, min.Z);
        yield return new XYZ(min.X, min.Y, max.Z);
        yield return new XYZ(min.X, max.Y, min.Z);
        yield return new XYZ(min.X, max.Y, max.Z);
        yield return new XYZ(max.X, min.Y, min.Z);
        yield return new XYZ(max.X, min.Y, max.Z);
        yield return new XYZ(max.X, max.Y, min.Z);
        yield return new XYZ(max.X, max.Y, max.Z);
    }

    private static ConnectorExpectation BuildConnectorExpectation(CompiledParamDrivenConnectorSpec spec) {
        var centerPlane1 = spec.Profile == ParamDrivenConnectorProfile.Round
            ? spec.RoundStub?.CenterPlane1
            : spec.RectangularStub?.PairAPlane1;
        var centerPlane2 = spec.Profile == ParamDrivenConnectorProfile.Round
            ? spec.RoundStub?.CenterPlane2
            : spec.RectangularStub?.PairBPlane1;
        var widthAxisPlaneName = spec.Profile == ParamDrivenConnectorProfile.Rectangular
            ? spec.RectangularStub?.PairAPlane1
            : null;
        var lengthAxisPlaneName = spec.Profile == ParamDrivenConnectorProfile.Rectangular
            ? spec.RectangularStub?.PairBPlane1
            : null;
        var sizeParameter1 = spec.Profile == ParamDrivenConnectorProfile.Round
            ? GetDriverParameterName(spec.RoundStub?.DiameterDriver) ?? spec.RoundStub?.DiameterParameter
            : GetDriverParameterName(spec.RectangularStub?.PairADriver) ?? spec.RectangularStub?.PairAParameter;
        var sizeParameter2 = spec.Profile == ParamDrivenConnectorProfile.Round
            ? null
            : GetDriverParameterName(spec.RectangularStub?.PairBDriver) ?? spec.RectangularStub?.PairBParameter;

        return new ConnectorExpectation(
            spec.Name,
            spec.RectangularStub?.SketchPlaneName ?? spec.RoundStub?.SketchPlaneName ?? spec.HostPlaneName,
            spec.Domain,
            spec.Profile,
            centerPlane1,
            centerPlane2,
            widthAxisPlaneName,
            lengthAxisPlaneName,
            sizeParameter1,
            sizeParameter2,
            GetDriverParameterName(spec.DepthDriver),
            ResolveExpectedFlowDirection(spec),
            ResolveExpectedSystemClassification(spec));
    }

    private static bool CandidateMatchesExpectation(RuntimeConnectorProbe candidate, ConnectorExpectation expectation) {
        if (expectation.Domain == ParamDrivenConnectorDomain.Duct && candidate.Domain != Domain.DomainHvac)
            return false;
        if (expectation.Domain == ParamDrivenConnectorDomain.Pipe && candidate.Domain != Domain.DomainPiping)
            return false;
        if (expectation.Domain == ParamDrivenConnectorDomain.Electrical && candidate.Domain != Domain.DomainElectrical)
            return false;

        return candidate.Profile == (expectation.Profile == ParamDrivenConnectorProfile.Round
            ? ConnectorProfileType.Round
            : ConnectorProfileType.Rectangular);
    }

    private static double ScoreConnectorCandidate(
        RuntimeConnectorProbe candidate,
        ConnectorExpectation expectation,
        XYZ expectedAnchorPoint,
        int faceAxisIndex
    ) {
        var coordinateScore = GetPointAxisDifference(candidate.Origin, expectedAnchorPoint, IgnoreAxis(faceAxisIndex));
        var flowScore = candidate.FlowDirection == expectation.FlowDirection ? 0.0 : 100.0;
        var classificationScore = expectation.SystemClassification == null || candidate.SystemClassification == expectation.SystemClassification
            ? 0.0
            : 100.0;
        return coordinateScore + flowScore + classificationScore;
    }

    private static void AssertPointMatchesPlaneCoordinate(
        XYZ point,
        RuntimePlaneProbe plane,
        string typeName,
        string label,
        string? depthParameter = null,
        bool allowDepthOffset = false,
        RuntimeStateProbe? state = null
    ) {
        var planeCoordinate = GetPlaneCoordinate(plane);
        var pointCoordinate = point.DotProduct(plane.Normal);
        if (allowDepthOffset) {
            var expectedDepth = ResolveParameterValue(depthParameter, state!);
            Assert.That(
                Math.Abs(pointCoordinate - planeCoordinate),
                Is.EqualTo(expectedDepth).Within(GeometryTolerance),
                $"{label} did not track the expected depth in type '{typeName}'.");
            return;
        }

        Assert.That(
            pointCoordinate,
            Is.EqualTo(planeCoordinate).Within(GeometryTolerance),
            $"{label} drifted away from plane '{plane.Name}' in type '{typeName}'.");
    }

    private static double ScorePointToPlaneCoordinate(XYZ point, RuntimePlaneProbe plane) =>
        Math.Abs(point.DotProduct(plane.Normal) - GetPlaneCoordinate(plane));

    private static XYZ BuildExpectedPoint(
        RuntimeStateProbe state,
        string planeName1,
        string? planeName2,
        string? planeName3
    ) {
        var coordinates = new double[3];

        ApplyPlaneCoordinate(GetPlane(state, planeName1), coordinates);
        if (!string.IsNullOrWhiteSpace(planeName2))
            ApplyPlaneCoordinate(GetPlane(state, planeName2!), coordinates);
        if (!string.IsNullOrWhiteSpace(planeName3))
            ApplyPlaneCoordinate(GetPlane(state, planeName3!), coordinates);

        return new XYZ(coordinates[0], coordinates[1], coordinates[2]);
    }

    private static void ApplyPlaneCoordinate(RuntimePlaneProbe plane, double[] coordinates) {
        var axisIndex = GetDominantAxisIndex(plane.Normal);
        coordinates[axisIndex] = GetCanonicalPlaneCoordinate(plane);
    }

    private static (XYZ WidthAxis, XYZ LengthAxis) ResolveExpectedRectangularFrame(
        ConnectorExpectation expectation,
        RuntimeStateProbe state,
        XYZ faceNormal
    ) {
        if (string.IsNullOrWhiteSpace(expectation.WidthAxisPlaneName) ||
            string.IsNullOrWhiteSpace(expectation.LengthAxisPlaneName)) {
            throw new AssertionException($"Connector '{expectation.Name}' did not carry rectangular frame plane names.");
        }

        var normalizedFace = FamilyFoundryRuntimeProbe.NormalizeOrThrow(faceNormal, $"connector '{expectation.Name}' face normal");
        var rawWidthAxis = FamilyFoundryRuntimeProbe.NormalizeOrThrow(GetPlane(state, expectation.WidthAxisPlaneName!).Normal, $"{expectation.Name} width axis plane");
        var rawLengthAxis = FamilyFoundryRuntimeProbe.NormalizeOrThrow(GetPlane(state, expectation.LengthAxisPlaneName!).Normal, $"{expectation.Name} length axis plane");

        var directLengthAxis = FamilyFoundryRuntimeProbe.NormalizeOrThrow(normalizedFace.CrossProduct(rawWidthAxis), $"{expectation.Name} direct length axis");
        var flippedWidthAxis = rawWidthAxis.Negate();
        var flippedLengthAxis = FamilyFoundryRuntimeProbe.NormalizeOrThrow(normalizedFace.CrossProduct(flippedWidthAxis), $"{expectation.Name} flipped length axis");
        return directLengthAxis.DotProduct(rawLengthAxis) >= flippedLengthAxis.DotProduct(rawLengthAxis)
            ? (rawWidthAxis, directLengthAxis)
            : (flippedWidthAxis, flippedLengthAxis);
    }

    private static int GetDominantAxisIndex(XYZ normal) {
        var components = new[] { Math.Abs(normal.X), Math.Abs(normal.Y), Math.Abs(normal.Z) };
        var max = components.Max();
        return Array.IndexOf(components, max);
    }

    private static double GetAxisComponent(XYZ vector, int axisIndex) =>
        axisIndex switch {
            0 => vector.X,
            1 => vector.Y,
            _ => vector.Z
        };

    private static XYZ GetCanonicalAxis(int axisIndex) =>
        axisIndex switch {
            0 => XYZ.BasisX,
            1 => XYZ.BasisY,
            _ => XYZ.BasisZ
        };

    private static IReadOnlyList<int> IgnoreAxis(int axisIndex) =>
        new[] { 0, 1, 2 }.Where(index => index != axisIndex).ToList();

    private static double GetPointAxisDifference(XYZ actual, XYZ expected, IReadOnlyList<int> axes) =>
        axes.Sum(axis => Math.Abs(GetCoordinate(actual, axis) - GetCoordinate(expected, axis)));

    private static double GetCoordinate(XYZ point, int axisIndex) =>
        axisIndex switch {
            0 => point.X,
            1 => point.Y,
            _ => point.Z
        };

    private static XYZ GetCenter(XYZ min, XYZ max) =>
        new((min.X + max.X) * 0.5, (min.Y + max.Y) * 0.5, (min.Z + max.Z) * 0.5);

    private static double ScoreStubCylinderCandidate(
        RuntimeCylinderProbe candidate,
        ConnectorExpectation expectation,
        RuntimeConnectorProbe connector,
        RuntimePlaneProbe facePlane,
        double expectedDiameter,
        RuntimeStateProbe state
    ) {
        var centerScore = GetPointAxisDifference(GetCenter(candidate.Min, candidate.Max), connector.Origin, IgnoreAxis(GetDominantAxisIndex(facePlane.Normal)));
        var diameterScore = Math.Abs(candidate.Diameter - expectedDiameter);
        var depthScore = Math.Abs(GetExtrusionDepth(candidate.Min, candidate.Max, facePlane.Normal) - ResolveParameterValue(expectation.DepthParameter, state));
        return centerScore + diameterScore + depthScore;
    }

    private static void AssertStubCylinder(
        RuntimeCylinderProbe candidate,
        ConnectorExpectation expectation,
        RuntimeConnectorProbe connector,
        RuntimePlaneProbe facePlane,
        RuntimeStateProbe state,
        string typeName
    ) {
        var faceAxisIndex = GetDominantAxisIndex(facePlane.Normal);
        var actualMin = ProjectBounds(candidate.Min, candidate.Max, faceAxisIndex, takeMax: false);
        var actualMax = ProjectBounds(candidate.Min, candidate.Max, faceAxisIndex, takeMax: true);
        var connectorCoordinate = GetCoordinate(connector.Origin, faceAxisIndex);
        var expectedDepth = ResolveParameterValue(expectation.DepthParameter, state);

        Assert.That(Math.Min(Math.Abs(actualMin - connectorCoordinate), Math.Abs(actualMax - connectorCoordinate)), Is.LessThanOrEqualTo(GeometryTolerance), $"Round stub for connector '{expectation.Name}' drifted away from its connector origin in type '{typeName}'.");
        Assert.That(Math.Abs(actualMax - actualMin), Is.EqualTo(expectedDepth).Within(GeometryTolerance), $"Round stub for connector '{expectation.Name}' did not track depth in type '{typeName}'.");
        Assert.That(GetPointAxisDifference(GetCenter(candidate.Min, candidate.Max), connector.Origin, IgnoreAxis(faceAxisIndex)), Is.LessThanOrEqualTo(GeometryTolerance), $"Round stub for connector '{expectation.Name}' drifted away from its connector center in type '{typeName}'.");
    }

    private static double ScoreStubPrismCandidate(
        RuntimePrismProbe candidate,
        ConnectorExpectation expectation,
        RuntimeConnectorProbe connector,
        RuntimePlaneProbe facePlane,
        double expectedWidth,
        double expectedLength,
        RuntimeStateProbe state
    ) {
        var centerScore = GetPointAxisDifference(GetCenter(candidate.Min, candidate.Max), connector.Origin, IgnoreAxis(GetDominantAxisIndex(facePlane.Normal)));
        var widthScore = Math.Abs(GetProjectedExtent(candidate.Min, candidate.Max, GetPlane(state, expectation.CenterPlane1!).Normal) - expectedWidth);
        var lengthScore = Math.Abs(GetProjectedExtent(candidate.Min, candidate.Max, GetPlane(state, expectation.CenterPlane2!).Normal) - expectedLength);
        var depthScore = Math.Abs(GetExtrusionDepth(candidate.Min, candidate.Max, facePlane.Normal) - ResolveParameterValue(expectation.DepthParameter, state));
        return centerScore + widthScore + lengthScore + depthScore;
    }

    private static void AssertStubPrism(
        RuntimePrismProbe candidate,
        ConnectorExpectation expectation,
        RuntimeConnectorProbe connector,
        RuntimePlaneProbe facePlane,
        RuntimeStateProbe state,
        string typeName
    ) {
        var faceAxisIndex = GetDominantAxisIndex(facePlane.Normal);
        var actualMin = ProjectBounds(candidate.Min, candidate.Max, faceAxisIndex, takeMax: false);
        var actualMax = ProjectBounds(candidate.Min, candidate.Max, faceAxisIndex, takeMax: true);
        var connectorCoordinate = GetCoordinate(connector.Origin, faceAxisIndex);
        var expectedDepth = ResolveParameterValue(expectation.DepthParameter, state);

        Assert.That(Math.Min(Math.Abs(actualMin - connectorCoordinate), Math.Abs(actualMax - connectorCoordinate)), Is.LessThanOrEqualTo(GeometryTolerance), $"Rectangular stub for connector '{expectation.Name}' drifted away from its connector origin in type '{typeName}'.");
        Assert.That(Math.Abs(actualMax - actualMin), Is.EqualTo(expectedDepth).Within(GeometryTolerance), $"Rectangular stub for connector '{expectation.Name}' did not track depth in type '{typeName}'.");
        Assert.That(GetPointAxisDifference(GetCenter(candidate.Min, candidate.Max), connector.Origin, IgnoreAxis(faceAxisIndex)), Is.LessThanOrEqualTo(GeometryTolerance), $"Rectangular stub for connector '{expectation.Name}' drifted away from its connector center in type '{typeName}'.");
    }

    private static double GetExtrusionDepth(XYZ min, XYZ max, XYZ axis) =>
        Math.Abs(ProjectBounds(min, max, axis, takeMax: true) - ProjectBounds(min, max, axis, takeMax: false));

    private static double GetProjectedExtent(XYZ min, XYZ max, XYZ axis) =>
        Math.Abs(ProjectBounds(min, max, axis, takeMax: true) - ProjectBounds(min, max, axis, takeMax: false));

    private static string? GetDriverParameterName(LengthDriverSpec? driver) =>
        driver == null || string.IsNullOrWhiteSpace(driver.ParameterName)
            ? null
            : driver.ParameterName.Trim();

    private static FlowDirectionType? ResolveExpectedFlowDirection(CompiledParamDrivenConnectorSpec spec) =>
        spec.Domain switch {
            ParamDrivenConnectorDomain.Duct => spec.Config.Duct?.FlowDirection,
            ParamDrivenConnectorDomain.Pipe => spec.Config.Pipe?.FlowDirection,
            _ => null
        };

    private static MEPSystemClassification? ResolveExpectedSystemClassification(CompiledParamDrivenConnectorSpec spec) {
        if (spec.Domain == ParamDrivenConnectorDomain.Duct) {
            return spec.Config.Duct?.SystemType switch {
                DuctSystemType.SupplyAir => MEPSystemClassification.SupplyAir,
                DuctSystemType.ReturnAir => MEPSystemClassification.ReturnAir,
                DuctSystemType.ExhaustAir => MEPSystemClassification.ExhaustAir,
                _ => null
            };
        }

        if (spec.Domain != ParamDrivenConnectorDomain.Pipe)
            return null;

        return spec.Config.Pipe?.SystemType switch {
            PipeSystemType.OtherPipe => MEPSystemClassification.OtherPipe,
            PipeSystemType.Sanitary => MEPSystemClassification.Sanitary,
            PipeSystemType.SupplyHydronic => MEPSystemClassification.SupplyHydronic,
            PipeSystemType.ReturnHydronic => MEPSystemClassification.ReturnHydronic,
            PipeSystemType.DomesticColdWater => MEPSystemClassification.DomesticColdWater,
            PipeSystemType.DomesticHotWater => MEPSystemClassification.DomesticHotWater,
            _ => null
        };
    }

    private static IReadOnlyList<ExtrusionVerticalSpan> GetOrderedExtrusionVerticalSpans(Document familyDocument) =>
        new FilteredElementCollector(familyDocument)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .Select(extrusion => {
                var box = extrusion.get_BoundingBox(null)
                    ?? throw new InvalidOperationException($"Extrusion '{extrusion.Id.IntegerValue}' had no bounding box.");
                return new ExtrusionVerticalSpan(
                    extrusion.IsSolid,
                    box.Min.Z,
                    box.Max.Z,
                    (box.Max.X - box.Min.X) * (box.Max.Y - box.Min.Y) * (box.Max.Z - box.Min.Z));
            })
            .OrderBy(span => span.MinZ)
            .ThenByDescending(span => span.Volume)
            .ToList();

    private static bool IsAdditionalHorizontalReferencePlane(ReferencePlane plane) {
        var normal = FamilyFoundryRuntimeProbe.NormalizeOrThrow(plane.Normal, $"reference plane '{plane.Name}' normal");
        if (Math.Abs(normal.Z) <= 0.95)
            return false;

        var name = plane.Name?.Trim() ?? string.Empty;
        return !string.Equals(name, "Reference Plane", StringComparison.OrdinalIgnoreCase) &&
               !string.Equals(name, "Ref. Level", StringComparison.OrdinalIgnoreCase) &&
               !string.Equals(name, "Reference Level", StringComparison.OrdinalIgnoreCase) &&
               !string.Equals(name, "Level", StringComparison.OrdinalIgnoreCase);
    }

    private static RectangularConnectorOrientationMeasurement MeasureRectangularConnectorOrientation(Document familyDocument) {
        var connector = new FilteredElementCollector(familyDocument)
            .OfClass(typeof(ConnectorElement))
            .Cast<ConnectorElement>()
            .Single(entry => entry.Shape == ConnectorProfileType.Rectangular);
        var coordinateSystem = connector.CoordinateSystem
            ?? throw new InvalidOperationException($"Rectangular connector '{connector.Id.IntegerValue}' had no coordinate system.");
        return new RectangularConnectorOrientationMeasurement(
            FamilyFoundryRuntimeProbe.NormalizeOrThrow(coordinateSystem.BasisX, "connector width axis"),
            FamilyFoundryRuntimeProbe.NormalizeOrThrow(coordinateSystem.BasisY, "connector length axis"),
            FamilyFoundryRuntimeProbe.NormalizeOrThrow(coordinateSystem.BasisZ, "connector face normal"));
    }

    private static double ComputeUnsignedAlignment(XYZ left, XYZ right) =>
        Math.Abs(FamilyFoundryRuntimeProbe.NormalizeOrThrow(left, nameof(left)).DotProduct(FamilyFoundryRuntimeProbe.NormalizeOrThrow(right, nameof(right))));

    private static double ComputeSignedAlignment(XYZ left, XYZ right) =>
        FamilyFoundryRuntimeProbe.NormalizeOrThrow(left, nameof(left)).DotProduct(FamilyFoundryRuntimeProbe.NormalizeOrThrow(right, nameof(right)));
}
