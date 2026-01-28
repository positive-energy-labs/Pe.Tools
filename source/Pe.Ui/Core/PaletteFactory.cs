using Pe.Global.Services.Storage;
using Pe.Ui.Components;
using Pe.Ui.Core.Services;
using Pe.Ui.ViewModels;
using System.Threading;
using System.Windows;
using System.Windows.Threading;

namespace Pe.Ui.Core;

/// <summary>
///     Defines a single tab in a tabbed palette.
///     Filter predicate is null for "All" tabs that show everything.
/// </summary>
/// <typeparam name="TItem">The palette item type</typeparam>
public class TabDefinition<TItem> where TItem : class, IPaletteListItem {
    /// <summary>
    ///     Display name for the tab.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    ///     Filter predicate for items in this tab. Null means show all items (no filtering).
    /// </summary>
    public Func<TItem, bool>? Filter { get; init; }

    /// <summary>
    ///     Filter key selector for this tab's dropdown filter.
    ///     Null means no filtering dropdown is shown for this tab.
    /// </summary>
    public Func<TItem, string>? FilterKeySelector { get; init; }
}

/// <summary>
///     Factory for creating palette windows using composition instead of inheritance.
///     Handles the boilerplate of wiring up SearchFilterService, PaletteViewModel, Palette, and EphemeralWindow.
/// </summary>
/// <example>
///     Basic usage with persistence and filtering:
///     <code>
///     var window = PaletteFactory.Create("Schedule Palette", items, actions,
///         new PaletteOptions&lt;SchedulePaletteItem&gt; {
///             Storage = new Storage(nameof(CmdPltSchedules)),
///             PersistenceKey = item => item.Schedule.Id.ToString(),
///             SearchConfig = SearchConfig.PrimaryAndSecondary(),
///             FilterKeySelector = item => item.TextPill
///         });
///     window.Show();
///     </code>
/// </example>
/// <example>
///     Minimal usage (search enabled, no persistence):
///     <code>
///     var window = PaletteFactory.Create("My Palette", items, actions);
///     window.Show();
///     </code>
/// </example>
public static class PaletteFactory {
    /// <summary>
    ///     Creates an EphemeralWindow containing a fully configured palette.
    /// </summary>
    /// <typeparam name="TItem">The palette item type (must implement IPaletteListItem)</typeparam>
    /// <param name="title">Window title displayed in the floating pill</param>
    /// <param name="items">Items to display in the palette list</param>
    /// <param name="actions">Actions available for items (first action with no modifiers is the default)</param>
    /// <param name="options">Optional configuration. If null, uses defaults (search enabled, no persistence)</param>
    /// <returns>An EphemeralWindow ready to show</returns>
    public static EphemeralWindow Create<TItem>(
        string title,
        IEnumerable<TItem> items,
        List<PaletteAction<TItem>> actions,
        PaletteOptions<TItem> options = null
    ) where TItem : class, IPaletteListItem {
        options ??= new PaletteOptions<TItem>();

        // Create search service - with or without persistence based on configuration
        var searchService = options.Storage != null && options.PersistenceKey != null
            ? new SearchFilterService<TItem>(options.Storage, options.PersistenceKey, options.SearchConfig)
            : new SearchFilterService<TItem>(options.SearchConfig);

        // Extract tab filters and per-tab filter key selectors for ViewModel
        List<Func<TItem, bool>> tabFilters = null;
        List<Func<TItem, string>> tabFilterKeySelectors = null;
        if (options.Tabs is { Count: > 0 }) {
            tabFilters = options.Tabs.Select(t => t.Filter).ToList();
            tabFilterKeySelectors = options.Tabs.Select(t => t.FilterKeySelector).ToList();
        }

        // Create view model with optional debounce delay and tabs
        var viewModel = new PaletteViewModel<TItem>(
            items,
            searchService,
            options.FilterKeySelector,
            options.SelectionDebounceMs,
            tabFilters,
            tabFilterKeySelectors,
            options.DefaultTabIndex
        );
        options.ViewModelMutator?.Invoke(viewModel);

        // Create palette - hide search box if search is disabled
        var isSearchDisabled = options.SearchConfig == null;
        var palette = new Palette(isSearchDisabled);

        // Create Ctrl-release callback if provided
        // Pass viewModel reference so callback can read current SelectedItem when Ctrl is released
        Action onCtrlReleased = null;
        if (options.OnCtrlReleased != null) {
            var vmRef = viewModel; // Capture viewModel reference
            onCtrlReleased = options.OnCtrlReleased(vmRef);
        }

        // Wire up selection changed callback if provided (immediate, for highlighting)
        if (options.OnSelectionChanged != null) {
            viewModel.PropertyChanged += (_, e) => {
                if (e.PropertyName == nameof(viewModel.SelectedItem))
                    options.OnSelectionChanged(viewModel.SelectedItem);
            };
        }

        // Wire up SidebarPanel if provided
        PaletteSidebar? sidebar = null;
        if (options.SidebarPanel != null) {
            sidebar = new PaletteSidebar {
                Content = options.SidebarPanel.Content,
                Width = options.SidebarPanel.PreferredWidth ?? new GridLength(450)
            };

            // Track cancellation for async loading - cancelled on each selection change
            CancellationTokenSource? updateCts = null;

            // Wire IMMEDIATE clear on selection change (pre-debounce) for responsive UI
            viewModel.PropertyChanged += (_, e) => {
                if (e.PropertyName != nameof(viewModel.SelectedItem)) return;

                // Cancel any pending update work
                updateCts?.Cancel();
                updateCts?.Dispose();
                updateCts = null;

                // Clear immediately so stale content doesn't persist during navigation
                options.SidebarPanel.Clear();
            };

            // Auto-wire debounced selection for ISidebarPanel with cancellation
            viewModel.SelectionChangedDebounced += (_, _) => {
                if (viewModel.SelectedItem != null)
                    palette.ExpandSidebarOnce(sidebar.Width);

                // Create new CTS for this update
                updateCts?.Cancel();
                updateCts?.Dispose();
                updateCts = new CancellationTokenSource();

                var updateToken = updateCts.Token;

                void RunUpdate() {
                    if (updateToken.IsCancellationRequested) return;
                    options.SidebarPanel.Update(viewModel.SelectedItem, updateToken);
                }

                _ = palette.Dispatcher.BeginInvoke(RunUpdate, DispatcherPriority.ApplicationIdle);
            };
        }

        // Extract tab names for UI
        List<string> tabNames = null;
        if (options.Tabs is { Count: > 0 })
            tabNames = options.Tabs.Select(t => t.Name).ToList();

        palette.Initialize(viewModel, actions, options.CustomKeyBindings, onCtrlReleased, sidebar,
            options.KeepOpenAfterAction, tabNames);

        var window = new EphemeralWindow(palette, title);

        // Wire up parent window reference FIRST so palette can access it when setting tray
        palette.SetParentWindow(window);

        // Set up tray - always show at least the default ephemerality toggle
        // If custom tray content is provided, it will be added below the toggle
        var trayContent = options.Tray?.Content;
        var trayMaxHeight = options.Tray?.MaxHeight ?? 200;
        palette.SetTrayContent(trayContent, trayMaxHeight);

        return window;
    }
}

/// <summary>
///     Internal sidebar data structure used by PaletteFactory and Palette.
///     Consumers should use <see cref="ISidebarPanel{TItem}" /> instead.
/// </summary>
internal class PaletteSidebar {
    public required UIElement Content { get; init; }
    public GridLength Width { get; init; } = new(450);
}

/// <summary>
///     Defines a collapsible tray for the palette that appears below the status bar.
///     Trays start collapsed and can be manually expanded/collapsed via a toggle button.
/// </summary>
public class PaletteTray {
    /// <summary>
    ///     The UserControl to display in the tray.
    /// </summary>
    public UIElement? Content { get; init; }

    /// <summary>
    ///     Maximum height of the tray when expanded. Default: 200px.
    /// </summary>
    public double MaxHeight { get; init; } = 200;
}

/// <summary>
///     Configuration options for <see cref="PaletteFactory.Create{TItem}" />.
///     All properties are optional - use only what you need.
/// </summary>
/// <typeparam name="TItem">The palette item type</typeparam>
public class PaletteOptions<TItem> where TItem : class, IPaletteListItem {
    /// <summary>
    ///     Storage instance for persisting usage data. Required for persistence to work.
    ///     Default: null (no persistence)
    /// </summary>
    /// <example>
    ///     <code>Storage = new Storage(nameof(MyCmdClass))</code>
    /// </example>
    public Storage? Storage { get; init; }

    /// <summary>
    ///     Function that returns a unique key for each item, used for persistence.
    ///     Required (along with Storage) for persistence to work.
    ///     Default: null (no persistence)
    /// </summary>
    /// <example>
    ///     <code>PersistenceKey = item => item.Element.Id.ToString()</code>
    /// </example>
    public Func<TItem, string>? PersistenceKey { get; init; }

    /// <summary>
    ///     Search configuration controlling which fields to search and scoring weights.
    ///     Default: <see cref="Services.SearchConfig.Default()" /> (searches TextPrimary only).
    ///     Set to null to disable search entirely (hides the search box).
    /// </summary>
    /// <example>
    ///     <code>
    ///     // Search both name and description:
    ///     SearchConfig = SearchConfig.PrimaryAndSecondary()
    ///     
    ///     // Disable search entirely:
    ///     SearchConfig = null
    ///     </code>
    /// </example>
    public SearchConfig SearchConfig { get; init; } = SearchConfig.Default();

    /// <summary>
    ///     Function that extracts a filter category from each item, enabling dropdown filtering.
    ///     Default: null (filtering disabled)
    /// </summary>
    /// <example>
    ///     <code>
    ///     // Filter by view type:
    ///     FilterKeySelector = item => item.View.ViewType.ToString()
    ///     
    ///     // Filter by category:
    ///     FilterKeySelector = item => item.TextPill
    ///     </code>
    /// </example>
    public Func<TItem, string>? FilterKeySelector { get; init; }

    /// <summary>
    ///     Custom keyboard bindings for navigation.
    ///     Default: null (uses only built-in arrow key navigation)
    /// </summary>
    /// <example>
    ///     <code>
    ///     var keys = new CustomKeyBindings();
    ///     keys.Add(Key.OemTilde, NavigationAction.MoveDown, ModifierKeys.Control);
    ///     CustomKeyBindings = keys;
    ///     </code>
    /// </example>
    public CustomKeyBindings? CustomKeyBindings { get; init; }

    /// <summary>
    ///     Callback to mutate the view model after creation but before palette initialization.
    ///     Useful for setting initial selection state.
    ///     Default: null (no mutation)
    /// </summary>
    /// <example>
    ///     <code>
    ///     // Select second item for MRU-style palettes:
    ///     ViewModelMutator = vm => { if (vm.FilteredItems.Count > 1) vm.SelectedIndex = 1; }
    ///     </code>
    /// </example>
    public Action<PaletteViewModel<TItem>>? ViewModelMutator { get; init; }

    /// <summary>
    ///     Factory function that receives the view model and returns an action to execute when Ctrl is released.
    ///     Used for "hold Ctrl to browse, release to select" behavior (like Alt+Tab).
    ///     The returned action should read the current SelectedItem when executed (not when created).
    ///     Default: null (no Ctrl-release behavior)
    /// </summary>
    /// <example>
    ///     <code>
    ///     OnCtrlReleased = vm => () => {
    ///         // Read current SelectedItem when Ctrl is released (not at window creation)
    ///         var selected = vm.SelectedItem;
    ///         if (selected?.View != null)
    ///             uiapp.ActiveUIDocument.ActiveView = selected.View;
    ///     }
    ///     </code>
    /// </example>
    public Func<PaletteViewModel<TItem>, Action>? OnCtrlReleased { get; init; }

    /// <summary>
    ///     Callback invoked when the selected item changes in the palette.
    ///     Useful for highlighting or previewing the currently selected element.
    ///     Default: null (no selection change behavior)
    /// </summary>
    /// <example>
    ///     <code>
    ///     OnSelectionChanged = item => {
    ///         if (item?.ElementId != null)
    ///             highlighter.Highlight(item.ElementId);
    ///     }
    ///     </code>
    /// </example>
    public Action<TItem?>? OnSelectionChanged { get; init; }

    /// <summary>
    ///     Debounce delay in milliseconds for sidebar panel updates.
    ///     Default: 300ms
    /// </summary>
    public int SelectionDebounceMs { get; init; } = 300;

    /// <summary>
    ///     Sidebar panel implementing <see cref="ISidebarPanel{TItem}" />.
    ///     Auto-wired to debounced selection changes with automatic Clear() and Update() calls.
    ///     Sidebars appear to the right of the main list, start collapsed, and auto-expand on first selection.
    ///     Default: null (no sidebar)
    /// </summary>
    /// <example>
    ///     <code>
    ///     SidebarPanel = new MyPreviewPanel()
    ///     </code>
    /// </example>
    public ISidebarPanel<TItem>? SidebarPanel { get; init; }

    /// <summary>
    ///     Tray definition for the palette.
    ///     Trays appear below the status bar, start collapsed, and can be manually expanded/collapsed.
    ///     All trays automatically include a "Keep Open (Pin Window)" toggle for controlling ephemerality.
    ///     If you provide custom content, it will be displayed below the default toggle with a separator.
    ///     Default: null (tray still created with only the ephemerality toggle)
    /// </summary>
    /// <example>
    ///     <code>
    ///     // Minimal - only the default ephemerality toggle:
    ///     // No Tray property needed, it's automatic
    ///     
    ///     // With custom content below the default toggle:
    ///     Tray = new PaletteTray { Content = optionsPanel }
    ///     
    ///     // Custom max height:
    ///     Tray = new PaletteTray { 
    ///         Content = optionsPanel,
    ///         MaxHeight = 300
    ///     }
    ///     </code>
    /// </example>
    public PaletteTray? Tray { get; init; }

    /// <summary>
    ///     When true, prevents the palette from closing after action execution.
    ///     Action executes immediately (not deferred) and the palette stays open.
    ///     Useful for multi-item workflows like placing multiple families.
    ///     Default: false (palette closes after action, execution is deferred)
    /// </summary>
    /// <example>
    ///     <code>
    ///     // For multi-placement workflows:
    ///     KeepOpenAfterAction = true
    ///     </code>
    /// </example>
    public bool KeepOpenAfterAction { get; init; } = false;

    /// <summary>
    ///     Tab definitions for tabbed palettes. If null or empty, no tab bar is shown.
    ///     Each tab can have a filter predicate; null filter means show all items.
    /// </summary>
    /// <example>
    ///     <code>
    ///     Tabs = [
    ///         new() { Name = "All", Filter = null },
    ///         new() { Name = "Views", Filter = i => i.ItemType == ViewItemType.View },
    ///         new() { Name = "Schedules", Filter = i => i.ItemType == ViewItemType.Schedule }
    ///     ]
    ///     </code>
    /// </example>
    public List<TabDefinition<TItem>>? Tabs { get; init; }

    /// <summary>
    ///     Default selected tab index when palette opens.
    ///     Default: 0 (first tab)
    /// </summary>
    public int DefaultTabIndex { get; init; } = 0;
}