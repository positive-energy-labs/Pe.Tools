using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;

namespace Pe.FamilyFoundry.Resolution;

public static class ParamDrivenSolidsCompiler {
    public static ParamDrivenSolidsCompileResult Compile(ParamDrivenSolidsSettings settings) {
        var diagnostics = new List<ParamDrivenSolidsDiagnostic>();
        var aliasMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var mirrorSpecs = new Dictionary<string, MirrorSpec>(StringComparer.Ordinal);
        var offsetSpecs = new Dictionary<string, OffsetSpec>(StringComparer.Ordinal);
        var rectangles = new List<ConstrainedRectangleExtrusionSpec>();
        var circles = new List<ConstrainedCircleExtrusionSpec>();

        var workItems = settings.Rectangles
            .Select((spec, index) => PendingSolidWorkItem.ForRectangle(index, spec))
            .Concat(settings.Cylinders.Select((spec, index) => PendingSolidWorkItem.ForCylinder(index, spec)))
            .OrderBy(item => item.Order)
            .ToList();

        var pending = new Queue<PendingSolidWorkItem>(workItems);
        var maxPasses = Math.Max(1, workItems.Count * 2);

        for (var pass = 0; pass < maxPasses && pending.Count > 0; pass++) {
            var passCount = pending.Count;
            var compiledInPass = false;

            for (var i = 0; i < passCount; i++) {
                var workItem = pending.Dequeue();
                var outcome = workItem.Kind == PendingSolidKind.Rectangle
                    ? TryCompileRectangle(
                        workItem.Rectangle!,
                        aliasMap,
                        mirrorSpecs,
                        offsetSpecs,
                        rectangles,
                        diagnostics)
                    : TryCompileCylinder(
                        workItem.Cylinder!,
                        aliasMap,
                        mirrorSpecs,
                        offsetSpecs,
                        circles,
                        diagnostics);

                if (outcome == CompileOutcome.Compiled) {
                    compiledInPass = true;
                    continue;
                }

                if (outcome == CompileOutcome.Deferred) {
                    pending.Enqueue(workItem);
                    continue;
                }
            }

            if (!compiledInPass)
                break;
        }

        foreach (var unresolved in pending) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                unresolved.Name,
                "$.ParamDrivenSolids",
                "Solid depends on unresolved semantic aliases or participates in a cycle."));
        }

        return new ParamDrivenSolidsCompileResult(
            new MakeRefPlaneAndDimsSettings {
                Enabled = mirrorSpecs.Count > 0 || offsetSpecs.Count > 0,
                MirrorSpecs = mirrorSpecs.Values.ToList(),
                OffsetSpecs = offsetSpecs.Values.ToList()
            },
            new MakeConstrainedExtrusionsSettings {
                Enabled = rectangles.Count > 0 || circles.Count > 0,
                Rectangles = rectangles,
                Circles = circles
            },
            diagnostics,
            aliasMap
        );
    }

    private static CompileOutcome TryCompileRectangle(
        ParamDrivenRectangleSpec spec,
        Dictionary<string, string> aliasMap,
        Dictionary<string, MirrorSpec> mirrorSpecs,
        Dictionary<string, OffsetSpec> offsetSpecs,
        List<ConstrainedRectangleExtrusionSpec> rectangles,
        List<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        var keyBase = $"$.ParamDrivenSolids.Rectangles[{rectangles.Count}]";
        if (!ValidateSolid(spec.Name, spec.Sketch, keyBase, diagnostics))
            return CompileOutcome.Invalid;

        if (!CollectInferenceDiagnostics(spec.Name, keyBase, spec.Inference, diagnostics))
            return CompileOutcome.Invalid;

        var resolvedSketch = ResolvePlaneReference(spec.Sketch.Plane, aliasMap);
        if (resolvedSketch.Outcome != CompileOutcome.Compiled) {
            if (resolvedSketch.Outcome == CompileOutcome.Invalid)
                diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                    ParamDrivenDiagnosticSeverity.Error,
                    spec.Name,
                    $"{keyBase}.Sketch.Plane",
                    $"Sketch plane '{spec.Sketch.Plane}' could not be resolved."));
            return resolvedSketch.Outcome;
        }

        var width = CompileAxis(
            spec.Name,
            "Width",
            spec.Width,
            AxisSemanticRole.Width,
            aliasMap,
            mirrorSpecs,
            offsetSpecs,
            diagnostics);
        var length = CompileAxis(
            spec.Name,
            "Length",
            spec.Length,
            AxisSemanticRole.Length,
            aliasMap,
            mirrorSpecs,
            offsetSpecs,
            diagnostics);
        var height = CompileAxis(
            spec.Name,
            "Height",
            spec.Height,
            AxisSemanticRole.Height,
            aliasMap,
            mirrorSpecs,
            offsetSpecs,
            diagnostics);

        if (width.Outcome == CompileOutcome.Deferred ||
            length.Outcome == CompileOutcome.Deferred ||
            height.Outcome == CompileOutcome.Deferred)
            return CompileOutcome.Deferred;

        if (width.Outcome == CompileOutcome.Invalid ||
            length.Outcome == CompileOutcome.Invalid ||
            height.Outcome == CompileOutcome.Invalid)
            return CompileOutcome.Invalid;

        rectangles.Add(new ConstrainedRectangleExtrusionSpec {
            Name = spec.Name,
            IsSolid = spec.IsSolid,
            StartOffset = 0.0,
            EndOffset = 1.0,
            SketchPlaneName = resolvedSketch.Value!,
            PairAPlane1 = width.NegativePlaneName!,
            PairAPlane2 = width.PositivePlaneName!,
            PairAParameter = spec.Width.Parameter,
            PairBPlane1 = length.NegativePlaneName!,
            PairBPlane2 = length.PositivePlaneName!,
            PairBParameter = spec.Length.Parameter,
            HeightPlaneBottom = height.NegativePlaneName,
            HeightPlaneTop = height.PositivePlaneName,
            HeightParameter = spec.Height.Parameter
        });

        return CompileOutcome.Compiled;
    }

    private static CompileOutcome TryCompileCylinder(
        ParamDrivenCylinderSpec spec,
        Dictionary<string, string> aliasMap,
        Dictionary<string, MirrorSpec> mirrorSpecs,
        Dictionary<string, OffsetSpec> offsetSpecs,
        List<ConstrainedCircleExtrusionSpec> circles,
        List<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        var keyBase = $"$.ParamDrivenSolids.Cylinders[{circles.Count}]";
        if (!ValidateSolid(spec.Name, spec.Sketch, keyBase, diagnostics))
            return CompileOutcome.Invalid;

        if (!CollectInferenceDiagnostics(spec.Name, keyBase, spec.Inference, diagnostics))
            return CompileOutcome.Invalid;

        var resolvedSketch = ResolvePlaneReference(spec.Sketch.Plane, aliasMap);
        if (resolvedSketch.Outcome != CompileOutcome.Compiled) {
            if (resolvedSketch.Outcome == CompileOutcome.Invalid)
                diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                    ParamDrivenDiagnosticSeverity.Error,
                    spec.Name,
                    $"{keyBase}.Sketch.Plane",
                    $"Sketch plane '{spec.Sketch.Plane}' could not be resolved."));
            return resolvedSketch.Outcome;
        }

        var resolvedCenterLeftRight = ResolvePlaneReference(spec.CenterLeftRightPlane, aliasMap);
        var resolvedCenterFrontBack = ResolvePlaneReference(spec.CenterFrontBackPlane, aliasMap);
        if (resolvedCenterLeftRight.Outcome == CompileOutcome.Deferred ||
            resolvedCenterFrontBack.Outcome == CompileOutcome.Deferred)
            return CompileOutcome.Deferred;

        if (resolvedCenterLeftRight.Outcome != CompileOutcome.Compiled ||
            resolvedCenterFrontBack.Outcome != CompileOutcome.Compiled) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                spec.Name,
                keyBase,
                "Cylinders require CenterLeftRightPlane and CenterFrontBackPlane."));
            return CompileOutcome.Invalid;
        }

        if (spec.Diameter.Mode != AxisConstraintMode.Mirror) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                spec.Name,
                $"{keyBase}.Diameter.Mode",
                "Cylinder Diameter only supports Mirror mode in this spike."));
            return CompileOutcome.Invalid;
        }

        if (!CollectInferenceDiagnostics(spec.Name, $"{keyBase}.Diameter", spec.Diameter.Inference, diagnostics))
            return CompileOutcome.Invalid;

        var height = CompileAxis(
            spec.Name,
            "Height",
            spec.Height,
            AxisSemanticRole.Height,
            aliasMap,
            mirrorSpecs,
            offsetSpecs,
            diagnostics);

        if (height.Outcome == CompileOutcome.Deferred)
            return CompileOutcome.Deferred;

        if (height.Outcome == CompileOutcome.Invalid)
            return CompileOutcome.Invalid;

        circles.Add(new ConstrainedCircleExtrusionSpec {
            Name = spec.Name,
            IsSolid = spec.IsSolid,
            StartOffset = 0.0,
            EndOffset = 1.0,
            SketchPlaneName = resolvedSketch.Value!,
            CenterLeftRightPlane = resolvedCenterLeftRight.Value!,
            CenterFrontBackPlane = resolvedCenterFrontBack.Value!,
            DiameterParameter = spec.Diameter.Parameter,
            HeightPlaneBottom = height.NegativePlaneName,
            HeightPlaneTop = height.PositivePlaneName,
            HeightParameter = spec.Height.Parameter
        });

        return CompileOutcome.Compiled;
    }

    private static AxisCompileResult CompileAxis(
        string solidName,
        string axisName,
        AxisConstraintSpec axis,
        AxisSemanticRole role,
        Dictionary<string, string> aliasMap,
        Dictionary<string, MirrorSpec> mirrorSpecs,
        Dictionary<string, OffsetSpec> offsetSpecs,
        List<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        var path = $"$.ParamDrivenSolids.{solidName}.{axisName}";
        if (!CollectInferenceDiagnostics(solidName, path, axis.Inference, diagnostics))
            return AxisCompileResult.Invalid;

        var planeNameBase = string.IsNullOrWhiteSpace(axis.PlaneNameBase)
            ? SynthesizePlaneNameBase(role)
            : axis.PlaneNameBase.Trim();

        return axis.Mode switch {
            AxisConstraintMode.Mirror => CompileMirrorAxis(
                solidName,
                axisName,
                axis,
                role,
                planeNameBase,
                aliasMap,
                mirrorSpecs,
                diagnostics),
            AxisConstraintMode.Offset => CompileOffsetAxis(
                solidName,
                axisName,
                axis,
                role,
                planeNameBase,
                aliasMap,
                offsetSpecs,
                diagnostics),
            _ => AxisCompileResult.Invalid
        };
    }

    private static AxisCompileResult CompileMirrorAxis(
        string solidName,
        string axisName,
        AxisConstraintSpec axis,
        AxisSemanticRole role,
        string planeNameBase,
        Dictionary<string, string> aliasMap,
        Dictionary<string, MirrorSpec> mirrorSpecs,
        List<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        var path = $"$.ParamDrivenSolids.{solidName}.{axisName}";
        if (string.IsNullOrWhiteSpace(axis.CenterAnchor)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                solidName,
                $"{path}.CenterAnchor",
                "Mirror mode requires CenterAnchor."));
            return AxisCompileResult.Invalid;
        }

        if (!string.IsNullOrWhiteSpace(axis.Anchor)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                solidName,
                $"{path}.Anchor",
                "Mirror mode does not allow Anchor."));
            return AxisCompileResult.Invalid;
        }

        var resolvedCenter = ResolvePlaneReference(axis.CenterAnchor, aliasMap);
        if (resolvedCenter.Outcome != CompileOutcome.Compiled)
            return AxisCompileResult.FromOutcome(resolvedCenter.Outcome);

        var (negativeLabel, positiveLabel) = GetRoleLabels(role);
        var negativePlaneName = $"{planeNameBase} ({negativeLabel})";
        var positivePlaneName = $"{planeNameBase} ({positiveLabel})";
        var spec = new MirrorSpec {
            Name = planeNameBase,
            CenterAnchor = resolvedCenter.Value!,
            Parameter = axis.Parameter,
            Strength = axis.Strength
        };

        mirrorSpecs.TryAdd(BuildMirrorKey(spec), spec);
        AddAxisAliases(aliasMap, solidName, axisName, negativeLabel, negativePlaneName, positiveLabel, positivePlaneName);

        return AxisCompileResult.Compiled(negativePlaneName, positivePlaneName);
    }

    private static AxisCompileResult CompileOffsetAxis(
        string solidName,
        string axisName,
        AxisConstraintSpec axis,
        AxisSemanticRole role,
        string planeNameBase,
        Dictionary<string, string> aliasMap,
        Dictionary<string, OffsetSpec> offsetSpecs,
        List<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        var path = $"$.ParamDrivenSolids.{solidName}.{axisName}";
        if (string.IsNullOrWhiteSpace(axis.Anchor)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                solidName,
                $"{path}.Anchor",
                "Offset mode requires Anchor."));
            return AxisCompileResult.Invalid;
        }

        if (!string.IsNullOrWhiteSpace(axis.CenterAnchor)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                solidName,
                $"{path}.CenterAnchor",
                "Offset mode does not allow CenterAnchor."));
            return AxisCompileResult.Invalid;
        }

        var resolvedAnchor = ResolvePlaneReference(axis.Anchor, aliasMap);
        if (resolvedAnchor.Outcome != CompileOutcome.Compiled)
            return AxisCompileResult.FromOutcome(resolvedAnchor.Outcome);

        var targetPlaneName = planeNameBase;
        var spec = new OffsetSpec {
            Name = targetPlaneName,
            AnchorName = resolvedAnchor.Value!,
            Direction = axis.Direction,
            Parameter = axis.Parameter,
            Strength = axis.Strength
        };
        offsetSpecs.TryAdd(BuildOffsetKey(spec), spec);

        var (negativeLabel, positiveLabel) = GetRoleLabels(role);
        var negativePlane = axis.Direction == OffsetDirection.Positive ? resolvedAnchor.Value! : targetPlaneName;
        var positivePlane = axis.Direction == OffsetDirection.Positive ? targetPlaneName : resolvedAnchor.Value!;
        AddAxisAliases(aliasMap, solidName, axisName, negativeLabel, negativePlane, positiveLabel, positivePlane);

        return AxisCompileResult.Compiled(negativePlane, positivePlane);
    }

    private static bool ValidateSolid(
        string name,
        SketchTargetSpec sketch,
        string path,
        List<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        var isValid = true;

        if (string.IsNullOrWhiteSpace(name)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                name,
                $"{path}.Name",
                "Solid Name is required."));
            isValid = false;
        }

        if (sketch.Kind != SketchTargetKind.ReferencePlane) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                name,
                $"{path}.Sketch.Kind",
                "Only ReferencePlane sketch targets are supported in this spike."));
            isValid = false;
        }

        if (string.IsNullOrWhiteSpace(sketch.Plane)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                name,
                $"{path}.Sketch.Plane",
                "Sketch.Plane is required."));
            isValid = false;
        }

        return isValid;
    }

    private static bool CollectInferenceDiagnostics(
        string solidName,
        string path,
        InferenceInfo? inference,
        List<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        if (inference == null)
            return true;

        foreach (var warning in inference.Warnings.Where(warning => !string.IsNullOrWhiteSpace(warning))) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Warning,
                solidName,
                path,
                warning.Trim()));
        }

        if (inference.Status != InferenceStatus.Ambiguous)
            return true;

        diagnostics.Add(new ParamDrivenSolidsDiagnostic(
            ParamDrivenDiagnosticSeverity.Error,
            solidName,
            path,
            "Ambiguous inferred semantics must be fixed before execution."));
        return false;
    }

    private static ResolvedReference ResolvePlaneReference(
        string requestedName,
        Dictionary<string, string> aliasMap
    ) {
        if (string.IsNullOrWhiteSpace(requestedName))
            return ResolvedReference.Invalid;

        var trimmed = requestedName.Trim();
        if (aliasMap.TryGetValue(trimmed, out var resolved))
            return new ResolvedReference(CompileOutcome.Compiled, resolved);

        return LooksLikeSemanticAlias(trimmed)
            ? ResolvedReference.Deferred
            : new ResolvedReference(CompileOutcome.Compiled, trimmed);
    }

    private static bool LooksLikeSemanticAlias(string value) =>
        value.Contains('.', StringComparison.Ordinal) &&
        value.Split('.', StringSplitOptions.RemoveEmptyEntries).Length >= 3;

    private static void AddAxisAliases(
        Dictionary<string, string> aliasMap,
        string solidName,
        string axisName,
        string negativeLabel,
        string negativePlaneName,
        string positiveLabel,
        string positivePlaneName
    ) {
        aliasMap[$"{solidName}.{axisName}.{negativeLabel}"] = negativePlaneName;
        aliasMap[$"{solidName}.{axisName}.{positiveLabel}"] = positivePlaneName;
    }

    private static string BuildMirrorKey(MirrorSpec spec) =>
        $"M|{spec.Name}|{spec.CenterAnchor}|{spec.Parameter}|{spec.Strength}";

    private static string BuildOffsetKey(OffsetSpec spec) =>
        $"O|{spec.Name}|{spec.AnchorName}|{spec.Direction}|{spec.Parameter}|{spec.Strength}";

    private static string SynthesizePlaneNameBase(AxisSemanticRole role) =>
        role switch {
            AxisSemanticRole.Width => "width",
            AxisSemanticRole.Length => "length",
            AxisSemanticRole.Height => "height",
            _ => "plane"
        };

    private static (string Negative, string Positive) GetRoleLabels(AxisSemanticRole role) =>
        role switch {
            AxisSemanticRole.Width => ("Back", "Front"),
            AxisSemanticRole.Length => ("Left", "Right"),
            AxisSemanticRole.Height => ("Bottom", "Top"),
            _ => ("Negative", "Positive")
        };

    public static IReadOnlyList<string> ToDisplayMessages(IReadOnlyList<ParamDrivenSolidsDiagnostic> diagnostics) =>
        diagnostics.Select(diagnostic => diagnostic.ToDisplayMessage()).ToList();

    private enum AxisSemanticRole {
        Width,
        Length,
        Height
    }

    private enum CompileOutcome {
        Compiled,
        Deferred,
        Invalid
    }

    private readonly record struct ResolvedReference(CompileOutcome Outcome, string? Value) {
        public static ResolvedReference Deferred => new(CompileOutcome.Deferred, null);
        public static ResolvedReference Invalid => new(CompileOutcome.Invalid, null);
    }

    private readonly record struct AxisCompileResult(
        CompileOutcome Outcome,
        string? NegativePlaneName,
        string? PositivePlaneName
    ) {
        public static AxisCompileResult Invalid => new(CompileOutcome.Invalid, null, null);

        public static AxisCompileResult Compiled(string negativePlaneName, string positivePlaneName) =>
            new(CompileOutcome.Compiled, negativePlaneName, positivePlaneName);

        public static AxisCompileResult FromOutcome(CompileOutcome outcome) => new(outcome, null, null);
    }

    private sealed record PendingSolidWorkItem(
        PendingSolidKind Kind,
        int Order,
        string Name,
        ParamDrivenRectangleSpec? Rectangle,
        ParamDrivenCylinderSpec? Cylinder
    ) {
        public static PendingSolidWorkItem ForRectangle(int order, ParamDrivenRectangleSpec rectangle) =>
            new(PendingSolidKind.Rectangle, order, rectangle.Name, rectangle, null);

        public static PendingSolidWorkItem ForCylinder(int order, ParamDrivenCylinderSpec cylinder) =>
            new(PendingSolidKind.Cylinder, order, cylinder.Name, null, cylinder);
    }

    private enum PendingSolidKind {
        Rectangle,
        Cylinder
    }
}

public sealed record ParamDrivenSolidsCompileResult(
    MakeRefPlaneAndDimsSettings RefPlanesAndDims,
    MakeConstrainedExtrusionsSettings InternalExtrusions,
    IReadOnlyList<ParamDrivenSolidsDiagnostic> Diagnostics,
    IReadOnlyDictionary<string, string> SemanticAliases
) {
    public bool CanExecute => this.Diagnostics.All(diagnostic => diagnostic.Severity != ParamDrivenDiagnosticSeverity.Error);
}

public sealed record ParamDrivenSolidsDiagnostic(
    ParamDrivenDiagnosticSeverity Severity,
    string SolidName,
    string Path,
    string Message
) {
    public string ToDisplayMessage() {
        var prefix = this.Severity == ParamDrivenDiagnosticSeverity.Error ? "Error" : "Warning";
        var solidSegment = string.IsNullOrWhiteSpace(this.SolidName) ? string.Empty : $" [{this.SolidName}]";
        return $"{prefix}{solidSegment} {this.Path}: {this.Message}";
    }
}

public enum ParamDrivenDiagnosticSeverity {
    Warning,
    Error
}
