using Pe.FamilyFoundry.Operations;
using Pe.FamilyFoundry.Snapshots;

using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Helpers;

/// <summary>
///     Creates reference planes and dimensions from MirrorSpec and OffsetSpec.
///     Plane creation and dimension creation are separate to allow transaction commits between them.
/// </summary>
public class RefPlaneDimCreator(
    Document doc,
    PlaneQuery query,
    List<LogEntry> logs) {
    private const double PlaneOffset = 0.5;
    private const double DimStaggerStep = 0.5;
    private const double PlaneExtent = 8.0;

    /// <summary>
    ///     Checks if a dimension already exists between the specified reference planes.
    /// </summary>
    private bool DimensionExists(params ReferencePlane[] planes) {
        if (planes.Length < 2) return false;

        var planeIds = planes.Select(p => p.Id).ToHashSet();

        var dimensions = new FilteredElementCollector(doc)
            .OfClass(typeof(Dimension))
            .Cast<Dimension>()
            .Where(d => d is not SpotDimension);

        foreach (var dim in dimensions) {
            if (dim.References.Size != planes.Length) continue;

            var dimPlaneIds = new HashSet<ElementId>();
            for (var i = 0; i < dim.References.Size; i++) {
                var reference = dim.References.get_Item(i);
                var elem = doc.GetElement(reference);
                if (elem is ReferencePlane rp)
                    _ = dimPlaneIds.Add(rp.Id);
            }

            if (dimPlaneIds.SetEquals(planeIds)) {
                Console.WriteLine("[DimensionExists] Found existing dimension with matching planes");
                return true;
            }
        }

        return false;
    }

    private static Line CreateDimensionLine(ReferencePlane rp1, ReferencePlane rp2, double offset) {
        var normal = rp1.Normal;
        var direction = rp1.Direction;

        var rp1Mid = (rp1.BubbleEnd + rp1.FreeEnd) * 0.5;
        var rp2Mid = (rp2.BubbleEnd + rp2.FreeEnd) * 0.5;
        var distanceAlongNormal = (rp2Mid - rp1Mid).DotProduct(normal);

        var p1 = rp1.BubbleEnd + (direction * offset);
        var p2 = p1 + (normal * distanceAlongNormal);

        Console.WriteLine($"[CreateDimensionLine] Distance: {distanceAlongNormal:F6}, Offset: {offset:F3}");

        return Line.CreateBound(p1, p2);
    }

    private static Line CreateDimensionLine(ReferencePlane rp1, ReferencePlane rp2, double offset, View view) {
        var normal = rp1.Normal.Normalize();
        var rp1Mid = (rp1.BubbleEnd + rp1.FreeEnd) * 0.5;
        var rp2Mid = (rp2.BubbleEnd + rp2.FreeEnd) * 0.5;
        var distanceAlongNormal = (rp2Mid - rp1Mid).DotProduct(normal);

        // Height-like dimensions need a line in the target view plane.
        var isHeightLike = Math.Abs(normal.Z) > 0.95;
        if (!isHeightLike || view == null)
            return CreateDimensionLine(rp1, rp2, offset);

        var up = view.UpDirection.Normalize();
        var right = view.RightDirection.Normalize();
        var dimAxis = Math.Abs(up.DotProduct(normal)) > 0.8 ? up : normal;

        var p1 = rp1Mid + (right * offset);
        var p2 = p1 + (dimAxis * distanceAlongNormal);
        return Line.CreateBound(p1, p2);
    }

    private View? GetWorkingView() {
        if (doc.ActiveView != null && !doc.ActiveView.IsTemplate)
            return doc.ActiveView;

        return new FilteredElementCollector(doc)
            .OfClass(typeof(View))
            .Cast<View>()
            .FirstOrDefault(view =>
                !view.IsTemplate &&
                view.ViewType is ViewType.FloorPlan or ViewType.CeilingPlan or ViewType.EngineeringPlan or ViewType.AreaPlan);
    }

    #region Plane Creation (First Operation)

    public void CreateSymmetricPlanes(SymmetricPlanePairSpec spec) {
        Console.WriteLine($"[CreateSymmetricPlanes] Processing: {spec.PlaneNameBase}, Center: {spec.CenterPlaneName}");

        var center = query.Get(spec.CenterPlaneName);
        if (center == null) {
            Console.WriteLine($"[CreateSymmetricPlanes] Center anchor not found: {spec.CenterPlaneName}");
            logs.Add(new LogEntry($"Symmetric planes: {spec.PlaneNameBase} @ {spec.CenterPlaneName}")
                .Error("Center anchor not found"));
            return;
        }

        if (query.Get(spec.NegativePlaneName) != null && query.Get(spec.PositivePlaneName) != null) {
            Console.WriteLine("[CreateSymmetricPlanes] Both planes already exist, skipping");
            logs.Add(new LogEntry($"Symmetric planes: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Skip("Already exist"));
            return;
        }

        var normal = center.Normal;
        var direction = center.Direction;
        var midpoint = (center.BubbleEnd + center.FreeEnd) * 0.5;
        var cutVec = normal.CrossProduct(direction);
        var t = direction * PlaneExtent;
        var seedOffset = ResolveSeedOffset(spec.Driver, spec.Parameter, isMirror: true);

        var negativeCreated = this.CreatePlane(spec.NegativePlaneName, midpoint - (normal * seedOffset), t, cutVec, spec.Strength);
        var positiveCreated = this.CreatePlane(spec.PositivePlaneName, midpoint + (normal * seedOffset), t, cutVec, spec.Strength);

        if (negativeCreated && positiveCreated) {
            logs.Add(new LogEntry($"Symmetric planes: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Success(
                $"Created {spec.NegativePlaneName}, {spec.PositivePlaneName}"));
        }
    }

    /// <summary>
     ///     Creates mirror planes: two planes symmetric around center.
     /// </summary>
    public void CreateMirrorPlanes(MirrorSpec spec) {
        Console.WriteLine($"[CreateMirrorPlanes] Processing: {spec.Name}, Center: {spec.CenterAnchor}");

        var center = query.Get(spec.CenterAnchor);
        if (center == null) {
            Console.WriteLine($"[CreateMirrorPlanes] Center anchor not found: {spec.CenterAnchor}");
            logs.Add(new LogEntry($"Mirror planes: {spec.Name} @ {spec.CenterAnchor}")
                .Error("Center anchor not found"));
            return;
        }

        var normal = center.Normal;
        var direction = center.Direction;
        var leftName = spec.GetLeftName(normal);
        var rightName = spec.GetRightName(normal);

        Console.WriteLine($"[CreateMirrorPlanes] Names - Left: '{leftName}', Right: '{rightName}'");

        // Check if already exist
        if (query.Get(leftName) != null && query.Get(rightName) != null) {
            Console.WriteLine("[CreateMirrorPlanes] Both planes already exist, skipping");
            logs.Add(new LogEntry($"Mirror planes: {spec.Name} @ {spec.CenterAnchor}").Skip("Already exist"));
            return;
        }

        var midpoint = (center.BubbleEnd + center.FreeEnd) * 0.5;
        var cutVec = normal.CrossProduct(direction);
        var t = direction * PlaneExtent;
        var seedOffset = ResolveSeedOffset(null, spec.Parameter, isMirror: true);

        var leftCreated = this.CreatePlane(leftName, midpoint - (normal * seedOffset), t, cutVec, spec.Strength);
        var rightCreated = this.CreatePlane(rightName, midpoint + (normal * seedOffset), t, cutVec, spec.Strength);

        if (leftCreated && rightCreated) {
            logs.Add(new LogEntry($"Mirror planes: {spec.Name} @ {spec.CenterAnchor}").Success(
                $"Created {leftName}, {rightName}"));
        }
    }

    /// <summary>
    ///     Creates offset plane: one plane offset from anchor.
    /// </summary>
    public void CreateOffsetPlane(OffsetSpec spec) {
        Console.WriteLine($"[CreateOffsetPlane] Processing: {spec.Name}, Anchor: {spec.AnchorName}");

        var anchor = this.ResolveReferencePlane(spec.AnchorName);
        if (anchor == null) {
            Console.WriteLine($"[CreateOffsetPlane] Anchor not found: {spec.AnchorName}");
            logs.Add(new LogEntry($"Offset plane: {spec.Name}").Error($"Anchor '{spec.AnchorName}' not found"));
            return;
        }

        if (query.Get(spec.Name) != null) {
            Console.WriteLine($"[CreateOffsetPlane] Plane already exists: {spec.Name}");
            logs.Add(new LogEntry($"Offset plane: {spec.Name}").Skip("Already exists"));
            return;
        }

        var normal = anchor.Normal;
        var midpoint = (anchor.BubbleEnd + anchor.FreeEnd) * 0.5;
        var direction = anchor.Direction;
        var cutVec = normal.CrossProduct(direction);
        var t = direction * PlaneExtent;
        var seedOffset = ResolveSeedOffset(null, spec.Parameter, isMirror: false);

        var offsetVector = spec.Direction == OffsetDirection.Positive
            ? normal * seedOffset
            : normal * -seedOffset;

        if (this.CreatePlane(spec.Name, midpoint + offsetVector, t, cutVec, spec.Strength))
            logs.Add(new LogEntry($"Offset plane: {spec.Name}").Success("Created"));
    }

    public void CreateOffsetPlane(OffsetPlaneConstraintSpec spec) {
        Console.WriteLine($"[CreateOffsetPlane] Processing: {spec.PlaneName}, Anchor: {spec.AnchorPlaneName}");

        var anchor = this.ResolveReferencePlane(spec.AnchorPlaneName);
        if (anchor == null) {
            Console.WriteLine($"[CreateOffsetPlane] Anchor not found: {spec.AnchorPlaneName}");
            logs.Add(new LogEntry($"Offset plane: {spec.PlaneName}").Error($"Anchor '{spec.AnchorPlaneName}' not found"));
            return;
        }

        if (query.Get(spec.PlaneName) != null) {
            Console.WriteLine($"[CreateOffsetPlane] Plane already exists: {spec.PlaneName}");
            logs.Add(new LogEntry($"Offset plane: {spec.PlaneName}").Skip("Already exists"));
            return;
        }

        var normal = anchor.Normal;
        var midpoint = (anchor.BubbleEnd + anchor.FreeEnd) * 0.5;
        var direction = anchor.Direction;
        var cutVec = normal.CrossProduct(direction);
        var t = direction * PlaneExtent;
        var seedOffset = ResolveSeedOffset(spec.Driver, spec.Parameter, isMirror: false);

        var offsetVector = spec.Direction == OffsetDirection.Positive
            ? normal * seedOffset
            : normal * -seedOffset;

        if (this.CreatePlane(spec.PlaneName, midpoint + offsetVector, t, cutVec, spec.Strength))
            logs.Add(new LogEntry($"Offset plane: {spec.PlaneName}").Success("Created"));
    }

    private bool CreatePlane(string name, XYZ origin, XYZ t, XYZ cutVec, RpStrength strength) {
        if (query.Get(name) != null) {
            Console.WriteLine($"[CreatePlane] Already exists: {name}");
            return true; // Already exists is success
        }

        try {
            Console.WriteLine($"[CreatePlane] Creating: {name}");
            var workingView = this.GetWorkingView();
            if (workingView == null) {
                logs.Add(new LogEntry($"RefPlane: {name}").Error("No valid non-template plan view was available."));
                return false;
            }

            var rp = doc.FamilyCreate.NewReferencePlane(origin + t, origin - t, cutVec, workingView);
            rp.Name = name;
            _ = rp.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME).Set((int)strength);
            _ = query.ReCache(name);
            Console.WriteLine($"[CreatePlane] Created: {name}, Id: {rp.Id}");
            return true;
        } catch (Exception ex) {
            Console.WriteLine($"[CreatePlane] ERROR: {name}: {ex.Message}");
            logs.Add(new LogEntry($"RefPlane: {name}").Error(ex));
            return false;
        }
    }

    private double ResolveSeedOffset(LengthDriverSpec? driver, string? parameterName, bool isMirror) {
        var currentValue = TryGetCurrentLengthValue(driver, parameterName);
        if (currentValue is null || currentValue <= 1e-9)
            return PlaneOffset;

        return isMirror
            ? currentValue.Value / 2.0
            : currentValue.Value;
    }

    private double? TryGetCurrentLengthValue(LengthDriverSpec? driver, string? parameterName) {
        if (driver.TryResolveCurrentValue(doc, out var resolvedValue))
            return resolvedValue;

        if (string.IsNullOrWhiteSpace(parameterName))
            return null;

        return LengthDriverSpec.FromLegacyParameter(parameterName).TryResolveCurrentValue(doc, out var legacyValue)
            ? legacyValue
            : null;
    }

    private ReferencePlane? ResolveReferencePlane(string requestedName) {
        if (string.IsNullOrWhiteSpace(requestedName))
            return null;

        var exact = query.Get(requestedName);
        if (exact != null)
            return exact;

        foreach (var alias in GetAnchorAliases(requestedName)) {
            var match = query.Get(alias);
            if (match != null)
                return match;
        }

        // Final fallback for level-like anchors: use the first horizontal level-like plane.
        if (requestedName.IndexOf("level", StringComparison.OrdinalIgnoreCase) < 0)
            return null;

        return new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .FirstOrDefault(rp =>
                !string.IsNullOrWhiteSpace(rp.Name) &&
                rp.Name.IndexOf("level", StringComparison.OrdinalIgnoreCase) >= 0 &&
                Math.Abs(rp.Normal.Normalize().Z) > 0.95)
            ?? this.TryCreateReferencePlaneFromSketchPlane(requestedName);
    }

    private static IEnumerable<string> GetAnchorAliases(string requestedName) {
        if (!requestedName.Equals("Ref. Level", StringComparison.OrdinalIgnoreCase))
            return [];

        return [
            "Reference Level",
            "Ref Level",
            "Lower Ref. Level",
            "Lower Reference Level",
            "Level"
        ];
    }

    private ReferencePlane? TryCreateReferencePlaneFromSketchPlane(string requestedName) {
        var sketchPlane = this.ResolveSketchPlane(requestedName);
        if (sketchPlane == null)
            return null;

        try {
            var workingView = this.GetWorkingView();
            if (workingView == null)
                return null;

            var plane = sketchPlane.GetPlane();
            var normal = plane.Normal.Normalize();
            var direction = BuildStableDirection(normal);
            var cutVec = normal.CrossProduct(direction).Normalize();
            var t = direction * PlaneExtent;
            var referencePlane = doc.FamilyCreate.NewReferencePlane(plane.Origin + t, plane.Origin - t, cutVec, workingView);
            referencePlane.Name = requestedName;
            _ = query.ReCache(requestedName);
            logs.Add(new LogEntry($"Sketch plane anchor: {requestedName}").Success("Created companion reference plane from sketch plane."));
            return referencePlane;
        } catch (Exception ex) {
            logs.Add(new LogEntry($"Sketch plane anchor: {requestedName}").Error(ex));
            return null;
        }
    }

    private SketchPlane? ResolveSketchPlane(string requestedName) {
        var sketchPlanes = new FilteredElementCollector(doc)
            .OfClass(typeof(SketchPlane))
            .Cast<SketchPlane>()
            .ToList();

        var exact = sketchPlanes.FirstOrDefault(sp => sp.Name == requestedName);
        if (exact != null)
            return exact;

        foreach (var alias in GetAnchorAliases(requestedName)) {
            var aliasMatch = sketchPlanes.FirstOrDefault(sp => sp.Name == alias);
            if (aliasMatch != null)
                return aliasMatch;
        }

        if (requestedName.IndexOf("level", StringComparison.OrdinalIgnoreCase) < 0)
            return null;

        return sketchPlanes.FirstOrDefault(sp =>
            !string.IsNullOrWhiteSpace(sp.Name) &&
            sp.Name.IndexOf("level", StringComparison.OrdinalIgnoreCase) >= 0);
    }

    private static XYZ BuildStableDirection(XYZ normal) {
        var seed = Math.Abs(normal.Z) > 0.9 ? XYZ.BasisX : XYZ.BasisZ;
        return seed.CrossProduct(normal).Normalize();
    }

    #endregion

    #region Dimension Creation (Second Operation)

    public void CreateSymmetricDimensions(SymmetricPlanePairSpec spec, int staggerIndex) {
        Console.WriteLine(
            $"[CreateSymmetricDimensions] Processing: {spec.PlaneNameBase}, Center: {spec.CenterPlaneName}, Stagger: {staggerIndex}");

        var center = query.Get(spec.CenterPlaneName);
        if (center == null) {
            Console.WriteLine($"[CreateSymmetricDimensions] Center not found: {spec.CenterPlaneName}");
            return;
        }

        var negativePlane = query.Get(spec.NegativePlaneName);
        var positivePlane = query.Get(spec.PositivePlaneName);

        if (negativePlane == null || positivePlane == null) {
            Console.WriteLine(
                $"[CreateSymmetricDimensions] Planes not found - Negative: {negativePlane != null}, Positive: {positivePlane != null}");
            logs.Add(new LogEntry($"Symmetric dims: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Error("Planes not found"));
            return;
        }

        var dimOffset = DimStaggerStep + (DimStaggerStep * staggerIndex);

        if (this.DimensionExists(negativePlane, positivePlane)) {
            Console.WriteLine($"[CreateSymmetricDimensions] Param dim already exists between {spec.NegativePlaneName} and {spec.PositivePlaneName}");
            logs.Add(new LogEntry($"Symmetric param dim: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Skip("Already exists"));
        } else {
            try {
                var dimView = this.GetBestDimensionView(negativePlane, positivePlane);
                if (dimView == null) {
                    logs.Add(new LogEntry($"Symmetric param dim: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Error(
                        "No valid view was available for parameter dimension creation."));
                    return;
                }

                var paramRefArray = new ReferenceArray();
                paramRefArray.Append(negativePlane.GetReference());
                paramRefArray.Append(positivePlane.GetReference());

                var paramDimLine = CreateDimensionLine(negativePlane, positivePlane, dimOffset, dimView);
                Console.WriteLine($"[CreateSymmetricDimensions] Param dim line length: {paramDimLine.Length:F6}");

                var paramDim = doc.FamilyCreate.NewLinearDimension(dimView, paramDimLine, paramRefArray);

                if (!string.IsNullOrEmpty(spec.Parameter)) {
                    var param = doc.FamilyManager.get_Parameter(spec.Parameter);
                    if (param != null) {
                        paramDim.FamilyLabel = param;
                        logs.Add(new LogEntry($"Symmetric param dim: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Success(
                            $"Label: {spec.Parameter}"));
                    } else {
                        logs.Add(new LogEntry($"Symmetric param dim: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Success(
                            $"(param '{spec.Parameter}' not found)"));
                    }
                } else
                    logs.Add(new LogEntry($"Symmetric param dim: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Success("Created"));
            } catch (Exception ex) {
                Console.WriteLine($"[CreateSymmetricDimensions] Param dim ERROR: {ex.Message}");
                logs.Add(new LogEntry($"Symmetric param dim: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Error(ex));
            }
        }

        if (this.DimensionExists(negativePlane, center, positivePlane)) {
            Console.WriteLine(
                $"[CreateSymmetricDimensions] EQ dim already exists between {spec.NegativePlaneName}, {spec.CenterPlaneName}, {spec.PositivePlaneName}");
            logs.Add(new LogEntry($"Symmetric EQ dim: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Skip("Already exists"));
        } else {
            try {
                var eqDimView = this.GetBestDimensionView(negativePlane, positivePlane);
                if (eqDimView == null) {
                    logs.Add(new LogEntry($"Symmetric EQ dim: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Error(
                        "No valid view was available for EQ dimension creation."));
                    return;
                }

                var eqRefArray = new ReferenceArray();
                eqRefArray.Append(negativePlane.GetReference());
                eqRefArray.Append(center.GetReference());
                eqRefArray.Append(positivePlane.GetReference());

                var eqDimLine = CreateDimensionLine(negativePlane, positivePlane, dimOffset - DimStaggerStep, eqDimView);
                Console.WriteLine($"[CreateSymmetricDimensions] EQ dim line length: {eqDimLine.Length:F6}");

                var eqDim = doc.FamilyCreate.NewLinearDimension(eqDimView, eqDimLine, eqRefArray);
                eqDim.AreSegmentsEqual = true;
                logs.Add(new LogEntry($"Symmetric EQ dim: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Success("Created"));
            } catch (Exception ex) {
                Console.WriteLine($"[CreateSymmetricDimensions] EQ dim ERROR: {ex.Message}");
                logs.Add(new LogEntry($"Symmetric EQ dim: {spec.PlaneNameBase} @ {spec.CenterPlaneName}").Error(ex));
            }
        }
    }

    /// <summary>
     ///     Creates mirror dimensions: EQ constraint (3 planes) + parameter label (2 planes).
     /// </summary>
    public void CreateMirrorDimensions(MirrorSpec spec, int staggerIndex) {
        Console.WriteLine(
            $"[CreateMirrorDimensions] Processing: {spec.Name}, Center: {spec.CenterAnchor}, Stagger: {staggerIndex}");

        var center = query.Get(spec.CenterAnchor);
        if (center == null) {
            Console.WriteLine($"[CreateMirrorDimensions] Center not found: {spec.CenterAnchor}");
            return; // Plane creation would have logged the error
        }

        var normal = center.Normal;
        var leftName = spec.GetLeftName(normal);
        var rightName = spec.GetRightName(normal);

        var leftPlane = query.Get(leftName);
        var rightPlane = query.Get(rightName);

        if (leftPlane == null || rightPlane == null) {
            Console.WriteLine(
                $"[CreateMirrorDimensions] Planes not found - Left: {leftPlane != null}, Right: {rightPlane != null}");
            logs.Add(new LogEntry($"Mirror dims: {spec.Name} @ {spec.CenterAnchor}").Error("Planes not found"));
            return;
        }

        var dimOffset = DimStaggerStep + (DimStaggerStep * staggerIndex);

        // Create parameter dimension first (2 planes: left, right)
        if (this.DimensionExists(leftPlane, rightPlane)) {
            Console.WriteLine($"[CreateMirrorDimensions] Param dim already exists between {leftName} and {rightName}");
            logs.Add(new LogEntry($"Mirror param dim: {spec.Name} @ {spec.CenterAnchor}").Skip("Already exists"));
        } else {
            try {
                var dimView = this.GetBestDimensionView(leftPlane, rightPlane);
                if (dimView == null) {
                    logs.Add(new LogEntry($"Mirror param dim: {spec.Name} @ {spec.CenterAnchor}").Error(
                        "No valid view was available for parameter dimension creation."));
                    return;
                }

                var paramRefArray = new ReferenceArray();
                paramRefArray.Append(leftPlane.GetReference());
                paramRefArray.Append(rightPlane.GetReference());

                var paramDimLine = CreateDimensionLine(leftPlane, rightPlane, dimOffset, dimView);
                Console.WriteLine($"[CreateMirrorDimensions] Param dim line length: {paramDimLine.Length:F6}");

                var paramDim = doc.FamilyCreate.NewLinearDimension(dimView, paramDimLine, paramRefArray);

                if (!string.IsNullOrEmpty(spec.Parameter)) {
                    var param = doc.FamilyManager.get_Parameter(spec.Parameter);
                    if (param != null) {
                        paramDim.FamilyLabel = param;
                        logs.Add(new LogEntry($"Mirror param dim: {spec.Name} @ {spec.CenterAnchor}").Success(
                            $"Label: {spec.Parameter}"));
                    } else {
                        logs.Add(new LogEntry($"Mirror param dim: {spec.Name} @ {spec.CenterAnchor}").Success(
                            $"(param '{spec.Parameter}' not found)"));
                    }
                } else
                    logs.Add(new LogEntry($"Mirror param dim: {spec.Name} @ {spec.CenterAnchor}").Success("Created"));
            } catch (Exception ex) {
                Console.WriteLine($"[CreateMirrorDimensions] Param dim ERROR: {ex.Message}");
                logs.Add(new LogEntry($"Mirror param dim: {spec.Name} @ {spec.CenterAnchor}").Error(ex));
            }
        }

        // Create EQ dimension (3 planes: left, center, right)
        if (this.DimensionExists(leftPlane, center, rightPlane)) {
            Console.WriteLine(
                $"[CreateMirrorDimensions] EQ dim already exists between {leftName}, {spec.CenterAnchor}, {rightName}");
            logs.Add(new LogEntry($"Mirror EQ dim: {spec.Name} @ {spec.CenterAnchor}").Skip("Already exists"));
        } else {
            try {
                var eqDimView = this.GetBestDimensionView(leftPlane, rightPlane);
                if (eqDimView == null) {
                    logs.Add(new LogEntry($"Mirror EQ dim: {spec.Name} @ {spec.CenterAnchor}").Error(
                        "No valid view was available for EQ dimension creation."));
                    return;
                }

                var eqRefArray = new ReferenceArray();
                eqRefArray.Append(leftPlane.GetReference());
                eqRefArray.Append(center.GetReference());
                eqRefArray.Append(rightPlane.GetReference());

                var eqDimLine = CreateDimensionLine(leftPlane, rightPlane, dimOffset - DimStaggerStep, eqDimView);
                Console.WriteLine($"[CreateMirrorDimensions] EQ dim line length: {eqDimLine.Length:F6}");

                var eqDim = doc.FamilyCreate.NewLinearDimension(eqDimView, eqDimLine, eqRefArray);
                eqDim.AreSegmentsEqual = true;
                logs.Add(new LogEntry($"Mirror EQ dim: {spec.Name} @ {spec.CenterAnchor}").Success("Created"));
            } catch (Exception ex) {
                Console.WriteLine($"[CreateMirrorDimensions] EQ dim ERROR: {ex.Message}");
                logs.Add(new LogEntry($"Mirror EQ dim: {spec.Name} @ {spec.CenterAnchor}").Error(ex));
            }
        }
    }

    /// <summary>
    ///     Creates offset dimension: single dimension between anchor and target.
    /// </summary>
    public void CreateOffsetDimension(OffsetSpec spec, int staggerIndex) {
        Console.WriteLine(
            $"[CreateOffsetDimension] Processing: {spec.Name}, Anchor: {spec.AnchorName}, Stagger: {staggerIndex}");

        var anchor = query.Get(spec.AnchorName);
        var target = query.Get(spec.Name);

        if (anchor == null || target == null) {
            Console.WriteLine(
                $"[CreateOffsetDimension] Planes not found - Anchor: {anchor != null}, Target: {target != null}");
            return; // Plane creation would have logged the error
        }

        if (this.DimensionExists(anchor, target)) {
            Console.WriteLine(
                $"[CreateOffsetDimension] Dimension already exists between {spec.AnchorName} and {spec.Name}");
            logs.Add(new LogEntry($"Offset dim: {spec.Name}").Skip("Already exists"));
            return;
        }

        var dimOffset = DimStaggerStep + (DimStaggerStep * staggerIndex);
        var dimView = this.GetBestDimensionView(anchor, target);

        try {
            var refArray = new ReferenceArray();
            refArray.Append(anchor.GetReference());
            refArray.Append(target.GetReference());

            var dimLine = CreateDimensionLine(anchor, target, dimOffset, dimView);
            Console.WriteLine($"[CreateOffsetDimension] Dim line length: {dimLine.Length:F6}");

            var dim = doc.FamilyCreate.NewLinearDimension(dimView, dimLine, refArray);

            if (!string.IsNullOrEmpty(spec.Parameter)) {
                var param = doc.FamilyManager.get_Parameter(spec.Parameter);
                if (param != null) {
                    dim.FamilyLabel = param;
                    logs.Add(new LogEntry($"Offset dim: {spec.Name}").Success($"Label: {spec.Parameter}"));
                } else
                    logs.Add(new LogEntry($"Offset dim: {spec.Name}").Success($"(param '{spec.Parameter}' not found)"));
            } else
                logs.Add(new LogEntry($"Offset dim: {spec.Name}").Success("Created"));
        } catch (Exception ex) {
            Console.WriteLine($"[CreateOffsetDimension] ERROR: {ex.Message}");
            logs.Add(new LogEntry($"Offset dim: {spec.Name}").Error(ex));
        }
    }

    public void CreateOffsetDimension(OffsetPlaneConstraintSpec spec, int staggerIndex) {
        Console.WriteLine(
            $"[CreateOffsetDimension] Processing: {spec.PlaneName}, Anchor: {spec.AnchorPlaneName}, Stagger: {staggerIndex}");

        var anchor = query.Get(spec.AnchorPlaneName);
        var target = query.Get(spec.PlaneName);

        if (anchor == null || target == null) {
            Console.WriteLine(
                $"[CreateOffsetDimension] Planes not found - Anchor: {anchor != null}, Target: {target != null}");
            return;
        }

        if (this.DimensionExists(anchor, target)) {
            Console.WriteLine(
                $"[CreateOffsetDimension] Dimension already exists between {spec.AnchorPlaneName} and {spec.PlaneName}");
            logs.Add(new LogEntry($"Offset dim: {spec.PlaneName}").Skip("Already exists"));
            return;
        }

        var dimOffset = DimStaggerStep + (DimStaggerStep * staggerIndex);
        var dimView = this.GetBestDimensionView(anchor, target);

        try {
            var refArray = new ReferenceArray();
            refArray.Append(anchor.GetReference());
            refArray.Append(target.GetReference());

            var dimLine = CreateDimensionLine(anchor, target, dimOffset, dimView);
            Console.WriteLine($"[CreateOffsetDimension] Dim line length: {dimLine.Length:F6}");

            var dim = doc.FamilyCreate.NewLinearDimension(dimView, dimLine, refArray);

            if (!string.IsNullOrEmpty(spec.Parameter)) {
                var param = doc.FamilyManager.get_Parameter(spec.Parameter);
                if (param != null) {
                    dim.FamilyLabel = param;
                    logs.Add(new LogEntry($"Offset dim: {spec.PlaneName}").Success($"Label: {spec.Parameter}"));
                } else
                    logs.Add(new LogEntry($"Offset dim: {spec.PlaneName}").Success($"(param '{spec.Parameter}' not found)"));
            } else
                logs.Add(new LogEntry($"Offset dim: {spec.PlaneName}").Success("Created"));
        } catch (Exception ex) {
            Console.WriteLine($"[CreateOffsetDimension] ERROR: {ex.Message}");
            logs.Add(new LogEntry($"Offset dim: {spec.PlaneName}").Error(ex));
        }
    }

    private View? GetBestDimensionView(ReferencePlane anchor, ReferencePlane target) {
        var isHeightLike = Math.Abs(anchor.Normal.Normalize().Z) > 0.95 &&
                           Math.Abs(target.Normal.Normalize().Z) > 0.95;
        if (!isHeightLike)
            return this.GetWorkingView();

        var elevation = new FilteredElementCollector(doc)
            .OfClass(typeof(View))
            .Cast<View>()
            .FirstOrDefault(v =>
                !v.IsTemplate &&
                (v.ViewType == ViewType.Elevation || v.ViewType == ViewType.Section));

        return elevation ?? this.GetWorkingView();
    }

    #endregion
}

/// <summary>
///     Tracks a formula that needs to be restored after dimension labeling.
/// </summary>
public record DeferredFormula(string ParamName, string Formula);
