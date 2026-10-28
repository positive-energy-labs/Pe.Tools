using System.Diagnostics;

namespace Pe.Revit.Space;

/// <summary>One placed source, used as the building grouping without inferring buildings from level names.
/// A host or site file can contain several buildings; the member names remain authoritative.</summary>
public sealed record SceneLevelSource(int Source, string? DocumentKey, long? LinkInstanceId, string Name,
    string Status, int? CountedLevels, IReadOnlyList<long> UnavailableLevelIds, string? Reason);
public sealed record SceneLevelMember(int Source, long ElementId, string UniqueId, string Name,
    double ProjectElevationFt, bool BuildingStory);
/// <summary>A measured plane in host internal feet. Coincident planes retain every member and source.</summary>
public sealed record SceneLevelPlane(IReadOnlyList<double> Point, IReadOnlyList<double> Normal,
    IReadOnlyList<SceneLevelMember> Members);
public sealed record SceneLevelWork(double NativeMilliseconds, long StartPrivateBytes, long EndPrivateBytes);
public sealed record SceneLevels(IReadOnlyList<SceneLevelSource> Sources, IReadOnlyList<SceneLevelPlane> Planes,
    SceneLevelWork Work);
public sealed record SceneLevelReceipt(int Levels, int Planes, int CoincidentGroups, int UnavailableSources,
    SceneLevelWork Work) {
    internal static SceneLevelReceipt From(SceneLevels levels) => new(
        levels.Planes.Sum(p => p.Members.Count), levels.Planes.Count,
        levels.Planes.Count(p => p.Members.Count > 1), levels.Sources.Count(s => s.Status != "loaded"), levels.Work);
}

/// <summary>Annotation datums are read by class, independently of model-category geometry and scene bounds.</summary>
public static class Levels {
    // Below Revit's geometric tolerance; names at the same height must not be lost or shift a plane.
    private const double CoincidentFt = 1e-6;
    private sealed record Datum(long Id, string UniqueId, string Name, double ProjectElevationFt, bool BuildingStory);

    public static SceneLevels Read(Document host, System.Threading.CancellationToken cancellationToken = default) {
        using var process = Process.GetCurrentProcess();
        var startBytes = process.PrivateMemorySize64;
        var clock = Stopwatch.StartNew();
        var sources = new List<SceneLevelSource>();
        var planes = new List<(XYZ Point, XYZ Normal, List<SceneLevelMember> Members)>();
        var documents = new Dictionary<Document, (int Count, List<Datum> Levels, List<long> Missing)>();

        void Read(Document? document, long? instanceId, string name, Transform transform, string status, string? reason) {
            cancellationToken.ThrowIfCancellationRequested();
            var source = sources.Count;
            if (document is null) {
                sources.Add(new SceneLevelSource(source, null, instanceId, name, status, null, [], reason));
                return;
            }
            if (!documents.TryGetValue(document, out var data)) {
                using var collector = new FilteredElementCollector(document);
                var ids = collector.OfClass(typeof(Level)).ToElementIds();
                data = (ids.Count, [], []);
                foreach (var id in ids) {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (document.GetElement(id) is not Level level) { data.Missing.Add(id.Value()); continue; }
                    // FOOTGUN: Level.Elevation uses the selected base point. Cleremont differs by 737 ft;
                    // one linked file even mixes bases. ProjectElevation alone shares the geometry frame.
                    data.Levels.Add(new Datum(level.Id.Value(), level.UniqueId, level.Name, level.ProjectElevation,
                        level.get_Parameter(BuiltInParameter.LEVEL_IS_BUILDING_STORY)?.AsInteger() == 1));
                }
                documents.Add(document, data);
            }
            sources.Add(new SceneLevelSource(source, document.GetDocumentKey(), instanceId, name, "loaded",
                data.Count, data.Missing, data.Missing.Count == 0 ? null : "Counted level ids could not be read."));
            var normal = transform.OfVector(XYZ.BasisZ).Normalize();
            foreach (var level in data.Levels) {
                var point = transform.OfPoint(new XYZ(0, 0, level.ProjectElevationFt));
                var member = new SceneLevelMember(source, level.Id, level.UniqueId, level.Name,
                    level.ProjectElevationFt, level.BuildingStory);
                var coincident = planes.FindIndex(p => Math.Abs(Math.Abs(p.Normal.DotProduct(normal)) - 1) < 1e-10
                    && Math.Abs(p.Normal.DotProduct(point - p.Point)) <= CoincidentFt);
                if (coincident >= 0) planes[coincident].Members.Add(member);
                else planes.Add((point, normal, [member]));
            }
        }

        Read(host, null, host.Title, Transform.Identity, "loaded", null);
        using var links = new FilteredElementCollector(host);
        var linkIds = links.OfClass(typeof(RevitLinkInstance)).ToElementIds();
        foreach (var id in linkIds.OrderBy(id => id.Value())) {
            cancellationToken.ThrowIfCancellationRequested();
            if (host.GetElement(id) is not RevitLinkInstance instance) {
                sources.Add(new SceneLevelSource(sources.Count, null, id.Value(), "Link instance", "unavailable",
                    null, [], "Counted link instance could not be read."));
                continue;
            }
            var linked = instance.GetLinkDocument();
            var status = "loaded";
            string? reason = null;
            if (linked is null) {
                status = "unavailable";
                reason = "Link document is unavailable.";
                if (host.GetElement(instance.GetTypeId()) is RevitLinkType type
                    && ExternalFileUtils.IsExternalFileReference(host, type.Id)) {
                    var reference = type.GetExternalFileReference();
                    var fileStatus = reference?.GetLinkedFileStatus();
                    status = fileStatus == LinkedFileStatus.Unloaded ? "unloaded" : "unavailable";
                    reason = fileStatus is null ? reason : $"Link document is {fileStatus}.";
                }
            }
            Read(linked, instance.Id.Value(), instance.Name, instance.GetTotalTransform(), status, reason);
        }
        clock.Stop();
        process.Refresh();
        return new SceneLevels(sources, planes.OrderBy(p => p.Point.Z).Select(p => new SceneLevelPlane(
            new[] { p.Point.X, p.Point.Y, p.Point.Z }, new[] { p.Normal.X, p.Normal.Y, p.Normal.Z }, p.Members)).ToList(),
            new SceneLevelWork(clock.Elapsed.TotalMilliseconds, startBytes, process.PrivateMemorySize64));
    }
}
