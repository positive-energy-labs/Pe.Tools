using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;
using System.IO;

namespace Pe.Revit.FamilyFoundry.Verify;

/// <summary>Disposable native verification, with no family-specific acceptance rules.</summary>
public static class FamilyVerification {
    public static FamilyLookData LookFamily(this Document document, FamilyLookRequest request) {
        var output = OutputDirectory(request.OutDir);
        var types = Types(document, request.Types);
        var manager = document.FamilyManager;
        var toggles = (request.Toggles ?? []).Distinct(StringComparer.Ordinal).Select(name => {
            var parameter = manager.get_Parameter(name);
            if (parameter is null || parameter.Definition.GetDataType() != SpecTypeId.Boolean.YesNo || parameter.IsReadOnly || parameter.IsDeterminedByFormula)
                throw Bad("$.toggles", "InvalidToggle", $"'{name}' must be an editable Yes/No family parameter without a formula.");
            return parameter;
        }).ToList();
        var rows = new List<FamilyLookRow>();
        using var group = new TransactionGroup(document, "Look at family (rollback)");
        group.Start();
        try {
            List<(string Key, View View)> views;
            using (var transaction = new Transaction(document, "Geometry views")) {
                transaction.Start();
                views = FamilyViews(document);
                PrepareViews(views);
                transaction.Commit();
            }
            var states = toggles.Count == 0
                ? new List<(FamilyParameter? Parameter, int Value, string Name)> { (null, 0, "default") }
                : toggles.SelectMany(p => new[] { (Parameter: (FamilyParameter?)p, Value: 0, Name: p.Definition.Name + "-off"), (Parameter: (FamilyParameter?)p, Value: 1, Name: p.Definition.Name + "-on") }).ToList();
            foreach (var type in types) foreach (var state in states) {
                using var stateGroup = new TransactionGroup(document, "Type and toggle (rollback)");
                stateGroup.Start();
                try {
                    using (var transaction = new Transaction(document, "Flex family")) {
                        transaction.Start();
                        manager.CurrentType = type;
                        if (state.Parameter is not null) manager.Set(state.Parameter, state.Value);
                        document.Regenerate();
                        transaction.Commit();
                    }
                    var elements = new FilteredElementCollector(document).WhereElementIsNotElementType()
                        .Where(e => e is GenericForm or FamilyInstance or ConnectorElement)
                        .Select(e => new FamilyLookElement(e.Id.Value(), e.GetType().Name, e.Name,
                            e.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM)?.AsInteger() != 0, Bounds(e.get_BoundingBox(null)),
                            e is ConnectorElement connector ? Describe(connector) : null)).ToList();
                    // Family-editor PNGs draw connector glyphs even after HideElements; the census above
                    // retains them, and this state group's rollback restores them after geometry-only export.
                    using (var transaction = new Transaction(document, "Omit connector glyphs from images")) {
                        transaction.Start();
                        document.Delete(new FilteredElementCollector(document).OfClass(typeof(ConnectorElement)).ToElementIds());
                        document.Regenerate();
                        transaction.Commit();
                    }
                    rows.Add(new FamilyLookRow(type.Name, state.Name, elements, Export(document, output, Safe(type.Name) + "__" + Safe(state.Name), views)));
                } finally { stateGroup.RollBack(); }
            }
            return new FamilyLookData(rows);
        } finally { group.RollBack(); }
    }

    public static FamilyLoadTestData LoadTestFamily(this Document familyDocument, FamilyLoadTestRequest request) {
        var output = OutputDirectory(request.OutDir);
        var typeNames = Types(familyDocument, request.Types).Select(t => t.Name).ToList();
        var app = familyDocument.Application;
        var template = request.Template ?? app.DefaultProjectTemplate;
        if (!string.IsNullOrWhiteSpace(template) && (!Path.IsPathFullyQualified(template) || !File.Exists(template) || !string.Equals(Path.GetExtension(template), ".rte", StringComparison.OrdinalIgnoreCase)))
            throw Bad("$.template", "InvalidTemplate", "The project template must be an existing absolute .rte path.");
        var sourceNested = NestedDefinitions(familyDocument);
        var failures = new FailureRecorder();
        // LoadFamily owns internal transactions, so its failures need the application event too.
        void OnFailures(object? sender, Autodesk.Revit.DB.Events.FailuresProcessingEventArgs args) => args.SetProcessingResult(failures.PreprocessFailures(args.GetFailuresAccessor()));
        app.FailuresProcessing += OnFailures;
        Document? project = null;
        try {
            project = string.IsNullOrWhiteSpace(template) ? app.NewProjectDocument(UnitSystem.Imperial) : app.NewProjectDocument(template);
            var existing = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Any(f => f.Name == familyDocument.OwnerFamily.Name);
            var options = new LoadOptions(familyDocument.OwnerFamily.Name);
            var loaded = familyDocument.LoadFamily(project, options);
            if (loaded is null) throw Bad("$", "LoadFailed", "Revit did not load the family into the scratch project.");
            var embedded = LoadedNestedDefinitions(project, loaded, failures);
            var rows = new List<FamilyLoadInstance>();
            List<(string Key, View View)> views;
            var placed = new List<(string Type, ElementId Id)>();
            using (var transaction = new Transaction(project, "Place verification row")) {
                transaction.Start();
                transaction.SetFailureHandlingOptions(transaction.GetFailureHandlingOptions().SetFailuresPreprocessor(failures).SetClearAfterRollback(true));
                var level = new FilteredElementCollector(project).OfClass(typeof(Level)).Cast<Level>().FirstOrDefault(l => l.Name == "Level 1");
                if (level is null) {
                    level = Level.Create(project, 0);
                    level.Name = "Level 1";
                }
                double nextX = 0;
                foreach (var name in typeNames) {
                    var symbol = loaded.GetFamilySymbolIds().Select(id => (FamilySymbol)project.GetElement(id)).Single(s => s.Name == name);
                    try {
                        using var placement = new SubTransaction(project);
                        placement.Start();
                        if (!symbol.IsActive) symbol.Activate();
                        var instance = project.Create.NewFamilyInstance(new XYZ(nextX, 0, level.Elevation), symbol, level, StructuralType.NonStructural);
                        project.Regenerate();
                        var bounds = instance.get_BoundingBox(null);
                        if (bounds is not null) {
                            ElementTransformUtils.MoveElement(project, instance.Id, new XYZ(nextX - bounds.Min.X, 0, 0));
                            nextX += bounds.Max.X - bounds.Min.X + 2;
                        } else nextX += 2;
                        project.Regenerate();
                        placement.Commit();
                        placed.Add((name, instance.Id));
                    } catch (Exception exception) {
                        rows.Add(new FamilyLoadInstance(name, null, [], exception.Message));
                    }
                }
                views = ProjectViews(project, level);
                PrepareViews(views);
                project.Regenerate();
                if (transaction.Commit() != TransactionStatus.Committed)
                    throw Bad("$", "PlacementRolledBack", "Revit rolled back the scratch placement; failures: " + string.Join("; ", failures.Rows.Select(f => f.Description)));
            }
            foreach (var (type, id) in placed) {
                if (project.GetElement(id) is not FamilyInstance instance) {
                    rows.Add(new FamilyLoadInstance(type, null, [], "Failure resolution removed this instance."));
                    continue;
                }
                var connectors = instance.MEPModel?.ConnectorManager?.Connectors.Cast<Connector>().Select(Describe).ToList() ?? [];
                rows.Add(new FamilyLoadInstance(type, id.Value(), connectors, null));
            }
            var warnings = project.GetWarnings().Select(w => new RevitWarningRow(w.GetSeverity().ToString(), w.GetDescriptionText(),
                w.GetFailingElements().Select(id => id.Value()).ToList(), w.GetAdditionalElements().Select(id => id.Value()).ToList())).ToList();
            var loadedFamilies = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().ToList();
            var nested = sourceNested.Select(pair => new FamilyLoadNested(pair.Key, pair.Value,
                loadedFamilies.Where(f => f.Name == pair.Key).Select(f => f.Id.Value()).ToList(), embedded.GetValueOrDefault(pair.Key))).ToList();
            var duplicates = sourceNested.Where(p => p.Value > 1).Select(p => p.Key)
                .Concat(embedded.Where(p => p.Value > 1).Select(p => p.Key))
                .Concat(loadedFamilies.GroupBy(f => f.Name).Where(g => g.Count() > 1).Select(g => g.Key)).Distinct().ToList();
            return new FamilyLoadTestData(loaded.Name, existing, options.Rows, nested, duplicates, rows, warnings, failures.Rows,
                Export(project, output, "loadTest", views));
        } finally {
            try { project?.Close(false); }
            finally { app.FailuresProcessing -= OnFailures; }
        }
    }

    private static IReadOnlyList<FamilyType> Types(Document document, IReadOnlyList<string>? names) {
        if (!document.IsFamilyDocument) throw Bad("$", "FamilyRequired", "Open a family document first.");
        var all = document.FamilyManager.Types.Cast<FamilyType>().OrderBy(t => t.Name, StringComparer.Ordinal).ToList();
        if (all.Count == 0) throw Bad("$.types", "NoTypes", "The family has no types to verify.");
        if (names is null) return all;
        if (names.Count == 0 || names.Distinct(StringComparer.Ordinal).Count() != names.Count || names.Any(n => all.All(t => t.Name != n)))
            throw Bad("$.types", "InvalidTypes", "Pass nonempty, distinct, exact family type names.");
        return names.Select(n => all.Single(t => t.Name == n)).ToList();
    }

    private static string OutputDirectory(string path) {
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path)) throw Bad("$.outDir", "AbsolutePathRequired", "outDir must be an absolute directory.");
        Directory.CreateDirectory(path);
        return path;
    }

    private static List<(string Key, View View)> FamilyViews(Document document) {
        var all = new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>().Where(v => !v.IsTemplate && v.CanBePrinted).ToList();
        var views = new List<(string Key, View View)>();
        if (all.FirstOrDefault(v => v.ViewType == ViewType.FloorPlan) is { } plan) views.Add(("plan", plan));
        foreach (var (key, direction) in new[] { ("-X", -XYZ.BasisX), ("+X", XYZ.BasisX), ("-Y", -XYZ.BasisY), ("+Y", XYZ.BasisY) })
            if (all.FirstOrDefault(v => v.ViewType == ViewType.Elevation && v.ViewDirection.DotProduct(direction) > 0.9) is { } elevation)
                views.Add((key, elevation));
        views.Add(("3D", Isometric(document)));
        return views;
    }

    private static List<(string Key, View View)> ProjectViews(Document project, Level level) {
        var viewTypes = new FilteredElementCollector(project).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().ToList();
        var plan = ViewPlan.Create(project, viewTypes.First(t => t.ViewFamily == ViewFamily.FloorPlan).Id, level.Id);
        var marker = ElevationMarker.CreateElevationMarker(project, viewTypes.First(t => t.ViewFamily == ViewFamily.Elevation).Id, new XYZ(0, -20, level.Elevation), 100);
        var elevation = marker.CreateElevation(project, plan.Id, 0);
        project.Regenerate();
        // Look along Y so an X-spaced row is visible across the whole elevation.
        // Revit's ViewDirection points toward the viewer, away from the geometry.
        var angle = -Math.PI / 2 - Math.Atan2(elevation.ViewDirection.Y, elevation.ViewDirection.X);
        ElementTransformUtils.RotateElement(project, marker.Id, Line.CreateBound(new XYZ(0, -20, level.Elevation), new XYZ(0, -20, level.Elevation + 1)), angle);
        elevation.get_Parameter(BuiltInParameter.VIEWER_BOUND_FAR_CLIPPING)?.Set(0);
        project.Regenerate();
        return [("plan", plan), ("elevation", elevation), ("3D", Isometric(project))];
    }

    private static View3D Isometric(Document document) {
        var type = new FilteredElementCollector(document).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().First(t => t.ViewFamily == ViewFamily.ThreeDimensional);
        var view = View3D.CreateIsometric(document, type.Id);
        view.SetOrientation(new ViewOrientation3D(new XYZ(-10, -10, 10), new XYZ(1, 1, 2).Normalize(), new XYZ(1, 1, -1).Normalize()));
        view.IsSectionBoxActive = false;
        return view;
    }

    private static void PrepareViews(IEnumerable<(string Key, View View)> views) {
        foreach (var (_, view) in views) {
            view.DetailLevel = ViewDetailLevel.Fine;
            view.DisplayStyle = DisplayStyle.HLR;
            view.CropBoxActive = false;
            view.CropBoxVisible = false;
            foreach (Category category in view.Document.Settings.Categories)
                if (category.CategoryType == CategoryType.Annotation && view.CanCategoryBeHidden(category.Id)) view.SetCategoryHidden(category.Id, true);
            foreach (var category in new[] { BuiltInCategory.OST_Dimensions, BuiltInCategory.OST_CLines, BuiltInCategory.OST_Levels, BuiltInCategory.OST_ReferenceLines, BuiltInCategory.OST_ElevationMarks })
                if (view.CanCategoryBeHidden(category.ToElementId())) view.SetCategoryHidden(category.ToElementId(), true);
        }
    }

    private static List<FamilyVerifyImage> Export(Document document, string directory, string prefix, IEnumerable<(string Key, View View)> views) {
        var images = new List<FamilyVerifyImage>();
        foreach (var (key, view) in views) {
            var temporary = Path.Combine(directory, Guid.NewGuid().ToString("N"));
            var options = new ImageExportOptions { ExportRange = ExportRange.SetOfViews, ZoomType = ZoomFitType.FitToPage,
                PixelSize = 1600, HLRandWFViewsFileType = ImageFileType.PNG, ShadowViewsFileType = ImageFileType.PNG,
                ImageResolution = ImageResolution.DPI_150, FilePath = temporary };
            options.SetViewsAndSheets([view.Id]);
            document.ExportImage(options);
            var exported = Directory.GetFiles(directory, Path.GetFileName(temporary) + "*.png").Single();
            var path = Path.Combine(directory, prefix + "__" + key + ".png");
            File.Move(exported, path, true);
            images.Add(new FamilyVerifyImage(key, path.Replace('\\', '/')));
        }
        return images;
    }

    // Escape instead of dropping characters so different authored names cannot overwrite one another.
    private static string Safe(string name) => string.Concat(name.Select(c => Path.GetInvalidFileNameChars().Contains(c) || c == '~' || c == '.' ? "~" + ((int)c).ToString("X4") : c.ToString()));
    private static Dictionary<string, int> NestedDefinitions(Document document) => new FilteredElementCollector(document).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
        .Select(i => i.Symbol.Family).DistinctBy(f => f.Id.Value()).GroupBy(f => f.Name, StringComparer.Ordinal)
        .ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);
    private static Dictionary<string, int> LoadedNestedDefinitions(Document project, Family loaded, FailureRecorder failures) {
        using var group = new TransactionGroup(project, "Inspect loaded nested definitions (rollback)");
        group.Start();
        try {
            // EditFamily can return a second wrapper for the already-open source document. A distinct
            // scratch name forces a separate loaded copy; rollback restores the actual loaded name.
            using (var transaction = new Transaction(project, "Separate scratch family identity")) {
                transaction.Start();
                transaction.SetFailureHandlingOptions(transaction.GetFailureHandlingOptions().SetFailuresPreprocessor(failures).SetClearAfterRollback(true));
                loaded.Name = "Verification_" + Guid.NewGuid().ToString("N");
                if (transaction.Commit() != TransactionStatus.Committed) throw Bad("$", "LoadedReadRefused", "Cannot inspect a separate loaded family copy.");
            }
            var before = project.Application.Documents.Cast<Document>().ToList();
            var copy = project.EditFamily(loaded);
            // Native Equals recognizes document identity across wrappers; ReferenceEquals does not.
            if (before.Any(document => document.Equals(copy))) throw Bad("$", "LoadedReadAliased", "Revit returned a pre-existing family document instead of a scratch copy.");
            try { return NestedDefinitions(copy); }
            finally { copy.Close(false); }
        } finally { group.RollBack(); }
    }
    private static FamilyVerifyPoint Point(XYZ p, double scale = 12) => new(p.X * scale, p.Y * scale, p.Z * scale);
    private static FamilyVerifyBounds? Bounds(BoundingBoxXYZ? box) {
        if (box is null) return null;
        var corners = (from x in new[] { box.Min.X, box.Max.X } from y in new[] { box.Min.Y, box.Max.Y } from z in new[] { box.Min.Z, box.Max.Z }
            select box.Transform.OfPoint(new XYZ(x, y, z))).ToList();
        return new FamilyVerifyBounds(Point(new XYZ(corners.Min(p => p.X), corners.Min(p => p.Y), corners.Min(p => p.Z))),
            Point(new XYZ(corners.Max(p => p.X), corners.Max(p => p.Y), corners.Max(p => p.Z))));
    }
    private static FamilyVerifyConnector Describe(ConnectorElement c) => new(c.Domain.ToString(), c.SystemClassification.ToString(), Point(c.Origin), Point(c.CoordinateSystem.BasisZ, 1),
        c.Shape.ToString(), c.Shape == ConnectorProfileType.Round ? c.Radius * 24 : null,
        c.Shape is ConnectorProfileType.Rectangular or ConnectorProfileType.Oval ? c.Width * 12 : null,
        c.Shape is ConnectorProfileType.Rectangular or ConnectorProfileType.Oval ? c.Height * 12 : null);
    private static FamilyVerifyConnector Describe(Connector c) => new(c.Domain.ToString(), c.Domain switch {
        Domain.DomainHvac => c.DuctSystemType.ToString(), Domain.DomainPiping => c.PipeSystemType.ToString(), Domain.DomainElectrical => c.ElectricalSystemType.ToString(), _ => "Undefined"
    }, Point(c.Origin), Point(c.CoordinateSystem.BasisZ, 1), c.Shape.ToString(), c.Shape == ConnectorProfileType.Round ? c.Radius * 24 : null,
        c.Shape is ConnectorProfileType.Rectangular or ConnectorProfileType.Oval ? c.Width * 12 : null,
        c.Shape is ConnectorProfileType.Rectangular or ConnectorProfileType.Oval ? c.Height * 12 : null);
    private static Exception Bad(string path, string code, string message) => BridgeOperationExceptions.BadRequest(message, [BridgeOperationExceptions.Issue(path, code, message, null)]);

    private sealed class LoadOptions(string name) : IFamilyLoadOptions {
        public List<FamilyLoadDecision> Rows { get; } = [];
        public bool OnFamilyFound(bool familyInUse, out bool overwriteParameterValues) {
            overwriteParameterValues = true;
            Rows.Add(new FamilyLoadDecision(name, false, familyInUse, true));
            return true;
        }
        public bool OnSharedFamilyFound(Family sharedFamily, bool familyInUse, out FamilySource source, out bool overwriteParameterValues) {
            source = FamilySource.Family;
            overwriteParameterValues = true;
            Rows.Add(new FamilyLoadDecision(sharedFamily.Name, true, familyInUse, true));
            return true;
        }
    }

    private sealed class FailureRecorder : IFailuresPreprocessor {
        public List<FamilyLoadFailure> Rows { get; } = [];
        public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor) {
            var resolved = false;
            var rollback = false;
            foreach (var failure in accessor.GetFailureMessages()) {
                var severity = failure.GetSeverity();
                var resolution = "Warning retained";
                if (severity != FailureSeverity.Warning) {
                    var current = Enum.GetValues<FailureResolutionType>().FirstOrDefault(type => type != FailureResolutionType.Invalid
                        && failure.HasResolutionOfType(type) && accessor.IsFailureResolutionPermitted(failure, type)
                        && !accessor.GetAttemptedResolutionTypes(failure).Contains(type));
                    if (current != FailureResolutionType.Invalid) {
                        failure.SetCurrentResolutionType(current);
                        accessor.ResolveFailure(failure);
                        resolved = true;
                        resolution = current.ToString();
                    } else {
                        rollback = true;
                        resolution = "Rollback: no permitted resolution";
                    }
                }
                Rows.Add(new FamilyLoadFailure(severity.ToString(), failure.GetDescriptionText(), failure.GetFailingElementIds().Select(id => id.Value()).ToList(),
                    failure.GetAdditionalElementIds().Select(id => id.Value()).ToList(), resolution));
            }
            return rollback ? FailureProcessingResult.ProceedWithRollBack : resolved ? FailureProcessingResult.ProceedWithCommit : FailureProcessingResult.Continue;
        }
    }
}
