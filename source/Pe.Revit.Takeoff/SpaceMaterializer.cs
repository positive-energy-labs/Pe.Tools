using Autodesk.Revit.DB.ExtensibleStorage;

namespace Pe.Revit.Takeoff;

internal sealed record SpaceMaterializationResult(
    IReadOnlyList<ElementId> Spaces,
    int FilledRegions,
    int LineFallbacks,
    int FilledRegionFailures,
    int Rooms,
    int Residues)
{
    internal bool AccountingHolds =>
        Spaces.Count + FilledRegions + LineFallbacks == Rooms + Residues;
}

internal sealed record NativeRunStamp(string RunId, string SourceSha256, string AuditState);

internal static class SpaceMaterializer
{
    private static readonly Guid OwnershipSchemaId = new("fe42dd0d-fd47-4b31-8332-ff1ed891ef02");

    internal static SpaceMaterializationResult Replace(
        Document doc, Level level, Phase phase, TakeoffResult result, TakeoffOptions opt, Action<string> log,
        Func<double, double, bool>? inkNear = null, NativeRunStamp? runStamp = null)
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
        var levelSpaces = new FilteredElementCollector(doc).OfClass(typeof(SpatialElement))
            .OfCategory(BuiltInCategory.OST_MEPSpaces).Cast<Space>()
            .Where(space => space.LevelId.Value() == level.Id.Value()).ToList();
        var wrongPhaseOwned = levelSpaces
            .Where(space => Owned(space, token)
                            && space.get_Parameter(BuiltInParameter.ROOM_PHASE_ID)?.AsElementId().Value()
                            != phase.Id.Value())
            .ToList();
        if (wrongPhaseOwned.Count > 0)
            throw new InvalidOperationException(
                $"target ownership token contains {wrongPhaseOwned.Count} Space(s) outside phase '{phase.Name}'");
        var ownedSpaces = levelSpaces
            .Where(space => Owned(space, token)).ToList();
        var duplicateOwnedIds = ownedSpaces.GroupBy(space => OwnedRoomId(space, token), StringComparer.Ordinal)
            .Where(group => group.Key != null && group.Count() > 1).Select(group => group.Key).ToList();
        if (duplicateOwnedIds.Count > 0)
            throw new InvalidOperationException(
                $"target ownership token contains duplicate room ids: {string.Join(", ", duplicateOwnedIds)}");
        var existing = levelSpaces
            .Where(space => space.get_Parameter(BuiltInParameter.ROOM_PHASE_ID)?.AsElementId().Value()
                            == phase.Id.Value()
                            && !Owned(space, token))
            .Select(space => space.Id).ToList();
        if (existing.Count > 0)
            throw new InvalidOperationException($"target level/phase already contains {existing.Count} non-takeoff Space(s)");

        var view = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .SingleOrDefault(candidate => candidate.Name == viewName);
        var sketchPlane = view != null && OwnedSketchPlane(view) is { } sketchId
            ? doc.GetElement(sketchId) as SketchPlane
            : null;
        DeleteOwned(doc, token, viewName);
        var boundary = SpaceBoundaryNetwork.Build(result.Rooms);
        var spaceRooms = result.Rooms.ToList();

        if (view == null)
        {
            var viewType = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                .First(type => type.ViewFamily == ViewFamily.FloorPlan);
            view = ViewPlan.Create(doc, viewType.Id, level.Id);
            view.Name = viewName;
            view.get_Parameter(BuiltInParameter.VIEW_PHASE)?.Set(phase.Id);
        }
        else
        {
            var viewPhase = view.get_Parameter(BuiltInParameter.VIEW_PHASE);
            if (viewPhase is { IsReadOnly: false } && viewPhase.AsElementId().Value() != phase.Id.Value())
                viewPhase.Set(phase.Id);
        }
        if (runStamp != null)
            Stamp(view, ViewRunComments(token, runStamp));

        if (sketchPlane == null)
        {
            var plane = Plane.CreateByNormalAndOrigin(XYZ.BasisZ, new XYZ(0, 0, level.Elevation));
            sketchPlane = SketchPlane.Create(doc, plane);
            if (view.get_Parameter(BuiltInParameter.VIEW_DESCRIPTION)?.Set(sketchPlane.UniqueId) != true)
                throw new InvalidOperationException("cannot persist the owned Space boundary sketch plane");
        }
        if (boundary.Count > 0)
        {
            var curves = new CurveArray();
            foreach (var curve in boundary)
                curves.Append(Line.CreateBound(
                    new XYZ(curve.X1, curve.Y1, level.Elevation),
                    new XYZ(curve.X2, curve.Y2, level.Elevation)));
            doc.Create.NewSpaceBoundaryLines(sketchPlane, curves, view);
            doc.Regenerate();
        }

        var available = ownedSpaces.ToList();
        var assigned = new Dictionary<string, Space>(StringComparer.Ordinal);
        foreach (var room in spaceRooms)
        {
            var exact = available.FirstOrDefault(space => OwnedRoomId(space, token) == room.Id);
            if (exact == null) continue;
            assigned.Add(room.Id, exact);
            available.Remove(exact);
        }
        foreach (var room in spaceRooms.Where(room => !assigned.ContainsKey(room.Id)))
        {
            var nearest = available.OrderBy(space => DistanceSquared(space, room)).FirstOrDefault();
            if (nearest == null) break;
            assigned.Add(room.Id, nearest);
            available.Remove(nearest);
        }

        var spacesByRoom = new Dictionary<string, Space>(StringComparer.Ordinal);
        foreach (var room in spaceRooms.Where(room => assigned.ContainsKey(room.Id)))
        {
            var space = assigned[room.Id];
            MoveTo(space, room);
            Configure(space, room);
            spacesByRoom.Add(room.Id, space);
        }
        if (available.Count > 0) doc.Delete(available.Select(space => space.Id).ToList());
        doc.Regenerate();

        foreach (var room in spaceRooms.Where(room => !spacesByRoom.ContainsKey(room.Id)))
        {
            var space = doc.Create.NewSpace(level, phase, new UV(room.LabelX, room.LabelY))
                ?? throw new InvalidOperationException($"Revit did not create a Space for {room.Id}");
            Configure(space, room);
            spacesByRoom.Add(room.Id, space);
        }
        doc.Regenerate();
        var ids = spaceRooms.Select(room => spacesByRoom[room.Id].Id).ToList();
        var wrongPhase = ids.Select(id => (Space)doc.GetElement(id))
            .Where(space => space.get_Parameter(BuiltInParameter.ROOM_PHASE_ID)?.AsElementId().Value()
                            != phase.Id.Value())
            .Select(space => space.Id.Value()).ToList();
        if (wrongPhase.Count > 0)
            throw new InvalidOperationException(
                $"Revit assigned {wrongPhase.Count} Space(s) outside requested phase '{phase.Name}': " +
                string.Join(", ", wrongPhase));

        // Geometry promotion is decided before Revit and verified after commit. Inspecting a
        // newly placed Space here is transaction-state-dependent: the same room can be enclosed
        // on a replacement pass only because the previous boundary graph existed at transaction
        // start. Keep materialization deterministic and let the canonical native gate decide.
        int filledRegions = 0, lineFallbacks = 0, filledRegionFailures = 0;
        if (result.Residues.Count > 0)
        {
            var frType = new FilteredElementCollector(doc).OfClass(typeof(FilledRegionType))
                .Cast<FilledRegionType>().First();
            var solid = new FilteredElementCollector(doc).OfClass(typeof(FillPatternElement))
                .Cast<FillPatternElement>().First(pattern => pattern.GetFillPattern().IsSolidFill);
            var unresolvedStyle = new OverrideGraphicSettings()
                .SetSurfaceForegroundPatternId(solid.Id)
                .SetSurfaceForegroundPatternColor(new Color(128, 128, 128))
                .SetSurfaceTransparency(55)
                .SetProjectionLineColor(new Color(96, 96, 96))
                .SetHalftone(true);

            foreach (var residue in result.Residues)
            {
                // A border residue leaks past the takeoff crop: exterior terrain, not building
                // evidence. Drawing it paints half the site — log it and keep the view clean.
                if (residue.Reason is ResidueReason.Border or ResidueReason.Rejected)
                {
                    log($"[spaces] {residue.Reason.ToString().ToLowerInvariant()} residue " +
                        $"{residue.Id} ({residue.RawSqft:F0}sf) not drawn");
                    continue;
                }
                DrawUnresolved(residue.Id, residue.Polygon, residue.Holes,
                    $"{token}|{residue.Id}\npe-takeoff: residue={residue.Reason.ToString().ToLowerInvariant()}");
            }

            void DrawUnresolved(
                string id, List<double[]> polygon, List<List<double[]>> holes, string comments)
            {
                List<FilledRegion> regions;
                string? repairLog = null;
                try
                {
                    var loops = new List<CurveLoop> { Annotate.ToLoop(polygon, level.Elevation) };
                    loops.AddRange(holes.Select(hole => Annotate.ToLoop(hole, level.Elevation)));
                    regions = [FilledRegion.Create(doc, frType.Id, view.Id, loops)];
                }
                catch (Exception originalException)
                {
                    try
                    {
                        (regions, repairLog) = CreateRepairedRegions(id, polygon, holes);
                    }
                    catch (Exception repairException)
                    {
                        DrawLineFallback(id, polygon, comments, originalException, repairException);
                        return;
                    }
                }

                StampAndStyle(regions, comments);
                filledRegions++;
                if (repairLog != null) log(repairLog);
            }

            (List<FilledRegion> Regions, string RepairLog) CreateRepairedRegions(
                string id, List<double[]> polygon, List<List<double[]>> holes)
            {
                var outerLoops = Annotate.SplitSelfTouchingLoop(
                    polygon, level.Elevation, out int repeatedVertices, out int droppedDegenerateLoops);
                var repairedLoops = outerLoops.ToList();
                int droppedHoles = 0;
                foreach (var hole in holes)
                {
                    try { repairedLoops.Add(Annotate.ToLoop(hole, level.Elevation)); }
                    catch (Exception holeException)
                    {
                        droppedHoles++;
                        log($"[spaces] {id} ring repair dropped hole: {holeException.Message}");
                    }
                }

                List<FilledRegion> regions;
                try
                {
                    regions = [FilledRegion.Create(doc, frType.Id, view.Id, repairedLoops)];
                }
                catch (Exception combinedException)
                {
                    regions = [];
                    try
                    {
                        foreach (var outerLoop in outerLoops)
                            regions.Add(FilledRegion.Create(
                                doc, frType.Id, view.Id, new List<CurveLoop> { outerLoop }));
                    }
                    catch (Exception individualException)
                    {
                        if (regions.Count > 0) doc.Delete(regions.Select(item => item.Id).ToList());
                        throw new InvalidOperationException(
                            $"combined loops rejected ({combinedException.Message}); " +
                            $"individual loop rejected ({individualException.Message})", individualException);
                    }
                    if (holes.Count > 0)
                    {
                        droppedHoles = holes.Count;
                        log($"[spaces] {id} ring repair dropped {holes.Count} hole(s): " +
                            "Revit rejected the combined repaired loops");
                    }
                }

                string repairLog = $"[spaces] {id} ring repaired: repeatedVertices={repeatedVertices} " +
                                   $"simpleLoops={outerLoops.Count} filledRegionElements={regions.Count} " +
                                   $"droppedDegenerateLoops={droppedDegenerateLoops} droppedHoles={droppedHoles}";
                return (regions, repairLog);
            }

            void StampAndStyle(IEnumerable<FilledRegion> regions, string comments)
            {
                foreach (var region in regions)
                {
                    Stamp(region, comments);
                    view.SetElementOverrides(region.Id, unresolvedStyle);
                }
            }

            void DrawLineFallback(
                string id, List<double[]> polygon, string comments,
                Exception originalException, Exception repairException)
            {
                filledRegionFailures++;
                var points = Annotate.CleanPoints(polygon, level.Elevation);
                int made = 0;
                for (int i = 0; i < points.Count; i++)
                {
                    var a = points[i]; var b = points[(i + 1) % points.Count];
                    if (a.DistanceTo(b) <= 0.01) continue;
                    var line = doc.Create.NewDetailCurve(view, Line.CreateBound(a, b));
                    Stamp(line, comments);
                    view.SetElementOverrides(line.Id, unresolvedStyle);
                    made++;
                }
                if (made == 0)
                    throw new InvalidOperationException(
                        $"{id} FilledRegion failed and ring repair left no drawable outer ring", repairException);
                lineFallbacks++;
                log($"[spaces] {id} FilledRegion failed; ring repair failed: {repairException.Message}; " +
                    $"drew outer-ring detail lines: {originalException.Message}");
            }
        }

        var validationErrors = new List<string>();
        foreach (var (room, id) in spaceRooms.Zip(ids, (room, id) => (room, id)))
        {
            var space = (Space)doc.GetElement(id);
            // Bound native area drift by the raster half-cell plus the wall fitter's maximum
            // displacement. Both are physical distance errors, so their perimeter strip is the
            // relevant envelope; percentage tolerances punish small rooms arbitrarily.
            double targetArea = room.RawSqft;
            double fitFt = opt.BoundarySimplifyFt;
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
        double targetTotal = spaceRooms.Sum(room => room.RawSqft);
        if (Math.Abs(nativeTotal - targetTotal) > Math.Max(20, 0.02 * targetTotal))
            validationErrors.Add(
                $"level total drift: native={nativeTotal:F0}sf target={targetTotal:F0}sf delta={nativeTotal - targetTotal:+0;-0}sf");
        // ponytail: validation reports instead of throwing — the 80% product path materializes the
        // level and hands drift/enclosure failures to the human/Pea loop with the unresolved list
        foreach (var error in validationErrors) log($"[spaces] VALIDATION {error}");
        // border residues are deliberately not drawn (exterior leaks); the accounting identity
        // covers only drawn evidence, and the skip is logged above
        var materialized = new SpaceMaterializationResult(
            ids, filledRegions, lineFallbacks, filledRegionFailures,
            spaceRooms.Count,
            result.Residues.Count(residue => residue.Reason == ResidueReason.Crumb));
        log($"[spaces] phase='{phase.Name}' level='{level.Name}' spaces={ids.Count} " +
            $"filledRegions={filledRegions} lineFallbacks={lineFallbacks} " +
            $"filledRegionFailures={filledRegionFailures} rooms={materialized.Rooms} " +
            $"residues={materialized.Residues} " +
            $"boundaryCurves={boundary.Count} view='{viewName}'");
        if (!materialized.AccountingHolds)
            throw new InvalidOperationException(
                $"materialization accounting failed: spaces={ids.Count} filledRegions={filledRegions} " +
                $"lineFallbacks={lineFallbacks} rooms={materialized.Rooms} " +
                $"residues={materialized.Residues}");
        return materialized;

        void Configure(Space space, RoomResult room)
        {
            space.Number = room.Id;
            space.Name = $"{opt.Marker} {room.Id}";
            space.BaseOffset = 0;
            space.UpperLimit = level;
            space.LimitOffset = room.MeanCeilingFt;
            Stamp(space, SpaceComments(token, room, runStamp));
        }

        void MoveTo(Space space, RoomResult room)
        {
            if (space.Location is not LocationPoint location)
                throw new InvalidOperationException($"owned Space {space.Id.Value()} has no point location");
            var delta = new XYZ(room.LabelX - location.Point.X, room.LabelY - location.Point.Y, 0);
            if (delta.GetLength() > 1e-6) ElementTransformUtils.MoveElement(doc, space.Id, delta);
        }

        static double DistanceSquared(Space space, RoomResult room)
        {
            if (space.Location is not LocationPoint location) return double.MaxValue;
            double dx = location.Point.X - room.LabelX, dy = location.Point.Y - room.LabelY;
            return dx * dx + dy * dy;
        }
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

    internal static string ViewName(TakeoffOptions opt, Level level, Phase phase) =>
        $"{opt.Marker} spaces {level.Name} {phase.Name}";

    private static void DeleteOwned(Document doc, string token, string viewName)
    {
        var views = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .Where(view => view.Name == viewName).ToList();
        var sketchIds = views.Select(OwnedSketchPlane).Where(id => id != null).Select(id => id!).ToList();
        var ids = new FilteredElementCollector(doc).WhereElementIsNotElementType()
            .Where(element => element is not Space && Owned(element, token))
            .Select(element => element.Id).ToList();
        if (sketchIds.Count > 0)
            ids.AddRange(new FilteredElementCollector(doc)
                .OfCategory(BuiltInCategory.OST_MEPSpaceSeparationLines)
                .WhereElementIsNotElementType().Cast<ModelCurve>()
                .Where(line => sketchIds.Any(id => id.Value() == line.SketchPlane.Id.Value()))
                .Select(line => line.Id));
        ids = ids.GroupBy(id => id.Value()).Select(group => group.First()).ToList();
        // Reuse the canonical view and its sketch plane. Deleting a view attempts to delete its
        // workset, which may be non-editable in a detached workshared document even though all
        // Takeoff elements inside that view are safely replaceable.
        if (ids.Count > 0) { doc.Delete(ids); doc.Regenerate(); }
    }

    private static ElementId? OwnedSketchPlane(View view)
    {
        string? uniqueId = view.get_Parameter(BuiltInParameter.VIEW_DESCRIPTION)?.AsString();
        return string.IsNullOrWhiteSpace(uniqueId) ? null : view.Document.GetElement(uniqueId)?.Id;
    }

    internal static bool Owned(Element element, string token) =>
        Comments(element)?.StartsWith(token + "|", StringComparison.Ordinal) == true;

    private static string? OwnedRoomId(Space space, string token)
    {
        string? firstLine = Comments(space)?.Split('\n')[0].TrimEnd('\r');
        string prefix = token + "|";
        return firstLine?.StartsWith(prefix, StringComparison.Ordinal) == true
            ? firstLine[prefix.Length..]
            : null;
    }

    internal static string? Comments(Element element)
    {
        string? comments = element.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.AsString();
        if (!string.IsNullOrWhiteSpace(comments)) return comments;
        var schema = Schema.Lookup(OwnershipSchemaId);
        if (schema == null) return null;
        var entity = element.GetEntity(schema);
        return entity.IsValid() ? entity.Get<string>("Token") : null;
    }

    internal static bool HasRunStamp(
        Element element, string runId, string sourceSha256, string auditState) =>
        Comments(element)?.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .Contains(RunLine(new NativeRunStamp(runId, sourceSha256, auditState)), StringComparer.Ordinal) == true;

    internal static bool HasPendingRun(Document doc, string token) =>
        new FilteredElementCollector(doc).OfClass(typeof(SpatialElement))
            .OfCategory(BuiltInCategory.OST_MEPSpaces).Cast<Space>()
            .Where(space => Owned(space, token))
            .Select(Comments)
            .Any(comments => comments?.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
                .Any(line => line.StartsWith("pe-takeoff-run:", StringComparison.Ordinal)
                             && line.Contains(";audit=pending;", StringComparison.Ordinal)) == true);

    internal static string SpaceComments(string token, RoomResult room, NativeRunStamp? runStamp = null)
    {
        var lines = new List<string> { token + "|" + room.Id };
        if (room.Flags.Count > 0)
            lines.Add("pe-takeoff: " + string.Join(", ", room.Flags));
        if (room.SplitFrom is not null)
            lines.Add("pe-takeoff: splitFrom=" + room.SplitFrom);
        if (room.MergedFrom is not null)
            lines.Add("pe-takeoff: mergedFrom=" + room.MergedFrom);
        if (runStamp != null)
            lines.Add(RunLine(runStamp));
        return string.Join("\n", lines);
    }

    internal static void SetRunAuditState(
        Document doc, TakeoffOptions opt, Level level, Phase phase,
        string runId, string sourceSha256, string auditState)
    {
        var stamp = new NativeRunStamp(runId, sourceSha256, auditState);
        string token = Token(opt, level, phase);
        foreach (var space in new FilteredElementCollector(doc).OfClass(typeof(SpatialElement))
                     .OfCategory(BuiltInCategory.OST_MEPSpaces).Cast<Space>()
                     .Where(space => Owned(space, token)))
            Stamp(space, ReplaceRunLine(Comments(space), stamp));

        var view = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .SingleOrDefault(candidate => candidate.Name == ViewName(opt, level, phase));
        if (view != null) Stamp(view, ViewRunComments(token, stamp));
    }

    private static string ViewRunComments(string token, NativeRunStamp stamp) =>
        $"pe-takeoff-view: {token}\n{RunLine(stamp)}";

    private static string RunLine(NativeRunStamp stamp) =>
        $"pe-takeoff-run: run={stamp.RunId};audit={stamp.AuditState};source={stamp.SourceSha256}";

    private static string ReplaceRunLine(string? comments, NativeRunStamp stamp)
    {
        var lines = (comments ?? "").Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .Where(line => !line.StartsWith("pe-takeoff-run:", StringComparison.Ordinal)).ToList();
        lines.Add(RunLine(stamp));
        return string.Join("\n", lines);
    }

    private static void Stamp(Element element, string value)
    {
        var parameter = element.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
        if (parameter is { IsReadOnly: false } && parameter.Set(value)) return;
        var schema = Schema.Lookup(OwnershipSchemaId) ?? CreateOwnershipSchema();
        var entity = new Entity(schema);
        entity.Set("Token", value);
        element.SetEntity(entity);
    }

    private static Schema CreateOwnershipSchema()
    {
        var builder = new SchemaBuilder(OwnershipSchemaId);
        builder.SetSchemaName("PeTakeoffOwnership");
        builder.SetReadAccessLevel(AccessLevel.Public);
        builder.SetWriteAccessLevel(AccessLevel.Public);
        builder.AddSimpleField("Token", typeof(string));
        return builder.Finish();
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
