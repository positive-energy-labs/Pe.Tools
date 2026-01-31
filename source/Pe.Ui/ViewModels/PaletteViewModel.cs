using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using System.Collections.ObjectModel;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Threading;

namespace Pe.Ui.ViewModels;

/// <summary>
///     Non-generic interface for type-erased access in Palette component
/// </summary>
public interface IPaletteViewModel {
    IRelayCommand MoveSelectionUpCommand { get; }
    IRelayCommand MoveSelectionDownCommand { get; }

    /// <summary>Whether tabs are enabled for this palette (only true for multi-tab)</summary>
    bool HasTabs { get; }

    /// <summary>Number of visible tabs for UI (0 if single-tab)</summary>
    int TabCount { get; }

    /// <summary>Actual number of tab definitions (includes single-tab palettes)</summary>
    int ActualTabCount { get; }

    /// <summary>Currently selected tab index</summary>
    int SelectedTabIndex { get; set; }

    /// <summary>Whether the current tab has filtering enabled</summary>
    bool CurrentTabHasFiltering { get; }

    /// <summary>Event raised when selected tab changes</summary>
    event EventHandler SelectedTabChanged;
}

/// <summary>
///     Generic ViewModel for the SelectablePalette window with optional filtering support
/// </summary>
public partial class PaletteViewModel<TItem> : ObservableObject, IPaletteViewModel
    where TItem : class, IPaletteListItem {
    private readonly Dispatcher _dispatcher;
    private readonly DispatcherTimer _debounceTimer;
    private readonly SearchFilterService<TItem> _searchService;
    private readonly DispatcherTimer _selectionDebounceTimer;
    public readonly IReadOnlyList<TabDefinition<TItem>>? Tabs;
    private CancellationTokenSource? _filterCts;
    private int _filterSequence;

    /// <summary> Per-tab item cache for lazy loading </summary>
    private readonly Dictionary<int, List<TItem>> _tabItemsCache = new();

    /// <summary> Previously selected item for efficient selection updates </summary>
    private TItem? _previousSelectedItem;

    /// <summary> Tracks whether this is the initial load (for higher priority rendering) </summary>
    private bool _isInitialLoad = true;

    /// <summary> Callback to run after initial items load (set via ViewModelMutator) </summary>
    private Action? _onInitialLoadComplete;

    /// <summary> Current search text </summary>
    [ObservableProperty] private string _searchText = string.Empty;

    private string _selectedFilterValue = string.Empty;

    /// <summary> Currently selected index in the filtered list </summary>
    [ObservableProperty] private int _selectedIndex = -1;

    /// <summary> Currently selected item </summary>
    [ObservableProperty] private TItem? _selectedItem;

    private int _selectedTabIndex;

    private const int SelectionDebounceMs = 300;

    public PaletteViewModel(
        SearchFilterService<TItem> searchService,
        IReadOnlyList<TabDefinition<TItem>> tabs,
        int defaultTabIndex = 0
    ) {
        this._dispatcher = Dispatcher.CurrentDispatcher;
        this._searchService = searchService;
        this.Tabs = tabs;
        var tabCount = tabs?.Count ?? 0;
        this._selectedTabIndex = tabCount > 1 ? Math.Clamp(defaultTabIndex, 0, tabCount - 1) : 0;

        // Initialize debounce timer for search (100ms delay)
        this._debounceTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(200) };
        this._debounceTimer.Tick += (_, _) => {
            this._debounceTimer.Stop();
            this.FilterItems();
        };

        // Initialize debounce timer for selection changes (configurable, default 300ms)
        this._selectionDebounceTimer =
            new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(SelectionDebounceMs) };
        this._selectionDebounceTimer.Tick += (_, _) => {
            this._selectionDebounceTimer.Stop();
            this.SelectionChangedDebounced?.Invoke(this, EventArgs.Empty);
        };

        this._searchService.LoadUsageData();

        this.FilteredItems = new ObservableCollection<TItem>();

        // Initialize AvailableFilterValues collection (will be populated per-tab or globally)
        var hasAnyFilterKeySelectors = this.Tabs?.Any(t => t.FilterKeySelector != null) == true;
        if (hasAnyFilterKeySelectors)
            this.AvailableFilterValues = new ObservableCollection<string>();

        // Populate initial filter values
        this.UpdateAvailableFilterValuesForCurrentTab();

        this.FilterItems();

        if (this.FilteredItems.Count > 0)
            this.SelectedIndex = 0;
    }

    /// <summary>
    ///     Sets a callback to run once after the initial items load completes.
    ///     Used for post-load mutations like setting initial selection.
    /// </summary>
    public void SetInitialLoadCallback(Action callback) => this._onInitialLoadComplete = callback;

    /// <summary> Filtered list of items based on search text and optional filter </summary>
    public ObservableCollection<TItem> FilteredItems { get; }

    /// <summary> Available filter values (only populated if filtering is enabled) </summary>
    public ObservableCollection<string> AvailableFilterValues { get; }

    /// <summary> Whether filtering is enabled for this palette </summary>
    public bool IsFilteringEnabled => this.CurrentTabHasFiltering;

    /// <summary> Currently selected filter value </summary>
    public string SelectedFilterValue {
        get => this._selectedFilterValue;
        set {
            if (this.SetProperty(ref this._selectedFilterValue, value))
                this.FilterItems();
        }
    }

    /// <summary> Whether the tab bar UI should be shown (only for multi-tab palettes) </summary>
    public bool HasTabs => this.Tabs is { Count: > 1 };

    /// <summary>
    ///     Number of visible tabs for UI purposes (0 if single-tab).
    ///     Use <see cref="ActualTabCount"/> for action binding iteration.
    /// </summary>
    public int TabCount => this.HasTabs ? this.Tabs?.Count ?? 0 : 0;

    /// <summary>
    ///     Actual number of tab definitions (includes single-tab palettes).
    ///     Used for action binding setup and item loading.
    /// </summary>
    public int ActualTabCount => this.Tabs?.Count ?? 0;

    /// <summary> Whether the current tab has filtering enabled </summary>
    public bool CurrentTabHasFiltering => this.GetActiveTab(this._selectedTabIndex)?.FilterKeySelector != null;

    /// <summary> Currently selected tab index </summary>
    public int SelectedTabIndex {
        get => this._selectedTabIndex;
        set {
            if (!this.HasTabs) return;
            var clampedValue = Math.Clamp(value, 0, this.TabCount - 1);
            if (this.SetProperty(ref this._selectedTabIndex, clampedValue)) {
                // Clear filter when switching tabs
                this._selectedFilterValue = string.Empty;
                this.OnPropertyChanged(nameof(this.SelectedFilterValue));

                // Clear search cache (will be rebuilt when tab items are lazy loaded)
                this._searchService.BuildSearchCache(new List<TItem>());

                // Recompute available filter values for new tab
                this.UpdateAvailableFilterValuesForCurrentTab();
                this.FilterItems();
                this.SelectedTabChanged?.Invoke(this, EventArgs.Empty);
            }
        }
    }

    /// <summary> Event raised when selected tab changes </summary>
    public event EventHandler SelectedTabChanged;

    /// <summary> Event raised when filtered items collection changes </summary>
    public event EventHandler FilteredItemsChanged;

    /// <summary> Event raised when selection changes after debounce delay </summary>
    public event EventHandler SelectionChangedDebounced;

    [RelayCommand]
    private void MoveSelectionUp() {
        if (this.FilteredItems.Count == 0) return;

        if (this.SelectedIndex > 0)
            this.SelectedIndex--;
        else {
            // Wrap to bottom
            this.SelectedIndex = this.FilteredItems.Count - 1;
        }
    }

    [RelayCommand]
    private void MoveSelectionDown() {
        if (this.FilteredItems.Count == 0) return;

        if (this.SelectedIndex < this.FilteredItems.Count - 1)
            this.SelectedIndex++;
        else {
            // Wrap to top
            this.SelectedIndex = 0;
        }
    }

    [RelayCommand]
    private void ClearSearch() => this.SearchText = string.Empty;

    /// <summary>
    ///     Updates the available filter values based on the current tab's filter key selector.
    /// </summary>
    private void UpdateAvailableFilterValuesForCurrentTab() {
        if (this.AvailableFilterValues == null) return;

        this.AvailableFilterValues.Clear();

        var activeTab = this.GetActiveTab(this._selectedTabIndex);
        var filterKeySelector = activeTab?.FilterKeySelector;

        if (filterKeySelector == null) return;

        // Get items for current tab (lazy loaded or filtered)
        var tabItems = this.GetItemsForCurrentTab();

        // Extract unique filter values
        var values = tabItems
            .Select(filterKeySelector)
            .Where(key => !string.IsNullOrEmpty(key))
            .Distinct()
            .OrderBy(key => key);

        foreach (var value in values)
            this.AvailableFilterValues.Add(value);
    }

    private TabDefinition<TItem>? GetActiveTab(int selectedIndex) =>
        GetActiveTab(this.Tabs, selectedIndex);

    private static TabDefinition<TItem>? GetActiveTab(
        IReadOnlyList<TabDefinition<TItem>>? tabs,
        int selectedIndex
    ) {
        if (tabs is not { Count: > 0 }) return null;

        var index = Math.Clamp(selectedIndex, 0, tabs.Count - 1);
        return tabs[index];
    }

    /// <summary>
    ///     Gets items for the current tab using lazy loading with caching.
    ///     Loads items from ItemProvider on first access and caches them.
    /// </summary>
    private List<TItem> GetItemsForCurrentTab() {
        var tab = GetActiveTab(this.Tabs, this._selectedTabIndex);

        // Use ItemProvider with caching (all palettes now use lazy loading)
        if (tab?.ItemProvider != null) {
            // Check cache first
            if (this._tabItemsCache.TryGetValue(this._selectedTabIndex, out var cached))
                return cached;

            // Load items from provider
            var items = tab.ItemProvider().ToList();
            this._tabItemsCache[this._selectedTabIndex] = items;

            // Build search cache for this tab only
            this._searchService.BuildSearchCache(items);

            return items;
        }

        // Fallback: empty list if no ItemProvider (should not happen with current API)
        return new List<TItem>();
    }

    /// <summary>
    ///     Filters items using 3-stage filtering: Tab -> Category Filter -> Search
    /// </summary>
    private void FilterItems() {
        this._filterCts?.Cancel();
        this._filterCts?.Dispose();
        this._filterCts = new CancellationTokenSource();

        var token = this._filterCts.Token;
        var sequence = Interlocked.Increment(ref this._filterSequence);

        var selectedTabIndex = this._selectedTabIndex;
        var selectedFilterValue = this.SelectedFilterValue;
        var searchText = this.SearchText;
        var tabs = this.Tabs;

        _ = Task.Run(() => {
            if (token.IsCancellationRequested) return;

            // Get items for current tab (always lazy loaded via ItemProvider)
            // Must get items on UI thread since it accesses cache
            var items = this._dispatcher.Invoke(() => this.GetItemsForCurrentTab());
            var activeTab = GetActiveTab(tabs, selectedTabIndex);

            // Stage 2: Category filter (use current tab's filter key selector)
            var currentFilterKeySelector = activeTab?.FilterKeySelector;

            if (currentFilterKeySelector != null && !string.IsNullOrEmpty(selectedFilterValue))
                items = items.Where(item => currentFilterKeySelector(item) == selectedFilterValue).ToList();

            // Stage 3: Search filter
            var filtered = this._searchService.Filter(searchText, items);

            if (token.IsCancellationRequested) return;

            // Use higher priority for initial load (Render), lower for subsequent filter updates (Background)
            // This ensures list items appear quickly on first open, while keeping UI responsive during typing
            var priority = this._isInitialLoad ? DispatcherPriority.Render : DispatcherPriority.Background;

            this._dispatcher.Invoke(() => {
                if (token.IsCancellationRequested) return;
                if (sequence != this._filterSequence) return;

                // Use efficient differential update instead of Clear/Add
                this.UpdateCollectionEfficiently(this.FilteredItems, filtered);

                // Reset selection to first item
                this.SelectedIndex = this.FilteredItems.Count > 0 ? 0 : -1;

                // Run initial load callback if set (e.g., to select a different item)
                if (this._isInitialLoad && this._onInitialLoadComplete != null) {
                    this._onInitialLoadComplete.Invoke();
                    this._onInitialLoadComplete = null; // Clear after use
                }

                // Notify that filtered items have changed
                this.FilteredItemsChanged?.Invoke(this, EventArgs.Empty);

                // Mark initial load as complete
                this._isInitialLoad = false;
            }, priority);
        }, token);
    }

    /// <summary>
    ///     Efficiently updates an ObservableCollection to match a target list.
    ///     Uses differential updates to minimize CollectionChanged notifications.
    /// </summary>
    private void UpdateCollectionEfficiently(ObservableCollection<TItem> target, List<TItem> source) {
        var sourceSet = new HashSet<TItem>(source);

        // Remove items not in source (iterate backwards to avoid index shifting)
        for (var i = target.Count - 1; i >= 0; i--) {
            if (!sourceSet.Contains(target[i]))
                target.RemoveAt(i);
        }

        // Add/reorder items from source
        for (var i = 0; i < source.Count; i++) {
            if (i >= target.Count) {
                // Need to add new item
                target.Add(source[i]);
            } else if (!EqualityComparer<TItem>.Default.Equals(target[i], source[i])) {
                // Item at this position is different, update it
                target[i] = source[i];
            }
            // else: item is already in the correct position, no action needed
        }
    }

    /// <summary>
    ///     Records usage of the selected item
    /// </summary>
    public void RecordUsage() {
        if (this.SelectedItem != null)
            this._searchService.RecordUsage(this.SelectedItem);
    }
#nullable disable

    #region Property Change Handlers

    partial void OnSearchTextChanged(string value) {
        // If search is cleared, filter immediately (no debounce)
        if (string.IsNullOrWhiteSpace(value)) {
            this._debounceTimer.Stop();
            this.FilterItems();
            return;
        }

        // Otherwise, restart debounce timer
        this._debounceTimer.Stop();
        this._debounceTimer.Start();
    }

    partial void OnSelectedItemChanged(TItem value) {
        this._previousSelectedItem = value;

        // Restart selection debounce timer
        this._selectionDebounceTimer.Stop();
        this._selectionDebounceTimer.Start();
    }

    partial void OnSelectedIndexChanged(int value) {
        // Update selected item based on index
        if (value >= 0 && value < this.FilteredItems.Count)
            this.SelectedItem = this.FilteredItems[value];
        else
            this.SelectedItem = default;
    }

    #endregion
}