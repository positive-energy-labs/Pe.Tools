public sealed class ViewOpenProbe : PeScriptContainer
{
    public override void Execute()
    {
        if (doc == null || uidoc == null) throw new ArgumentException("Requires the active windowed document in an owned foreground session.");
        Interventions.GuardCopy(doc, ProfilerSettings.EnableViewOpenProbe);
        if (ProfilerSettings.ViewUniqueIds.Length == 0) throw new ArgumentException("Supply explicit ViewUniqueIds.");
        var d = doc;
        var u = uidoc;
        var targets = ProfilerSettings.ViewUniqueIds.Distinct().Select(id => d.GetElement(id) as View ??
            throw new ArgumentException("View anchor absent: " + id)).ToArray();
        if (targets.Any(v => v.IsTemplate)) throw new ArgumentException("Template views cannot open.");
        var start = u.ActiveView.Id;
        var initial = u.GetOpenUIViews().ToDictionary(v => v.ViewId.Value, v => v.GetZoomCorners().ToArray());
        if (!Valid(initial[start.Value], (View)d.GetElement(start))) throw new ArgumentException("Starting zoom rectangle is not initialized; return to Revit before retrying.");
        var rows = new List<ViewOpenSample>();
        var cleanup = new List<string>();
        var budget = new ProfilerBudget(ct);
        string failure = null;
        bool restored = false;
        var provenance = Profiler.Provenance(d);
        var limits = "Foreground API call durations only. First means first activation in this invocation, not a cold process. One external event provides no frame-present, visible-completion or FPS guarantee. Degenerate zoom bounds exclude zoom mutation/timing. Cleanup failure excludes all comparisons.";
        try {
            foreach (var target in targets) {
                var away = start != target.Id ? start : targets.FirstOrDefault(v => v.Id != target.Id)?.Id;
                if (away == null) throw new ArgumentException("A target equal to the starting view needs a second explicit target to force departure.");
                for (var trial = 0; trial < ProfilerSettings.Samples; trial++) {
                    budget.Check();
                    u.ActiveView = (View)d.GetElement(away);
                    var row = new ViewOpenSample { ViewId = target.Id.Value, UniqueId = target.UniqueId, Name = target.Name,
                        Kind = target.ViewType.ToString(), Trial = trial, InitiallyOpen = initial.ContainsKey(target.Id.Value), DepartingViewId = u.ActiveView.Id.Value };
                    rows.Add(row);
                    Artifacts.WriteJson("view-open-checkpoint.json", new { phase = "activating", provenance, limits, rows });
                    var clock = Stopwatch.StartNew();
                    u.ActiveView = target;
                    row.ActivateCallMs = clock.Elapsed.TotalMilliseconds;
                    row.ObservedViewId = u.ActiveView.Id.Value;
                    if (row.ObservedViewId != row.ViewId) throw new InvalidOperationException("Active view readback mismatch.");
                    clock.Restart(); u.RefreshActiveView(); row.RefreshCallMs = clock.Elapsed.TotalMilliseconds;
                    var view = u.GetOpenUIViews().Single(v => v.ViewId == target.Id);
                    var corners = view.GetZoomCorners().ToArray();
                    row.BeforeZoom = Points(corners);
                    if (!Valid(corners, target)) row.ZoomStatus = "unavailable-degenerate-bounds";
                    else {
                        try {
                            clock.Restart(); view.Zoom(1.05); row.ZoomCallMs = clock.Elapsed.TotalMilliseconds;
                            row.ZoomStatus = "measured";
                        } catch (Exception e) { row.ZoomStatus = "failed"; row.Error = e.Message; }
                        finally {
                            try {
                                clock.Restart(); view.ZoomAndCenterRectangle(corners[0], corners[1]);
                                row.ZoomRestoreCallMs = clock.Elapsed.TotalMilliseconds;
                                row.ZoomRestored = Same(corners, view.GetZoomCorners().ToArray());
                                if (!row.ZoomRestored) throw new InvalidOperationException("Target zoom restoration readback mismatch.");
                            } catch (Exception e) { row.Error = (row.Error ?? "") + " Restore: " + e.Message; throw; }
                        }
                    }
                    row.Completed = true;
                }
            }
        } catch (Exception e) { failure = e.ToString(); }
        finally {
            // Restore each captured tab before closing only tabs this invocation opened.
            foreach (var item in initial) {
                try {
                    var v = (View)d.GetElement(new ElementId(item.Key));
                    if (!Valid(item.Value, v)) continue;
                    u.ActiveView = v;
                    var ui = u.GetOpenUIViews().Single(x => x.ViewId.Value == item.Key);
                    ui.ZoomAndCenterRectangle(item.Value[0], item.Value[1]);
                    if (!Same(item.Value, ui.GetZoomCorners().ToArray())) cleanup.Add("Zoom readback mismatch: " + item.Key);
                } catch (Exception e) { cleanup.Add("Restore " + item.Key + ": " + e.Message); }
            }
            try {
                u.ActiveView = (View)d.GetElement(start);
                foreach (var ui in u.GetOpenUIViews().Where(v => !initial.ContainsKey(v.ViewId.Value)).ToArray()) ui.Close();
                var actual = u.GetOpenUIViews().Select(v => v.ViewId.Value).OrderBy(id => id).ToArray();
                if (!actual.SequenceEqual(initial.Keys.OrderBy(id => id))) cleanup.Add("Open tab set differs from initial state.");
                var startUi = u.GetOpenUIViews().Single(v => v.ViewId == start);
                if (u.ActiveView.Id != start || !Same(initial[start.Value], startUi.GetZoomCorners().ToArray())) cleanup.Add("Starting view/zoom readback mismatch.");
                restored = cleanup.Count == 0;
            } catch (Exception e) { cleanup.Add("Final UI readback: " + e.Message); }
        }
        var artifact = Artifacts.WriteJson("view-open.json", new { schemaVersion = 1, status = failure == null && restored ? "completed" : "failed",
            provenance, limits, failure, cleanup, restored, startingViewId = start.Value, initialZoom = initial.ToDictionary(x => x.Key, x => Points(x.Value)),
            finalViewId = u.ActiveView.Id.Value, finalOpenViewIds = u.GetOpenUIViews().Select(v => v.ViewId.Value).ToArray(), rows,
            eligible = rows.Select(row => new { row.ViewId, row.Trial, activation = restored && row.Completed && row.ObservedViewId == row.ViewId,
                zoom = restored && row.Completed && row.ZoomStatus == "measured" && row.ZoomRestored && row.Error == null }).ToArray() });
        Result(new { status = failure == null && restored ? "completed" : "failed", restored, artifact = artifact.FullPath, failure, cleanup });
    }

    private static double[][] Points(XYZ[] points) => points.Select(p => new[] { p.X, p.Y, p.Z }).ToArray();
    private static bool Same(XYZ[] a, XYZ[] b) => a.Length == 2 && b.Length == 2 && a.Zip(b, (x, y) => x.DistanceTo(y)).All(v => v < 1e-5);
    private static bool Valid(XYZ[] corners, View view) {
        if (corners.Length != 2) return false;
        var delta = corners[1] - corners[0];
        return (delta - view.ViewDirection * delta.DotProduct(view.ViewDirection)).GetLength() > 1e-8;
    }
}

public sealed class ViewOpenSample
{
    public long ViewId, DepartingViewId, ObservedViewId;
    public string UniqueId, Name, Kind, ZoomStatus, Error;
    public int Trial;
    public bool InitiallyOpen, Completed, ZoomRestored;
    public double ActivateCallMs, RefreshCallMs;
    public double? ZoomCallMs, ZoomRestoreCallMs;
    public double[][] BeforeZoom;
}
