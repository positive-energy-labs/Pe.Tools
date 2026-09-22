using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Revit.Global.Services.Document;

/// <summary>
///     Paints Revit's view tabs with each document's ledger color (pyRevit-style top bar).
///     Rides the docking manager's LayoutUpdated event with a cheap state hash — pyRevit's proven
///     approach, because document events fire before tabs exist in the visual tree. Original tab
///     styles are cached so toggling off restores Revit's chrome exactly.
/// </summary>
public static class RevitTabColorizer {
    private static FrameworkElement? _dockingManager;
    private static string? _lastTabState;
    private static readonly Dictionary<TabItem, Style?> OrigStyles = [];

    /// <summary>
    ///     Idempotent; safe to call on every view activation. No-ops while coloring is disabled
    ///     or until Revit's docking manager exists (first document open).
    /// </summary>
    public static void EnsureStarted() {
        if (!DocumentColorLedger.TabColoringEnabled || _dockingManager != null) return;

        try {
            _dockingManager = GetMainWindowRoot()
                ?.FindDescendantsByTypeName("DockingManager")
                .OfType<FrameworkElement>()
                .FirstOrDefault();
        } catch {
            return;
        }

        if (_dockingManager == null) return;
        _dockingManager.LayoutUpdated += OnLayoutUpdated;
        _lastTabState = null;
        OnLayoutUpdated(null, EventArgs.Empty);
    }

    /// <summary>Re-applies styles now (e.g. after a mode change that layout events won't notice).</summary>
    public static void Refresh() {
        _lastTabState = null;
        OnLayoutUpdated(null, EventArgs.Empty);
    }

    /// <summary>Unhooks and restores every tab's original style.</summary>
    public static void Stop() {
        if (_dockingManager != null) {
            _dockingManager.LayoutUpdated -= OnLayoutUpdated;
            _dockingManager = null;
        }

        foreach (var entry in OrigStyles) {
            try {
                entry.Key.Style = entry.Value;
            } catch {
                // Tab may already be disposed with its document; nothing to restore.
            }
        }

        OrigStyles.Clear();
        _lastTabState = null;
    }

    private static void OnLayoutUpdated(object? sender, EventArgs e) {
        try {
            Repaint();
        } catch {
            // Never break Revit's UI thread over cosmetics.
        }
    }

    private static void Repaint() {
        if (_dockingManager == null) return;

        var tabs = _dockingManager
            .FindDescendantsByTypeName("LayoutDocumentPaneControl")
            .SelectMany(pane => pane.FindDescendants<TabItem>())
            .ToList();

        // LayoutUpdated fires constantly; only repaint when the tab set actually changed.
        var state = string.Join(";", tabs.Select(t => $"{t.GetHashCode()}+{t.ToolTip}"));
        if (state == _lastTabState) return;
        _lastTabState = state;

        foreach (var dead in OrigStyles.Keys.Where(t => !tabs.Contains(t)).ToList())
            _ = OrigStyles.Remove(dead);

        var documents = OpenDocuments();
        foreach (var tab in tabs) {
            var document = MatchDocument(tab, documents);
            if (document == null) continue;
            Apply(tab, DocumentColorLedger.GetColor(document));
        }
    }

    // ponytail: tab→document identity by tooltip title prefix (same heuristic the old reader
    // shipped with); upgrade path is pyRevit's MFC document-pointer match if collisions bite.
    private static Autodesk.Revit.DB.Document? MatchDocument(
        TabItem tab,
        List<Autodesk.Revit.DB.Document> documents
    ) {
        var tooltip = tab.ToolTip?.ToString();
        if (string.IsNullOrEmpty(tooltip)) return null;

        foreach (var document in documents) {
            var title = document.Title;
            var extension = document.IsFamilyDocument ? ".rfa" : ".rvt";
            var titleWithExtension = title.EndsWith(extension) ? title : title + extension;
            if (tooltip.StartsWith($"{title} - ") || tooltip.StartsWith($"{titleWithExtension} - "))
                return document;
        }

        return null;
    }

    private static List<Autodesk.Revit.DB.Document> OpenDocuments() {
        var documents = new List<Autodesk.Revit.DB.Document>();
        var tracker = DocumentTrackerAccessor.Current;
        if (tracker == null) return documents;

        foreach (var tracked in tracker.Open) {
            try {
                var document = tracked.Resolve();
                if (document is { IsValidObject: true })
                    documents.Add(document);
            } catch {
                // Raced a close; the tab is going away too.
            }
        }

        return documents;
    }

    private static void Apply(TabItem tab, WpfColor color) {
        if (!OrigStyles.TryGetValue(tab, out var original)) {
            original = tab.Style;
            OrigStyles[tab] = original;
        }

        var brush = new SolidColorBrush(color);
        var style = new Style(typeof(TabItem), original);
        style.Setters.Add(new Setter(TabItem.BorderBrushProperty, brush));
        style.Setters.Add(new Setter(TabItem.BorderThicknessProperty, new Thickness(0, 3, 0, 0)));
        if (DocumentColorLedger.WholeTabFill)
            style.Setters.Add(new Setter(TabItem.BackgroundProperty, brush));
        tab.Style = style;
    }

    private static Visual? GetMainWindowRoot() {
        var handle = RevitUiSession.CurrentUIApplication.GetActiveWindowHandle();
        if (handle == IntPtr.Zero) return null;
        return HwndSource.FromHwnd(handle)?.RootVisual;
    }

    internal static IEnumerable<T> FindDescendants<T>(this DependencyObject parent) where T : DependencyObject {
        var childCount = VisualTreeHelper.GetChildrenCount(parent);
        for (var i = 0; i < childCount; i++) {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is T typedChild)
                yield return typedChild;

            foreach (var descendant in child.FindDescendants<T>())
                yield return descendant;
        }
    }

    /// <summary>For types we hold no assembly reference to (Xceed AvalonDock).</summary>
    internal static IEnumerable<DependencyObject> FindDescendantsByTypeName(
        this DependencyObject parent,
        string typeName
    ) {
        var childCount = VisualTreeHelper.GetChildrenCount(parent);
        for (var i = 0; i < childCount; i++) {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child.GetType().Name == typeName)
                yield return child;

            foreach (var descendant in child.FindDescendantsByTypeName(typeName))
                yield return descendant;
        }
    }
}
