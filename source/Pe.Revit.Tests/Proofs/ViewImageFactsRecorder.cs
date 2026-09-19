using System.IO;
using System.Security.Cryptography;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.DocumentData.AgentContext;
using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests;

/// <summary>
///     Records the plan-image facts of the views of an ALREADY OPEN project (projectA, D4) once, so the export/registration rule is
///     solved offline. Raw numbers in internal feet, no interpretation. Reads and ExportImage only: nothing is written to the
///     model, no transaction, the views stay as the user left them. Ignored when no open document has a named view.
///     Output: `%TEMP%\pe-view-image-facts\&lt;doc&gt;-&lt;yyyyMMdd&gt;\facts.json` plus the PNGs beside it (the path is printed as
///     `[PE_VIEW_IMAGE_FACTS]`); the holder copies them to `Fixtures/ViewImageFacts/`.
///     Views: `PE_VIEW_IMAGE_FACTS_VIEWS` (';'-separated). Extra region ids: `PE_VIEW_IMAGE_FACTS_REGIONS`.
/// </summary>
[TestFixture]
public sealed class ViewImageFactsRecorder {
    private const int ProductPixelSize = 1500; // RevitViewImageRequest.PixelSize default
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [Test]
    public void Record_view_image_facts_from_the_open_document() {
        var names = List("PE_VIEW_IMAGE_FACTS_VIEWS",
            "Mechanical Zoning Plan - Pool House;Mechanical Zoning Plan - Lower Level;Mechanical Zoning Plan - Gatehouse;Mechanical Zoning Plan - Main Lvl Guest House Controls");
        // E/F (Guest House), A/B (Lower Level), C/D (Pool House): the D4 leg B adoption ids.
        var regionIds = List("PE_VIEW_IMAGE_FACTS_REGIONS", "10047387;10047400;5852816;5852871;5989874;5989932").Select(long.Parse).ToHashSet();
        var recorded = 0;
        foreach (var doc in this._ui.Application.Documents.Cast<Document>().Where(d => !d.IsFamilyDocument && !d.IsLinked).ToList()) {
            var views = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Where(v => !v.IsTemplate && names.Contains(v.Name)).ToList();
            if (views.Count == 0) continue;
            var dir = Path.Combine(Path.GetTempPath(), "pe-view-image-facts", $"{Safe(doc.Title)}-{DateTime.UtcNow:yyyyMMdd}");
            Directory.CreateDirectory(dir);
            var facts = new JObject {
                ["recordedUtc"] = DateTime.UtcNow.ToString("O"),
                ["document"] = Document(doc, this._ui.Application),
                ["views"] = new JArray(views.Select(v => View(doc, v, dir))),
                ["regions"] = Regions(doc, regionIds)
            };
            var path = Path.Combine(dir, "facts.json");
            File.WriteAllText(path, facts.ToString(Formatting.Indented));
            Console.WriteLine($"[PE_VIEW_IMAGE_FACTS] {path}");
            recorded++;
        }
        if (recorded == 0) Assert.Ignore($"no open document has a view named {string.Join(" | ", names)}");
    }

    private static JObject Document(Document doc, Application app) {
        var basePoint = BasePoint.GetProjectBasePoint(doc);
        var survey = BasePoint.GetSurveyPoint(doc);
        var position = doc.ActiveProjectLocation.GetProjectPosition(XYZ.Zero);
        return new JObject {
            ["title"] = doc.Title,
            ["pathName"] = doc.PathName,
            ["revit"] = $"{app.VersionName} {app.VersionNumber} build {app.VersionBuild} {app.SubVersionNumber}",
            ["projectBasePoint"] = new JObject { ["position"] = P(basePoint.Position), ["sharedPosition"] = P(basePoint.SharedPosition) },
            ["surveyPoint"] = new JObject { ["position"] = P(survey.Position), ["sharedPosition"] = P(survey.SharedPosition) },
            ["projectPositionAtInternalOrigin"] = new JObject {
                ["eastWest"] = position.EastWest, ["northSouth"] = position.NorthSouth, ["elevation"] = position.Elevation, ["angle"] = position.Angle
            }
        };
    }

    private static JObject View(Document doc, View view, string dir) {
        var crop = view.CropBox;
        var template = doc.GetElement(view.ViewTemplateId) as View;
        var scopeBox = view.get_Parameter(BuiltInParameter.VIEWER_VOLUME_OF_INTEREST_CROP)?.AsElementId() is { } scopeId ? doc.GetElement(scopeId) : null;
        var shape = view.GetCropRegionShapeManager();
        var outline = view.Outline;
        return new JObject {
            ["id"] = view.Id.Value(),
            ["name"] = view.Name,
            ["type"] = view.ViewType.ToString(),
            ["scale"] = view.Scale,
            ["dependentOf"] = view.GetPrimaryViewId().Value(),
            ["template"] = template is null ? null : new JObject {
                ["id"] = template.Id.Value(),
                ["name"] = template.Name,
                ["controls"] = new JArray(template.GetTemplateParameterIds().Except(template.GetNonControlledTemplateParameterIds())
                    .Select(id => ParameterName(doc, id)))
            },
            ["scopeBox"] = scopeBox is null ? null : new JObject {
                ["id"] = scopeBox.Id.Value(), ["name"] = scopeBox.Name, ["bbox"] = Box(scopeBox.get_BoundingBox(null))
            },
            ["cropBox"] = new JObject {
                ["min"] = P(crop.Min), ["max"] = P(crop.Max),
                ["transform"] = new JObject {
                    ["origin"] = P(crop.Transform.Origin), ["basisX"] = P(crop.Transform.BasisX),
                    ["basisY"] = P(crop.Transform.BasisY), ["basisZ"] = P(crop.Transform.BasisZ)
                },
                ["active"] = view.CropBoxActive,
                ["visible"] = view.CropBoxVisible
            },
            ["cropShape"] = new JObject {
                ["shapeSet"] = Try(() => shape.ShapeSet),
                ["loops"] = Try(() => new JArray(shape.GetCropShape().Select(Loop)))
            },
            ["annotationCrop"] = new JObject {
                ["active"] = view.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE)?.AsInteger(),
                ["offsets"] = Try(() => new JObject {
                    ["left"] = shape.LeftAnnotationCropOffset, ["right"] = shape.RightAnnotationCropOffset,
                    ["bottom"] = shape.BottomAnnotationCropOffset, ["top"] = shape.TopAnnotationCropOffset
                }),
                ["shape"] = Try(() => Loop(shape.GetAnnotationCropShape()))
            },
            ["outline"] = new JObject { ["min"] = new JArray(outline.Min.U, outline.Min.V), ["max"] = new JArray(outline.Max.U, outline.Max.V) },
            ["exports"] = new JArray(Exports(doc, view, dir)),
            ["beyondCrop"] = BeyondCrop(doc, view)
        };
    }

    /// <summary>Each export with its options, the view untouched. Zoom 100% is recorded as an error if Revit refuses it.</summary>
    private static IEnumerable<JObject> Exports(Document doc, View view, string dir) {
        var productName = $"{view.Id.Value()}-product";
        yield return Export("product", new JObject {
            ["via"] = "RevitViewImageExporter.ExportPng", ["zoomType"] = "FitToPage", ["pixelSize"] = ProductPixelSize,
            ["imageResolution"] = "DPI_150", ["fitDirection"] = "Horizontal", ["exportRange"] = "SetOfViews", ["fileType"] = "PNG"
        }, () => RevitViewImageExporter.ExportPng(doc, view.Id, dir, productName, ProductPixelSize));
        yield return Export("fitToPage1500", new JObject {
            ["zoomType"] = "FitToPage", ["pixelSize"] = 1500, ["fitDirection"] = "Horizontal", ["imageResolution"] = "(default)",
            ["exportRange"] = "SetOfViews", ["fileType"] = "PNG"
        }, () => Raw(doc, view, dir, $"{view.Id.Value()}-fit1500", o => {
            o.ZoomType = ZoomFitType.FitToPage;
            o.PixelSize = 1500;
            o.FitDirection = FitDirectionType.Horizontal;
        }));
        yield return Export("zoom100", new JObject {
            ["zoomType"] = "Zoom", ["zoom"] = 100, ["imageResolution"] = "DPI_150", ["exportRange"] = "SetOfViews", ["fileType"] = "PNG"
        }, () => Raw(doc, view, dir, $"{view.Id.Value()}-zoom100", o => {
            o.ZoomType = ZoomFitType.Zoom;
            o.Zoom = 100;
            o.ImageResolution = ImageResolution.DPI_150;
        }));
    }

    private static JObject Export(string name, JObject options, Func<string> run) {
        var result = new JObject { ["name"] = name, ["options"] = options };
        try {
            var path = run();
            var b = File.ReadAllBytes(path);
            int Be(int at) => (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
            result["file"] = Path.GetFileName(path);
            result["width"] = Be(16);
            result["height"] = Be(20);
            result["sha256"] = Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
        } catch (Exception e) {
            result["error"] = $"{e.GetType().Name}: {e.Message}";
        }
        return result;
    }

    private static string Raw(Document doc, View view, string dir, string baseName, Action<ImageExportOptions> set) {
        var options = new ImageExportOptions {
            ExportRange = ExportRange.SetOfViews,
            HLRandWFViewsFileType = ImageFileType.PNG,
            ShadowViewsFileType = ImageFileType.PNG,
            FilePath = Path.Combine(dir, baseName + ".png")
        };
        set(options);
        options.SetViewsAndSheets([view.Id]);
        doc.ExportImage(options);
        return Directory.GetFiles(dir, baseName + "*.png").OrderByDescending(File.GetLastWriteTimeUtc).First();
    }

    /// <summary>Every element the view collector returns whose view box reaches beyond the crop (in the crop's own frame).</summary>
    private static JArray BeyondCrop(Document doc, View view) {
        var crop = view.CropBox;
        var toCrop = crop.Transform.Inverse;
        var rows = new JArray();
        foreach (var e in new FilteredElementCollector(doc, view.Id).WhereElementIsNotElementType()) {
            if (e.get_BoundingBox(view) is not { } box) continue;
            var local = Corners(box).Select(toCrop.OfPoint).ToList();
            if (local.Min(p => p.X) >= crop.Min.X && local.Max(p => p.X) <= crop.Max.X && local.Min(p => p.Y) >= crop.Min.Y && local.Max(p => p.Y) <= crop.Max.Y)
                continue;
            rows.Add(new JObject {
                ["id"] = e.Id.Value(),
                ["category"] = e.Category?.Name,
                ["categoryType"] = e.Category?.CategoryType.ToString(),
                ["builtInCategory"] = e.Category?.BuiltInCategory.ToString(),
                ["class"] = e.GetType().Name,
                ["name"] = e.Name,
                ["bbox"] = Box(box)
            });
        }
        return rows;
    }

    private static JArray Regions(Document doc, HashSet<long> ids) {
        var rows = new JArray();
        foreach (var region in new FilteredElementCollector(doc).OfClass(typeof(FilledRegion)).Cast<FilledRegion>()) {
            var (role, guid) = TakeoffCarriers.ReadIdentity(region);
            if (guid is null && !ids.Contains(region.Id.Value())) continue;
            rows.Add(new JObject {
                ["id"] = region.Id.Value(),
                ["role"] = role,
                ["guid"] = guid?.ToString(),
                ["ownerViewId"] = region.OwnerViewId.Value(),
                ["ownerViewName"] = (doc.GetElement(region.OwnerViewId) as View)?.Name,
                ["loops"] = new JArray(region.GetBoundaries().Select(loop =>
                    new JArray(loop.SelectMany(c => c.Tessellate().Take(c.Tessellate().Count - 1)).Select(p => new JArray(p.X, p.Y)))))
            });
        }
        return rows;
    }

    private static JArray Loop(CurveLoop loop) => new(loop.Select(c => new JObject { ["start"] = P(c.GetEndPoint(0)), ["end"] = P(c.GetEndPoint(1)) }));

    /// <summary>Model-XYZ extent of a box through its own transform.</summary>
    private static JObject Box(BoundingBoxXYZ? box) {
        if (box is null) return new JObject();
        var c = Corners(box).ToList();
        return new JObject {
            ["min"] = new JArray(c.Min(p => p.X), c.Min(p => p.Y), c.Min(p => p.Z)),
            ["max"] = new JArray(c.Max(p => p.X), c.Max(p => p.Y), c.Max(p => p.Z))
        };
    }

    private static IEnumerable<XYZ> Corners(BoundingBoxXYZ box) {
        foreach (var x in new[] { box.Min.X, box.Max.X })
        foreach (var y in new[] { box.Min.Y, box.Max.Y })
        foreach (var z in new[] { box.Min.Z, box.Max.Z })
            yield return box.Transform.OfPoint(new XYZ(x, y, z));
    }

    private static string ParameterName(Document doc, ElementId id) {
        if (id.Value() < 0)
            try { return LabelUtils.GetLabelFor((BuiltInParameter)id.Value()); } catch { return $"builtin {id.Value()}"; }
        return doc.GetElement(id)?.Name ?? $"param {id.Value()}";
    }

    private static JArray P(XYZ p) => new(p.X, p.Y, p.Z);

    private static JToken Try(Func<JToken> read) {
        try { return read(); } catch (Exception e) { return $"({e.GetType().Name}: {e.Message})"; }
    }

    private static JToken Try(Func<bool> read) {
        try { return read(); } catch (Exception e) { return $"({e.GetType().Name}: {e.Message})"; }
    }

    private static string[] List(string variable, string fallback) =>
        (Environment.GetEnvironmentVariable(variable) is { Length: > 0 } list ? list : fallback)
        .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static string Safe(string title) => string.Concat(title.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '_' : ch));
}
