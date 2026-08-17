using Autodesk.Revit.UI;
using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests.Diagnostics;

public sealed class RhvacTakeoffProbeTests
{
    [Test]
    [Explicit("FreshRevitProcess probe; requires PE_RHVAC_MODEL and PE_RHVAC_OUTPUT.")]
    public void Report_spatial_elements(UIApplication uiApplication)
    {
        var document = uiApplication.Application.OpenDocumentFile(Required("PE_RHVAC_MODEL"));
        var lines = new List<string>();
        try
        {
            Report(document, Transform.Identity, document.Title, lines);
            foreach (var link in new FilteredElementCollector(document)
                         .OfClass(typeof(RevitLinkInstance))
                         .Cast<RevitLinkInstance>())
                if (link.GetLinkDocument() is { } linkedDocument)
                    Report(linkedDocument, link.GetTotalTransform(), linkedDocument.Title, lines);
        }
        finally
        {
            document.Close(false);
        }
        var outputDirectory = Required("PE_RHVAC_OUTPUT");
        Directory.CreateDirectory(outputDirectory);
        File.WriteAllLines(Path.Combine(outputDirectory, "spatial-elements.tsv"), lines);
    }

    [Test]
    [Explicit("FreshRevitProcess probe; requires PE_RHVAC_MODEL, PE_RHVAC_OUTPUT, and PE_RHVAC_LEVELS.")]
    public void Regenerate_takeoff_snapshot(UIApplication uiApplication)
    {
        var modelPath = Required("PE_RHVAC_MODEL");
        var outputDirectory = Required("PE_RHVAC_OUTPUT");
        var levels = Required("PE_RHVAC_LEVELS")
            .Split(';')
            .Select(level => level.Trim())
            .Where(level => level.Length > 0)
            .ToArray();
        Directory.CreateDirectory(outputDirectory);
        var log = new List<string>();

        var document = uiApplication.Application.OpenDocumentFile(modelPath);
        try
        {
            foreach (var level in levels)
            {
                var options = new TakeoffOptions {
                    LevelNameContains = level,
                    ArtifactDir = outputDirectory,
                };
                using (var transaction = new Transaction(document, $"Prepare RHVAC takeoff {level}"))
                {
                    transaction.Start();
                    RoomTakeoff.Prepare(document, options, log.Add);
                    transaction.Commit();
                }

                var result = RoomTakeoff.Detect(
                    document,
                    level,
                    log.Add,
                    options
                );
                log.Add($"{result.LevelName}: {result.Rooms.Count} rooms, {result.TotalSqft:F0} sf");
            }
            File.WriteAllLines(Path.Combine(outputDirectory, "takeoff.log"), log);
        }
        finally
        {
            document.Close(false);
        }
    }

    private static void Report(
        Document document,
        Transform toHost,
        string source,
        ICollection<string> lines)
    {
        var elements = new FilteredElementCollector(document)
            .OfClass(typeof(SpatialElement))
            .Cast<SpatialElement>()
            .Where(element => element.Area > 0)
            .OrderBy(element => element.Level?.ProjectElevation)
            .ThenBy(element => element.Number)
            .ToList();
        lines.Add($"{source}: {elements.Count} placed spatial elements");
        foreach (var element in elements)
        {
            var point = element.Location is LocationPoint location
                ? toHost.OfPoint(location.Point)
                : XYZ.Zero;
            lines.Add(
                $"{source}\t{element.Category?.Name}\t{element.Level?.Name}\t{element.Number}\t" +
                $"{element.Name}\t{element.Area:F1}\t({point.X:F1},{point.Y:F1})"
            );
        }
    }

    private static string Required(string name) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"{name} is required.");
}
