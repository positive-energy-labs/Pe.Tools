using Autodesk.Revit.UI;
using Pe.Revit.Extensions.ProjDocument;
using System.Collections;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace Pe.Revit.Ui.Core;

/// <summary>
///     Host abstraction so a Palette can live in an EphemeralWindow (floating) or the
///     shared dockable pane (docked) without caring which.
/// </summary>
public interface IPaletteHost {
    /// <summary> Whether the host closes on focus loss. Always false for the docked pane. </summary>
    bool IsEphemeral { get; set; }

    /// <summary> Raised after the host has closed/hidden. </summary>
    event EventHandler? Closed;

    /// <summary> Close (window) or hide (pane) the host. </summary>
    void CloseHost(bool restoreFocus);
}

/// <summary>
///     Palette host backed by the shared dockable pane. Esc hides the pane instead of closing.
/// </summary>
public sealed class DockablePaneHost : IPaletteHost {
    /// <summary> Docked panes never close on focus loss. </summary>
    public bool IsEphemeral { get => false; set { } }

    public event EventHandler? Closed;

    public void CloseHost(bool restoreFocus) {
        PaletteDock.HidePane();
        this.Closed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
///     The single shell dockable pane that hosts whichever palette the user docks.
///     Registered once at Revit startup (dockable panes cannot be registered later);
///     content is swapped at runtime. Shell + docked-palette metadata live on
///     WPF Application.Current.Properties as framework types (ContentControl, string,
///     Action) so hot-swapped payload assemblies can still find and drive them.
/// </summary>
public static class PaletteDock {
    // Rotated 2026-07-07: the original id shipped with a Bottom+hidden initial state that
    // left a phantom AvalonDock splitter (splitter with an invisible neighbor) and crashed
    // Revit on splitter drag. New id = clean remembered-layout slate.
    private static readonly Guid PaneGuid = new("B3D8F4C2-7A61-4E9D-8B2F-9C5E0A1D6F84");
    private const string ShellKey = "PeTools.PaletteDockShell";
    private const string TitleKey = "PeTools.PaletteDockTitle";
    private const string FocusKey = "PeTools.PaletteDockFocus";
    private const string RefreshKey = "PeTools.PaletteDockRefresh";

    public static DockablePaneId PaneId { get; } = new(PaneGuid);

    private static IDictionary? Props => System.Windows.Application.Current?.Properties;

    private static ContentControl? Shell => Props?[ShellKey] as ContentControl;

    /// <summary> True when the pane was registered at startup and the shell is reachable. </summary>
    public static bool IsAvailable => Shell is not null && DockablePane.PaneIsRegistered(PaneId);

    /// <summary>
    ///     Registers the shell pane. Must be called during Revit startup (OnStartup /
    ///     ApplicationInitialized) — safe to call again on payload hot-swap (no-ops).
    /// </summary>
    public static bool Register(UIControlledApplication application) {
        if (DockablePane.PaneIsRegistered(PaneId)) return true;
        var props = Props;
        if (props is null) return false;

        // Opaque themed shell: the pane host paints nothing behind our element, so an
        // unpainted region renders solid black. Content must stretch so a docked palette
        // fills the pane instead of hugging the top-left at natural size.
        var shell = new ContentControl {
            Content = CreateEmptyState(),
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch,
            Focusable = false
        };
        Theme.LoadResources(shell);
        props[ShellKey] = shell;
        application.RegisterDockablePane(PaneId, "PE Palette", new ShellProvider(shell));
        return true;
    }

    /// <summary>
    ///     Puts a palette into the shell and shows the pane. Replaces any previously docked palette.
    /// </summary>
    public static void Dock(UIElement palette, string title, Action focusSearch, Action? refreshItems = null) {
        var shell = Shell ?? throw new InvalidOperationException("Palette dock pane is not registered.");
        shell.Content = palette;
        var props = Props!;
        props[TitleKey] = title;
        props[FocusKey] = focusSearch;
        props[RefreshKey] = refreshItems;
        TryGetPane()?.Show();
    }

    /// <summary>
    ///     Removes a palette from the shell (if it is the docked one) and hides the pane.
    /// </summary>
    public static void Undock(UIElement palette) {
        var shell = Shell;
        if (shell is not null && ReferenceEquals(shell.Content, palette)) {
            shell.Content = CreateEmptyState();
            var props = Props!;
            props.Remove(TitleKey);
            props.Remove(FocusKey);
            props.Remove(RefreshKey);
        }

        HidePane();
    }

    public static void HidePane() => TryGetPane()?.Hide();

    /// <summary>
    ///     If a palette with this title is currently docked, show the pane and focus its search box.
    ///     Palette commands call this first so the ribbon shortcut acts as a summon key.
    /// </summary>
    public static bool TrySummonDocked(string title) {
        var props = Props;
        if (props?[TitleKey] as string != title) return false;

        var pane = TryGetPane();
        var shell = Shell;
        if (pane is null || shell is null) return false;

        pane.Show();
        // Long-lived pane never rebuilds on open — re-run item providers so summoned
        // data is as fresh as a newly opened floating palette.
        if (props[RefreshKey] is Action refresh)
            refresh();
        if (props[FocusKey] is Action focus)
            _ = shell.Dispatcher.BeginInvoke(focus, DispatcherPriority.Loaded);
        return true;
    }

    private static DockablePane? TryGetPane() {
        try {
            return RevitUiSession.CurrentUIApplication.GetDockablePane(PaneId);
        } catch {
            return null;
        }
    }

    private static UIElement CreateEmptyState() {
        var hint = new TextBlock {
            Text = "No palette docked — open a palette and press its dock button.",
            Opacity = 0.6,
            Margin = new Thickness(16),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.Wrap
        };
        hint.SetResourceReference(TextBlock.ForegroundProperty, "TextFillColorSecondaryBrush");

        // Border (not bare TextBlock): paints an opaque themed background across the pane.
        var surface = new Border { Child = hint };
        surface.SetResourceReference(Border.BackgroundProperty, "ApplicationBackgroundBrush");
        return surface;
    }

    private sealed class ShellProvider(ContentControl shell) : IDockablePaneProvider {
        public void SetupDockablePane(DockablePaneProviderData data) {
            data.FrameworkElement = shell;
            data.VisibleByDefault = false;
            // Tabbed behind Project Browser — the ecosystem-proven initial state. A hidden
            // tab leaves no dangling AvalonDock splitter; Bottom + hidden crashed Revit
            // (splitter drag hits an invisible neighbor pane). Users can drag it to the
            // bottom edge themselves once shown.
            data.InitialState = new DockablePaneState {
                DockPosition = DockPosition.Tabbed,
                TabBehind = DockablePanes.BuiltInDockablePanes.ProjectBrowser
            };
            // KeepAlive = Properties-palette semantics: focusing the pane keeps the active
            // tool and selection alive (the whole point of a summonable command palette).
            data.EditorInteraction = new EditorInteraction(EditorInteractionType.KeepAlive);
        }
    }
}
