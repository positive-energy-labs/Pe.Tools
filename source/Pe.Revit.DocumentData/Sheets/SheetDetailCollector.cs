using Pe.Revit.DocumentData.ProjectBrowser;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Sheets;

public static class SheetDetailCollector {
    private static readonly StringComparer IgnoreCase = StringComparer.OrdinalIgnoreCase;

    public static SheetDetailData Collect(Document document, View? activeView, SheetDetailRequest? request = null) {
        request ??= new SheetDetailRequest();
        var references = request.References ?? new SheetReferenceRequest { CurrentActiveSheet = true };
        var projection = request.Projection ?? new SheetDetailProjection();
        var budget = RevitDataOutputBudgets.WithDefaults(request.Budget, maxEntries: 10, maxSamplesPerEntry: 50);
        var issues = new List<RevitDataIssue>();
        var sheets = ResolveSheets(document, activeView, references, issues)
            .OrderBy(sheet => sheet.SheetNumber, IgnoreCase)
            .ThenBy(sheet => sheet.Name, IgnoreCase)
            .ToList();
        var total = sheets.Count;
        var maxEntries = Math.Max(0, budget.MaxEntries ?? 10);
        var pageSheets = sheets.Take(maxEntries).ToList();
        if (pageSheets.Count < total) {
            issues.Add(new RevitDataIssue(
                "SheetDetailsTruncated",
                RevitDataIssueSeverity.Warning,
                $"Returned {pageSheets.Count} of {total} matching sheets. Narrow references or increase budget.maxEntries."
            ));
        }

        var browserIssues = new List<RevitDataIssue>();
        var browserIndex = ProjectBrowserCollector.CollectIndex(
            document,
            new HashSet<ProjectBrowserSection> { ProjectBrowserSection.Sheets },
            Math.Max(0, budget.MaxSamplesPerEntry ?? 5),
            browserIssues
        );
        issues.AddRange(browserIssues);

        var entries = pageSheets
            .Select(sheet => CollectSheet(document, sheet, projection, browserIndex, budget))
            .ToList();

        return new SheetDetailData(
            entries,
            new RevitDataResultPage(total, entries.Count, entries.Count < total),
            RevitDataOutputBudgets.ProjectIssues(issues, budget)
        );
    }

    private static List<ViewSheet> ResolveSheets(Document document, View? activeView, SheetReferenceRequest references, List<RevitDataIssue> issues) {
        var allSheets = new FilteredElementCollector(document)
            .OfClass(typeof(ViewSheet))
            .Cast<ViewSheet>()
            .Where(sheet => !sheet.IsTemplate)
            .ToList();

        var matched = new List<ViewSheet>();
        if (references.CurrentActiveSheet) {
            if (activeView is ViewSheet activeSheet) {
                matched.Add(activeSheet);
            } else {
                issues.Add(new RevitDataIssue(
                    "ActiveViewIsNotSheet",
                    RevitDataIssueSeverity.Warning,
                    "CurrentActiveSheet was requested, but the active view is not a sheet. Pass sheetNumbers/sheetIds or open a sheet."
                ));
            }
        }

        matched.AddRange(allSheets.Where(sheet => references.SheetNumbers.Contains(sheet.SheetNumber, IgnoreCase)));
        matched.AddRange(allSheets.Where(sheet => references.SheetNumberContains.Any(value => Contains(sheet.SheetNumber, value))));
        matched.AddRange(allSheets.Where(sheet => references.SheetIds.Contains(sheet.Id.Value())));
        matched.AddRange(allSheets.Where(sheet => references.SheetUniqueIds.Contains(sheet.UniqueId, IgnoreCase)));

        if (!matched.Any() && !HasExplicitReference(references))
            matched.AddRange(allSheets.Take(10));

        var distinct = matched
            .GroupBy(sheet => sheet.Id.Value())
            .Select(group => group.First())
            .ToList();
        if (distinct.Count == 0) {
            issues.Add(new RevitDataIssue(
                "SheetReferenceNoMatch",
                RevitDataIssueSeverity.Warning,
                "No sheets matched the supplied sheet references. Use revit.catalog.project-index or revit.catalog.project-browser to inspect sheet handles."
            ));
        }

        return distinct;
    }

    private static bool HasExplicitReference(SheetReferenceRequest references) => references.CurrentActiveSheet
        || references.SheetNumbers.Count != 0
        || references.SheetNumberContains.Count != 0
        || references.SheetIds.Count != 0
        || references.SheetUniqueIds.Count != 0;

    private static SheetDetailEntry CollectSheet(
        Document document,
        ViewSheet sheet,
        SheetDetailProjection projection,
        ProjectBrowserCollectedIndex browserIndex,
        RevitDataOutputBudget budget
    ) {
        var issues = new List<RevitDataIssue>();
        var titleBlocks = CollectOwnedElements<FamilyInstance>(document, sheet, BuiltInCategory.OST_TitleBlocks);
        var viewports = projection.IncludeViewports ? CollectOwnedElements<Viewport>(document, sheet) : [];
        var scheduleInstances = projection.IncludeScheduleInstances ? CollectOwnedElements<ScheduleSheetInstance>(document, sheet) : [];
        var textNotes = projection.IncludeTextNotes || projection.View == SheetDetailView.Text ? CollectOwnedElements<TextNote>(document, sheet) : [];
        var genericAnnotations = projection.IncludeAnnotations ? CollectOwnedElements<FamilyInstance>(document, sheet, BuiltInCategory.OST_GenericAnnotation) : [];
        var rasterImages = CollectOwnedElements<Element>(document, sheet, BuiltInCategory.OST_RasterImages);
        var importInstances = CollectOwnedElements<ImportInstance>(document, sheet);
        var summary = new SheetSummary(
            CreateHandle(document, sheet, RevitAgentContextHandleKind.Sheet, $"{sheet.SheetNumber} - {sheet.Name}", "Sheets"),
            sheet.SheetNumber,
            sheet.Name,
            titleBlocks.Count,
            viewports.Count,
            scheduleInstances.Count,
            textNotes.Count,
            genericAnnotations.Count,
            rasterImages.Count,
            importInstances.Count,
            browserIndex.Get(ProjectBrowserSection.Sheets, sheet.Id, true)
        );

        var anchors = new List<SheetAnchor>();
        if (projection.View != SheetDetailView.Summary) {
            if (projection.IncludeTitleBlocks)
                anchors.AddRange(titleBlocks.Select(titleBlock => CreateTitleBlockAnchor(document, sheet, titleBlock, projection)));
            if (projection.IncludeViewports)
                anchors.AddRange(viewports.Select(viewport => CreateViewportAnchor(document, sheet, viewport, projection)));
            if (projection.IncludeScheduleInstances)
                anchors.AddRange(scheduleInstances.Select(instance => CreateScheduleAnchor(document, sheet, instance, projection)));
            if (projection.IncludeTextNotes || projection.View == SheetDetailView.Text)
                anchors.AddRange(textNotes.Select(note => CreateTextNoteAnchor(document, sheet, note, projection)));
            if (projection.IncludeAnnotations)
                anchors.AddRange(genericAnnotations.Select(annotation => CreateElementAnchor(document, sheet, annotation, SheetAnchorKind.GenericAnnotation, projection)));
        }

        var maxSamples = Math.Max(0, budget.MaxSamplesPerEntry ?? 50);
        if (anchors.Count > maxSamples) {
            issues.Add(new RevitDataIssue(
                "SheetAnchorsTruncated",
                RevitDataIssueSeverity.Warning,
                $"Returned {maxSamples} of {anchors.Count} sheet anchors. Narrow projection flags or increase budget.maxSamplesPerEntry."
            ));
            anchors = anchors.Take(maxSamples).ToList();
        }

        return new SheetDetailEntry(summary, anchors, RevitDataOutputBudgets.ProjectIssues(issues, budget));
    }

    private static SheetAnchor CreateTitleBlockAnchor(Document document, ViewSheet sheet, FamilyInstance titleBlock, SheetDetailProjection projection) => new(
        SheetAnchorKind.TitleBlock,
        CreateHandle(document, titleBlock, RevitAgentContextHandleKind.Element, titleBlock.Name, titleBlock.Category?.Name),
        titleBlock.Name,
        GetBounds(titleBlock, sheet, projection),
        null,
        null,
        projection.IncludeTitleBlockParameters ? CollectStringParameters(titleBlock) : [],
        [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.PrintedContext, $"Title block on sheet {sheet.SheetNumber}.")]
    );

    private static SheetAnchor CreateViewportAnchor(Document document, ViewSheet sheet, Viewport viewport, SheetDetailProjection projection) {
        var view = document.GetElement(viewport.ViewId) as View;
        return new SheetAnchor(
            SheetAnchorKind.Viewport,
            CreateHandle(document, viewport, RevitAgentContextHandleKind.Element, viewport.Name, viewport.Category?.Name),
            view?.Title ?? viewport.Name,
            GetViewportBounds(viewport, projection),
            view == null ? null : CreateHandle(document, view, RevitAgentContextHandleKind.View, view.Title, view.ViewType.ToString()),
            null,
            [],
            [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.SheetPlacement, $"Viewport placed on sheet {sheet.SheetNumber}.")]
        );
    }

    private static SheetAnchor CreateScheduleAnchor(Document document, ViewSheet sheet, ScheduleSheetInstance instance, SheetDetailProjection projection) {
        var schedule = document.GetElement(instance.ScheduleId) as ViewSchedule;
        return new SheetAnchor(
            SheetAnchorKind.ScheduleInstance,
            CreateHandle(document, instance, RevitAgentContextHandleKind.Element, instance.Name, instance.Category?.Name),
            schedule?.Name ?? instance.Name,
            GetBounds(instance, sheet, projection),
            schedule == null ? null : CreateHandle(document, schedule, RevitAgentContextHandleKind.Schedule, schedule.Name, "Schedules"),
            null,
            [],
            [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.SheetPlacement, $"Schedule instance placed on sheet {sheet.SheetNumber}.")]
        );
    }

    private static SheetAnchor CreateTextNoteAnchor(Document document, ViewSheet sheet, TextNote note, SheetDetailProjection projection) => new(
        SheetAnchorKind.TextNote,
        CreateHandle(document, note, RevitAgentContextHandleKind.Element, note.Name, note.Category?.Name),
        note.Text.Length > 80 ? note.Text[..80] : note.Text,
        GetBounds(note, sheet, projection),
        null,
        note.Text,
        [],
        [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.PrintedContext, $"Sheet-owned text note on sheet {sheet.SheetNumber}.")]
    );

    private static SheetAnchor CreateElementAnchor(Document document, ViewSheet sheet, Element element, SheetAnchorKind kind, SheetDetailProjection projection) => new(
        kind,
        CreateHandle(document, element, RevitAgentContextHandleKind.Element, element.Name, element.Category?.Name),
        element.Name,
        GetBounds(element, sheet, projection),
        null,
        null,
        [],
        [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.PrintedContext, $"Sheet-owned {kind} on sheet {sheet.SheetNumber}.")]
    );

    private static List<T> CollectOwnedElements<T>(Document document, ViewSheet sheet, BuiltInCategory? category = null) where T : Element {
        var collector = new FilteredElementCollector(document, sheet.Id);
        if (category.HasValue)
            collector.OfCategory(category.Value);
        if (typeof(T) != typeof(Element))
            collector.OfClass(typeof(T));
        return collector.Cast<Element>().OfType<T>().ToList();
    }

    private static SheetBounds? GetViewportBounds(Viewport viewport, SheetDetailProjection projection) {
        if (!projection.IncludeBoundingBoxes)
            return null;
        var outline = viewport.GetBoxOutline();
        return new SheetBounds(outline.MinimumPoint.X, outline.MinimumPoint.Y, outline.MaximumPoint.X, outline.MaximumPoint.Y);
    }

    private static SheetBounds? GetBounds(Element element, ViewSheet sheet, SheetDetailProjection projection) {
        if (!projection.IncludeBoundingBoxes)
            return null;
        var box = element.get_BoundingBox(sheet);
        return box == null ? null : new SheetBounds(box.Min.X, box.Min.Y, box.Max.X, box.Max.Y);
    }

    private static Dictionary<string, string> CollectStringParameters(Element element) => element.Parameters
        .Cast<Parameter>()
        .Where(parameter => parameter.StorageType == StorageType.String)
        .Select(parameter => new { Name = parameter.Definition?.Name, Value = parameter.AsString() })
        .Where(item => !string.IsNullOrWhiteSpace(item.Name) && !string.IsNullOrWhiteSpace(item.Value))
        .GroupBy(item => item.Name!, IgnoreCase)
        .ToDictionary(group => group.Key, group => group.First().Value!, IgnoreCase);

    private static RevitAgentContextHandle CreateHandle(Document document, Element element, RevitAgentContextHandleKind kind, string label, string? categoryName) => new(
        kind,
        document.GetDocumentKey(),
        element.Id.Value(),
        element.UniqueId,
        label,
        categoryName
    );

    private static bool Contains(string? value, string? filter) => !string.IsNullOrWhiteSpace(value)
        && !string.IsNullOrWhiteSpace(filter)
        && value.Contains(filter.Trim(), StringComparison.OrdinalIgnoreCase);
}
