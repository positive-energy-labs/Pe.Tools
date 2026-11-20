using Pe.Revit.Parameters;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Newtonsoft.Json.Linq;
using Pe.Shared.RevitData;

namespace Pe.Revit.Takeoff;

internal static class TakeoffJson
{
    private static readonly JsonSerializerSettings Settings = new()
    {
        ContractResolver = new DefaultContractResolver { NamingStrategy = new CamelCaseNamingStrategy() },
        FloatFormatHandling = FloatFormatHandling.DefaultValue,
        NullValueHandling = NullValueHandling.Include,
    };

    public static string Serialize(object value) =>
        JsonConvert.SerializeObject(value, Formatting.None, Settings);

    public static JObject Object(object value) => JObject.FromObject(value, JsonSerializer.Create(Settings));

}

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
    public static TakeoffSnapshotData Snapshot(Document doc, TakeoffReadRequest request)
    {
        var views = (request.Views ?? []).Select(id => PlanView(doc, id).Id).ToHashSet();
        var zoneIds = (request.ZoneUniqueIds ?? []).ToHashSet(StringComparer.Ordinal);
        var read = RoomsRegionRecord.Read(doc);
        var zones = new List<TakeoffRegionFacts>();
        var grouped = new Dictionary<string, List<TakeoffLiveRegion>>(StringComparer.Ordinal);
        var geometryKeys = new Dictionary<(ElementId View, string? Zone), string>();
        var unreadable = new List<TakeoffUnreadableBlob>();
        if (read.Refusal != null)
            unreadable.Add(new(null, RoomsRegionRecord.Owner.Name, read.Refusal));
        if (read.Value is { } record && (views.Count > 0 || zoneIds.Count > 0))
            foreach (var (id, row) in record.Regions)
            {
                if (doc.GetElement(id) is not FilledRegion fr) continue;
                bool selectedView = views.Contains(fr.OwnerViewId);
                if (row.Role == TakeoffCarriers.RoleZoningRegion)
                {
                    if (selectedView || zoneIds.Contains(id)) zones.Add(ToRegionFacts(doc, fr, row));
                    continue;
                }
                var zone = row.Provenance.Zone;
                if (!selectedView && (zone == null || !zoneIds.Contains(zone))) continue;
                var scope = (fr.OwnerViewId, zone);
                if (!geometryKeys.TryGetValue(scope, out var geometryKey))
                    geometryKeys[scope] = geometryKey = RegionMeasurements.ScopeKey(
                        doc, (View)doc.GetElement(fr.OwnerViewId), record, zone);
                var key = zone ?? "";
                if (!grouped.TryGetValue(key, out var regions))
                    grouped[key] = regions = [];
                regions.Add(ToLiveRegion(doc, fr, record, row, geometryKey));
            }

        var registry = TakeoffCarriers.TryReadRegistry(doc);
        if (registry.Refusal != null)
            unreadable.Add(new TakeoffUnreadableBlob(null, SystemRegistry.Owner.Name, registry.Refusal));
        var status = new TakeoffModelStatus(
            (registry.Value?.Systems ?? []).Select(s => new TakeoffRegistrySystem(s.Guid, s.Tag)).ToList(),
            TakeoffCarriers.Preflight(doc));
        return new TakeoffSnapshotData(status, zones, grouped, unreadable);
    }

    public static List<TakeoffRegionFacts> CandidateRegions(Document doc, TakeoffCandidatesRequest request)
    {
        var view = PlanView(doc, request.View);
        var read = RoomsRegionRecord.Read(doc);
        return new FilteredElementCollector(doc, view.Id)
            .OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
            .OrderBy(fr => fr.Id.Value())
            .Select(fr => ToRegionFacts(doc, fr, read.Value?[fr.UniqueId], read.Refusal))
            .ToList();
    }

    public static TakeoffAdoptResult AdoptZones(Document doc, TakeoffAdoptRequest request, OwnerBlobNotices? notices = null)
    {
        var record = RoomsRegionRecord.Stage(doc, request.Replacing);
        var unnamed = request.Items.FirstOrDefault(item => string.IsNullOrWhiteSpace(item.Name));
        if (unnamed != null)
            throw new InvalidOperationException($"FilledRegion {unnamed.ElementId} requires a zone name");
        var view = PlanView(doc, request.View);
        var registry = TakeoffCarriers.StageRegistry(doc, request.ReplacingRegistry);
        var adopted = new List<TakeoffAdopted>();

        foreach (var item in request.Items)
        {
            var fr = doc.GetElement(item.ElementId.ToElementId()) as FilledRegion
                     ?? throw new InvalidOperationException($"element {item.ElementId} is not a FilledRegion");
            RequireRegionIdentity(item.ElementId, item.UniqueId, fr.UniqueId);
            if (fr.OwnerViewId != view.Id)
                throw new InvalidOperationException($"FilledRegion {item.ElementId} is not on '{view.Name}'");
            var row = record[fr.UniqueId] ?? new RegionRow(TakeoffCarriers.RoleZoningRegion, new(), RegionProvenance.Default);
            if (row.Role != TakeoffCarriers.RoleZoningRegion)
                throw new InvalidOperationException($"element {item.ElementId} already carries role '{row.Role}'");
            var name = item.Name.Trim();
            var provenance = row.Provenance;
            var metadata = new Dictionary<string, JToken>(provenance.Unknown)
            {
                ["view"] = request.View, ["systemTag"] = item.SystemTag.Trim(),
            };
            record.Regions[fr.UniqueId] = row with { Fields = row.Fields with { Name = name },
                Provenance = provenance with { Flags = [.. provenance.Flags.Where(flag => flag != Rooms.FlagPerson), Rooms.FlagPerson], Unknown = metadata } };
            if (!string.IsNullOrWhiteSpace(item.SystemTag) && registry.FindByTag(item.SystemTag) == null)
                registry.Register(item.SystemTag);
            var loops = Boundaries(fr);
            adopted.Add(new TakeoffAdopted(item.ElementId, fr.UniqueId,
                view.CropBoxActive && loops.Count > 0 ? OwnerCrop(view.CropBox, loops) : null));
        }

        TakeoffCarriers.Save(doc, SystemRegistry.Owner, registry.ToData(), request.ReplacingRegistry, notices);
        record.Save(doc, replacing: request.Replacing, notices: notices);
        return new TakeoffAdoptResult(adopted);
    }

    // ADR 0011: the partition runs on Pe.Revit.Space. The solver never writes to the document; this
    // maps its answer onto the materializer exactly as the raster result was mapped — Accepted to
    // Room Regions, Held and Void to held regions, Excluded drawn as nothing — and the
    // rebind-by-geometry rule in ZoneMaterializer is untouched.
    public static TakeoffPartitionResult Partition(Document doc, TakeoffPartitionRequest request, OwnerBlobNotices? notices = null) {
        var zone = doc.GetElement(request.ZoneRegion.ToElementId()) as FilledRegion
            ?? throw new InvalidOperationException("Partition requires a native Zoning Region");
        var record = RoomsRegionRecord.Stage(doc, request.Replacing);
        if (zone.UniqueId != request.ZoneUniqueId || record[zone.UniqueId]?.Role != TakeoffCarriers.RoleZoningRegion
            || zone.OwnerViewId != PlanView(doc, request.View).Id)
            throw new InvalidOperationException(record.Recovery ?? "Partition target does not match the adopted zone identity and view");
        ValidateRunId(request.RunId);
        // The partition's own scope also holds every room label the measurement probes: rooms lie inside their zone.
        var partition = new Pe.Revit.Partition.PartitionRequest(request.ZoneRegion);
        var world = Pe.Revit.Partition.Verbs.PrepareSpace(doc, partition);
        return MaterializePartition(doc, request, Pe.Revit.Partition.Verbs.Partition(doc, partition, world), world, record, notices);
    }

    public static TakeoffPartitionResult MaterializePartition(
        Document doc,
        TakeoffPartitionRequest request,
        Pe.Revit.Partition.PartitionAnswer answer,
        Pe.Revit.Space.World? world = null, OwnerBlobNotices? notices = null) =>
        MaterializePartition(doc, request, answer, world, RoomsRegionRecord.Stage(doc, request.Replacing), notices);

    private static void ValidateRunId(string runId)
    {
        if (string.IsNullOrWhiteSpace(runId))
            throw new InvalidOperationException("Takeoffs partition requires a run id.");
    }

    private static TakeoffPartitionResult MaterializePartition(Document doc, TakeoffPartitionRequest request,
        Pe.Revit.Partition.PartitionAnswer answer, Pe.Revit.Space.World? world, RoomsRegionRecord record, OwnerBlobNotices? notices)
    {
        ValidateRunId(request.RunId);
        Action<string> log = static _ => { };
        var view = PlanView(doc, request.View);
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

        var materialized = record.BeforeMutation(() => ZoneMaterializer.Materialize(
            doc, view, record, elevation, request.ZoneUniqueId, request.RunId, rooms, residues, log));
        doc.Regenerate();
        RegionMeasurements.Measure(doc, view, record, request.ZoneUniqueId, request.RunId, world);
        record.Save(doc, replacing: request.Replacing, notices: notices);

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
            answer.EnclosureSource,
            answer.Hold,
            materialized.Failures,
            rooms.Select(r => new TakeoffDetectedRoom(
                r.Id, r.RawSqft, r.PerimeterFt, r.MeanCeilingFt,
                [r.LabelX, r.LabelY], r.Flags, r.Polygon)).ToList(),
            residues.Select(r => new TakeoffDetectedResidue(
                r.Id, r.Reason.ToString(), r.RawSqft,
                [r.LabelX, r.LabelY], r.Polygon)).ToList(),
            ReadLiveRegions(doc, view, record, request.ZoneUniqueId),
            new TakeoffPartitionReview(
                new TakeoffReviewSource(request.RunId, answer.Evidence.DocumentKey, request.ZoneUniqueId),
                new TakeoffReviewZone(request.ZoneUniqueId, request.ZoneName,
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

    public static IReadOnlyList<TakeoffWriteResult> LinkRhvacBatch(
        Document doc,
        TakeoffRhvacLinksRequest request,
        bool commit = true, OwnerBlobNotices? notices = null)
    {
        if (request.Writes.Count == 0) throw new InvalidOperationException("RHVAC link batch is empty");
        if (request.Writes.Select(w => w.ElementId).Distinct().Count() != request.Writes.Count)
            throw new InvalidOperationException("RHVAC link batch contains duplicate FilledRegion ids");
        var record = RoomsRegionRecord.Stage(doc, request.Replacing);
        var results = new List<TakeoffWriteResult>();
        foreach (var write in request.Writes)
        {
            var fr = doc.GetElement(write.ElementId.ToElementId()) as FilledRegion
                ?? throw new InvalidOperationException($"element {write.ElementId} is not a FilledRegion");
            RequireRegionIdentity(write.ElementId, write.UniqueId, fr.UniqueId);
            var row = record[fr.UniqueId] ?? throw new InvalidOperationException(record.Recovery ?? $"FilledRegion {write.ElementId} is not tracked");
            var next = row.Provenance with { Rhvac = write.Link };
            record.Regions[fr.UniqueId] = row with { Provenance = next };
            string blob = next.ToJson();
            results.Add(new(write.ElementId, fr.UniqueId, next.Zone, Encoding.UTF8.GetByteCount(blob), blob));
        }
        if (commit) record.Save(doc, replacing: request.Replacing, notices: notices);
        else record.BeforeMutation(() => true);
        return results;
    }

    internal static void RequireRegionIdentity(long elementId, string expectedUniqueId, string actualUniqueId)
    {
        if (expectedUniqueId != actualUniqueId)
            throw new InvalidOperationException($"FilledRegion {elementId} no longer matches UniqueId '{expectedUniqueId}'.");
    }

    /// <summary>
    ///     The one plan resolver: a plan is its view UniqueId within this Document. Name and view type are
    ///     display metadata, so two plans of one name never resolve by collector order.
    /// </summary>
    internal static ViewPlan PlanView(Document doc, string uniqueId) =>
        (string.IsNullOrWhiteSpace(uniqueId) ? null : doc.GetElement(uniqueId)) is ViewPlan { IsTemplate: false } view
            ? view
            : throw new RoomsViewMissingException();

    private static TakeoffRegionFacts ToRegionFacts(Document doc, FilledRegion fr, RegionRow? row, string? refusal = null)
    {
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
        var provenance = row == null ? null : TakeoffJson.Object(row.Provenance);
        if (provenance != null && row!.Fields.Name is { } name) provenance["name"] = name;
        return new TakeoffRegionFacts(
            fr.Id.Value(),
            type?.Name ?? "",
            owner?.Name ?? "",
            owner?.UniqueId ?? "",
            color,
            Area(fr, loops),
            row?.Role,
            fr.UniqueId,
            provenance?.ToString(Formatting.None) ?? "",
            loops,
            owner is { CropBoxActive: true } && loops.Count > 0 ? OwnerCrop(owner.CropBox, loops) : null,
            refusal);
    }

    private static RevitCropCoverage OwnerCrop(BoundingBoxXYZ crop, List<List<double[]>> loops)
    {
        var t = crop.Transform;
        return RevitViewImageRegistration.Coverage(loops.SelectMany(loop => loop), (crop.Min.X, crop.Min.Y), (crop.Max.X, crop.Max.Y),
            (t.Origin.X, t.Origin.Y), (t.BasisX.X, t.BasisX.Y), (t.BasisY.X, t.BasisY.Y));
    }

    private static TakeoffLiveRegion ToLiveRegion(
        Document doc, FilledRegion fr, RoomsRegionRecord record, RegionRow row, string geometryKey)
    {
        var loops = Boundaries(fr);
        var outer = loops.OrderByDescending(loop => Math.Abs(Kernel.Shoelace(loop))).FirstOrDefault()
                    ?? throw new InvalidOperationException($"FilledRegion {fr.Id} has no boundary");
        return new TakeoffLiveRegion(fr.Id.Value(), row.Role, fr.UniqueId, Area(fr, loops),
            row.Role == TakeoffCarriers.RoleRoomRegion ? row.Fields.Type ?? "" : "", record.ProjectOriginal(row.Provenance).ToJson(), outer,
            loops.Where(loop => !ReferenceEquals(loop, outer)).ToList(),
            RegionMeasurements.Read(row.Provenance, geometryKey + RegionMeasurements.GeometryKey(
                ((View)doc.GetElement(fr.OwnerViewId)).GenLevel.ProjectElevation, [loops])));
    }

    private static List<TakeoffLiveRegion> ReadLiveRegions(Document doc, ViewPlan view, RoomsRegionRecord record, string zone)
    {
        var result = new List<TakeoffLiveRegion>();
        var geometryKey = RegionMeasurements.ScopeKey(doc, view, record, zone);
        foreach (var fr in new FilteredElementCollector(doc, view.Id)
                     .OfClass(typeof(FilledRegion)).Cast<FilledRegion>())
        {
                if (record[fr.UniqueId] is not { } row || row.Role == TakeoffCarriers.RoleZoningRegion
                || row.Provenance.Zone != zone) continue;
            result.Add(ToLiveRegion(doc, fr, record, row, geometryKey));
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
