namespace Pe.Revit.Takeoff;

internal static class SpaceMaterializer
{
    internal static IReadOnlyList<ElementId> Replace(
        Document doc, Level level, Phase phase, TakeoffResult result, TakeoffOptions opt, Action<string> log,
        Func<double, double, bool>? inkNear = null)
    {
        if (!doc.IsModifiable) throw new InvalidOperationException("Space materialization requires an open transaction");
        if (doc.GetElement(level.Id) is not Level || doc.GetElement(phase.Id) is not Phase)
            throw new InvalidOperationException("level and phase must belong to the target document");
        if (Math.Abs(result.LevelElevation - level.ProjectElevation) > 0.01)
            throw new InvalidOperationException("takeoff result elevation does not match the target level");
        if (result.Rooms.Count == 0) throw new InvalidOperationException("takeoff result has no accepted regions");
        if (result.Rooms.Select(room => room.Id).Distinct(StringComparer.Ordinal).Count() != result.Rooms.Count)
            throw new InvalidOperationException("takeoff region ids must be unique");
        foreach (var room in result.Rooms)
            if (!Contains(room.Polygon, room.LabelX, room.LabelY)
                || room.Holes.Any(hole => Contains(hole, room.LabelX, room.LabelY)))
                throw new InvalidOperationException($"{room.Id} label point is outside its accepted region");

        string token = Token(opt, level, phase), viewName = ViewName(opt, level, phase);
        var existing = new FilteredElementCollector(doc).OfClass(typeof(SpatialElement))
            .OfCategory(BuiltInCategory.OST_MEPSpaces).Cast<Space>()
            .Where(space => space.LevelId.Value() == level.Id.Value()
                            && space.get_Parameter(BuiltInParameter.ROOM_PHASE_ID)?.AsElementId().Value() == phase.Id.Value()
                            && !Owned(space, token))
            .Select(space => space.Id).ToList();
        if (existing.Count > 0)
            throw new InvalidOperationException($"target level/phase already contains {existing.Count} non-takeoff Space(s)");

        DeleteOwned(doc, token, viewName);
        var dropped = new SortedSet<string>(StringComparer.Ordinal);
        var boundary = SpaceBoundaryNetwork.Build(result.Rooms, opt.CellFt, opt.BoundarySimplifyFt, inkNear, dropped, log);
        var keptRooms = result.Rooms.Where(room => !dropped.Contains(room.Id)).ToList();
        if (dropped.Count > 0)
            log($"[spaces] dropped {dropped.Count}/{result.Rooms.Count} rooms as holes: " + string.Join(" ",
                result.Rooms.Where(room => dropped.Contains(room.Id))
                    .Select(room => $"{room.Id}@({room.LabelX:F0},{room.LabelY:F0})")));
        if (keptRooms.Count == 0) throw new InvalidOperationException("every room dropped as unresolvable — nothing to materialize");

        var viewType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
            .First(type => type.ViewFamily == ViewFamily.FloorPlan);
        var view = ViewPlan.Create(doc, viewType.Id, level.Id);
        view.Name = viewName;
        view.get_Parameter(BuiltInParameter.VIEW_PHASE)?.Set(phase.Id);

        var plane = Plane.CreateByNormalAndOrigin(XYZ.BasisZ, new XYZ(0, 0, level.Elevation));
        var sketchPlane = SketchPlane.Create(doc, plane);
        if (view.get_Parameter(BuiltInParameter.VIEW_DESCRIPTION)?.Set(sketchPlane.UniqueId) != true)
            throw new InvalidOperationException("cannot persist the owned Space boundary sketch plane");
        var curves = new CurveArray();
        foreach (var curve in boundary)
            curves.Append(curve.IsArc
                ? Arc.Create(
                    new XYZ(curve.X1, curve.Y1, level.Elevation),
                    new XYZ(curve.X2, curve.Y2, level.Elevation),
                    new XYZ(curve.MidX, curve.MidY, level.Elevation))
                : (Curve)Line.CreateBound(
                    new XYZ(curve.X1, curve.Y1, level.Elevation),
                    new XYZ(curve.X2, curve.Y2, level.Elevation)));
        doc.Create.NewSpaceBoundaryLines(sketchPlane, curves, view);
        doc.Regenerate();

        var ids = new List<ElementId>();
        foreach (var room in keptRooms)
        {
            var space = doc.Create.NewSpace(level, phase, new UV(room.LabelX, room.LabelY))
                ?? throw new InvalidOperationException($"Revit did not create a Space for {room.Id}");
            space.Number = room.Id;
            space.Name = $"{opt.Marker} {room.Id}";
            space.BaseOffset = 0;
            space.UpperLimit = level;
            space.LimitOffset = room.MeanCeilingFt;
            Stamp(space, token + "|" + room.Id);
            ids.Add(space.Id);
        }
        doc.Regenerate();

        // Room-level shape gate on the NATIVE boundary: a small room that came out as an
        // arrowhead/wedge (acute corner), a sliver, or a step-storm is bewildering, not helpful —
        // delete it so the plan shows an honest hole. Big rooms are exempt: circulation legally
        // has many corners, and dropping the main corridor would gut the level.
        var shapeDropped = new List<string>();
        for (int i = ids.Count - 1; i >= 0; i--)
        {
            var space = (Space)doc.GetElement(ids[i]);
            string? reason = ShapeDefect(space, inkNear);
            if (reason == null) continue;
            shapeDropped.Add($"{keptRooms[i].Id}@({keptRooms[i].LabelX:F0},{keptRooms[i].LabelY:F0}) {reason}");
            dropped.Add(keptRooms[i].Id);
            doc.Delete(space.Id);
            ids.RemoveAt(i);
            keptRooms.RemoveAt(i);
        }
        if (shapeDropped.Count > 0)
        {
            doc.Regenerate();
            log($"[spaces] shape gate dropped {shapeDropped.Count} rooms as holes: " + string.Join(" ", shapeDropped));
        }

        var validationErrors = new List<string>();
        foreach (var (room, id) in keptRooms.Zip(ids, (room, id) => (room, id)))
        {
            var space = (Space)doc.GetElement(id);
            // Bound native area drift by the raster half-cell plus the wall fitter's maximum
            // displacement. Both are physical distance errors, so their perimeter strip is the
            // relevant envelope; percentage tolerances punish small rooms arbitrarily.
            double targetArea = room.RawSqft;
            double fitFt = Math.Min(opt.BoundarySimplifyFt, 3.5 * opt.CellFt);
            double tolerance = Math.Max(1, room.PerimeterFt * (opt.CellFt / 2 + fitFt));
            if (space.Area <= 0 || Math.Abs(space.Area - targetArea) > tolerance)
                validationErrors.Add($"{room.Id} area native={space.Area:F1}sf physical={targetArea:F1}sf delta={space.Area - targetArea:+0.0;-0.0;0.0}sf ({(space.Area / targetArea - 1) * 100:+0.00;-0.00;0.00}%)");
            if (space.GetBoundarySegments(new SpatialElementBoundaryOptions()) is not { Count: > 0 })
                validationErrors.Add($"{room.Id} is not enclosed");
            if (space.Location is not LocationPoint location
                || Math.Abs(location.Point.X - room.LabelX) > 0.01
                || Math.Abs(location.Point.Y - room.LabelY) > 0.01)
                validationErrors.Add($"{room.Id} is not placed at its takeoff label point");
        }
        // conservation check: per-room strips can hide a reshuffle (one room's loss is another's
        // gain), but the LEVEL total must hold — boundary regularization only moves area between
        // rooms, it must not create or destroy it
        double nativeTotal = ids.Sum(id => ((Space)doc.GetElement(id)).Area);
        double targetTotal = keptRooms.Sum(room => room.RawSqft);
        if (Math.Abs(nativeTotal - targetTotal) > Math.Max(20, 0.02 * targetTotal))
            validationErrors.Add(
                $"level total drift: native={nativeTotal:F0}sf target={targetTotal:F0}sf delta={nativeTotal - targetTotal:+0;-0}sf");
        // ponytail: validation reports instead of throwing — the 80% product path materializes the
        // level and hands drift/enclosure failures to the human/Pea loop with the unresolved list
        foreach (var error in validationErrors) log($"[spaces] VALIDATION {error}");
        log($"[spaces] phase='{phase.Name}' level='{level.Name}' spaces={ids.Count} boundaryCurves={boundary.Count} view='{viewName}'");
        return ids;
    }

    // Room-level shape defects a user called "bewildering": arrowheads/wedges (acute corners),
    // slivers, and step-storms. Returns a short reason tag, or null when the shape is acceptable.
    // ponytail: fixed thresholds (400 sf exemption, 55-degree spike, 2 ft width, 14 corners) —
    // promote to TakeoffOptions when a second model disagrees.
    private static string? ShapeDefect(Space space, Func<double, double, bool>? inkNear)
    {
        if (space.Area >= 400) return null;
        var loops = space.GetBoundarySegments(new SpatialElementBoundaryOptions());
        if (loops == null || loops.Count == 0) return null;   // enclosure validation reports this
        var outer = loops.OrderByDescending(segments =>
            Math.Abs(Shoelace(segments.Select(segment => segment.GetCurve().GetEndPoint(0)).ToList()))).First();
        var raw = outer.Select(segment => segment.GetCurve().GetEndPoint(0)).ToList();

        // merge collinear vertices: separation lines split at network junctions inflate the count
        var corners = new List<XYZ>();
        int n = raw.Count;
        for (int i = 0; i < n; i++)
        {
            var previous = raw[(i + n - 1) % n];
            var vertex = raw[i];
            var next = raw[(i + 1) % n];
            double ax = vertex.X - previous.X, ay = vertex.Y - previous.Y;
            double bx = next.X - vertex.X, by = next.Y - vertex.Y;
            double la = Math.Sqrt(ax * ax + ay * ay), lb = Math.Sqrt(bx * bx + by * by);
            if (la < 1e-6 || lb < 1e-6) continue;
            if (Math.Abs(ax * by - ay * bx) > 0.01 * la * lb) corners.Add(vertex);
        }
        if (corners.Count < 3) return null;

        double area = Math.Abs(Shoelace(corners));
        double perimeter = 0;
        for (int i = 0; i < corners.Count; i++)
        {
            var a = corners[i];
            var b = corners[(i + 1) % corners.Count];
            perimeter += Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));
        }
        if (perimeter > 0 && 2 * area / perimeter < 2.0)
            return $"sliver(width={2 * area / perimeter:F1}ft)";
        if (corners.Count > 14) return $"zigzag(corners={corners.Count})";
        for (int i = 0; i < corners.Count; i++)
        {
            var previous = corners[(i + corners.Count - 1) % corners.Count];
            var vertex = corners[i];
            var next = corners[(i + 1) % corners.Count];
            double ax = vertex.X - previous.X, ay = vertex.Y - previous.Y;
            double bx = next.X - vertex.X, by = next.Y - vertex.Y;
            double la = Math.Sqrt(ax * ax + ay * ay), lb = Math.Sqrt(bx * bx + by * by);
            // spike (interior OR notch) sharper than 55 degrees: angle between -a and b.
            // A real 45-degree corner exists wherever the building's two wall families meet, so
            // acute alone is not a defect — an acute corner WITHOUT wall ink under it is: that
            // apex is an equidistance seam poking into open floor (the "arrowhead" rooms).
            if (-(ax * bx + ay * by) / (la * lb) > 0.574
                && (inkNear == null || !inkNear(vertex.X, vertex.Y)))
                return $"acuteCorner@({vertex.X:F0},{vertex.Y:F0})";
        }
        return null;
    }

    private static double Shoelace(IReadOnlyList<XYZ> points)
    {
        double sum = 0;
        for (int i = 0; i < points.Count; i++)
        {
            var a = points[i];
            var b = points[(i + 1) % points.Count];
            sum += a.X * b.Y - b.X * a.Y;
        }
        return sum / 2;
    }

    internal static int Cleanup(Document doc, TakeoffOptions opt, Action<string> log)
    {
        string prefix = $"{opt.Marker}|spaces|";
        var views = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .Where(view => view.Name.StartsWith(opt.Marker + " spaces ", StringComparison.Ordinal)).ToList();
        var sketchIds = views.Select(OwnedSketchPlane).Where(id => id != null).Select(id => id!).ToList();
        var ids = new FilteredElementCollector(doc).WhereElementIsNotElementType()
            .Where(element => Comments(element)?.StartsWith(prefix, StringComparison.Ordinal) == true
                              || element is ViewPlan && views.Any(view => view.Id.Value() == element.Id.Value()))
            .Select(element => element.Id).Concat(sketchIds).GroupBy(id => id.Value()).Select(group => group.First()).ToList();
        if (ids.Count > 0) doc.Delete(ids);
        log($"[spaces] cleanup deleted {ids.Count} owned elements");
        return ids.Count;
    }

    internal static string Token(TakeoffOptions opt, Level level, Phase phase) =>
        $"{opt.Marker}|spaces|{level.Id.Value()}|{phase.Id.Value()}";

    private static string ViewName(TakeoffOptions opt, Level level, Phase phase) =>
        $"{opt.Marker} spaces {level.Name} {phase.Name}";

    private static void DeleteOwned(Document doc, string token, string viewName)
    {
        var views = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .Where(view => view.Name == viewName).ToList();
        var sketchIds = views.Select(OwnedSketchPlane).Where(id => id != null).Select(id => id!).ToList();
        var ids = new FilteredElementCollector(doc).WhereElementIsNotElementType()
            .Where(element => Owned(element, token)
                              || element is ViewPlan && views.Any(view => view.Id.Value() == element.Id.Value()))
            .Select(element => element.Id).Concat(sketchIds).GroupBy(id => id.Value()).Select(group => group.First()).ToList();
        // Revit refuses to delete the ACTIVE view; if the user has our spaces view open, strand it
        // under a stale name instead so the fresh view can claim the canonical name
        var active = doc.ActiveView;
        if (active != null && ids.Any(id => id.Value() == active.Id.Value()))
        {
            ids.RemoveAll(id => id.Value() == active.Id.Value());
            active.Name = $"{viewName} stale {DateTime.UtcNow.Ticks}";
        }
        if (ids.Count > 0) { doc.Delete(ids); doc.Regenerate(); }
    }

    private static ElementId? OwnedSketchPlane(View view)
    {
        string? uniqueId = view.get_Parameter(BuiltInParameter.VIEW_DESCRIPTION)?.AsString();
        return string.IsNullOrWhiteSpace(uniqueId) ? null : view.Document.GetElement(uniqueId)?.Id;
    }

    private static bool Owned(Element element, string token) =>
        Comments(element)?.StartsWith(token + "|", StringComparison.Ordinal) == true;

    private static string? Comments(Element element) =>
        element.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.AsString();

    private static void Stamp(Element element, string value)
    {
        var parameter = element.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
        if (parameter == null || parameter.IsReadOnly || !parameter.Set(value))
            throw new InvalidOperationException($"cannot stamp ownership on {element.GetType().Name} {element.Id}");
    }

    private static bool Contains(IReadOnlyList<double[]> polygon, double x, double y)
    {
        bool inside = false;
        for (int i = 0, j = polygon.Count - 1; i < polygon.Count; j = i++)
        {
            var a = polygon[i]; var b = polygon[j];
            if ((a[1] > y) != (b[1] > y)
                && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
    }
}
