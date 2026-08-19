using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>
///     Asserts a Revit runtime probe against the pure-math prediction of the same portable document.
/// </summary>
/// <remarks>
///     <para>
///         This is the complement of the Revit-vs-Revit roundtrip comparison, not a replacement for it.
///         The roundtrip proves that the pipeline reproduces itself; this proves that what the pipeline
///         produces is what the portable document says.
///     </para>
///     <para>
///         Matching is by geometry, because the probe carries no logical slug: a Revit extrusion has an
///         ElementId and a sketch plane name, and neither recovers the authored identity. Each predicted
///         solid claims the closest unclaimed probe of the same kind and solidity. The probe also carries
///         extrusions the portable solids section never authored — connector stubs are extrusions too —
///         so unmatched probe entries are ignored on purpose and counts are never asserted here.
///     </para>
/// </remarks>
internal static class FamilyModelEvaluatorOracleAssert {
    public static void AssertProbeMatchesPrediction(
        FamilyModel model,
        RuntimeStateProbe probe,
        double tolerance = 1e-6
    ) {
        var prediction = FamilyModelEvaluatorOracle.Predict(model, probe.ParameterValues);
        var context = $"{model.Family.Name} / {probe.TypeName}";

        var remainingPrisms = probe.Prisms.ToList();
        foreach (var predicted in prediction.Solids.Where(solid => solid.IsPrism)) {
            var candidates = remainingPrisms.Where(candidate => candidate.IsSolid == predicted.IsSolid).ToList();
            var match = SelectClosest(candidates, candidate => BoxDistance(predicted, candidate.Min, candidate.Max));
            if (match == null) {
                Assert.Fail($"{context}: no {predicted.Kind} extrusion was found for solid '{predicted.Slug}'; " +
                            $"predicted {predicted.Min}..{predicted.Max}.");
                return;
            }

            _ = remainingPrisms.Remove(match);
            AssertBox(context, predicted, match.Min, match.Max, tolerance);
        }

        var remainingCylinders = probe.Cylinders.ToList();
        foreach (var predicted in prediction.Solids.Where(solid => solid.IsCylinder)) {
            var candidates = remainingCylinders.Where(candidate => candidate.IsSolid == predicted.IsSolid).ToList();
            var match = SelectClosest(
                candidates,
                candidate => Math.Max(
                    BoxDistance(predicted, candidate.Min, candidate.Max),
                    Math.Abs(candidate.Diameter - predicted.Diameter!.Value)));
            if (match == null) {
                Assert.Fail($"{context}: no {predicted.Kind} extrusion was found for solid '{predicted.Slug}'; " +
                            $"predicted {predicted.Min}..{predicted.Max}.");
                return;
            }

            _ = remainingCylinders.Remove(match);
            AssertBox(context, predicted, match.Min, match.Max, tolerance);
            Assert.That(match.Diameter, Is.EqualTo(predicted.Diameter!.Value).Within(tolerance),
                $"{context}: solid '{predicted.Slug}' diameter; " +
                $"predicted {FamilyModelEvaluatorOracle.Format(predicted.Diameter!.Value)}, " +
                $"actual {FamilyModelEvaluatorOracle.Format(match.Diameter)}.");
        }

        // The probe classifies an extrusion as rectangular or round and nothing else, so a predicted
        // ExtrudedPolygon has no probe list to be matched against. Nothing can build one yet either — the
        // lowerer refuses the kind — so this says what is missing rather than passing in silence.
        foreach (var predicted in prediction.Solids.Where(solid => !solid.IsPrism && !solid.IsCylinder)) {
            Assert.Fail($"{context}: solid '{predicted.Slug}' is a {predicted.Kind}; the runtime probe reads " +
                        "rectangular and round extrusions only, so this prediction cannot be checked against Revit.");
        }

        foreach (var predicted in prediction.Planes)
            AssertPlane(context, predicted, probe, tolerance);
    }

    private static void AssertPlane(
        string context,
        PredictedPlane predicted,
        RuntimeStateProbe probe,
        double tolerance
    ) {
        if (!probe.Planes.TryGetValue(predicted.Name, out var actual)) {
            Assert.Fail($"{context}: reference plane '{predicted.Name}' is missing. " +
                        $"Probed planes: {string.Join(", ", probe.Planes.Keys.OrderBy(name => name, StringComparer.Ordinal))}");
            return;
        }

        var expectedNormal = predicted.Geometry.Normal;
        // A reference plane has no preferred normal sign in Revit, so the normal is asserted as an
        // orientation, not a direction. The in-plane position of the Revit origin is not a portable claim
        // and is deliberately not checked — only that the plane Revit built is the plane predicted.
        var alignment = (actual.Normal.X * expectedNormal.X) +
                        (actual.Normal.Y * expectedNormal.Y) +
                        (actual.Normal.Z * expectedNormal.Z);
        Assert.That(Math.Abs(alignment), Is.EqualTo(1.0).Within(tolerance),
            $"{context}: plane '{predicted.Name}' must be normal to {Format(expectedNormal)}; " +
            $"actual normal [{FamilyModelEvaluatorOracle.Format(actual.Normal.X)}, " +
            $"{FamilyModelEvaluatorOracle.Format(actual.Normal.Y)}, " +
            $"{FamilyModelEvaluatorOracle.Format(actual.Normal.Z)}].");

        var offAxis = ((actual.Midpoint.X - predicted.Geometry.Point.X) * expectedNormal.X) +
                      ((actual.Midpoint.Y - predicted.Geometry.Point.Y) * expectedNormal.Y) +
                      ((actual.Midpoint.Z - predicted.Geometry.Point.Z) * expectedNormal.Z);
        Assert.That(offAxis, Is.EqualTo(0.0).Within(tolerance),
            $"{context}: plane '{predicted.Name}' distance from the predicted plane " +
            $"{Format(predicted.Geometry.Point)} normal {Format(expectedNormal)}; " +
            $"actual midpoint [{FamilyModelEvaluatorOracle.Format(actual.Midpoint.X)}, " +
            $"{FamilyModelEvaluatorOracle.Format(actual.Midpoint.Y)}, " +
            $"{FamilyModelEvaluatorOracle.Format(actual.Midpoint.Z)}].");
    }

    private static string Format(FamilyModelVector vector) =>
        $"[{FamilyModelEvaluatorOracle.Format(vector.X)}, {FamilyModelEvaluatorOracle.Format(vector.Y)}, " +
        $"{FamilyModelEvaluatorOracle.Format(vector.Z)}]";

    private static void AssertBox(
        string context,
        PredictedSolid predicted,
        XYZ actualMin,
        XYZ actualMax,
        double tolerance
    ) {
        AssertCorner(context, predicted, "Min", predicted.Min, actualMin, tolerance);
        AssertCorner(context, predicted, "Max", predicted.Max, actualMax, tolerance);
    }

    private static void AssertCorner(
        string context,
        PredictedSolid predicted,
        string corner,
        PredictedPoint expected,
        XYZ actual,
        double tolerance
    ) {
        foreach (var axis in new[] {
                     FamilyModelCoordinateAxis.X, FamilyModelCoordinateAxis.Y, FamilyModelCoordinateAxis.Z
                 }) {
            Assert.That(Component(actual, axis), Is.EqualTo(expected.Component(axis)).Within(tolerance),
                $"{context}: solid '{predicted.Slug}' ({predicted.Kind}) {corner}.{axis}; " +
                $"predicted {FamilyModelEvaluatorOracle.Format(expected.Component(axis))}, " +
                $"actual {FamilyModelEvaluatorOracle.Format(Component(actual, axis))}. " +
                $"Predicted box {predicted.Min}..{predicted.Max}.");
        }
    }

    private static TProbe? SelectClosest<TProbe>(IReadOnlyList<TProbe> candidates, Func<TProbe, double> distance)
        where TProbe : class =>
        candidates.Count == 0 ? null : candidates.OrderBy(distance).First();

    private static double BoxDistance(PredictedSolid predicted, XYZ actualMin, XYZ actualMax) =>
        new[] {
            Math.Abs(actualMin.X - predicted.Min.X),
            Math.Abs(actualMin.Y - predicted.Min.Y),
            Math.Abs(actualMin.Z - predicted.Min.Z),
            Math.Abs(actualMax.X - predicted.Max.X),
            Math.Abs(actualMax.Y - predicted.Max.Y),
            Math.Abs(actualMax.Z - predicted.Max.Z)
        }.Max();

    private static double Component(XYZ vector, FamilyModelCoordinateAxis axis) => axis switch {
        FamilyModelCoordinateAxis.X => vector.X,
        FamilyModelCoordinateAxis.Y => vector.Y,
        _ => vector.Z
    };
}
