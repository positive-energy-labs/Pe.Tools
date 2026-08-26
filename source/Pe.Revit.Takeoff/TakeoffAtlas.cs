using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace Pe.Revit.Takeoff;

/// <summary>
/// JSON formatting for durable Takeoff provenance and artifacts.
/// </summary>
internal static class TakeoffJson
{
    private static readonly JsonSerializerSettings Settings = new()
    {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
        FloatFormatHandling = FloatFormatHandling.DefaultValue,
        NullValueHandling = NullValueHandling.Include,
    };

    public static string Serialize(object value) =>
        JsonConvert.SerializeObject(value, Formatting.None, Settings);

}

public sealed record TakeoffZoneProvenance(int V, string View, string Name, string SystemTag);
public sealed record TakeoffPlanReferenceArgs(
    string View,
    string Token,
    List<List<double[]>> Loops);
public sealed record TakeoffPlanReferencePrepared(string View, string Token);
public sealed record TakeoffPlanReferenceExported(
    string View,
    string Token,
    string ImagePath,
    string ManifestPath);

public static class TakeoffAtlas
{
    public static TakeoffSnapshotData Snapshot(Document doc)
    {
        var zones = ZoneRegions(doc);
        var grouped = new Dictionary<string, List<TakeoffLiveRegion>>(StringComparer.OrdinalIgnoreCase);

        foreach (var fr in new FilteredElementCollector(doc)
                     .OfClass(typeof(FilledRegion)).Cast<FilledRegion>())
        {
            var (role, guid) = TakeoffCarriers.ReadIdentity(fr);
            if (guid == null || role is not (TakeoffCarriers.RoleRoomRegion or TakeoffCarriers.RoleHeldResidue))
                continue;
            string blob = TakeoffCarriers.ReadProvenance(fr)
                          ?? throw new InvalidOperationException($"{role} {fr.Id} has no provenance blob");
            var provenance = RegionProvenance.FromJson(blob);
            string key = provenance.ZoneGuid.ToString("D");
            if (!grouped.TryGetValue(key, out var regions))
                grouped[key] = regions = [];
            regions.Add(ToLiveRegion(doc, fr, role, guid.Value, blob));
        }

        var registry = TakeoffCarriers.ReadRegistry(doc);
        var status = new TakeoffModelStatus(
            registry.Systems.Select(s => new TakeoffRegistrySystem(s.Guid, s.Tag)).ToList());
        return new TakeoffSnapshotData(status, zones, grouped);
    }

    public static List<TakeoffViewFacts> Views(Document doc)
    {
        var counts = new FilteredElementCollector(doc)
            .OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
            .GroupBy(fr => fr.OwnerViewId.Value())
            .ToDictionary(g => g.Key, g => g.Count());
        return new FilteredElementCollector(doc)
            .OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .Where(v => !v.IsTemplate)
            .Select(v => new TakeoffViewFacts(
                v.Id.Value(),
                counts.GetValueOrDefault(v.Id.Value())))
            .ToList();
    }

    public static List<TakeoffRegionFacts> CandidateRegions(Document doc, TakeoffCandidatesRequest request)
    {
        var view = FindView(doc, request.View);
        return new FilteredElementCollector(doc, view.Id)
            .OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
            .OrderBy(fr => fr.Id.Value())
            .Select(fr => ToRegionFacts(doc, fr))
            .ToList();
    }

    private static List<TakeoffRegionFacts> ZoneRegions(Document doc) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
            .Where(fr => TakeoffCarriers.ReadIdentity(fr).Role == TakeoffCarriers.RoleZoningRegion)
            .Select(fr => ToRegionFacts(doc, fr))
            .ToList();

    public static TakeoffAdoptResult AdoptZones(Document doc, TakeoffAdoptRequest request)
    {
        var view = FindView(doc, request.View);
        TakeoffCarriers.EnsureBindings(doc);
        var registry = TakeoffCarriers.ReadRegistry(doc);
        var adopted = new List<TakeoffAdopted>();

        foreach (var item in request.Items)
        {
            var fr = doc.GetElement(item.ElementId.ToElementId()) as FilledRegion
                     ?? throw new InvalidOperationException($"element {item.ElementId} is not a FilledRegion");
            if (fr.OwnerViewId != view.Id)
                throw new InvalidOperationException($"FilledRegion {item.ElementId} is not on '{request.View}'");
            var identity = TakeoffCarriers.ReadIdentity(fr);
            if (identity.Role != null && identity.Role != TakeoffCarriers.RoleZoningRegion)
                throw new InvalidOperationException(
                    $"element {item.ElementId} already carries role '{identity.Role}'");
            var guid = identity.Guid ?? Guid.NewGuid();
            TakeoffCarriers.WriteIdentity(fr, TakeoffCarriers.RoleZoningRegion, guid);
            TakeoffCarriers.WriteProvenance(fr,
                TakeoffJson.Serialize(new TakeoffZoneProvenance(1, request.View, item.Name.Trim(), item.SystemTag.Trim())));
            if (!string.IsNullOrWhiteSpace(item.SystemTag) && registry.FindByTag(item.SystemTag) == null)
                registry.Register(item.SystemTag);
            adopted.Add(new TakeoffAdopted(item.ElementId, guid));
        }

        TakeoffCarriers.WriteRegistry(doc, registry);
        return new TakeoffAdoptResult(adopted);
    }

    public static TakeoffCapturePrepared PrepareCapture(
        Document doc,
        TakeoffPrepareCaptureRequest request,
        Action<string>? log = null)
    {
        var view = FindView(doc, request.View);
        string level = view.GenLevel?.Name
                       ?? throw new InvalidOperationException($"view '{request.View}' has no level");
        RoomTakeoff.Prepare(doc, new TakeoffOptions { LevelNameContains = level }, log ?? (static _ => { }));
        return new TakeoffCapturePrepared(level);
    }

    public static TakeoffCaptureResult DetectCapture(
        Document doc,
        TakeoffDetectCaptureRequest request,
        Action<string>? log = null)
    {
        var result = RoomTakeoff.Detect(doc, request.Level, log ?? (static _ => { }));
        string token = string.Concat(result.LevelName.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));
        string replay = Path.Combine(RoomTakeoff.DefaultArtifactDir, $"replay_{token}.bin");
        if (!File.Exists(replay))
            throw new InvalidOperationException($"detect ran but no replay exists at {replay}");
        return new TakeoffCaptureResult(result.LevelName, replay, result.Rooms.Count, result.TotalSqft);
    }

    public static TakeoffPlanReferencePrepared PreparePlanReference(
        Document doc,
        TakeoffPlanReferenceArgs args,
        Action<string> log)
    {
        return Annotate.PreparePlanReference(doc, args.View, args.Token, args.Loops, log);
    }

    public static TakeoffPlanReferenceExported ExportPlanReference(
        Document doc,
        string sourceView,
        string token,
        string outDir,
        Action<string> log) =>
        Annotate.ExportPlanReference(doc, sourceView, token, outDir, log);

    public static TakeoffPartitionResult Partition(
        Document doc,
        TakeoffPartitionRequest request,
        Action<string>? log = null)
    {
        log ??= static _ => { };
        var zone = new ZoneScope { Name = request.ZoneName, Loops = request.Loops };
        var snapshot = DetectSnapshot.Load(Environment.ExpandEnvironmentVariables(request.ReplayPath));
        log($"[partition] replaying zone '{request.ZoneName}'");
        var result = snapshot.ReplayInferred(log, null, zone.CellMask(snapshot.Field));
        var profile = TakeoffPolicy.InferLevelProfile(snapshot);
        var promotion = TakeoffPromotion.PromoteZone(
            result, zone, profile.Options, snapshot.EvidenceInkDistance(profile), log,
            distanceToWallInk: snapshot.SeedInkDistance(),
            heuristicClosureAt: snapshot.HeuristicClosureAt(profile));
        result = promotion.Result;

        var view = FindView(doc, request.View);
        var level = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>()
            .FirstOrDefault(l => l.Name.Contains(request.LevelFragment, StringComparison.OrdinalIgnoreCase));
        double elevation = level?.Elevation ?? snapshot.LevelElevation;
        var materialized = ZoneMaterializer.Materialize(
            doc, view, elevation, request.ZoneGuid, request.RunId, result.Rooms, result.Residues, log);
        doc.Regenerate();

        return new TakeoffPartitionResult(
            result.LevelName,
            elevation,
            materialized.Created,
            materialized.Held,
            materialized.Rebound,
            materialized.Orphaned,
            new TakeoffPromotionFacts(
                promotion.Diagnostics.AcceptedRooms,
                promotion.Diagnostics.HeldRooms,
                promotion.Diagnostics.IsStrictlyEditable),
            result.DomainSqft,
            result.ClaimedWallSqft,
            result.ExcludedResidueSqft,
            result.TotalSqft,
            result.ProfileProvenance ?? "",
            materialized.Failures,
            result.Rooms.Select(r => new TakeoffDetectedRoom(
                r.Id, r.RawSqft, r.PerimeterFt, r.MeanCeilingFt,
                [r.LabelX, r.LabelY], r.Flags, r.Polygon)).ToList(),
            result.Residues.Select(r => new TakeoffDetectedResidue(
                r.Id, r.Reason.ToString(), r.RawSqft,
                [r.LabelX, r.LabelY], r.Polygon)).ToList(),
            ReadLiveRegions(doc, view, request.ZoneGuid));
    }

    public static TakeoffWriteResult WriteDecisions(Document doc, TakeoffDecisionsRequest request) =>
        MutateProvenance(doc, request.ElementId, p => p with { Resolutions = request.Resolutions });

    public static IReadOnlyList<TakeoffWriteResult> LinkRhvacBatch(
        Document doc,
        TakeoffRhvacLinksRequest request)
    {
        if (request.Writes.Count == 0) throw new InvalidOperationException("RHVAC link batch is empty");
        if (request.Writes.Select(w => w.ElementId).Distinct().Count() != request.Writes.Count)
            throw new InvalidOperationException("RHVAC link batch contains duplicate FilledRegion ids");
        return request.Writes.Select(write =>
            MutateProvenance(doc, write.ElementId, p => p with { Rhvac = write.Link })).ToList();
    }

    public static string WriteRoomType(Document doc, TakeoffRoomTypeRequest request)
    {
        TakeoffCarriers.EnsureBindings(doc);
        var fr = doc.GetElement(request.ElementId.ToElementId()) as FilledRegion
                 ?? throw new InvalidOperationException($"element {request.ElementId} is not a FilledRegion");
        if (TakeoffCarriers.ReadIdentity(fr).Role != TakeoffCarriers.RoleRoomRegion)
            throw new InvalidOperationException($"element {request.ElementId} is not a Room Region");
        TakeoffCarriers.WriteRoomType(fr, request.RoomType);
        string readBack = TakeoffCarriers.ReadRoomType(fr);
        return readBack == request.RoomType
            ? readBack
            : throw new InvalidOperationException(
                $"room type read back as '{readBack}', expected '{request.RoomType}'");
    }

    private static TakeoffWriteResult MutateProvenance(
        Document doc,
        long elementId,
        Func<RegionProvenance, RegionProvenance> mutate)
    {
        var fr = doc.GetElement(elementId.ToElementId()) as FilledRegion
                 ?? throw new InvalidOperationException($"element {elementId} is not a FilledRegion");
        string current = TakeoffCarriers.ReadProvenance(fr)
                         ?? throw new InvalidOperationException($"region {elementId} carries no provenance blob");
        var next = mutate(RegionProvenance.FromJson(current));
        string blob = next.ToJson();
        TakeoffCarriers.WriteProvenance(fr, blob);
        var check = RegionProvenance.FromJson(TakeoffCarriers.ReadProvenance(fr)!);
        return new TakeoffWriteResult(elementId, check.ZoneGuid, blob.Length, blob);
    }

    private static ViewPlan FindView(Document doc, string name) =>
        new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
            .FirstOrDefault(v => !v.IsTemplate && v.Name == name)
        ?? throw new InvalidOperationException($"no ViewPlan named '{name}'");

    private static TakeoffRegionFacts ToRegionFacts(Document doc, FilledRegion fr)
    {
        var (role, guid) = TakeoffCarriers.ReadIdentity(fr);
        var type = doc.GetElement(fr.GetTypeId()) as FilledRegionType;
        var owner = doc.GetElement(fr.OwnerViewId) as View;
        string color = "128,128,128";
        try
        {
            var c = type?.ForegroundPatternColor;
            if (c?.IsValid == true) color = $"{c.Red},{c.Green},{c.Blue}";
        }
        catch { }
        var loops = Boundaries(fr);
        return new TakeoffRegionFacts(
            fr.Id.Value(),
            type?.Name ?? "",
            owner?.Name ?? "",
            color,
            Area(fr, loops),
            role,
            guid,
            TakeoffCarriers.ReadProvenance(fr) ?? "",
            loops);
    }

    private static TakeoffLiveRegion ToLiveRegion(
        Document doc, FilledRegion fr, string role, Guid guid, string blob)
    {
        var loops = Boundaries(fr);
        var outer = loops.OrderByDescending(loop => Math.Abs(Detector.Shoelace(loop))).FirstOrDefault()
                    ?? throw new InvalidOperationException($"FilledRegion {fr.Id} has no boundary");
        return new TakeoffLiveRegion(fr.Id.Value(), role, guid, Area(fr, loops),
            role == TakeoffCarriers.RoleRoomRegion ? TakeoffCarriers.ReadRoomType(fr) : "", blob, outer);
    }

    private static List<TakeoffLiveRegion> ReadLiveRegions(Document doc, ViewPlan view, Guid zoneGuid)
    {
        var result = new List<TakeoffLiveRegion>();
        foreach (var fr in new FilteredElementCollector(doc, view.Id)
                     .OfClass(typeof(FilledRegion)).Cast<FilledRegion>())
        {
            var (role, guid) = TakeoffCarriers.ReadIdentity(fr);
            if (guid == null || role is not (TakeoffCarriers.RoleRoomRegion or TakeoffCarriers.RoleHeldResidue))
                continue;
            string blob = TakeoffCarriers.ReadProvenance(fr)
                          ?? throw new InvalidOperationException($"{role} {fr.Id} has no provenance blob");
            if (RegionProvenance.FromJson(blob).ZoneGuid != zoneGuid) continue;
            result.Add(ToLiveRegion(doc, fr, role, guid.Value, blob));
        }
        return result;
    }

    private static List<List<double[]>> Boundaries(FilledRegion fr) =>
        fr.GetBoundaries().Select(loop =>
        {
            var points = new List<double[]>();
            foreach (var curve in loop)
            {
                var tessellated = curve.Tessellate();
                for (int i = 0; i < tessellated.Count - 1; i++)
                    points.Add([tessellated[i].X, tessellated[i].Y]);
            }
            return points;
        }).Where(points => points.Count >= 3).ToList();

    private static double Area(FilledRegion fr, IReadOnlyList<List<double[]>> loops) =>
        fr.get_Parameter(BuiltInParameter.HOST_AREA_COMPUTED)?.AsDouble()
        ?? loops.Sum(loop => Math.Abs(Detector.Shoelace(loop)));
}
