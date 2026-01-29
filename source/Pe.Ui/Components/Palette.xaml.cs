using Pe.Ui.Core;
using Pe.Ui.ViewModels;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Visibility = System.Windows.Visibility;
using Grid = System.Windows.Controls.Grid;
using Button = Wpf.Ui.Controls.Button;
using Application = System.Windows.Application;
using AnimatedScrollViewer = Pe.Ui.Controls.AnimatedScrollViewer;
using Point = System.Windows.Point;


namespace Pe.Ui.Components;

/// <summary>
///     Attached property holder and common close behavior for Palette.
///     Separated from XAML class to support generic usage.
/// </summary>
public static class PaletteAttachedProperties {
    /// <summary>
    ///     Attached property to store ActionBinding for child controls to access
    /// </summary>
    public static readonly DependencyProperty ActionBindingProperty = DependencyProperty.RegisterAttached(
        "ActionBinding",
        typeof(object),
        typeof(PaletteAttachedProperties),
        new PropertyMetadata(null));

    public static void SetActionBinding(DependencyObject element, object value) =>
        element.SetValue(ActionBindingProperty, value);

    public static object GetActionBinding(DependencyObject element) =>
        element.GetValue(ActionBindingProperty);
}

/// <summary>
///     XAML-backed Palette component. This is the ONLY class that should be used
///     with the Palette.xaml file. Generic behavior is handled via composition,
///     NOT inheritance (generic classes cannot inherit from XAML partial classes).
/// </summary>
public sealed partial class Palette : ICloseRequestable, ITitleable {
    private const double DefaultSidebarWidth = 400;
    private const double ExpandedPanelWidth = 600;
    private const double DefaultPaletteWidth = 500;
    private const double DefaultTrayMaxHeight = 200;

    /// <summary>
    ///     Number of visible items in the palette list before scrolling.
    ///     Determines both list MaxHeight and default panel height.
    /// </summary>
    private const int DefaultVisibleItems = 7;

    /// <summary>
    ///     Approximate height per list item in pixels.
    /// </summary>
    private const double ItemHeight = 42;

    /// <summary>
    ///     Height of palette chrome (title bar + search + status bar).
    ///     Used to calculate panel height to match palette.
    /// </summary>
    private const double PaletteChromeHeight = 115;

    private readonly bool _isSearchBoxHidden;
    private readonly List<Button> _tabButtons = [];
    private readonly SolidColorBrush _pinPinnedBrush = new(System.Windows.Media.Color.FromRgb(100, 149, 237));
    private readonly SolidColorBrush _pinHoverBrush = new(System.Windows.Media.Color.FromRgb(126, 179, 255));
    private ActionBinding _actionBinding;
    private ActionMenu _actionMenu;
    private PaletteSidebar _currentSidebar;
    private CustomKeyBindings _customKeyBindings;
    private Func<Task<bool>> _executeItemFunc;
    private FilterBox _filterBox;
    private Func<object> _getSelectedItemFunc;
    private bool _isCtrlPressed;
    private bool _isPanelExpanded;
    private bool _isTrayExpanded;
    private Action _onCtrlReleased;
    private EphemeralWindow _parentWindow;
    private bool _sidebarAutoExpanded;
    private SelectableTextBox _tooltipPanel;
    private double _trayMaxHeight = DefaultTrayMaxHeight;

    public Palette(bool isSearchBoxHidden = false) {
        this.InitializeComponent();

        // Don't add PreviewMouseWheel handler - let events flow naturally
        // The SortableDataTable will handle Shift+Scroll itself
        this.PinIcon.SetResourceReference(ForegroundProperty, "TextFillColorSecondaryBrush");
        if (this.TabScrollViewer != null)
            this.TabScrollViewer.PreviewMouseWheel += this.OnTabBarPreviewMouseWheel;

        if (isSearchBoxHidden) {
            this._isSearchBoxHidden = true;
            this.SearchBoxBorder.Visibility = Visibility.Collapsed;
            // Make the UserControl itself focusable so it can receive keyboard input
            this.Focusable = true;
        }
    }

    public event EventHandler<CloseRequestedEventArgs> CloseRequested;

    /// <summary>
    ///     Sets the title displayed in the palette's title bar.
    /// </summary>
    public void SetTitle(string title) {
        this.TitleText.Text = title;
    }

    /// <summary>
    ///     Initializes the palette with type-specific behavior via composition.
    ///     This must be called after construction to wire up generic-specific logic.
    ///     Internal: Only called by <see cref="PaletteFactory" />.
    /// </summary>
    internal void Initialize<TItem>(
        PaletteViewModel<TItem> viewModel,
        IEnumerable<PaletteAction<TItem>> actions,
        CustomKeyBindings customKeyBindings = null,
        Action onCtrlReleased = null,
        PaletteSidebar paletteSidebar = null
    ) where TItem : class, IPaletteListItem {
        this.DataContext = viewModel;
        this._customKeyBindings = customKeyBindings;

        // Initialize tabs if provided
        if (viewModel.TabCount > 1)
            this.InitializeTabs(viewModel);

        // Create FilterBox if filtering is enabled
        var hasFiltering = viewModel.AvailableFilterValues != null;
        if (hasFiltering) {
            this._filterBox = new FilterBox<PaletteViewModel<TItem>>(
                viewModel,
                [Key.Tab, Key.Escape],
                viewModel.AvailableFilterValues
            ) {
                // Set initial visibility based on current tab
                Visibility = viewModel.CurrentTabHasFiltering
                    ? Visibility.Visible
                    : Visibility.Collapsed
            };
            this._filterBox.ExitRequested += (_, _) => _ = this.SearchTextBox.Focus();

            Grid.SetColumn(this._filterBox, 1);
            _ = this.SearchBoxGrid.Children.Add(this._filterBox);
        }

        // Apply styling to palette content borders
        new BorderSpec()
            .Padding(UiSz.ll, UiSz.ll, UiSz.ll, UiSz.ll)
            .ApplyToBorder(this.SearchBoxBorder);

        new BorderSpec()
            .Border((UiSz.none, UiSz.none, UiSz.l, UiSz.l))
            .Padding(UiSz.l, UiSz.s, UiSz.l, UiSz.s)
            .ApplyToBorder(this.StatusBarBorder);
        this.StatusBarBorder.ClipToBounds = true;

        // Set initial palette width
        this.PaletteBackground.Width = DefaultPaletteWidth;

        // Calculate and set list height based on visible items
        var listHeight = DefaultVisibleItems * ItemHeight;
        var itemListBorder = (Border)this.ItemListView.Parent;
        itemListBorder.MaxHeight = listHeight;

        // Set panel default height to match palette with visible items
        var defaultPanelHeight = PaletteChromeHeight + listHeight;
        this.PanelBackground.MaxHeight = defaultPanelHeight;

        // Wire up expand button
        this.ExpandPanelButton.Click += this.ExpandPanelButton_Click;

        // Wire up tray toggle button
        this.TrayToggleButton.Click += this.TrayToggleButton_Click;

        // Wire up pin button
        this.PinButton.Click += this.PinButton_Click;

        var actionBinding = new ActionBinding<TItem>();
        if (actions != null && actions.Any()) actionBinding.RegisterRange(actions);
        var actionMenu = new ActionMenu<TItem>([Key.Escape, Key.Left]);

        // Store type-erased references for non-generic code paths
        this._actionBinding = actionBinding;
        this._actionMenu = actionMenu;

        // Store ActionBinding as attached property so child controls can access it
        PaletteAttachedProperties.SetActionBinding(this, actionBinding);

        // Create tooltip panel programmatically
        this._tooltipPanel = new SelectableTextBox([Key.Escape, Key.Up, Key.Down, Key.Right]);

        // Capture typed delegates for use in non-generic handlers
        this._getSelectedItemFunc = () => viewModel.SelectedItem;
        this._executeItemFunc = async () => {
            var selectedItem = viewModel.SelectedItem;
            if (selectedItem == null) return false;
            return await this.ExecuteItemTyped(selectedItem, actionBinding, viewModel, Keyboard.Modifiers);
        };

        // Store Ctrl-release callback if provided
        this._onCtrlReleased = onCtrlReleased;

        // Wire up typed event handlers
        this.SetupTypedEventHandlers(viewModel, actionBinding, actionMenu);

        // Wire up event handlers
        this.Loaded += this.UserControl_Loaded;
        this.PreviewKeyDown += this.UserControl_PreviewKeyDown;
        this.PreviewKeyUp += this.UserControl_PreviewKeyUp;

        // Initialize sidebar if provided (always starts collapsed, auto-expands on first selection)
        if (paletteSidebar != null) {
            this._currentSidebar = paletteSidebar;
            this.SidebarContent.Content = paletteSidebar.Content;

            // Update help text to reflect sidebar instead of tooltip
            this.HelpText.Text = "↑↓ Navigate • ← Details • → Actions • Click/Enter Execute • Esc Close";
        }
    }

    private void SetupTypedEventHandlers<TItem>(
        PaletteViewModel<TItem> viewModel,
        ActionBinding<TItem> actionBinding,
        ActionMenu<TItem> actionMenu
    ) where TItem : class, IPaletteListItem {
        this.ItemListView.ItemMouseLeftButtonUp += async (_, e) => {
            if (e.OriginalSource is not FrameworkElement source) return;
            var item = source.DataContext as TItem;
            if (item == null) return;
            viewModel.SelectedItem = item;
            _ = await this.ExecuteItemTyped(item, actionBinding, viewModel, Keyboard.Modifiers);
        };

        this.ItemListView.ItemMouseRightButtonUp += (_, e) => {
            if (e.OriginalSource is not FrameworkElement source) return;
            var item = source.DataContext as TItem;
            if (item == null) return;
            viewModel.SelectedItem = item;

            e.Handled = this.ShowPopover(placementTarget => {
                actionMenu.Actions = actionBinding.GetAllActions().ToList();
                actionMenu.Show(placementTarget, item);
            });
        };

        this.ItemListView.SelectionChanged += (_, _) => {
            if (viewModel.SelectedItem != null) this.ItemListView.ScrollIntoView(viewModel.SelectedItem);
        };

        // Set up action menu handlers
        actionMenu.ExitRequested += (_, _) => this.Focus();
        actionMenu.ActionClicked += async (_, action) => {
            var selectedItem = viewModel.SelectedItem;
            if (selectedItem == null) return;

            viewModel.RecordUsage();

            // If KeepOpenAfterAction is true, execute immediately and keep palette open
            if (!this._parentWindow.IsEphemeral) {
                await actionBinding.ExecuteAsync(action, selectedItem);
                return;
            }

            // Default behavior: close window first, then defer execution
            this.ExecuteDeferred(async () => await actionBinding.ExecuteAsync(action, selectedItem));
        };

        // Set up tooltip popover exit handler
        this._tooltipPanel.ExitRequested += (_, _) => this.Focus();
    }

    /// <summary>
    ///     Expands the sidebar/panel to the specified width.
    ///     Adjusts corner radii so palette has flat right edge when panel is visible.
    /// </summary>
    public void ExpandSidebar(GridLength width) {
        var wasCollapsed = this.SidebarColumn.Width.Value == 0;
        this.SidebarColumn.Width = width;

        if (wasCollapsed) {
            // Both sides get rounded inner corners (smaller radius) for visual separation
            this.PaletteBackground.CornerRadius = new CornerRadius(8, 4, 4, 8);
            this.PanelBackground.CornerRadius = new CornerRadius(4, 8, 8, 4);
        }
    }

    /// <summary>
    ///     Expands the sidebar once (on first call only). Used for auto-expand on first selection.
    /// </summary>
    public void ExpandSidebarOnce(GridLength width) {
        if (this._sidebarAutoExpanded) return;
        this._sidebarAutoExpanded = true;
        this.ExpandSidebar(width);
    }

    /// <summary>
    ///     Collapses the sidebar/panel to width 0.
    ///     Restores full corner radius to palette.
    /// </summary>
    public void CollapseSidebar() {
        var currentWidth = this.SidebarColumn.Width.Value;
        if (currentWidth <= 0) return; // Already collapsed

        this.SidebarColumn.Width = new GridLength(0);

        // Restore full corners to palette when panel is hidden
        this.PaletteBackground.CornerRadius = new CornerRadius(8);
        this._isPanelExpanded = false;
    }

    /// <summary>
    ///     Toggles the sidebar between expanded and collapsed states.
    /// </summary>
    public void ToggleSidebar() {
        if (this._currentSidebar == null) return;

        if (this.SidebarColumn.Width.Value > 0)
            this.CollapseSidebar();
        else
            this.ExpandSidebar(this._currentSidebar.Width);
    }

    /// <summary>
    ///     Expands only the panel width (not the palette).
    ///     Used by the expand button in the panel header.
    /// </summary>
    public void ExpandPanel() {
        if (this._isPanelExpanded) {
            // Collapse back to normal width and height
            var currentWidth = this._currentSidebar?.Width ?? new GridLength(DefaultSidebarWidth);
            this.SidebarColumn.Width = currentWidth;
            this.PanelBackground.MaxHeight = PaletteChromeHeight + (DefaultVisibleItems * ItemHeight);
            this._isPanelExpanded = false;
        } else {
            // Expand to larger width and height
            this.SidebarColumn.Width = new GridLength(ExpandedPanelWidth);
            this.PanelBackground.MaxHeight = PaletteChromeHeight + (DefaultVisibleItems * ItemHeight) + 300; // Extra 300px when expanded
            this._isPanelExpanded = true;
        }
    }

    private void ExpandPanelButton_Click(object sender, RoutedEventArgs e) => this.ExpandPanel();

    /// <summary>
    ///     Sets the tray content and shows the tray toggle button.
    ///     The tray starts collapsed and can be expanded by clicking the toggle button.
    /// </summary>
    /// <param name="content">Content to display in the tray.</param>
    /// <param name="maxHeight">Maximum height when expanded. Defaults to 200px.</param>
    public void SetTrayContent(UIElement content, double maxHeight = DefaultTrayMaxHeight) {
        if (content == null) return;

        this.TrayContent.Content = content;
        this.TrayToggleButton.Visibility = Visibility.Visible;
        this._trayMaxHeight = maxHeight;
    }

    /// <summary>
    ///     Toggles the tray between expanded and collapsed states.
    /// </summary>
    public void ToggleTray() {
        if (this._isTrayExpanded)
            this.CollapseTray();
        else
            this.ExpandTray();
    }

    /// <summary>
    ///     Expands the tray to show its content.
    /// </summary>
    public void ExpandTray() {
        if (this._isTrayExpanded) return;

        this._isTrayExpanded = true;
        this.TrayBorder.MaxHeight = this._trayMaxHeight;
        this.TrayToggleIcon.Symbol = Wpf.Ui.Controls.SymbolRegular.ChevronUp20;
    }

    /// <summary>
    ///     Collapses the tray to hide its content.
    /// </summary>
    public void CollapseTray() {
        if (!this._isTrayExpanded) return;

        this._isTrayExpanded = false;
        this.TrayBorder.MaxHeight = 0;
        this.TrayToggleIcon.Symbol = Wpf.Ui.Controls.SymbolRegular.ChevronDown20;
    }

    private void TrayToggleButton_Click(object sender, RoutedEventArgs e) => this.ToggleTray();

    /// <summary>
    ///     Handles pin button clicks to toggle window pinning (ephemeral behavior).
    /// </summary>
    private void PinButton_Click(object sender, RoutedEventArgs e) {
        if (this._parentWindow == null) return;

        // Toggle ephemeral mode
        this._parentWindow.IsEphemeral = !this._parentWindow.IsEphemeral;
        this.UpdatePinButtonState();
    }

    /// <summary>
    ///     Updates the pin button icon and color based on current pin state.
    /// </summary>
    private void UpdatePinButtonState() {
        if (this._parentWindow == null) return;

        var isPinned = !this._parentWindow.IsEphemeral;
        this.PinButton.MouseEnter -= this.PinButton_MouseEnter;
        this.PinButton.MouseLeave -= this.PinButton_MouseLeave;

        if (isPinned) {
            // Pinned state: filled pin icon in cornflower blue
            this.PinIcon.Symbol = Wpf.Ui.Controls.SymbolRegular.Pin24;
            this.PinIcon.Filled = true;
            this.PinIcon.Foreground = this._pinPinnedBrush;
            this.PinButton.ToolTip = "Unpin window (close when clicking outside)";

            // Hover effect
            this.PinButton.MouseEnter += this.PinButton_MouseEnter;
            this.PinButton.MouseLeave += this.PinButton_MouseLeave;
        } else {
            // Unpinned state: outline pin icon in default color
            this.PinIcon.Symbol = Wpf.Ui.Controls.SymbolRegular.Pin24;
            this.PinIcon.Filled = false;
            this.PinIcon.SetResourceReference(ForegroundProperty, "TextFillColorSecondaryBrush");
            this.PinButton.ToolTip = "Pin window (keep open when clicking outside)";
        }
    }

    /// <summary>
    ///     Sets the parent window reference for coordinating window size with sidebar expansion.
    /// </summary>
    public void SetParentWindow(EphemeralWindow window) {
        this._parentWindow = window;

        // Initialize pin button state based on window's ephemeral setting
        this.UpdatePinButtonState();

        // Propagate to nested palette in sidebar if present
        if (this.SidebarContent.Content is Palette nestedPalette)
            nestedPalette.SetParentWindow(window);
    }

    private async Task<bool> ExecuteItemTyped<TItem>(
        TItem selectedItem,
        ActionBinding<TItem> actionBinding,
        PaletteViewModel<TItem> viewModel,
        ModifierKeys modifiers = ModifierKeys.None,
        Key key = Key.Enter
    ) where TItem : class, IPaletteListItem {
        var action = actionBinding.TryFindAction(selectedItem, key, modifiers);
        if (action == null) return false;

        viewModel.RecordUsage();

        // If KeepOpenAfterAction is true, execute immediately and keep palette open
        if (!this._parentWindow.IsEphemeral) {
            await actionBinding.ExecuteAsync(action, selectedItem);
            return true;
        }

        // Default behavior: close window first, then defer execution to Revit API context
        this.ExecuteDeferred(async () => await actionBinding.ExecuteAsync(action, selectedItem));
        return true;
    }

    /// <summary>
    ///     Closes the window and defers action execution to Revit API context via Window.Closed event.
    /// </summary>
    private void ExecuteDeferred(Func<Task> action) {
        if (this._parentWindow == null) {
            throw new InvalidOperationException(
                "Palette parent window not set. Use PaletteFactory.Create or call SetParentWindow.");
        }

        if (!RevitTaskAccessor.IsConfigured) {
            throw new InvalidOperationException(
                "RevitTaskAccessor not configured. Wire up in App.OnStartup.");
        }

        void ClosedHandler(object sender, EventArgs args) {
            this._parentWindow.Closed -= ClosedHandler;
            _ = RevitTaskAccessor.RunAsync(async () => await action());
        }

        this._parentWindow.Closed += ClosedHandler;
        this.RequestClose();
    }

    private void RequestClose(bool restoreFocus = true) =>
        this.CloseRequested?.Invoke(this, new CloseRequestedEventArgs { RestoreFocus = restoreFocus });

    private void UserControl_Loaded(object sender, RoutedEventArgs e) {
        if (this.DataContext == null) throw new InvalidOperationException("Palette DataContext is null");

        // Check if Ctrl is already pressed (e.g., palette opened with Ctrl+`)
        if (this._onCtrlReleased != null)
            this._isCtrlPressed = (Keyboard.Modifiers & ModifierKeys.Control) != 0;

        // If search box is hidden - focus on the UserControl itself to receive keyboard input
        if (this._isSearchBoxHidden)
            _ = this.Focus();
        else {
            _ = this.SearchTextBox.Focus();
            this.SearchTextBox.SelectAll();
        }

        this.UpdatePinButtonState();
    }

    private void PinButton_MouseEnter(object sender, MouseEventArgs e) {
        if (this._parentWindow == null || this._parentWindow.IsEphemeral) return;
        this.PinIcon.Foreground = this._pinHoverBrush;
    }

    private void PinButton_MouseLeave(object sender, MouseEventArgs e) {
        if (this._parentWindow == null || this._parentWindow.IsEphemeral) return;
        this.PinIcon.Foreground = this._pinPinnedBrush;
    }

    private async void UserControl_PreviewKeyDown(object sender, KeyEventArgs e) {
        // Don't handle keys if focus is in a child RevitHostedUserControl (popover or FilterBox)
        if (Keyboard.FocusedElement is not DependencyObject focusedElement) return;

        // Walk up the visual tree to find if focus is inside another RevitHostedUserControl
        var current = focusedElement;
        while (current != null) {
            if (current is RevitHostedUserControl control && control != this)
                return; // Focus is in a child component, let it handle its own keys
            current = VisualTreeHelper.GetParent(current);
        }

        var modifiers = e.KeyboardDevice.Modifiers;
        var selectedItem = this._getSelectedItemFunc?.Invoke();

        // Track Ctrl key state for Ctrl-release behavior
        if ((modifiers & ModifierKeys.Control) != 0)
            this._isCtrlPressed = true;

        // Handle Ctrl+Left/Right for tab switching
        if ((modifiers & ModifierKeys.Control) != 0 && e.Key == Key.Left) {
            e.Handled = this.SwitchTab(-1);
            return;
        }

        if ((modifiers & ModifierKeys.Control) != 0 && e.Key == Key.Right) {
            e.Handled = this.SwitchTab(1);
            return;
        }

        // Check custom key bindings first (and handle no search box palettes)
        if (this._customKeyBindings != null &&
            this._customKeyBindings.TryGetAction(e.Key, modifiers, out var navAction))
            e.Handled = await this.HandleNavigationAction(navAction);
        else if (e.Key == Key.Escape) {
            this.RequestClose();
            e.Handled = true;
        } else if (e.Key == Key.Enter && selectedItem != null)
            e.Handled = await this._executeItemFunc();
        // No idea why this is needed, but it is and its very counterintuitive. 
        // Without it, when the search box is hidden, ONLY the up/down keys work, and none of the others
        else if (e.Key == Key.Up && modifiers == ModifierKeys.None && this._isSearchBoxHidden)
            e.Handled = await this.HandleNavigationAction(NavigationAction.MoveUp);
        else if (e.Key == Key.Down && modifiers == ModifierKeys.None && this._isSearchBoxHidden)
            e.Handled = await this.HandleNavigationAction(NavigationAction.MoveDown);
        else if (e.Key == Key.Tab && modifiers == ModifierKeys.None) {
            if (this._filterBox != null && this.DataContext is IPaletteViewModel vm && vm.CurrentTabHasFiltering)
                e.Handled = this.ShowPopover(_ => this._filterBox?.Show());
            e.Handled = true;
        } else if (e.Key == Key.Left && selectedItem is IPaletteListItem item) {
            // If sidebar is configured, expand it instead of showing tooltip popup
            if (this._currentSidebar != null) {
                this.ExpandSidebar(this._currentSidebar.Width);
                e.Handled = true;
            } else {
                // Fallback to tooltip for palettes without sidebar
                e.Handled = this.ShowPopover(placementTarget => {
                    var tooltipText = item.GetTextInfo?.Invoke();
                    this._tooltipPanel.Show(placementTarget, tooltipText);
                });
            }
        } else if (e.Key == Key.Right && selectedItem != null) {
            e.Handled = this.ShowPopover(placementTarget => {
                this._actionMenu?.SetActionsUntyped(this._actionBinding?.GetAllActionsUntyped());
                this._actionMenu?.ShowUntyped(placementTarget, selectedItem);
            });
        }
    }

    private void UserControl_PreviewKeyUp(object sender, KeyEventArgs e) {
        // Handle Ctrl-release behavior
        if (this._onCtrlReleased == null || !this._isCtrlPressed) return;

        var modifiers = e.KeyboardDevice.Modifiers;

        // Check if Ctrl was released (no longer in modifiers)
        if ((modifiers & ModifierKeys.Control) != 0) return;

        this._isCtrlPressed = false;

        // Defer the Ctrl-released callback to Revit API context
        var callback = this._onCtrlReleased;
        this.ExecuteDeferred(() => {
            callback();
            return Task.CompletedTask;
        });
    }

    private bool ShowPopover(Action<UIElement> action) {
        var selectedItem = this._getSelectedItemFunc?.Invoke();
        if (selectedItem == null) return false;
        this.ItemListView.UpdateLayout();
        var container = this.ItemListView.ContainerFromItem(selectedItem);
        if (container == null) return false;
        _ = this.Dispatcher.BeginInvoke(() => action(container), DispatcherPriority.Loaded);
        return true;
    }

    /// <summary>
    ///     Handles custom navigation actions triggered by key bindings
    /// </summary>
    private async Task<bool> HandleNavigationAction(NavigationAction action) {
        if (this.DataContext is not IPaletteViewModel viewModel) return false;

        switch (action) {
        case NavigationAction.MoveUp:
            viewModel.MoveSelectionUpCommand.Execute(null);
            return true;

        case NavigationAction.MoveDown:
            viewModel.MoveSelectionDownCommand.Execute(null);
            return true;

        case NavigationAction.Execute:
            return await this._executeItemFunc();

        case NavigationAction.Cancel:
            this.RequestClose();
            return true;

        default:
            return false;
        }
    }

    /// <summary>
    ///     Initializes tab bar buttons and wires up selection.
    /// </summary>
    private void InitializeTabs<TItem>(PaletteViewModel<TItem> viewModel)
        where TItem : class, IPaletteListItem {
        if (viewModel.TabCount == 0) return;

        this.TabBarBorder.Visibility = Visibility.Visible;
        this.TabSwitchHint.Visibility = Visibility.Visible;
        this._tabButtons.Clear();

        for (var i = 0; i < viewModel.TabCount; i++) {
            var tabIndex = i; // Capture for closure
            var button = new Button {
                Content = viewModel.Tabs?[i].Name ?? $"Tab {i + 1}",
                Margin = i == 0 ? new Thickness(0) : new Thickness(4, 0, 0, 0),
                Padding = new Thickness(8, 4, 8, 4),
                Tag = tabIndex,
                Focusable = false, // Keep focus in search box
                FocusVisualStyle = null, // Remove focus rectangle
                BorderThickness = new Thickness(0) // Remove border
            };

            button.Click += (_, _) => {
                viewModel.SelectedTabIndex = tabIndex;
                this.UpdateTabButtonStates(viewModel.SelectedTabIndex);
                this.ScrollSelectedTabIntoView(viewModel.SelectedTabIndex);
            };

            this._tabButtons.Add(button);
            _ = this.TabBarItemsControl.Items.Add(button);
        }

        // Subscribe to tab changes from ViewModel (e.g., from keyboard navigation)
        viewModel.SelectedTabChanged += (_, _) => {
            this.UpdateTabButtonStates(viewModel.SelectedTabIndex);
            this.ScrollSelectedTabIntoView(viewModel.SelectedTabIndex);
            this.UpdateFilterBoxVisibility(viewModel);
        };

        // Set initial state
        this.UpdateTabButtonStates(viewModel.SelectedTabIndex);
        this.ScrollSelectedTabIntoView(viewModel.SelectedTabIndex);
        this.UpdateFilterBoxVisibility(viewModel);
    }

    /// <summary>
    ///     Updates FilterBox visibility based on whether current tab has filtering.
    ///     Also collapses the FilterBox when hiding it to reset its state.
    /// </summary>
    private void UpdateFilterBoxVisibility(IPaletteViewModel viewModel) {
        if (this._filterBox == null) return;

        var shouldBeVisible = viewModel.CurrentTabHasFiltering;
        this._filterBox.Visibility = shouldBeVisible ? Visibility.Visible : Visibility.Collapsed;

        // Collapse the FilterBox when hiding it to reset its expanded state
        if (!shouldBeVisible)
            this._filterBox?.Collapse();
    }

    /// <summary>
    ///     Updates the visual state of tab buttons based on selected index.
    /// </summary>
    private void UpdateTabButtonStates(int selectedIndex) {
        for (var i = 0; i < this._tabButtons.Count; i++) {
            var button = this._tabButtons[i];
            if (i == selectedIndex) {
                // Selected: lighter than palette background
                button.SetResourceReference(BackgroundProperty, "ControlFillColorDefaultBrush");
                button.SetResourceReference(ForegroundProperty, "TextFillColorPrimaryBrush");
                button.FontWeight = FontWeights.SemiBold;
            } else {
                // Unselected: same background as palette to read as buttons
                button.SetResourceReference(BackgroundProperty, "ApplicationBackgroundBrush");
                button.SetResourceReference(ForegroundProperty, "TextFillColorSecondaryBrush");
                button.FontWeight = FontWeights.Normal;
            }
        }
    }

    private void ScrollSelectedTabIntoView(int selectedIndex) {
        if (selectedIndex < 0 || selectedIndex >= this._tabButtons.Count) return;
        var button = this._tabButtons[selectedIndex];
        _ = this.Dispatcher.BeginInvoke(() => this.EnsureTabVisible(button), DispatcherPriority.Loaded);
    }

    private void EnsureTabVisible(Button button) {
        if (this.TabScrollViewer == null) return;

        this.TabScrollViewer.UpdateLayout();
        button.UpdateLayout();

        var transform = button.TransformToAncestor(this.TabScrollViewer);
        var position = transform.Transform(new Point(0, 0));
        var left = position.X;
        var right = left + button.ActualWidth;
        var viewportWidth = this.TabScrollViewer.ViewportWidth;
        if (viewportWidth <= 0) return;

        var target = this.TabScrollViewer.HorizontalOffset;
        if (left < 0)
            target += left;
        else if (right > viewportWidth)
            target += right - viewportWidth;

        target = Math.Max(0, Math.Min(this.TabScrollViewer.ScrollableWidth, target));

        if (this.TabScrollViewer is AnimatedScrollViewer animated)
            animated.TargetHorizontalOffset = target;
        else
            this.TabScrollViewer.ScrollToHorizontalOffset(target);
    }

    private void OnTabBarPreviewMouseWheel(object sender, MouseWheelEventArgs e) {
        if (this.TabScrollViewer == null) return;

        e.Handled = true;
        var scrollAmount = e.Delta * -0.5;
        var target = this.TabScrollViewer.HorizontalOffset + scrollAmount;
        target = Math.Max(0, Math.Min(this.TabScrollViewer.ScrollableWidth, target));

        if (this.TabScrollViewer is AnimatedScrollViewer animated)
            animated.TargetHorizontalOffset = target;
        else
            this.TabScrollViewer.ScrollToHorizontalOffset(target);
    }

    /// <summary>
    ///     Switches to the next or previous tab.
    /// </summary>
    private bool SwitchTab(int direction) {
        if (this.DataContext is not IPaletteViewModel viewModel || !viewModel.HasTabs)
            return false;

        var newIndex = viewModel.SelectedTabIndex + direction;
        if (newIndex < 0)
            newIndex = viewModel.TabCount - 1; // Wrap to last
        else if (newIndex >= viewModel.TabCount)
            newIndex = 0; // Wrap to first

        viewModel.SelectedTabIndex = newIndex;
        this.UpdateTabButtonStates(newIndex);
        return true;
    }
}