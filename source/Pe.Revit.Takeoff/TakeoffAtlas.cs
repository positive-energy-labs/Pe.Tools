using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace Pe.Revit.Takeoff;

/// <summary>
/// The script/host boundary for the Takeoffs product. Revit work and wire-shape construction
/// happen here; browser scripts only invoke one method and serialize its result.
/// </summary>
public static class TakeoffJson
{
    private static readonly JsonSerializerSettings Settings = new()
    {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
        FloatFormatHandling = FloatFormatHandling.DefaultValue,
        NullValueHandling = NullValueHandling.Include,
    };

    public static string Serialize(object value) =>
        JsonConvert.SerializeObject(value, Formatting.None, Settings);

    public static T Deserialize<T>(string json) =>
        JsonConvert.DeserializeObject<T>(json, Settings)
        ?? throw new InvalidOperationException($"{typeof(T).Name} JSON was empty");
}

public sealed record TakeoffViewFacts(string Name, string Level, int Regions);
public sealed record TakeoffRegistrySystem(Guid Guid, string Tag);
public sealed record TakeoffRegionCount(Guid ZoneGuid, int Rooms, int Held);
public sealed record TakeoffModelStatus(
    string Doc,
    IReadOnlyList<TakeoffRegistrySystem> Systems,
    IReadOnlyList<TakeoffRegionCount> Regions);
public sealed record TakeoffRegionFacts(
    long ElementId,
    string TypeName,
    string View,
    string Color,
    double Sqft,
    string? Role,
    Guid? Guid,
    string Blob,
    List<List<double[]>> Loops);
public sealed record TakeoffLiveRegion(
    long ElementId,
    string Role,
    Guid Guid,
    double Sqft,
    string RoomType,
    string Blob,
    List<double[]> Outer);
public sealed record TakeoffSnapshot(
    TakeoffModelStatus Status,
    IReadOnlyList<TakeoffViewFacts> Views,
    IReadOnlyList<TakeoffRegionFacts> ZoneFrs,
    IReadOnlyDictionary<string, List<TakeoffLiveRegion>> RegionsByZone);

public sealed record TakeoffAdoptItem(long ElementId, string Name, string SystemTag);
public sealed record TakeoffAdopted(long ElementId, Guid Guid);
public sealed record TakeoffAdoptResult(IReadOnlyList<TakeoffAdopted> Adopted);
public sealed record TakeoffZoneProvenance(int V, string View, string Name, string SystemTag);

public sealed record TakeoffRegistryRename(Guid Guid, string ToTag);
public sealed record TakeoffRegistryArgs(
    List<string> Observed,
    List<string> Register,
    List<TakeoffRegistryRename> Renames);
public sealed record TakeoffRenameCandidate(Guid FromGuid, string FromTag, string ToTag);
public sealed record TakeoffRegistryResult(
    IReadOnlyList<TakeoffRegistrySystem> Systems,
    IReadOnlyList<string> Appeared,
    IReadOnlyList<TakeoffRegistrySystem> Vanished,
    IReadOnlyList<TakeoffRenameCandidate> RenameCandidates,
    bool NeedsHuman);

public sealed record TakeoffCapturePrepared(string Level);
public sealed record TakeoffCaptureResult(
    string Level,
    string ReplayPath,
    int Rooms,
    double TotalSqft);
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

public sealed record TakeoffPartitionArgs(
    string ReplayPath,
    string View,
    string LevelFragment,
    string ZoneName,
    Guid ZoneGuid,
    string RunId,
    List<List<double[]>> Loops);
public sealed record TakeoffDetectedRoom(
    string Id,
    double RawSqft,
    double PerimeterFt,
    double MeanCeilingFt,
    double[] Label,
    IReadOnlyList<string> Flags,
    List<double[]> Outer);
public sealed record TakeoffDetectedResidue(
    string Id,
    string Reason,
    double RawSqft,
    double[] Label,
    List<double[]> Outer);
public sealed record TakeoffPromotionFacts(int Accepted, int Held, bool Strict);
public sealed record TakeoffPartitionResult(
    string LevelName,
    double Elevation,
    int Created,
    int Held,
    int Rebound,
    int Orphaned,
    TakeoffPromotionFacts Promotion,
    double DomainSqft,
    double ClaimedWallSqft,
    double ExcludedResidueSqft,
    double TotalSqft,
    string Profile,
    IReadOnlyList<string> Failures,
    IReadOnlyList<TakeoffDetectedRoom> Rooms,
    IReadOnlyList<TakeoffDetectedResidue> Residues,
    IReadOnlyList<TakeoffLiveRegion> Regions);

public sealed record TakeoffWriteResult(long ElementId, Guid ZoneGuid, int Bytes, string Blob);
public sealed record TakeoffRhvacLinkWrite(long ElementId, RegionRhvacLink Link);

public static class TakeoffAtlas
{
    public static TakeoffSnapshot Snapshot(Document doc)
    {
        var views = Views(doc);
        var zones = ZoneRegions(doc);
        var grouped = new Dictionary<string, List<TakeoffLiveRegion>>(StringComparer.OrdinalIgnoreCase);
        var counts = new Dictionary<Guid, int[]>();

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
            if (!counts.TryGetValue(provenance.ZoneGuid, out var pair))
                counts[provenance.ZoneGuid] = pair = [0, 0];
            pair[role == TakeoffCarriers.RoleRoomRegion ? 0 : 1]++;
        }

        var registry = TakeoffCarriers.ReadRegistry(doc);
        var status = new TakeoffModelStatus(
            doc.Title,
            registry.Systems.Select(s => new TakeoffRegistrySystem(s.Guid, s.Tag)).ToList(),
            counts.Select(kv => new TakeoffRegionCount(kv.Key, kv.Value[0], kv.Value[1])).ToList());
        return new TakeoffSnapshot(status, views, zones, grouped);
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
                v.Name,
                v.GenLevel?.Name ?? "",
                counts.GetValueOrDefault(v.Id.Value())))
            .OrderByDescending(v => v.Regions)
            .ThenBy(v => v.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static List<TakeoffRegionFacts> CandidateRegions(Document doc, string viewName)
    {
        var view = FindView(doc, viewName);
        return new FilteredElementCollector(doc, view.Id)
            .OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
            .OrderBy(fr => fr.Id.Value())
            .Select(fr => ToRegionFacts(doc, fr))
            .ToList();
    }

    public static List<TakeoffRegionFacts> ZoneRegions(Document doc) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
            .Where(fr => TakeoffCarriers.ReadIdentity(fr).Role == TakeoffCarriers.RoleZoningRegion)
            .Select(fr => ToRegionFacts(doc, fr))
            .ToList();

    public static List<TakeoffLiveRegion> RoomRegions(Document doc, string viewName, Guid zoneGuid)
    {
        var view = FindView(doc, viewName);
        return [.. ReadLiveRegions(doc, view, zoneGuid)];
    }

    public static TakeoffAdoptResult AdoptZones(Document doc, string viewName, string itemsJson)
    {
        var view = FindView(doc, viewName);
        var items = TakeoffJson.Deserialize<List<TakeoffAdoptItem>>(itemsJson);
        TakeoffCarriers.EnsureBindings(doc);
        var registry = TakeoffCarriers.ReadRegistry(doc);
        var adopted = new List<TakeoffAdopted>();

        foreach (var item in items)
        {
            var fr = doc.GetElement(item.ElementId.ToElementId()) as FilledRegion
                     ?? throw new InvalidOperationException($"element {item.ElementId} is not a FilledRegion");
            if (fr.OwnerViewId != view.Id)
                throw new InvalidOperationException($"FilledRegion {item.ElementId} is not on '{viewName}'");
            var identity = TakeoffCarriers.ReadIdentity(fr);
            if (identity.Role != null && identity.Role != TakeoffCarriers.RoleZoningRegion)
                throw new InvalidOperationException(
                    $"element {item.ElementId} already carries role '{identity.Role}'");
            var guid = identity.Guid ?? Guid.NewGuid();
            TakeoffCarriers.WriteIdentity(fr, TakeoffCarriers.RoleZoningRegion, guid);
            TakeoffCarriers.WriteProvenance(fr,
                TakeoffJson.Serialize(new TakeoffZoneProvenance(1, viewName, item.Name.Trim(), item.SystemTag.Trim())));
            if (!string.IsNullOrWhiteSpace(item.SystemTag) && registry.FindByTag(item.SystemTag) == null)
                registry.Register(item.SystemTag);
            adopted.Add(new TakeoffAdopted(item.ElementId, guid));
        }

        TakeoffCarriers.WriteRegistry(doc, registry);
        return new TakeoffAdoptResult(adopted);
    }

    public static TakeoffRegistryResult ApplyRegistry(Document doc, string argsJson)
    {
        var args = TakeoffJson.Deserialize<TakeoffRegistryArgs>(argsJson);
        TakeoffCarriers.EnsureBindings(doc);
        var registry = TakeoffCarriers.ReadRegistry(doc);
        foreach (var rename in args.Renames) registry.Rename(rename.Guid, rename.ToTag);
        foreach (string tag in args.Register)
            if (registry.FindByTag(tag) == null) registry.Register(tag);
        TakeoffCarriers.WriteRegistry(doc, registry);
        var reconciliation = registry.Reconcile(args.Observed);
        return new TakeoffRegistryResult(
            registry.Systems.Select(s => new TakeoffRegistrySystem(s.Guid, s.Tag)).ToList(),
            reconciliation.Appeared,
            reconciliation.Vanished.Select(s => new TakeoffRegistrySystem(s.Guid, s.Tag)).ToList(),
            reconciliation.RenameCandidates.Select(c =>
                new TakeoffRenameCandidate(c.From.Guid, c.From.Tag, c.To)).ToList(),
            reconciliation.NeedsHuman);
    }

    public static TakeoffCapturePrepared PrepareCapture(
        Document doc,
        string viewName,
        Action<string> log)
    {
        var view = FindView(doc, viewName);
        string level = view.GenLevel?.Name
                       ?? throw new InvalidOperationException($"view '{viewName}' has no level");
        RoomTakeoff.Prepare(doc, new TakeoffOptions { LevelNameContains = level }, log);
        return new TakeoffCapturePrepared(level);
    }

    public static TakeoffCaptureResult DetectCapture(Document doc, string level, Action<string> log)
    {
        var result = RoomTakeoff.Detect(doc, level, log);
        string token = string.Concat(result.LevelName.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));
        string replay = Path.Combine(RoomTakeoff.DefaultArtifactDir, $"replay_{token}.bin");
        if (!File.Exists(replay))
            throw new InvalidOperationException($"detect ran but no replay exists at {replay}");
        return new TakeoffCaptureResult(result.LevelName, replay, result.Rooms.Count, result.TotalSqft);
    }

    public static TakeoffPlanReferencePrepared PreparePlanReference(
        Document doc,
        string argsJson,
        Action<string> log)
    {
        var args = TakeoffJson.Deserialize<TakeoffPlanReferenceArgs>(argsJson);
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
        string argsJson,
        Action<string> log)
    {
        var args = TakeoffJson.Deserialize<TakeoffPartitionArgs>(argsJson);
        var zone = new ZoneScope { Name = args.ZoneName, Loops = args.Loops };
        var snapshot = DetectSnapshot.Load(Environment.ExpandEnvironmentVariables(args.ReplayPath));
        log($"[partition] replaying zone '{args.ZoneName}'");
        var result = snapshot.ReplayInferred(log, null, zone.CellMask(snapshot.Field));
        var profile = TakeoffPolicy.InferLevelProfile(snapshot);
        var promotion = TakeoffPromotion.PromoteZone(
            result, zone, profile.Options, snapshot.EvidenceInkDistance(profile), log,
            distanceToWallInk: snapshot.SeedInkDistance(),
            heuristicClosureAt: snapshot.HeuristicClosureAt(profile));
        result = promotion.Result;

        var view = FindView(doc, args.View);
        var level = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>()
            .FirstOrDefault(l => l.Name.Contains(args.LevelFragment, StringComparison.OrdinalIgnoreCase));
        double elevation = level?.Elevation ?? snapshot.LevelElevation;
        var materialized = ZoneMaterializer.Materialize(
            doc, view, elevation, args.ZoneGuid, args.RunId, result.Rooms, result.Residues, log);
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
            ReadLiveRegions(doc, view, args.ZoneGuid));
    }

    public static TakeoffWriteResult WriteDecisions(Document doc, long elementId, string resolutionsJson)
    {
        var resolutions = TakeoffJson.Deserialize<List<RegionResolution>>(resolutionsJson);
        return MutateProvenance(doc, elementId, p => p with { Resolutions = resolutions });
    }

    public static IReadOnlyList<TakeoffWriteResult> LinkRhvacBatch(Document doc, string writesJson)
    {
        var writes = TakeoffJson.Deserialize<List<TakeoffRhvacLinkWrite>>(writesJson);
        if (writes.Count == 0) throw new InvalidOperationException("RHVAC link batch is empty");
        if (writes.Select(w => w.ElementId).Distinct().Count() != writes.Count)
            throw new InvalidOperationException("RHVAC link batch contains duplicate FilledRegion ids");
        return writes.Select(write =>
            MutateProvenance(doc, write.ElementId, p => p with { Rhvac = write.Link })).ToList();
    }

    public static string WriteRoomType(Document doc, long elementId, string roomType)
    {
        TakeoffCarriers.EnsureBindings(doc);
        var fr = doc.GetElement(elementId.ToElementId()) as FilledRegion
                 ?? throw new InvalidOperationException($"element {elementId} is not a FilledRegion");
        if (TakeoffCarriers.ReadIdentity(fr).Role != TakeoffCarriers.RoleRoomRegion)
            throw new InvalidOperationException($"element {elementId} is not a Room Region");
        TakeoffCarriers.WriteRoomType(fr, roomType);
        string readBack = TakeoffCarriers.ReadRoomType(fr);
        return readBack == roomType
            ? readBack
            : throw new InvalidOperationException($"room type read back as '{readBack}', expected '{roomType}'");
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
