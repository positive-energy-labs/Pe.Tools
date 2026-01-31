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
    ///     Lazy item provider for this tab. Takes precedence over Filter if provided.
    ///     Enables per-tab lazy loading - items are only collected when the tab is first activated.
    ///     Default: null (use shared item collection with Filter)
    /// </summary>
    /// <example>
    ///     <code>
    ///     ItemProvider = () => FamilyActions.CollectFamilyTypes(doc)
    ///     </code>
    /// </example>
    public Func<IEnumerable<TItem>>? ItemProvider { get; init; }

    /// <summary>
    ///     Filter predicate for items in this tab. Null means show all items (no filtering).
    ///     Only used if ItemProvider is null (i.e., using shared item collection).
    /// </summary>
    public Func<TItem, bool>? Filter { get; init; }

    /// <summary>
    ///     Function that extracts a key from each item, enabling dropdown filtering by those keys.
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
    ///     Per-tab actions. When provided, these actions replace global actions for this tab.
    ///     Enables cleaner action lists by only showing relevant actions per tab.
    ///     Default: null (use global actions)
    /// </summary>
    /// <example>
    ///     <code>
    ///     Actions = [
    ///         new() { Name = "Place", Execute = async item => PlaceItem(item) },
    ///         new() { Name = "Edit", Execute = async item => EditItem(item) }
    ///     ]
    ///     </code>
    /// </example>
    public List<PaletteAction<TItem>> Actions { get; init; } = [];
}

/// <summary>
///     Factory for creating palette windows using composition instead of inheritance.
///     Handles the boilerplate of wiring up SearchFilterService, PaletteViewModel, Palette, and EphemeralWindow.
/// </summary>
/// <example>
///     Basic usage with persistence and filtering:
///     <code>
///     var window = PaletteFactory.Create("Schedule Palette",
///         new PaletteOptions&lt;SchedulePaletteItem&gt; {
///             Persistence = (storage, item => item.Schedule.Id.ToString()),
///             SearchConfig = SearchConfig.PrimaryAndSecondary(),
///             Tabs = [new TabDefinition<SchedulePaletteItem> {
///                 Name = "All",
///                 ItemProvider = () => CollectSchedules(doc),
///                 FilterKeySelector = item => item.TextPill,
///                 Actions = [
///                     new() { Name = "Open", Execute = async item => OpenSchedule(item) }
///                 ]
///             }]
///         });
///     window.Show();
///     </code>
/// </example>
/// <example>
///     Minimal usage (no tabs, no persistence):
///     <code>
///     var window = PaletteFactory.Create("My Palette",
///         new PaletteOptions&lt;MyItem&gt; {
///             Tabs = [new() {
///                 Name = "All",
///                 ItemProvider = () => GetItems(),
///                 Actions = [new() { Name = "Execute", Execute = async item => DoAction(item) }]
///             }]
///         });
///     window.Show();
///     </code>
/// </example>
public static class PaletteFactory {
    /// <summary>
    ///     Creates an EphemeralWindow containing a fully configured palette.
    /// </summary>
    /// <typeparam name="TItem">The palette item type (must implement IPaletteListItem)</typeparam>
    /// <param name="title">Window title displayed in the floating pill</param>
    /// <param name="options">Configuration including tabs with ItemProvider and Actions. Tabs are required.</param>
    /// <returns>An EphemeralWindow ready to show</returns>
    public static EphemeralWindow Create<TItem>(
        string title,
        PaletteOptions<TItem> options
    ) where TItem : class, IPaletteListItem {
        options ??= new PaletteOptions<TItem>();

        // Validation: tabs are now required
        if (options.Tabs == null || !options.Tabs.Any()) {
            throw new InvalidOperationException("Tabs are required. Each tab must define ItemProvider and optionally Actions.");
        }

        // Validation: all tabs must have ItemProvider
        var tabsWithoutProvider = options.Tabs.Where(t => t.ItemProvider == null).ToList();
        if (tabsWithoutProvider.Any()) {
            throw new InvalidOperationException(
                $"All tabs must have ItemProvider defined. " +
                $"Tabs without ItemProvider: {string.Join(", ", tabsWithoutProvider.Select(t => t.Name))}");
        }

        // Create search service - with or without persistence based on configuration
        var searchService = options.Persistence != null
            ? new SearchFilterService<TItem>(options.Persistence.Value.Storage, options.Persistence.Value.PersistenceKey, options.SearchConfig)
            : new SearchFilterService<TItem>(options.SearchConfig);

        // Create view model with tabs (lazy loading via ItemProvider)
        var viewModel = new PaletteViewModel<TItem>(
            searchService,
            options.Tabs,
            options.DefaultTabIndex
        );

        // Set up initial load callback if mutator is provided
        if (options.ViewModelMutator != null)
            viewModel.SetInitialLoadCallback(() => options.ViewModelMutator(viewModel));

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

        palette.Initialize(viewModel, options.CustomKeyBindings, onCtrlReleased, sidebar);

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
    ///     For persisting usage data. Required for persistence to work.
    ///     Default: null (no persistence)
    /// </summary>
    /// <param name="Storage">Storage instance for persisting usage data</param>
    /// <param name="PersistenceKey">Function that returns a unique key for each item, used for persistence</param>
    /// <example>
    ///     <code>Storage = new Storage(nameof(MyCmdClass))</code>
    /// </example>
    public (Storage Storage, Func<TItem, string> PersistenceKey)? Persistence { get; init; }

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
    public SearchConfig? SearchConfig { get; init; } = SearchConfig.Default();

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
    ///     Callback to mutate the view model after initial items load.
    ///     Called once after the first filter completes and items are populated.
    ///     Useful for setting initial selection state (e.g., select second item for MRU palettes).
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