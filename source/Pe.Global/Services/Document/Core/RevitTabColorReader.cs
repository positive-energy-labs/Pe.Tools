using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Global.Services.Document.Core;

/// <summary>
///     Service for reading document colors from Revit's UI (set by pyRevit or other addins).
///     Instead of setting colors ourselves, we read what's already in the UI.
/// </summary>
public static class RevitTabColorReader {
    /// <summary>
    ///     Gets the tab color for a specific document by reading it from the Revit UI.
    ///     Returns null if no color is found or if pyRevit colorization is not active.
    /// </summary>
    public static WpfColor? GetDocumentColorFromUI(Autodesk.Revit.DB.Document doc) {
        if (doc == null) return null;

        try {
            var mainWindow = GetMainRevitWindow();
            if (mainWindow == null) return null;

            var dockingManager = mainWindow.FindDescendantsByTypeName("DockingManager").FirstOrDefault();
            if (dockingManager == null) return null;

            var docPanes = dockingManager.FindDescendantsByTypeName("LayoutDocumentPaneControl").ToList();

            // Build possible document name patterns
            // Revit adds file extensions to tab tooltips (.rfa for families, .rvt for projects)
            var docTitleWithExt = doc.Title;
            if (doc.IsFamilyDocument && !doc.Title.EndsWith(".rfa"))
                docTitleWithExt = doc.Title + ".rfa";
            else if (!doc.IsFamilyDocument && !doc.Title.EndsWith(".rvt")) docTitleWithExt = doc.Title + ".rvt";

            var tabsChecked = 0;
            foreach (var pane in docPanes) {
                var tabs = pane.FindDescendants<TabItem>().ToList();

                foreach (var tab in tabs) {
                    tabsChecked++;
                    var tooltip = tab.ToolTip?.ToString();
                    if (string.IsNullOrEmpty(tooltip)) continue;

                    // Tab tooltip format: "{DocumentName} - {ViewTitle}"
                    // Check if this tab belongs to our document (try both with and without extension)
                    var isMatch = tooltip.StartsWith($"{doc.Title} - ") ||
                                  tooltip.StartsWith($"{docTitleWithExt} - ");

                    if (!isMatch) continue;


                    WpfColor? backgroundColorValue = null;
                    WpfColor? borderColorValue = null;

                    if (tab.Background is SolidColorBrush backgroundBrush)
                        backgroundColorValue = backgroundBrush.Color;

                    if (tab.BorderBrush is SolidColorBrush borderBrush) borderColorValue = borderBrush.Color;

                    // In border mode, pyRevit uses BorderBrush for color and background is theme-based
                    // Detect border mode: BorderThickness > 0 AND BorderBrush is significantly different from Background
                    if (borderColorValue.HasValue && backgroundColorValue.HasValue && tab.BorderThickness.Top > 0) {
                        var bg = backgroundColorValue.Value;
                        var border = borderColorValue.Value;

                        // Calculate color difference between background and border
                        var colorDiff = Math.Abs(bg.R - border.R) + Math.Abs(bg.G - border.G) +
                                        Math.Abs(bg.B - border.B);


                        // If border is significantly different from background (diff > 100), use border color
                        if (colorDiff > 100) return borderColorValue.Value;
                    }

                    // Otherwise use background color (fill mode)
                    if (backgroundColorValue.HasValue) return backgroundColorValue.Value;
                }
            }

            return null;
        } catch (Exception ex) {
            Debug.WriteLine($"[TabColorReader] EXCEPTION: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    ///     Gets the main Revit window by enumerating all HWNDs and finding the one with DockingManager
    /// </summary>
    private static Visual GetMainRevitWindow() {
        try {
            var currentProcessId = Process.GetCurrentProcess().Id;
            var windowsWithDockingManager = new List<IntPtr>();

            // Enumerate all top-level windows
            _ = EnumWindows((hwnd, lParam) => {
                _ = GetWindowThreadProcessId(hwnd, out var processId);

                // Only check windows belonging to our process
                if (processId != currentProcessId) return true;

                try {
                    // Try to get HwndSource for this window
                    var source = HwndSource.FromHwnd(hwnd);
                    if (source?.RootVisual == null) return true;

                    // Check if this window contains a DockingManager
                    var hasDockingManager = source.RootVisual
                        ?.FindDescendantsByTypeName("DockingManager")
                        .Any() ?? false;

                    if (hasDockingManager) {
                        windowsWithDockingManager.Add(hwnd);
                        return false; // Stop enumeration
                    }
                } catch {
                    // Ignore windows we can't access
                }

                return true; // Continue enumeration
            }, IntPtr.Zero);

            // Return the first window with DockingManager
            if (windowsWithDockingManager.Count > 0) {
                var hwnd = windowsWithDockingManager[0];
                var source = HwndSource.FromHwnd(hwnd);
                return source?.RootVisual;
            }

            return null;
        } catch {
            return null;
        }
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    /// <summary>
    ///     Extension method to find all descendants of a specific type in the WPF visual tree
    /// </summary>
    private static IEnumerable<T> FindDescendants<T>(this DependencyObject parent) where T : DependencyObject {
        if (parent == null) yield break;

        var childCount = VisualTreeHelper.GetChildrenCount(parent);
        for (var i = 0; i < childCount; i++) {
            var child = VisualTreeHelper.GetChild(parent, i);

            if (child is T typedChild)
                yield return typedChild;

            foreach (var descendant in FindDescendants<T>(child))
                yield return descendant;
        }
    }

    /// <summary>
    ///     Find descendants by type name (for types we don't have references to, like DockingManager)
    /// </summary>
    private static IEnumerable<DependencyObject> FindDescendantsByTypeName(this DependencyObject parent,
        string typeName) {
        if (parent == null) yield break;

        var childCount = VisualTreeHelper.GetChildrenCount(parent);
        for (var i = 0; i < childCount; i++) {
            var child = VisualTreeHelper.GetChild(parent, i);

            if (child.GetType().Name == typeName)
                yield return child;

            foreach (var descendant in FindDescendantsByTypeName(child, typeName))
                yield return descendant;
        }
    }

    // P/Invoke declarations
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
}