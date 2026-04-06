using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Snapshots;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Pe.Revit.FamilyFoundry.Resolution;

public static partial class AuthoredParamDrivenSolidsCompiler {
    private const double ConnectorStubSeedDepth = 0.5 / 12.0;
    private static readonly Regex LengthLiteralPattern = new(
        @"^\s*(?<value>[-+]?\d+(?:\.\d+)?)\s*(?<unit>in|""|ft|')\s*$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly IReadOnlyDictionary<string, string> BuiltInPlaneNames =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            ["@Left"] = "Left",
            ["@Right"] = "Right",
            ["@Front"] = "Front",
            ["@Back"] = "Back",
            ["@Top"] = "Top",
            ["@Bottom"] = "Reference Plane",
            ["@CenterLR"] = "Center (Left/Right)",
            ["@CenterFB"] = "Center (Front/Back)"
        };

    public static ParamDrivenSolidsCompileResult Compile(AuthoredParamDrivenSolidsSettings settings) {
        var diagnostics = new List<ParamDrivenSolidsDiagnostic>();
        var planes = new Dictionary<string, PublishedPlane>(StringComparer.OrdinalIgnoreCase);
        var spans = new Dictionary<string, PublishedSpan>(StringComparer.OrdinalIgnoreCase);
        var symmetricPairs = new Dictionary<string, SymmetricPlanePairSpec>(StringComparer.Ordinal);
        var offsetConstraints = new Dictionary<string, OffsetPlaneConstraintSpec>(StringComparer.Ordinal);
        var rectangles = new List<ConstrainedRectangleExtrusionSpec>();
        var circles = new List<ConstrainedCircleExtrusionSpec>();
        var connectors = new List<CompiledParamDrivenConnectorSpec>();

        SeedBuiltInPlanes(settings.Frame, planes, diagnostics);
        ValidateTopLevelPlaneNameCollisions(settings, diagnostics);

        var pending = BuildWorkItems(settings).ToList();
        var maxPasses = Math.Max(1, pending.Count * 3);

        for (var pass = 0; pass < maxPasses && pending.Count > 0; pass++) {
            var nextPass = new List<PendingWorkItem>();
            var compiledThisPass = false;

            foreach (var item in pending) {
                var outcome = item.Kind switch {
                    PendingWorkKind.Plane => TryCompilePlane(item.Name, item.Plane!, planes, offsetConstraints, diagnostics),
                    PendingWorkKind.Span => TryCompileSpan(item.Span!, spans, planes, symmetricPairs, diagnostics),
                    PendingWorkKind.Prism => TryCompilePrism(item.Prism!, spans, planes, symmetricPairs, offsetConstraints, rectangles, diagnostics),
                    PendingWorkKind.Cylinder => TryCompileCylinder(item.Cylinder!, planes, offsetConstraints, circles, diagnostics),
                    PendingWorkKind.Connector => TryCompileConnector(item.Connector!, spans, planes, symmetricPairs, offsetConstraints, connectors, diagnostics),
                    _ => CompileOutcome.Invalid
                };

                if (outcome == CompileOutcome.Compiled) {
                    compiledThisPass = true;
                    continue;
                }

                if (outcome == CompileOutcome.Deferred)
                    nextPass.Add(item);
            }

            if (!compiledThisPass) {
                foreach (var item in nextPass) {
                    diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                        ParamDrivenDiagnosticSeverity.Error,
                        item.Name,
                        "$.ParamDrivenSolids",
                        "Spec depends on unresolved plane refs or participates in a cycle."));
                }

                nextPass.Clear();
            }

            pending = nextPass;
        }

        var connectorFacePlanes = settings.Connectors
            .Select(connector => connector.Face?.Trim())
            .Where(face => !string.IsNullOrWhiteSpace(face) && face.StartsWith("plane:", StringComparison.OrdinalIgnoreCase))
            .Select(face => face!["plane:".Length..].Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var otherNamedPlaneRefs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void AddPlaneRef(string? planeRef) {
            if (string.IsNullOrWhiteSpace(planeRef) || !planeRef.StartsWith("plane:", StringComparison.OrdinalIgnoreCase))
                return;

            _ = otherNamedPlaneRefs.Add(planeRef["plane:".Length..].Trim());
        }

        void AddInlinePlaneName(string? planeName) {
            if (string.IsNullOrWhiteSpace(planeName))
                return;

            _ = otherNamedPlaneRefs.Add(planeName.Trim());
        }

        foreach (var plane in settings.Planes.Values)
            AddPlaneRef(plane.From);

        foreach (var span in settings.Spans)
            AddPlaneRef(span.About);

        foreach (var prism in settings.Prisms) {
            AddPlaneRef(prism.On);
            foreach (var planeRef in prism.Width.PlaneRefs ?? [])
                AddPlaneRef(planeRef);

            AddPlaneRef(prism.Width.InlineSpan?.About);

            foreach (var planeRef in prism.Length.PlaneRefs ?? [])
                AddPlaneRef(planeRef);

            AddPlaneRef(prism.Length.InlineSpan?.About);
            AddPlaneRef(prism.Height.PlaneRef);
            AddPlaneRef(prism.Height.InlinePlane?.From);
            AddInlinePlaneName(prism.Height.InlinePlane?.Name);
        }

        foreach (var cylinder in settings.Cylinders) {
            AddPlaneRef(cylinder.On);
            foreach (var planeRef in cylinder.Center)
                AddPlaneRef(planeRef);

            AddPlaneRef(cylinder.Height.PlaneRef);
            AddPlaneRef(cylinder.Height.InlinePlane?.From);
            AddInlinePlaneName(cylinder.Height.InlinePlane?.Name);
        }

        foreach (var connector in settings.Connectors) {
            if (connector.Round != null) {
                foreach (var planeRef in connector.Round.Center)
                    AddPlaneRef(planeRef);
            }

            if (connector.Rect == null)
                continue;

            foreach (var planeRef in connector.Rect.Center)
                AddPlaneRef(planeRef);

            AddPlaneRef(connector.Rect.Width.About);
            AddPlaneRef(connector.Rect.Length.About);
        }

        var connectorOnlyFacePlanes = connectorFacePlanes
            .Where(planeName => !otherNamedPlaneRefs.Contains(planeName))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return new ParamDrivenSolidsCompileResult(
            new MakeParamDrivenPlanesAndDimsSettings {
                Enabled = symmetricPairs.Count > 0 || offsetConstraints.Count > 0,
                SymmetricPairs = symmetricPairs.Values.ToList(),
                Offsets = offsetConstraints.Values
                    .Where(offset => !connectorOnlyFacePlanes.Contains(offset.PlaneName))
                    .ToList()
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
            diagnostics
        );
    }

    private static IEnumerable<PendingWorkItem> BuildWorkItems(AuthoredParamDrivenSolidsSettings settings) {
        foreach (var (name, plane) in settings.Planes)
            yield return PendingWorkItem.ForPlane(name, plane);

        foreach (var span in settings.Spans)
            yield return PendingWorkItem.ForSpan(span);

        foreach (var prism in settings.Prisms)
            yield return PendingWorkItem.ForPrism(prism);

        foreach (var cylinder in settings.Cylinders)
            yield return PendingWorkItem.ForCylinder(cylinder);

        foreach (var connector in settings.Connectors)
            yield return PendingWorkItem.ForConnector(connector);
    }

    private static void SeedBuiltInPlanes(
        ParamDrivenFamilyFrameKind frame,
        IDictionary<string, PublishedPlane> planes,
        IList<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        if (frame != ParamDrivenFamilyFrameKind.NonHosted) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                "Frame",
                "$.ParamDrivenSolids.Frame",
                $"Frame '{frame}' is not supported."));
            return;
        }

        foreach (var (token, planeName) in BuiltInPlaneNames) {
            planes[planeName] = new PublishedPlane(planeName, LengthDriverSpec.None);
        }
    }

    private static void ValidateTopLevelPlaneNameCollisions(
        AuthoredParamDrivenSolidsSettings settings,
        IList<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        var names = settings.Planes.Keys
            .Concat(settings.Spans.SelectMany(span => new[] { span.Negative, span.Positive }))
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .ToList();

        foreach (var collision in names.GroupBy(name => name, StringComparer.OrdinalIgnoreCase).Where(group => group.Count() > 1)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                collision.Key,
                "$.ParamDrivenSolids",
                $"Plane name '{collision.Key}' is duplicated."));
        }
    }

    private static CompileOutcome TryCompilePlane(
        string name,
        AuthoredPlaneSpec spec,
        IDictionary<string, PublishedPlane> planes,
        IDictionary<string, OffsetPlaneConstraintSpec> offsets,
        IList<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        if (string.IsNullOrWhiteSpace(name)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                "Plane",
                "$.ParamDrivenSolids.Planes",
                "Plane names are required."));
            return CompileOutcome.Invalid;
        }

        var normalizedName = name.Trim();
        if (planes.ContainsKey(normalizedName)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                normalizedName,
                "$.ParamDrivenSolids.Planes",
                $"Plane '{normalizedName}' is duplicated."));
            return CompileOutcome.Invalid;
        }

        var resolvedFrom = ResolvePlaneRef(spec.From, planes, diagnostics, normalizedName, "$.ParamDrivenSolids.Planes");
        if (resolvedFrom.Outcome != CompileOutcome.Compiled)
            return resolvedFrom.Outcome;

        if (!TryParseLengthDriver(spec.By, normalizedName, "$.ParamDrivenSolids.Planes", diagnostics, out var driver))
            return CompileOutcome.Invalid;

        if (!TryParseOffsetDirection(spec.Dir, out var direction)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                normalizedName,
                "$.ParamDrivenSolids.Planes",
                $"Plane Dir '{spec.Dir}' is invalid."));
            return CompileOutcome.Invalid;
        }

        var offset = new OffsetPlaneConstraintSpec {
            OwnerName = normalizedName,
            PlaneName = normalizedName,
            AnchorPlaneName = resolvedFrom.PlaneName!,
            Direction = direction,
            Parameter = driver.TryGetParameterName(),
            Driver = driver,
            Strength = RpStrength.StrongRef
        };
        offsets.TryAdd(BuildOffsetKey(offset), offset);
        planes[normalizedName] = new PublishedPlane(normalizedName, driver);
        return CompileOutcome.Compiled;
    }

    private static CompileOutcome TryCompileSpan(
        AuthoredSpanSpec span,
        IDictionary<string, PublishedSpan> spans,
        IDictionary<string, PublishedPlane> planes,
        IDictionary<string, SymmetricPlanePairSpec> symmetricPairs,
        IList<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        if (string.IsNullOrWhiteSpace(span.Negative) || string.IsNullOrWhiteSpace(span.Positive)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                "Span",
                "$.ParamDrivenSolids.Spans",
                "Span Negative and Positive names are required."));
            return CompileOutcome.Invalid;
        }

        var negative = span.Negative.Trim();
        var positive = span.Positive.Trim();
        if (planes.ContainsKey(negative) || planes.ContainsKey(positive)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                $"{negative}/{positive}",
                "$.ParamDrivenSolids.Spans",
                "Span names must be unique."));
            return CompileOutcome.Invalid;
        }

        var resolvedAbout = ResolvePlaneRef(span.About, planes, diagnostics, negative, "$.ParamDrivenSolids.Spans");
        if (resolvedAbout.Outcome != CompileOutcome.Compiled)
            return resolvedAbout.Outcome;

        if (!TryParseLengthDriver(span.By, negative, "$.ParamDrivenSolids.Spans", diagnostics, out var driver))
            return CompileOutcome.Invalid;

        var symmetric = new SymmetricPlanePairSpec {
            OwnerName = $"{negative}/{positive}",
            PlaneNameBase = $"{negative}|{positive}",
            CenterPlaneName = resolvedAbout.PlaneName!,
            NegativePlaneName = negative,
            PositivePlaneName = positive,
            Parameter = driver.TryGetParameterName(),
            Driver = driver,
            Strength = RpStrength.StrongRef
        };
        symmetricPairs.TryAdd(BuildSymmetricKey(symmetric), symmetric);

        spans[BuildPairKey(negative, positive)] = new PublishedSpan(negative, positive, driver);
        planes[negative] = new PublishedPlane(negative, driver);
        planes[positive] = new PublishedPlane(positive, driver);
        return CompileOutcome.Compiled;
    }

    private static CompileOutcome TryCompilePrism(
        AuthoredPrismSpec prism,
        IDictionary<string, PublishedSpan> spans,
        IDictionary<string, PublishedPlane> planes,
        IDictionary<string, SymmetricPlanePairSpec> symmetricPairs,
        IDictionary<string, OffsetPlaneConstraintSpec> offsets,
        ICollection<ConstrainedRectangleExtrusionSpec> rectangles,
        IList<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        if (string.IsNullOrWhiteSpace(prism.Name)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                "Prism",
                "$.ParamDrivenSolids.Prisms",
                "Prism Name is required."));
            return CompileOutcome.Invalid;
        }

        var sketch = ResolvePlaneRef(prism.On, planes, diagnostics, prism.Name, "$.ParamDrivenSolids.Prisms");
        if (sketch.Outcome != CompileOutcome.Compiled)
            return sketch.Outcome;

        var width = ResolvePairOrInlineSpan(prism.Name, "Width", prism.Width, spans, planes, symmetricPairs, diagnostics);
        if (width.Outcome != CompileOutcome.Compiled)
            return width.Outcome;

        var length = ResolvePairOrInlineSpan(prism.Name, "Length", prism.Length, spans, planes, symmetricPairs, diagnostics);
        if (length.Outcome != CompileOutcome.Compiled)
            return length.Outcome;

        var height = ResolveHeightSpec(prism.Name, prism.Height, planes, offsets, diagnostics);
        if (height.Outcome != CompileOutcome.Compiled)
            return height.Outcome;

        rectangles.Add(new ConstrainedRectangleExtrusionSpec {
            Name = prism.Name.Trim(),
            IsSolid = prism.IsSolid,
            StartOffset = height.StartOffset,
            EndOffset = height.EndOffset,
            HeightControlMode = height.Mode,
            SketchPlaneName = sketch.PlaneName!,
            PairAPlane1 = width.PlaneName1!,
            PairAPlane2 = width.PlaneName2!,
            PairAParameter = width.Driver.TryGetParameterName() ?? string.Empty,
            PairADriver = width.Driver,
            PairBPlane1 = length.PlaneName1!,
            PairBPlane2 = length.PlaneName2!,
            PairBParameter = length.Driver.TryGetParameterName() ?? string.Empty,
            PairBDriver = length.Driver,
            HeightPlaneBottom = height.Mode == ExtrusionHeightControlMode.ReferencePlane ? sketch.PlaneName! : null,
            HeightPlaneTop = height.Mode == ExtrusionHeightControlMode.ReferencePlane ? height.PlaneName! : null,
            HeightParameter = height.Driver.TryGetParameterName(),
            HeightDriver = height.Driver
        });

        return CompileOutcome.Compiled;
    }

    private static CompileOutcome TryCompileCylinder(
        AuthoredCylinderSpec cylinder,
        IDictionary<string, PublishedPlane> planes,
        IDictionary<string, OffsetPlaneConstraintSpec> offsets,
        ICollection<ConstrainedCircleExtrusionSpec> circles,
        IList<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        if (string.IsNullOrWhiteSpace(cylinder.Name)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                "Cylinder",
                "$.ParamDrivenSolids.Cylinders",
                "Cylinder Name is required."));
            return CompileOutcome.Invalid;
        }

        if (cylinder.Center.Count != 2) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                cylinder.Name,
                "$.ParamDrivenSolids.Cylinders.Center",
                "Cylinder Center must contain exactly two plane refs."));
            return CompileOutcome.Invalid;
        }

        var sketch = ResolvePlaneRef(cylinder.On, planes, diagnostics, cylinder.Name, "$.ParamDrivenSolids.Cylinders");
        if (sketch.Outcome != CompileOutcome.Compiled)
            return sketch.Outcome;

        var center1 = ResolvePlaneRef(cylinder.Center[0], planes, diagnostics, cylinder.Name, "$.ParamDrivenSolids.Cylinders.Center");
        var center2 = ResolvePlaneRef(cylinder.Center[1], planes, diagnostics, cylinder.Name, "$.ParamDrivenSolids.Cylinders.Center");
        if (center1.Outcome != CompileOutcome.Compiled || center2.Outcome != CompileOutcome.Compiled)
            return center1.Outcome == CompileOutcome.Deferred || center2.Outcome == CompileOutcome.Deferred
                ? CompileOutcome.Deferred
                : CompileOutcome.Invalid;

        if (!TryParseLengthDriver(cylinder.Diameter.By, cylinder.Name, "$.ParamDrivenSolids.Cylinders.Diameter", diagnostics, out var diameterDriver))
            return CompileOutcome.Invalid;

        var height = ResolveHeightSpec(cylinder.Name, cylinder.Height, planes, offsets, diagnostics);
        if (height.Outcome != CompileOutcome.Compiled)
            return height.Outcome;

        circles.Add(new ConstrainedCircleExtrusionSpec {
            Name = cylinder.Name.Trim(),
            IsSolid = cylinder.IsSolid,
            StartOffset = height.StartOffset,
            EndOffset = height.EndOffset,
            HeightControlMode = height.Mode,
            SketchPlaneName = sketch.PlaneName!,
            CenterPlane1 = center1.PlaneName!,
            CenterPlane2 = center2.PlaneName!,
            DiameterParameter = diameterDriver.TryGetParameterName() ?? string.Empty,
            DiameterDriver = diameterDriver,
            HeightPlaneBottom = height.Mode == ExtrusionHeightControlMode.ReferencePlane ? sketch.PlaneName! : null,
            HeightPlaneTop = height.Mode == ExtrusionHeightControlMode.ReferencePlane ? height.PlaneName! : null,
            HeightParameter = height.Driver.TryGetParameterName(),
            HeightDriver = height.Driver
        });

        return CompileOutcome.Compiled;
    }

    private static CompileOutcome TryCompileConnector(
        AuthoredConnectorSpec connector,
        IDictionary<string, PublishedSpan> spans,
        IDictionary<string, PublishedPlane> planes,
        IDictionary<string, SymmetricPlanePairSpec> symmetricPairs,
        IDictionary<string, OffsetPlaneConstraintSpec> offsets,
        ICollection<CompiledParamDrivenConnectorSpec> connectors,
        IList<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        if (string.IsNullOrWhiteSpace(connector.Name)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                "Connector",
                "$.ParamDrivenSolids.Connectors",
                "Connector Name is required."));
            return CompileOutcome.Invalid;
        }

        var host = ResolvePlaneRef(connector.Face, planes, diagnostics, connector.Name, "$.ParamDrivenSolids.Connectors.Face");
        if (host.Outcome != CompileOutcome.Compiled)
            return host.Outcome;

        if (!TryParseLengthDriver(connector.Depth.By, connector.Name, "$.ParamDrivenSolids.Connectors.Depth", diagnostics, out var depthDriver))
            return CompileOutcome.Invalid;

        if (!TryParseOffsetDirection(connector.Depth.Dir, out var depthDirection)) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                connector.Name,
                "$.ParamDrivenSolids.Connectors.Depth.Dir",
                $"Depth Dir '{connector.Depth.Dir}' is invalid."));
            return CompileOutcome.Invalid;
        }

        var hostFaceName = host.PlaneName!;
        var hostPlaneName = host.PlaneName!;
        if (offsets.Values.FirstOrDefault(offset => string.Equals(offset.PlaneName, hostFaceName, StringComparison.OrdinalIgnoreCase))
            is { } hostOffsetSpec) {
            hostPlaneName = hostOffsetSpec.AnchorPlaneName;
            var hostOffsetSign = hostOffsetSpec.Direction == OffsetDirection.Negative ? "-" : "+";
            var hostOffsetValue = !string.IsNullOrWhiteSpace(hostOffsetSpec.Parameter)
                ? $"P:{hostOffsetSpec.Parameter.Trim()}"
                : $"L:{(hostOffsetSpec.Driver.LiteralValue ?? 0.0).ToString("R", CultureInfo.InvariantCulture)}";
            hostFaceName = $"__OFFSET__|{host.PlaneName!}|{hostOffsetSign}|{hostOffsetValue}";
        }

        if (connector.Round != null && connector.Rect != null) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                connector.Name,
                "$.ParamDrivenSolids.Connectors",
                "Connector must specify exactly one of Round or Rect."));
            return CompileOutcome.Invalid;
        }

        if (connector.Round == null && connector.Rect == null) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                connector.Name,
                "$.ParamDrivenSolids.Connectors",
                "Connector must specify Round or Rect geometry."));
            return CompileOutcome.Invalid;
        }

        if (!TryCompileConnectorConfig(connector, diagnostics, out var runtimeConfig))
            return CompileOutcome.Invalid;

        var stubSolidName = $"{connector.Name.Trim()} Stub";
        if (connector.Round != null) {
            return TryCompileRoundConnector(
                connector,
                hostPlaneName,
                hostFaceName,
                stubSolidName,
                depthDirection,
                depthDriver,
                runtimeConfig,
                planes,
                connectors,
                diagnostics);
        }

        return TryCompileRectConnector(
            connector,
            hostPlaneName,
            hostFaceName,
            stubSolidName,
            depthDirection,
            depthDriver,
            spans,
            planes,
            symmetricPairs,
            connectors,
            diagnostics,
            runtimeConfig);
    }

    private static CompileOutcome TryCompileRoundConnector(
        AuthoredConnectorSpec connector,
        string hostPlaneName,
        string hostFacePlaneName,
        string stubSolidName,
        OffsetDirection depthDirection,
        LengthDriverSpec depthDriver,
        ConnectorDomainConfigSpec runtimeConfig,
        IDictionary<string, PublishedPlane> planes,
        ICollection<CompiledParamDrivenConnectorSpec> connectors,
        IList<ParamDrivenSolidsDiagnostic> diagnostics
    ) {
        if (connector.Round!.Center.Count != 2) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                connector.Name,
                "$.ParamDrivenSolids.Connectors.Round.Center",
                "Round connector Center must contain exactly two plane refs."));
            return CompileOutcome.Invalid;
        }

        var center1 = ResolvePlaneRef(connector.Round.Center[0], planes, diagnostics, connector.Name, "$.ParamDrivenSolids.Connectors.Round.Center");
        var center2 = ResolvePlaneRef(connector.Round.Center[1], planes, diagnostics, connector.Name, "$.ParamDrivenSolids.Connectors.Round.Center");
        if (center1.Outcome != CompileOutcome.Compiled || center2.Outcome != CompileOutcome.Compiled)
            return center1.Outcome == CompileOutcome.Deferred || center2.Outcome == CompileOutcome.Deferred
                ? CompileOutcome.Deferred
                : CompileOutcome.Invalid;

        if (!TryParseLengthDriver(connector.Round.Diameter.By, connector.Name, "$.ParamDrivenSolids.Connectors.Round.Diameter", diagnostics, out var diameterDriver))
            return CompileOutcome.Invalid;

        connectors.Add(new CompiledParamDrivenConnectorSpec {
            Name = connector.Name.Trim(),
            StubSolidName = stubSolidName,
            Domain = connector.Domain,
            Profile = ParamDrivenConnectorProfile.Round,
            HostPlaneName = hostPlaneName,
            HostFacePlaneName = hostFacePlaneName,
            DepthDirection = depthDirection,
            DepthDriver = depthDriver,
            RoundStub = new ConstrainedCircleExtrusionSpec {
                Name = stubSolidName,
                IsSolid = connector.IsSolid,
                StartOffset = 0.0,
                EndOffset = ConnectorStubSeedDepth,
                HeightControlMode = ExtrusionHeightControlMode.EndOffset,
                SketchPlaneName = hostPlaneName,
                CenterPlane1 = center1.PlaneName!,
                CenterPlane2 = center2.PlaneName!,
                DiameterParameter = diameterDriver.TryGetParameterName() ?? string.Empty,
                DiameterDriver = diameterDriver
            },
            Bindings = connector.Bindings,
            Config = runtimeConfig,
            AuthoredSpec = connector
        });

        return CompileOutcome.Compiled;
    }
}
