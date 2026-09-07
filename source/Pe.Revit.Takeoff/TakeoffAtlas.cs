using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace Pe.Revit.Takeoff;

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
            registry.Systems.Select(s => new TakeoffRegistrySystem(s.Guid, s.Tag)).ToList(),
            TakeoffCarriers.Preflight(doc));
        return new TakeoffSnapshotData(status, zones, grouped);
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
        TakeoffCarriers.Require(doc, TakeoffCarrierStage.Adoption);
        var unnamed = request.Items.FirstOrDefault(item => string.IsNullOrWhiteSpace(item.Name));
        if (unnamed != null)
            throw new InvalidOperationException($"FilledRegion {unnamed.ElementId} requires a zone name");
        var view = FindView(doc, request.View);
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

    // ADR 0011: the partition runs on Pe.Revit.Space. The solver never writes to the document; this
    // maps its answer onto the materializer exactly as the raster result was mapped — Accepted to
    // Room Regions, Held and Void to held regions, Excluded drawn as nothing — and the
    // rebind-by-geometry rule in ZoneMaterializer is untouched.
    public static TakeoffPartitionResult Partition(Document doc, TakeoffPartitionRequest request) =>
        MaterializePartition(doc, request, Pe.Revit.Partition.Verbs.Partition(
            doc, new Pe.Revit.Partition.PartitionRequest(request.ZoneRegion)));

    public static TakeoffPartitionResult MaterializePartition(
        Document doc,
        TakeoffPartitionRequest request,
        Pe.Revit.Partition.PartitionAnswer answer)
    {
        TakeoffCarriers.Require(doc, TakeoffCarrierStage.Materialization);
        Action<string> log = static _ => { };
        var view = FindView(doc, request.View);
        var level = view.GenLevel;
        double elevation = level?.ProjectElevation ?? 0.0;

        var rooms = new List<RoomResult>();
        var residues = new List<ResidueResult>();
        foreach (var r in answer.Rooms)
        {
            var poly = Outer(r.Loop);
            if (r.Disposition == Pe.Revit.Partition.Disposition.Excluded) continue;   // wall: drawn as nothing
            if (r.Disposition == Pe.Revit.Partition.Disposition.Accepted)
            {
                rooms.Add(new RoomResult {
                    Partition = r,
                    Id = $"R{r.Index + 1:D2}", RawSqft = r.AreaSqft, PerimeterFt = Perimeter(poly),
                    LabelX = r.LabelX, LabelY = r.LabelY,
                    MeanCeilingFt = r.CeilingZ is { } cz && r.FloorZ is { } fz ? cz - fz : 0.0,
                    Polygon = poly,
                    Holes = (r.Holes ?? []).Select(Outer).ToList(),
                });
                continue;
            }

            residues.Add(new ResidueResult {
                Partition = r,
                Id = $"R{r.Index + 1:D2}",
                Reason = r.Disposition == Pe.Revit.Partition.Disposition.Void ? ResidueReason.Void : ResidueReason.Held,
                RawSqft = r.AreaSqft, LabelX = r.LabelX, LabelY = r.LabelY,
                MeanCeilingFt = r.CeilingZ is { } cz2 && r.FloorZ is { } fz2 ? cz2 - fz2 : 0.0,
                Polygon = poly,
                Holes = (r.Holes ?? []).Select(Outer).ToList(),
            });
        }

        var materialized = ZoneMaterializer.Materialize(
            doc, view, elevation, request.ZoneGuid, request.RunId, rooms, residues, log);
        doc.Regenerate();

        var acc = answer.Accounting;
        return new TakeoffPartitionResult(
            level?.Name ?? "",
            elevation,
            materialized.Created,
            materialized.Held,
            materialized.Rebound,
            materialized.Orphaned,
            new TakeoffPromotionFacts(rooms.Count, residues.Count, answer.Hold == null),
            acc.ZoneSqft,
            acc.Excluded,
            acc.Void,
            acc.Accepted + acc.Held + acc.Void + acc.Excluded,
            answer.EnclosureSource + (answer.Hold is null ? "" : " | hold: " + answer.Hold),
            materialized.Failures,
            rooms.Select(r => new TakeoffDetectedRoom(
                r.Id, r.RawSqft, r.PerimeterFt, r.MeanCeilingFt,
                [r.LabelX, r.LabelY], r.Flags, r.Polygon)).ToList(),
            residues.Select(r => new TakeoffDetectedResidue(
                r.Id, r.Reason.ToString(), r.RawSqft,
                [r.LabelX, r.LabelY], r.Polygon)).ToList(),
            ReadLiveRegions(doc, view, request.ZoneGuid),
            new TakeoffPartitionReview(
                new TakeoffReviewSource(request.RunId, answer.Stamp.HostDocumentKey, request.ZoneGuid.ToString("D")),
                new TakeoffReviewZone(request.ZoneGuid.ToString("D"), request.ZoneName,
                    Boundaries((FilledRegion)doc.GetElement(request.ZoneRegion.ToElementId()))),
                answer.Rooms.Select(r => new TakeoffReviewShape(
                    $"R{r.Index + 1:D2}",
                    r.Disposition is Pe.Revit.Partition.Disposition.Accepted or Pe.Revit.Partition.Disposition.Held ? "room" : "residue",
                    r.Disposition.ToString().ToLowerInvariant(), r.Reason, r.AreaSqft,
                    [r.LabelX, r.LabelY],
                    new[] { r.Loop }.Concat(r.Holes ?? []).Select(loop => (IReadOnlyList<double[]>)Outer(loop)).ToList()))
                    .ToList()));
    }

    private static List<double[]> Outer(double[] loop)
    {
        var pts = new List<double[]>(loop.Length / 2);
        for (int i = 0; i < loop.Length; i += 2) pts.Add([loop[i], loop[i + 1]]);
        return pts;
    }

    private static double Perimeter(List<double[]> pts)
    {
        double p = 0;
        for (int i = 0; i < pts.Count; i++)
        {
            var a = pts[i]; var b = pts[(i + 1) % pts.Count];
            p += Math.Sqrt(((a[0] - b[0]) * (a[0] - b[0])) + ((a[1] - b[1]) * (a[1] - b[1])));
        }
        return p;
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
        TakeoffCarriers.Require(doc, TakeoffCarrierStage.Materialization);
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
        var outer = loops.OrderByDescending(loop => Math.Abs(Kernel.Shoelace(loop))).FirstOrDefault()
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

    internal static List<List<double[]>> Boundaries(FilledRegion fr) =>
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
        ?? loops.Sum(loop => Math.Abs(Kernel.Shoelace(loop)));
}
