using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;

namespace Pe.FamilyFoundry.Resolution;

public static class ParamDrivenSolidsCompiler {
    private const double ConnectorStubSeedDepth = 0.5 / 12.0;

    public static ParamDrivenSolidsCompileResult Compile(ParamDrivenSolidsSettings settings) {
        var diagnostics = new List<ParamDrivenSolidsDiagnostic>();
        var aliasMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var mirrorSpecs = new Dictionary<string, MirrorSpec>(StringComparer.Ordinal);
        var offsetSpecs = new Dictionary<string, OffsetSpec>(StringComparer.Ordinal);
        var rectangles = new List<ConstrainedRectangleExtrusionSpec>();
        var circles = new List<ConstrainedCircleExtrusionSpec>();
        var connectors = new List<CompiledParamDrivenConnectorSpec>();

        var workItems = settings.Rectangles
            .Select((spec, index) => PendingWorkItem.ForRectangle(index, spec))
            .Concat(settings.Cylinders.Select((spec, index) => PendingWorkItem.ForCylinder(settings.Rectangles.Count + index, spec)))
            .Concat(settings.Connectors.Select((spec, index) => PendingWorkItem.ForConnector(settings.Rectangles.Count + settings.Cylinders.Count + index, spec)))
            .OrderBy(item => item.Order)
            .ToList();

        var pending = new Queue<PendingWorkItem>(workItems);
        var maxPasses = Math.Max(1, workItems.Count * 3);

        for (var pass = 0; pass < maxPasses && pending.Count > 0; pass++) {
            var passCount = pending.Count;
            var compiledInPass = false;

            for (var i = 0; i < passCount; i++) {
                var workItem = pending.Dequeue();
                var outcome = workItem.Kind switch {
                    PendingWorkKind.Rectangle => TryCompileRectangle(workItem.Rectangle!, aliasMap, mirrorSpecs, offsetSpecs, rectangles, diagnostics),
                    PendingWorkKind.Cylinder => TryCompileCylinder(workItem.Cylinder!, aliasMap, mirrorSpecs, offsetSpecs, circles, diagnostics),
                    PendingWorkKind.Connector => TryCompileConnector(workItem.Connector!, aliasMap, mirrorSpecs, offsetSpecs, connectors, diagnostics),
                    _ => CompileOutcome.Invalid
                };

                if (outcome == CompileOutcome.Compiled) {
                    compiledInPass = true;
                    continue;
                }

                if (outcome == CompileOutcome.Deferred)
                    pending.Enqueue(workItem);
            }

            if (!compiledInPass)
                break;
        }

        foreach (var unresolved in pending) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                unresolved.Name,
                "$.ParamDrivenSolids",
                "Spec depends on unresolved semantic aliases or participates in a cycle."));
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
            new MakeParamDrivenConnectorsSettings {
                Enabled = connectors.Count > 0,
                Connectors = connectors
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

        var width = CompileAxis(spec.Name, "Width", spec.Width, AxisSemanticRole.Width, aliasMap, mirrorSpecs, offsetSpecs, diagnostics);
        var length = CompileAxis(spec.Name, "Length", spec.Length, AxisSemanticRole.Length, aliasMap, mirrorSpecs, offsetSpecs, diagnostics);
        var height = CompileAxis(spec.Name, "Height", spec.Height, AxisSemanticRole.Height, aliasMap, mirrorSpecs, offsetSpecs, diagnostics);

        if (width.Outcome == CompileOutcome.Deferred || length.Outcome == CompileOutcome.Deferred || height.Outcome == CompileOutcome.Deferred)
            return CompileOutcome.Deferred;
        if (width.Outcome == CompileOutcome.Invalid || length.Outcome == CompileOutcome.Invalid || height.Outcome == CompileOutcome.Invalid)
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
        if (resolvedCenterLeftRight.Outcome == CompileOutcome.Deferred || resolvedCenterFrontBack.Outcome == CompileOutcome.Deferred)
            return CompileOutcome.Deferred;

        if (resolvedCenterLeftRight.Outcome != CompileOutcome.Compiled || resolvedCenterFrontBack.Outcome != CompileOutcome.Compiled) {
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

        var height = CompileAxis(spec.Name, "Height", spec.Height, AxisSemanticRole.Height, aliasMap, mirrorSpecs, offsetSpecs, diagnostics);
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

    private static CompileOutcome TryCompileConnector(
        ParamDrivenConnectorSpec spec,
        Dictionary<string, string> aliasMap,
        Dictionary<string, MirrorSpec> mirrorSpecs,
        Dictionary<string, OffsetSpec> offsetSpecs,
        List<CompiledParamDrivenConnectorSpec> connectors,
        List<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        var keyBase = $"$.ParamDrivenSolids.Connectors[{connectors.Count}]";
        if (string.IsNullOrWhiteSpace(spec.Name)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, spec.Name, $"{keyBase}.Name", "Connector Name is required."));
            return CompileOutcome.Invalid;
        }

        if (!CollectInferenceDiagnostics(spec.Name, keyBase, spec.Inference, diagnostics))
            return CompileOutcome.Invalid;

        var resolvedSketch = ResolvePlaneReference(spec.Host.SketchPlane, aliasMap);
        if (resolvedSketch.Outcome != CompileOutcome.Compiled) {
            if (resolvedSketch.Outcome == CompileOutcome.Invalid)
                diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, spec.Name, $"{keyBase}.Host.SketchPlane", $"Host sketch plane '{spec.Host.SketchPlane}' could not be resolved."));
            return resolvedSketch.Outcome;
        }

        if (spec.Host.Depth.Mode != AxisConstraintMode.Offset) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, spec.Name, $"{keyBase}.Host.Depth.Mode", "Connector depth must use Offset mode in this spike."));
            return CompileOutcome.Invalid;
        }

        if (!CollectInferenceDiagnostics(spec.Name, $"{keyBase}.Host.Depth", spec.Host.Depth.Inference, diagnostics))
            return CompileOutcome.Invalid;

        if (string.IsNullOrWhiteSpace(spec.Host.Depth.Parameter)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, spec.Name, $"{keyBase}.Host.Depth.Parameter", "Connector depth requires a driving Parameter."));
            return CompileOutcome.Invalid;
        }

        if (!string.IsNullOrWhiteSpace(spec.Host.Depth.Anchor)) {
            var resolvedDepthAnchor = ResolvePlaneReference(spec.Host.Depth.Anchor, aliasMap);
            if (resolvedDepthAnchor.Outcome != CompileOutcome.Compiled)
                return resolvedDepthAnchor.Outcome;

            if (!string.Equals(resolvedDepthAnchor.Value, resolvedSketch.Value, StringComparison.OrdinalIgnoreCase)) {
                diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, spec.Name, $"{keyBase}.Host.Depth.Anchor", "Connector depth Anchor must resolve to the same plane as Host.SketchPlane."));
                return CompileOutcome.Invalid;
            }
        }

        if (!ValidateDomainConfig(spec, keyBase, diagnostics))
            return CompileOutcome.Invalid;

        var stubSolidName = $"{spec.Name} Stub";
        var hostFacePlaneName = $"{spec.Name} HostFace";

        aliasMap[$"{spec.Name}.HostPlane"] = resolvedSketch.Value!;
        aliasMap[$"{spec.Name}.HostFace"] = hostFacePlaneName;
        aliasMap[$"{spec.Name}.Depth.Start"] = resolvedSketch.Value!;
        aliasMap[$"{spec.Name}.Depth.End"] = hostFacePlaneName;

        CompiledParamDrivenConnectorSpec compiled;
        if (spec.Geometry.Profile == ParamDrivenConnectorProfile.Rectangular) {
            var width = CompileAxis(spec.Name, "Width", spec.Geometry.Width, AxisSemanticRole.Width, aliasMap, mirrorSpecs, offsetSpecs, diagnostics);
            var length = CompileAxis(spec.Name, "Length", spec.Geometry.Length, AxisSemanticRole.Length, aliasMap, mirrorSpecs, offsetSpecs, diagnostics);
            if (width.Outcome == CompileOutcome.Deferred || length.Outcome == CompileOutcome.Deferred)
                return CompileOutcome.Deferred;
            if (width.Outcome == CompileOutcome.Invalid || length.Outcome == CompileOutcome.Invalid)
                return CompileOutcome.Invalid;

            compiled = new CompiledParamDrivenConnectorSpec {
                Name = spec.Name,
                StubSolidName = stubSolidName,
                Domain = spec.Domain,
                Profile = spec.Geometry.Profile,
                HostPlaneName = resolvedSketch.Value!,
                HostFacePlaneName = hostFacePlaneName,
                RectangularStub = new ConstrainedRectangleExtrusionSpec {
                    Name = stubSolidName,
                    IsSolid = spec.Geometry.IsSolid,
                    StartOffset = 0.0,
                    EndOffset = ConnectorStubSeedDepth,
                    SketchPlaneName = resolvedSketch.Value!,
                    PairAPlane1 = width.NegativePlaneName!,
                    PairAPlane2 = width.PositivePlaneName!,
                    PairAParameter = spec.Geometry.Width.Parameter,
                    PairBPlane1 = length.NegativePlaneName!,
                    PairBPlane2 = length.PositivePlaneName!,
                    PairBParameter = spec.Geometry.Length.Parameter,
                    HeightPlaneBottom = null,
                    HeightPlaneTop = null,
                    HeightParameter = null
                },
                Bindings = spec.Bindings,
                Config = spec.Config,
                AuthoredSpec = spec
            };
        } else {
            if (spec.Geometry.Diameter.Mode != AxisConstraintMode.Mirror) {
                diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, spec.Name, $"{keyBase}.Geometry.Diameter.Mode", "Round connector geometry requires Diameter mirror mode."));
                return CompileOutcome.Invalid;
            }

            if (string.IsNullOrWhiteSpace(spec.Geometry.Diameter.Parameter)) {
                diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, spec.Name, $"{keyBase}.Geometry.Diameter.Parameter", "Round connector geometry requires a driving Diameter parameter."));
                return CompileOutcome.Invalid;
            }

            if (!CollectInferenceDiagnostics(spec.Name, $"{keyBase}.Geometry.Diameter", spec.Geometry.Diameter.Inference, diagnostics))
                return CompileOutcome.Invalid;

            var resolvedCenterLeftRight = ResolvePlaneReference(spec.Geometry.CenterLeftRightPlane, aliasMap);
            var resolvedCenterFrontBack = ResolvePlaneReference(spec.Geometry.CenterFrontBackPlane, aliasMap);
            if (resolvedCenterLeftRight.Outcome == CompileOutcome.Deferred || resolvedCenterFrontBack.Outcome == CompileOutcome.Deferred)
                return CompileOutcome.Deferred;

            if (resolvedCenterLeftRight.Outcome != CompileOutcome.Compiled || resolvedCenterFrontBack.Outcome != CompileOutcome.Compiled) {
                diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, spec.Name, $"{keyBase}.Geometry", "Round connector geometry requires CenterLeftRightPlane and CenterFrontBackPlane."));
                return CompileOutcome.Invalid;
            }

            compiled = new CompiledParamDrivenConnectorSpec {
                Name = spec.Name,
                StubSolidName = stubSolidName,
                Domain = spec.Domain,
                Profile = spec.Geometry.Profile,
                HostPlaneName = resolvedSketch.Value!,
                HostFacePlaneName = hostFacePlaneName,
                RoundStub = new ConstrainedCircleExtrusionSpec {
                    Name = stubSolidName,
                    IsSolid = spec.Geometry.IsSolid,
                    StartOffset = 0.0,
                    EndOffset = ConnectorStubSeedDepth,
                    SketchPlaneName = resolvedSketch.Value!,
                    CenterLeftRightPlane = resolvedCenterLeftRight.Value!,
                    CenterFrontBackPlane = resolvedCenterFrontBack.Value!,
                    DiameterParameter = spec.Geometry.Diameter.Parameter,
                    HeightPlaneBottom = null,
                    HeightPlaneTop = null,
                    HeightParameter = null
                },
                Bindings = spec.Bindings,
                Config = spec.Config,
                AuthoredSpec = spec
            };
        }

        AddConnectorAliases(aliasMap, spec, compiled);
        connectors.Add(compiled);
        return CompileOutcome.Compiled;
    }

    private static void AddConnectorAliases(Dictionary<string, string> aliasMap, ParamDrivenConnectorSpec authored, CompiledParamDrivenConnectorSpec compiled) {
        if (compiled.Profile == ParamDrivenConnectorProfile.Rectangular && compiled.RectangularStub != null) {
            aliasMap[$"{authored.Name}.Width.Back"] = compiled.RectangularStub.PairAPlane1;
            aliasMap[$"{authored.Name}.Width.Front"] = compiled.RectangularStub.PairAPlane2;
            aliasMap[$"{authored.Name}.Length.Left"] = compiled.RectangularStub.PairBPlane1;
            aliasMap[$"{authored.Name}.Length.Right"] = compiled.RectangularStub.PairBPlane2;
            return;
        }

        if (compiled.RoundStub == null)
            return;

        aliasMap[$"{authored.Name}.Width.Back"] = compiled.RoundStub.CenterFrontBackPlane;
        aliasMap[$"{authored.Name}.Width.Front"] = compiled.RoundStub.CenterFrontBackPlane;
        aliasMap[$"{authored.Name}.Length.Left"] = compiled.RoundStub.CenterLeftRightPlane;
        aliasMap[$"{authored.Name}.Length.Right"] = compiled.RoundStub.CenterLeftRightPlane;
    }

    private static bool ValidateDomainConfig(ParamDrivenConnectorSpec spec, string keyBase, List<ParamDrivenSolidsDiagnostic> diagnostics) {
        if (spec.Domain == ParamDrivenConnectorDomain.Pipe && spec.Geometry.Profile != ParamDrivenConnectorProfile.Round) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, spec.Name, $"{keyBase}.Geometry.Profile", "Pipe connectors only support Round profile."));
            return false;
        }

        return spec.Domain switch {
            ParamDrivenConnectorDomain.Duct when spec.Config.Duct == null => AddMissingConfig(diagnostics, spec.Name, $"{keyBase}.Config.Duct", "Duct connectors require explicit duct config."),
            ParamDrivenConnectorDomain.Pipe when spec.Config.Pipe == null => AddMissingConfig(diagnostics, spec.Name, $"{keyBase}.Config.Pipe", "Pipe connectors require explicit pipe config."),
            ParamDrivenConnectorDomain.Electrical when spec.Config.Electrical == null => AddMissingConfig(diagnostics, spec.Name, $"{keyBase}.Config.Electrical", "Electrical connectors require explicit electrical config."),
            _ => true
        };
    }

    private static bool AddMissingConfig(List<ParamDrivenSolidsDiagnostic> diagnostics, string specName, string path, string message) {
        diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, specName, path, message));
        return false;
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

        if (string.IsNullOrWhiteSpace(axis.Parameter)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                solidName,
                $"{path}.Parameter",
                $"{axisName} requires a driving Parameter."));
            return AxisCompileResult.Invalid;
        }

        var planeNameBase = string.IsNullOrWhiteSpace(axis.PlaneNameBase) ? SynthesizePlaneNameBase(role) : axis.PlaneNameBase.Trim();

        return axis.Mode switch {
            AxisConstraintMode.Mirror => CompileMirrorAxis(solidName, axisName, axis, role, planeNameBase, aliasMap, mirrorSpecs, diagnostics),
            AxisConstraintMode.Offset => CompileOffsetAxis(solidName, axisName, axis, role, planeNameBase, aliasMap, offsetSpecs, diagnostics),
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
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, solidName, $"{path}.CenterAnchor", "Mirror mode requires CenterAnchor."));
            return AxisCompileResult.Invalid;
        }

        if (!string.IsNullOrWhiteSpace(axis.Anchor)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, solidName, $"{path}.Anchor", "Mirror mode does not allow Anchor."));
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
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, solidName, $"{path}.Anchor", "Offset mode requires Anchor."));
            return AxisCompileResult.Invalid;
        }

        if (!string.IsNullOrWhiteSpace(axis.CenterAnchor)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, solidName, $"{path}.CenterAnchor", "Offset mode does not allow CenterAnchor."));
            return AxisCompileResult.Invalid;
        }

        var resolvedAnchor = ResolvePlaneReference(axis.Anchor, aliasMap);
        if (resolvedAnchor.Outcome != CompileOutcome.Compiled)
            return AxisCompileResult.FromOutcome(resolvedAnchor.Outcome);

        var spec = new OffsetSpec {
            Name = planeNameBase,
            AnchorName = resolvedAnchor.Value!,
            Direction = axis.Direction,
            Parameter = axis.Parameter,
            Strength = axis.Strength
        };
        offsetSpecs.TryAdd(BuildOffsetKey(spec), spec);

        var (negativeLabel, positiveLabel) = GetRoleLabels(role);
        var negativePlane = axis.Direction == OffsetDirection.Positive ? resolvedAnchor.Value! : planeNameBase;
        var positivePlane = axis.Direction == OffsetDirection.Positive ? planeNameBase : resolvedAnchor.Value!;
        AddAxisAliases(aliasMap, solidName, axisName, negativeLabel, negativePlane, positiveLabel, positivePlane);
        return AxisCompileResult.Compiled(negativePlane, positivePlane);
    }

    private static bool ValidateSolid(string name, SketchTargetSpec sketch, string path, List<ParamDrivenSolidsDiagnostic> diagnostics) {
        var isValid = true;
        if (string.IsNullOrWhiteSpace(name)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, name, $"{path}.Name", "Solid Name is required."));
            isValid = false;
        }

        if (sketch.Kind != SketchTargetKind.ReferencePlane) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, name, $"{path}.Sketch.Kind", "Only ReferencePlane sketch targets are supported in this spike."));
            isValid = false;
        }

        if (string.IsNullOrWhiteSpace(sketch.Plane)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, name, $"{path}.Sketch.Plane", "Sketch.Plane is required."));
            isValid = false;
        }

        return isValid;
    }

    private static bool CollectInferenceDiagnostics(string solidName, string path, InferenceInfo? inference, List<ParamDrivenSolidsDiagnostic> diagnostics) {
        if (inference == null)
            return true;

        foreach (var warning in inference.Warnings.Where(warning => !string.IsNullOrWhiteSpace(warning)))
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Warning, solidName, path, warning.Trim()));

        if (inference.Status != InferenceStatus.Ambiguous)
            return true;

        diagnostics.Add(new ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity.Error, solidName, path, "Ambiguous inferred semantics must be fixed before execution."));
        return false;
    }

    private static ResolvedReference ResolvePlaneReference(string requestedName, Dictionary<string, string> aliasMap) {
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

    private static void AddAxisAliases(Dictionary<string, string> aliasMap, string solidName, string axisName, string negativeLabel, string negativePlaneName, string positiveLabel, string positivePlaneName) {
        aliasMap[$"{solidName}.{axisName}.{negativeLabel}"] = negativePlaneName;
        aliasMap[$"{solidName}.{axisName}.{positiveLabel}"] = positivePlaneName;
    }

    private static string BuildMirrorKey(MirrorSpec spec) => $"M|{spec.Name}|{spec.CenterAnchor}|{spec.Parameter}|{spec.Strength}";
    private static string BuildOffsetKey(OffsetSpec spec) => $"O|{spec.Name}|{spec.AnchorName}|{spec.Direction}|{spec.Parameter}|{spec.Strength}";

    private static string SynthesizePlaneNameBase(AxisSemanticRole role) => role switch {
        AxisSemanticRole.Width => "width",
        AxisSemanticRole.Length => "length",
        AxisSemanticRole.Height => "height",
        _ => "plane"
    };

    private static (string Negative, string Positive) GetRoleLabels(AxisSemanticRole role) => role switch {
        AxisSemanticRole.Width => ("Back", "Front"),
        AxisSemanticRole.Length => ("Left", "Right"),
        AxisSemanticRole.Height => ("Bottom", "Top"),
        _ => ("Negative", "Positive")
    };

    public static IReadOnlyList<string> ToDisplayMessages(IReadOnlyList<ParamDrivenSolidsDiagnostic> diagnostics) =>
        diagnostics.Select(diagnostic => diagnostic.ToDisplayMessage()).ToList();

    private enum AxisSemanticRole { Width, Length, Height }
    private enum CompileOutcome { Compiled, Deferred, Invalid }

    private readonly record struct ResolvedReference(CompileOutcome Outcome, string? Value) {
        public static ResolvedReference Deferred => new(CompileOutcome.Deferred, null);
        public static ResolvedReference Invalid => new(CompileOutcome.Invalid, null);
    }

    private readonly record struct AxisCompileResult(CompileOutcome Outcome, string? NegativePlaneName, string? PositivePlaneName) {
        public static AxisCompileResult Invalid => new(CompileOutcome.Invalid, null, null);
        public static AxisCompileResult Compiled(string negativePlaneName, string positivePlaneName) => new(CompileOutcome.Compiled, negativePlaneName, positivePlaneName);
        public static AxisCompileResult FromOutcome(CompileOutcome outcome) => new(outcome, null, null);
    }

    private sealed record PendingWorkItem(
        PendingWorkKind Kind,
        int Order,
        string Name,
        ParamDrivenRectangleSpec? Rectangle,
        ParamDrivenCylinderSpec? Cylinder,
        ParamDrivenConnectorSpec? Connector
    ) {
        public static PendingWorkItem ForRectangle(int order, ParamDrivenRectangleSpec rectangle) => new(PendingWorkKind.Rectangle, order, rectangle.Name, rectangle, null, null);
        public static PendingWorkItem ForCylinder(int order, ParamDrivenCylinderSpec cylinder) => new(PendingWorkKind.Cylinder, order, cylinder.Name, null, cylinder, null);
        public static PendingWorkItem ForConnector(int order, ParamDrivenConnectorSpec connector) => new(PendingWorkKind.Connector, order, connector.Name, null, null, connector);
    }

    private enum PendingWorkKind { Rectangle, Cylinder, Connector }
}

public sealed record ParamDrivenSolidsCompileResult(
    MakeRefPlaneAndDimsSettings RefPlanesAndDims,
    MakeConstrainedExtrusionsSettings InternalExtrusions,
    MakeParamDrivenConnectorsSettings Connectors,
    IReadOnlyList<ParamDrivenSolidsDiagnostic> Diagnostics,
    IReadOnlyDictionary<string, string> SemanticAliases
) {
    public bool CanExecute => this.Diagnostics.All(diagnostic => diagnostic.Severity != ParamDrivenDiagnosticSeverity.Error);
}

public sealed record ParamDrivenSolidsDiagnostic(ParamDrivenDiagnosticSeverity Severity, string SolidName, string Path, string Message) {
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
