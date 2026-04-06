using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;

namespace Pe.FamilyFoundry.Resolution;

public static partial class AuthoredParamDrivenSolidsCompiler {
    private static PairResolution ResolveGeneratedSpan(
        string ownerName,
        string axisName,
        AuthoredCenterMeasureSpec spec,
        string negativePlaneName,
        string positivePlaneName,
        IDictionary<string, PublishedSpan> spans,
        IDictionary<string, PublishedPlane> planes,
        IDictionary<string, SymmetricPlanePairSpec> symmetricPairs,
        IList<ParamDrivenSolidsDiagnostic> diagnostics,
        string path
    ) {
        if (spans.TryGetValue(BuildPairKey(negativePlaneName, positivePlaneName), out var existing))
            return PairResolution.Compiled(existing.NegativePlaneName, existing.PositivePlaneName, existing.Driver);

        var about = ResolvePlaneRef(spec.About, planes, diagnostics, ownerName, path);
        if (about.Outcome != CompileOutcome.Compiled)
            return PairResolution.FromOutcome(about.Outcome);

        if (!TryParseLengthDriver(spec.By, ownerName, path, diagnostics, out var driver))
            return PairResolution.Invalid;

        var symmetric = new SymmetricPlanePairSpec {
            OwnerName = ownerName.Trim(),
            PlaneNameBase = $"{ownerName.Trim()} {axisName}",
            CenterPlaneName = about.PlaneName!,
            NegativePlaneName = negativePlaneName,
            PositivePlaneName = positivePlaneName,
            Parameter = driver.TryGetParameterName(),
            Driver = driver,
            Strength = RpStrength.StrongRef
        };
        symmetricPairs.TryAdd(BuildSymmetricKey(symmetric), symmetric);
        spans[BuildPairKey(negativePlaneName, positivePlaneName)] = new PublishedSpan(negativePlaneName, positivePlaneName, driver);
        planes[negativePlaneName] = new PublishedPlane(negativePlaneName, driver);
        planes[positivePlaneName] = new PublishedPlane(positivePlaneName, driver);
        return PairResolution.Compiled(negativePlaneName, positivePlaneName, driver);
    }

    private static PairResolution ResolvePairOrInlineSpan(
        string ownerName,
        string axisName,
        PlanePairOrInlineSpanSpec spec,
        IDictionary<string, PublishedSpan> spans,
        IDictionary<string, PublishedPlane> planes,
        IDictionary<string, SymmetricPlanePairSpec> symmetricPairs,
        IList<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        if (spec.PlaneRefs is { Count: > 0 }) {
            if (spec.PlaneRefs.Count != 2) {
                diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                    ParamDrivenDiagnosticSeverity.Error,
                    ownerName,
                    $"$.ParamDrivenSolids.{ownerName}.{axisName}",
                    $"{axisName} must contain exactly two plane refs."));
                return PairResolution.Invalid;
            }

            var ref1 = ResolvePlaneRef(spec.PlaneRefs[0], planes, diagnostics, ownerName, $"$.ParamDrivenSolids.{ownerName}.{axisName}");
            var ref2 = ResolvePlaneRef(spec.PlaneRefs[1], planes, diagnostics, ownerName, $"$.ParamDrivenSolids.{ownerName}.{axisName}");
            if (ref1.Outcome != CompileOutcome.Compiled || ref2.Outcome != CompileOutcome.Compiled)
                return ref1.Outcome == CompileOutcome.Deferred || ref2.Outcome == CompileOutcome.Deferred
                    ? PairResolution.FromOutcome(CompileOutcome.Deferred)
                    : PairResolution.Invalid;

            if (spans.TryGetValue(BuildPairKey(ref1.PlaneName!, ref2.PlaneName!), out var exact))
                return PairResolution.Compiled(exact.NegativePlaneName, exact.PositivePlaneName, exact.Driver);

            if (spans.TryGetValue(BuildPairKey(ref2.PlaneName!, ref1.PlaneName!), out var reversed))
                return PairResolution.Compiled(ref1.PlaneName!, ref2.PlaneName!, reversed.Driver);

            return PairResolution.Compiled(ref1.PlaneName!, ref2.PlaneName!, LengthDriverSpec.None);
        }

        if (spec.InlineSpan == null) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                ownerName,
                $"$.ParamDrivenSolids.{ownerName}.{axisName}",
                $"{axisName} requires a plane pair or inline span."));
            return PairResolution.Invalid;
        }

        var inline = spec.InlineSpan;
        var key = BuildPairKey(inline.Negative, inline.Positive);
        if (spans.TryGetValue(key, out var published))
            return PairResolution.Compiled(published.NegativePlaneName, published.PositivePlaneName, published.Driver);

        var outcome = TryCompileSpan(inline, spans, planes, symmetricPairs, diagnostics);
        if (outcome != CompileOutcome.Compiled)
            return PairResolution.FromOutcome(outcome);

        published = spans[key];
        return PairResolution.Compiled(published.NegativePlaneName, published.PositivePlaneName, published.Driver);
    }

    private static PlaneResolution ResolvePlaneOrInlinePlane(
        string ownerName,
        string axisName,
        PlaneRefOrInlinePlaneSpec spec,
        IDictionary<string, PublishedPlane> planes,
        IDictionary<string, OffsetPlaneConstraintSpec> offsets,
        IList<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        if (!string.IsNullOrWhiteSpace(spec.PlaneRef)) {
            var resolved = ResolvePlaneRef(spec.PlaneRef, planes, diagnostics, ownerName, $"$.ParamDrivenSolids.{ownerName}.{axisName}");
            if (resolved.Outcome != CompileOutcome.Compiled)
                return PlaneResolution.FromOutcome(resolved.Outcome);

            var driver = planes.TryGetValue(resolved.PlaneName!, out var published)
                ? published.Driver
                : LengthDriverSpec.None;
            return PlaneResolution.Compiled(resolved.PlaneName!, driver);
        }

        if (spec.InlinePlane == null || string.IsNullOrWhiteSpace(spec.InlinePlane.Name)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                ownerName,
                $"$.ParamDrivenSolids.{ownerName}.{axisName}",
                $"{axisName} requires a plane ref or inline plane with Name."));
            return PlaneResolution.Invalid;
        }

        var inline = spec.InlinePlane;
        var normalizedName = inline.Name.Trim();
        if (planes.TryGetValue(normalizedName, out var existing))
            return PlaneResolution.Compiled(existing.Name, existing.Driver);

        var outcome = TryCompilePlane(normalizedName, inline, planes, offsets, diagnostics);
        if (outcome != CompileOutcome.Compiled)
            return PlaneResolution.FromOutcome(outcome);

        var created = planes[normalizedName];
        return PlaneResolution.Compiled(created.Name, created.Driver);
    }

    private static HeightResolution ResolveHeightSpec(
        string ownerName,
        PlaneRefOrInlinePlaneSpec spec,
        IDictionary<string, PublishedPlane> planes,
        IDictionary<string, OffsetPlaneConstraintSpec> offsets,
        IList<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        if (spec.EndOffset != null) {
            if (!TryParseLengthDriver(spec.EndOffset.By, ownerName, $"$.ParamDrivenSolids.{ownerName}.Height", diagnostics, out var driver))
                return HeightResolution.Invalid;

            if (!TryParseOffsetDirection(spec.EndOffset.Dir, out var direction)) {
                diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                    ParamDrivenDiagnosticSeverity.Error,
                    ownerName,
                    $"$.ParamDrivenSolids.{ownerName}.Height.Dir",
                    $"Height Dir '{spec.EndOffset.Dir}' is invalid."));
                return HeightResolution.Invalid;
            }

            var endOffset = direction == OffsetDirection.Negative ? -1.0 : 1.0;
            return HeightResolution.FromEndOffset(endOffset, driver);
        }

        var plane = ResolvePlaneOrInlinePlane(ownerName, "Height", spec, planes, offsets, diagnostics);
        return plane.Outcome != CompileOutcome.Compiled
            ? HeightResolution.FromOutcome(plane.Outcome)
            : HeightResolution.ReferencePlane(plane.PlaneName!, plane.Driver);
    }

    private static PlaneRefResolution ResolvePlaneRef(
        string planeRef,
        IDictionary<string, PublishedPlane> planes,
        IList<ParamDrivenSolidsDiagnostic> diagnostics,
        string ownerName,
        string path
    ) {
        if (string.IsNullOrWhiteSpace(planeRef)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                ownerName,
                path,
                "Plane ref is required."));
            return PlaneRefResolution.Invalid;
        }

        var normalized = planeRef.Trim();
        if (BuiltInPlaneNames.TryGetValue(normalized, out var builtInPlane))
            return PlaneRefResolution.Compiled(builtInPlane);

        if (normalized.StartsWith("plane:", StringComparison.OrdinalIgnoreCase)) {
            var authoredName = normalized["plane:".Length..].Trim();
            if (string.IsNullOrWhiteSpace(authoredName)) {
                diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                    ParamDrivenDiagnosticSeverity.Error,
                    ownerName,
                    path,
                    $"Plane ref '{planeRef}' is invalid."));
                return PlaneRefResolution.Invalid;
            }

            return planes.TryGetValue(authoredName, out var published)
                ? PlaneRefResolution.Compiled(published.Name)
                : PlaneRefResolution.Deferred;
        }

        if (planes.TryGetValue(normalized, out var plane))
            return PlaneRefResolution.Compiled(plane.Name);

        diagnostics.Add(new ParamDrivenSolidsDiagnostic(
            ParamDrivenDiagnosticSeverity.Error,
            ownerName,
            path,
            $"Plane ref '{planeRef}' is invalid. Expected a built-in '@Plane' token or 'plane:<name>'."));
        return PlaneRefResolution.Invalid;
    }

    private static bool TryParseLengthDriver(
        string authoredValue,
        string ownerName,
        string path,
        IList<ParamDrivenSolidsDiagnostic> diagnostics,
        out LengthDriverSpec driver
    ) {
        driver = LengthDriverSpec.None;
        var normalized = authoredValue?.Trim();
        if (string.IsNullOrWhiteSpace(normalized)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                ownerName,
                path,
                "A param:<name> or literal length is required."));
            return false;
        }

        if (normalized.StartsWith("param:", StringComparison.OrdinalIgnoreCase)) {
            var parameterName = normalized["param:".Length..].Trim();
            if (string.IsNullOrWhiteSpace(parameterName)) {
                diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                    ParamDrivenDiagnosticSeverity.Error,
                    ownerName,
                    path,
                    $"Parameter ref '{authoredValue}' is invalid."));
                return false;
            }

            driver = LengthDriverSpec.FromParameter(parameterName, normalized);
            return true;
        }

        var match = LengthLiteralPattern.Match(normalized);
        if (!match.Success) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                ownerName,
                path,
                $"Length value '{authoredValue}' is invalid. Expected param:<name> or a literal like 2in or 0.5ft."));
            return false;
        }

        var magnitude = double.Parse(match.Groups["value"].Value, System.Globalization.CultureInfo.InvariantCulture);
        var unit = match.Groups["unit"].Value;
        var feet = unit.Equals("ft", StringComparison.OrdinalIgnoreCase) || unit == "'"
            ? magnitude
            : magnitude / 12.0;
        driver = LengthDriverSpec.FromLiteral(feet, normalized);
        return true;
    }

    private static string BuildPairKey(string plane1, string plane2) =>
        $"{plane1?.Trim()}|{plane2?.Trim()}";

    private static string BuildSymmetricKey(SymmetricPlanePairSpec spec) =>
        $"M|{spec.PlaneNameBase}|{spec.CenterPlaneName}|{BuildDriverKey(spec.Driver, spec.Parameter)}|{spec.Strength}";

    private static string BuildOffsetKey(OffsetPlaneConstraintSpec spec) =>
        $"O|{spec.PlaneName}|{spec.AnchorPlaneName}|{spec.Direction}|{BuildDriverKey(spec.Driver, spec.Parameter)}|{spec.Strength}";

    private static string BuildDriverKey(LengthDriverSpec driver, string? parameter) {
        if (driver.IsLiteralDriven)
            return $"L:{driver.LiteralValue?.ToString("R", System.Globalization.CultureInfo.InvariantCulture)}";

        return $"P:{driver.TryGetParameterName() ?? parameter ?? string.Empty}";
    }

    private enum PendingWorkKind {
        Plane,
        Span,
        Prism,
        Cylinder,
        Connector
    }

    private enum CompileOutcome {
        Compiled,
        Deferred,
        Invalid
    }

    private sealed record PendingWorkItem(
        PendingWorkKind Kind,
        string Name,
        AuthoredPlaneSpec? Plane,
        AuthoredSpanSpec? Span,
        AuthoredPrismSpec? Prism,
        AuthoredCylinderSpec? Cylinder,
        AuthoredConnectorSpec? Connector
    ) {
        public static PendingWorkItem ForPlane(string name, AuthoredPlaneSpec plane) =>
            new(PendingWorkKind.Plane, name, plane, null, null, null, null);

        public static PendingWorkItem ForSpan(AuthoredSpanSpec span) =>
            new(PendingWorkKind.Span, $"{span.Negative}/{span.Positive}", null, span, null, null, null);

        public static PendingWorkItem ForPrism(AuthoredPrismSpec prism) =>
            new(PendingWorkKind.Prism, prism.Name, null, null, prism, null, null);

        public static PendingWorkItem ForCylinder(AuthoredCylinderSpec cylinder) =>
            new(PendingWorkKind.Cylinder, cylinder.Name, null, null, null, cylinder, null);

        public static PendingWorkItem ForConnector(AuthoredConnectorSpec connector) =>
            new(PendingWorkKind.Connector, connector.Name, null, null, null, null, connector);
    }

    private sealed record PublishedPlane(string Name, LengthDriverSpec Driver);
    private sealed record PublishedSpan(string NegativePlaneName, string PositivePlaneName, LengthDriverSpec Driver);

    private readonly record struct PlaneRefResolution(CompileOutcome Outcome, string? PlaneName) {
        public static PlaneRefResolution Compiled(string planeName) => new(CompileOutcome.Compiled, planeName);
        public static PlaneRefResolution Deferred => new(CompileOutcome.Deferred, null);
        public static PlaneRefResolution Invalid => new(CompileOutcome.Invalid, null);
    }

    private readonly record struct PairResolution(
        CompileOutcome Outcome,
        string? PlaneName1,
        string? PlaneName2,
        LengthDriverSpec Driver
    ) {
        public static PairResolution Compiled(string planeName1, string planeName2, LengthDriverSpec driver) =>
            new(CompileOutcome.Compiled, planeName1, planeName2, driver);

        public static PairResolution Invalid => new(CompileOutcome.Invalid, null, null, LengthDriverSpec.None);

        public static PairResolution FromOutcome(CompileOutcome outcome) =>
            new(outcome, null, null, LengthDriverSpec.None);
    }

    private readonly record struct PlaneResolution(
        CompileOutcome Outcome,
        string? PlaneName,
        LengthDriverSpec Driver
    ) {
        public static PlaneResolution Compiled(string planeName, LengthDriverSpec driver) =>
            new(CompileOutcome.Compiled, planeName, driver);

        public static PlaneResolution Invalid => new(CompileOutcome.Invalid, null, LengthDriverSpec.None);

        public static PlaneResolution FromOutcome(CompileOutcome outcome) =>
            new(outcome, null, LengthDriverSpec.None);
    }

    private readonly record struct HeightResolution(
        CompileOutcome Outcome,
        ExtrusionHeightControlMode Mode,
        string? PlaneName,
        LengthDriverSpec Driver,
        double StartOffset,
        double EndOffset
    ) {
        public static HeightResolution ReferencePlane(string planeName, LengthDriverSpec driver) =>
            new(CompileOutcome.Compiled, ExtrusionHeightControlMode.ReferencePlane, planeName, driver, 0.0, 1.0);

        public static HeightResolution FromEndOffset(double endOffset, LengthDriverSpec driver) =>
            new(CompileOutcome.Compiled, ExtrusionHeightControlMode.EndOffset, null, driver, 0.0, endOffset);

        public static HeightResolution Invalid =>
            new(CompileOutcome.Invalid, ExtrusionHeightControlMode.ReferencePlane, null, LengthDriverSpec.None, 0.0, 0.0);

        public static HeightResolution FromOutcome(CompileOutcome outcome) =>
            new(outcome, ExtrusionHeightControlMode.ReferencePlane, null, LengthDriverSpec.None, 0.0, 0.0);
    }
}
