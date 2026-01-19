using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.Operations;
using Pe.FamilyFoundry.Snapshots;
using System.Diagnostics;

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

    #region Plane Creation (First Operation)

    /// <summary>
    ///     Creates mirror planes: two planes symmetric around center.
    /// </summary>
    public void CreateMirrorPlanes(MirrorSpec spec) {
        Debug.WriteLine($"[CreateMirrorPlanes] Processing: {spec.Name}, Center: {spec.CenterAnchor}");

        var center = query.Get(spec.CenterAnchor);
        if (center == null) {
            Debug.WriteLine($"[CreateMirrorPlanes] Center anchor not found: {spec.CenterAnchor}");
            logs.Add(new LogEntry($"Mirror planes: {spec.Name} @ {spec.CenterAnchor}").Error("Center anchor not found"));
            return;
        }

        var normal = center.Normal;
        var direction = center.Direction;
        var leftName = spec.GetLeftName(normal);
        var rightName = spec.GetRightName(normal);

        Debug.WriteLine($"[CreateMirrorPlanes] Names - Left: '{leftName}', Right: '{rightName}'");

        // Check if already exist
        if (query.Get(leftName) != null && query.Get(rightName) != null) {
            Debug.WriteLine($"[CreateMirrorPlanes] Both planes already exist, skipping");
            logs.Add(new LogEntry($"Mirror planes: {spec.Name} @ {spec.CenterAnchor}").Skip("Already exist"));
            return;
        }

        var midpoint = (center.BubbleEnd + center.FreeEnd) * 0.5;
        var cutVec = normal.CrossProduct(direction);
        var t = direction * PlaneExtent;

        var leftCreated = this.CreatePlane(leftName, midpoint - (normal * PlaneOffset), t, cutVec, spec.Strength);
        var rightCreated = this.CreatePlane(rightName, midpoint + (normal * PlaneOffset), t, cutVec, spec.Strength);

        if (leftCreated && rightCreated) logs.Add(new LogEntry($"Mirror planes: {spec.Name} @ {spec.CenterAnchor}").Success($"Created {leftName}, {rightName}"));
    }

    /// <summary>
    ///     Creates offset plane: one plane offset from anchor.
    /// </summary>
    public void CreateOffsetPlane(OffsetSpec spec) {
        Debug.WriteLine($"[CreateOffsetPlane] Processing: {spec.Name}, Anchor: {spec.AnchorName}");

        var anchor = query.Get(spec.AnchorName);
        if (anchor == null) {
            Debug.WriteLine($"[CreateOffsetPlane] Anchor not found: {spec.AnchorName}");
            logs.Add(new LogEntry($"Offset plane: {spec.Name}").Error($"Anchor '{spec.AnchorName}' not found"));
            return;
        }

        if (query.Get(spec.Name) != null) {
            Debug.WriteLine($"[CreateOffsetPlane] Plane already exists: {spec.Name}");
            logs.Add(new LogEntry($"Offset plane: {spec.Name}").Skip("Already exists"));
            return;
        }

        var normal = anchor.Normal;
        var midpoint = (anchor.BubbleEnd + anchor.FreeEnd) * 0.5;
        var direction = anchor.Direction;
        var cutVec = normal.CrossProduct(direction);
        var t = direction * PlaneExtent;

        var offsetVector = spec.Direction == OffsetDirection.Positive
            ? normal * PlaneOffset
            : normal * -PlaneOffset;

        if (this.CreatePlane(spec.Name, midpoint + offsetVector, t, cutVec, spec.Strength)) logs.Add(new LogEntry($"Offset plane: {spec.Name}").Success("Created"));
    }

    private bool CreatePlane(string name, XYZ origin, XYZ t, XYZ cutVec, RpStrength strength) {
        if (query.Get(name) != null) {
            Debug.WriteLine($"[CreatePlane] Already exists: {name}");
            return true; // Already exists is success
        }

        try {
            Debug.WriteLine($"[CreatePlane] Creating: {name}");
            var rp = doc.FamilyCreate.NewReferencePlane(origin + t, origin - t, cutVec, doc.ActiveView);
            rp.Name = name;
            _ = rp.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME).Set((int)strength);
            _ = query.ReCache(name);
            Debug.WriteLine($"[CreatePlane] Created: {name}, Id: {rp.Id}");
            return true;
        } catch (Exception ex) {
            Debug.WriteLine($"[CreatePlane] ERROR: {name}: {ex.Message}");
            logs.Add(new LogEntry($"RefPlane: {name}").Error(ex));
            return false;
        }
    }

    #endregion

    #region Dimension Creation (Second Operation)

    /// <summary>
    ///     Creates mirror dimensions: EQ constraint (3 planes) + parameter label (2 planes).
    /// </summary>
    public void CreateMirrorDimensions(MirrorSpec spec, int staggerIndex) {
        Debug.WriteLine($"[CreateMirrorDimensions] Processing: {spec.Name}, Center: {spec.CenterAnchor}, Stagger: {staggerIndex}");

        var center = query.Get(spec.CenterAnchor);
        if (center == null) {
            Debug.WriteLine($"[CreateMirrorDimensions] Center not found: {spec.CenterAnchor}");
            return; // Plane creation would have logged the error
        }

        var normal = center.Normal;
        var leftName = spec.GetLeftName(normal);
        var rightName = spec.GetRightName(normal);

        var leftPlane = query.Get(leftName);
        var rightPlane = query.Get(rightName);

        if (leftPlane == null || rightPlane == null) {
            Debug.WriteLine($"[CreateMirrorDimensions] Planes not found - Left: {leftPlane != null}, Right: {rightPlane != null}");
            logs.Add(new LogEntry($"Mirror dims: {spec.Name} @ {spec.CenterAnchor}").Error("Planes not found"));
            return;
        }

        var dimOffset = DimStaggerStep + (DimStaggerStep * staggerIndex);

        // Create parameter dimension first (2 planes: left, right)
        if (this.DimensionExists(leftPlane, rightPlane)) {
            Debug.WriteLine($"[CreateMirrorDimensions] Param dim already exists between {leftName} and {rightName}");
            logs.Add(new LogEntry($"Mirror param dim: {spec.Name} @ {spec.CenterAnchor}").Skip("Already exists"));
        } else {
            try {
                var paramRefArray = new ReferenceArray();
                paramRefArray.Append(leftPlane.GetReference());
                paramRefArray.Append(rightPlane.GetReference());

                var paramDimLine = CreateDimensionLine(leftPlane, rightPlane, dimOffset);
                Debug.WriteLine($"[CreateMirrorDimensions] Param dim line length: {paramDimLine.Length:F6}");

                var paramDim = doc.FamilyCreate.NewLinearDimension(doc.ActiveView, paramDimLine, paramRefArray);

                if (!string.IsNullOrEmpty(spec.Parameter)) {
                    var param = doc.FamilyManager.get_Parameter(spec.Parameter);
                    if (param != null) {
                        paramDim.FamilyLabel = param;
                        logs.Add(new LogEntry($"Mirror param dim: {spec.Name} @ {spec.CenterAnchor}").Success($"Label: {spec.Parameter}"));
                    } else {
                        logs.Add(new LogEntry($"Mirror param dim: {spec.Name} @ {spec.CenterAnchor}").Success($"(param '{spec.Parameter}' not found)"));
                    }
                } else {
                    logs.Add(new LogEntry($"Mirror param dim: {spec.Name} @ {spec.CenterAnchor}").Success("Created"));
                }
            } catch (Exception ex) {
                Debug.WriteLine($"[CreateMirrorDimensions] Param dim ERROR: {ex.Message}");
                logs.Add(new LogEntry($"Mirror param dim: {spec.Name} @ {spec.CenterAnchor}").Error(ex));
            }
        }

        // Create EQ dimension (3 planes: left, center, right)
        if (this.DimensionExists(leftPlane, center, rightPlane)) {
            Debug.WriteLine($"[CreateMirrorDimensions] EQ dim already exists between {leftName}, {spec.CenterAnchor}, {rightName}");
            logs.Add(new LogEntry($"Mirror EQ dim: {spec.Name} @ {spec.CenterAnchor}").Skip("Already exists"));
        } else {
            try {
                var eqRefArray = new ReferenceArray();
                eqRefArray.Append(leftPlane.GetReference());
                eqRefArray.Append(center.GetReference());
                eqRefArray.Append(rightPlane.GetReference());

                var eqDimLine = CreateDimensionLine(leftPlane, rightPlane, dimOffset - DimStaggerStep);
                Debug.WriteLine($"[CreateMirrorDimensions] EQ dim line length: {eqDimLine.Length:F6}");

                var eqDim = doc.FamilyCreate.NewLinearDimension(doc.ActiveView, eqDimLine, eqRefArray);
                eqDim.AreSegmentsEqual = true;
                logs.Add(new LogEntry($"Mirror EQ dim: {spec.Name} @ {spec.CenterAnchor}").Success("Created"));
            } catch (Exception ex) {
                Debug.WriteLine($"[CreateMirrorDimensions] EQ dim ERROR: {ex.Message}");
                logs.Add(new LogEntry($"Mirror EQ dim: {spec.Name} @ {spec.CenterAnchor}").Error(ex));
            }
        }
    }

    /// <summary>
    ///     Creates offset dimension: single dimension between anchor and target.
    /// </summary>
    public void CreateOffsetDimension(OffsetSpec spec, int staggerIndex) {
        Debug.WriteLine($"[CreateOffsetDimension] Processing: {spec.Name}, Anchor: {spec.AnchorName}, Stagger: {staggerIndex}");

        var anchor = query.Get(spec.AnchorName);
        var target = query.Get(spec.Name);

        if (anchor == null || target == null) {
            Debug.WriteLine($"[CreateOffsetDimension] Planes not found - Anchor: {anchor != null}, Target: {target != null}");
            return; // Plane creation would have logged the error
        }

        if (this.DimensionExists(anchor, target)) {
            Debug.WriteLine($"[CreateOffsetDimension] Dimension already exists between {spec.AnchorName} and {spec.Name}");
            logs.Add(new LogEntry($"Offset dim: {spec.Name}").Skip("Already exists"));
            return;
        }

        var dimOffset = DimStaggerStep + (DimStaggerStep * staggerIndex);

        try {
            var refArray = new ReferenceArray();
            refArray.Append(anchor.GetReference());
            refArray.Append(target.GetReference());

            var dimLine = CreateDimensionLine(anchor, target, dimOffset);
            Debug.WriteLine($"[CreateOffsetDimension] Dim line length: {dimLine.Length:F6}");

            var dim = doc.FamilyCreate.NewLinearDimension(doc.ActiveView, dimLine, refArray);

            if (!string.IsNullOrEmpty(spec.Parameter)) {
                var param = doc.FamilyManager.get_Parameter(spec.Parameter);
                if (param != null) {
                    dim.FamilyLabel = param;
                    logs.Add(new LogEntry($"Offset dim: {spec.Name}").Success($"Label: {spec.Parameter}"));
                } else {
                    logs.Add(new LogEntry($"Offset dim: {spec.Name}").Success($"(param '{spec.Parameter}' not found)"));
                }
            } else {
                logs.Add(new LogEntry($"Offset dim: {spec.Name}").Success("Created"));
            }
        } catch (Exception ex) {
            Debug.WriteLine($"[CreateOffsetDimension] ERROR: {ex.Message}");
            logs.Add(new LogEntry($"Offset dim: {spec.Name}").Error(ex));
        }
    }

    #endregion

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
                Debug.WriteLine($"[DimensionExists] Found existing dimension with matching planes");
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

        Debug.WriteLine($"[CreateDimensionLine] Distance: {distanceAlongNormal:F6}, Offset: {offset:F3}");

        return Line.CreateBound(p1, p2);
    }
}

/// <summary>
///     Tracks a formula that needs to be restored after dimension labeling.
/// </summary>
public record DeferredFormula(string ParamName, string Formula);
