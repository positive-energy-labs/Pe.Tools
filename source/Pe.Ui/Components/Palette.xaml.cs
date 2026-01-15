using Pe.Ui.Core;
using Pe.Ui.ViewModels;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Wpf.Ui.Controls;
using Visibility = System.Windows.Visibility;
using Grid = System.Windows.Controls.Grid;
using Button = Wpf.Ui.Controls.Button;


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
public sealed partial class Palette : ICloseRequestable {
    private const double DefaultSidebarWidth = 400;

    private readonly bool _isSearchBoxHidden;
    private readonly List<Button> _tabButtons = [];
    private ActionBinding _actionBinding;
    private ActionMenu _actionMenu;
    private PaletteSidebar _currentSidebar;
    private CustomKeyBindings _customKeyBindings;
    private Func<Task<bool>> _executeItemFunc;
    private FilterBox _filterBox;
    private Func<object> _getSelectedItemFunc;
    private bool _isCtrlPressed;
    private bool _keepOpenAfterAction;
    private Action _onCtrlReleased;
    private EphemeralWindow _parentWindow;
    private bool _sidebarAutoExpanded;
    private SelectableTextBox _tooltipPanel;

    public Palette(bool isSearchBoxHidden = false) {
        this.InitializeComponent();
        if (isSearchBoxHidden) {
            this._isSearchBoxHidden = true;
            this.SearchBoxBorder.Visibility = Visibility.Collapsed;
            // Make the UserControl itself focusable so it can receive keyboard input
            this.Focusable = true;
        }
    }

    public event EventHandler<CloseRequestedEventArgs> CloseRequested;

    /// <summary>
    ///     Initializes the palette with type-specific behavior via composition.
    ///     This must be called after construction to wire up generic-specific logic.
    /// </summary>
    public void Initialize<TItem>(
        PaletteViewModel<TItem> viewModel,
        IEnumerable<PaletteAction<TItem>> actions,
        CustomKeyBindings customKeyBindings = null,
        Action onCtrlReleased = null,
        PaletteSidebar paletteSidebar = null,
        bool keepOpenAfterAction = false,
        List<string> tabNames = null
    ) where TItem : class, IPaletteListItem {
        this.DataContext = viewModel;
        this._customKeyBindings = customKeyBindings;
        this._keepOpenAfterAction = keepOpenAfterAction;

        // Initialize tabs if provided
        if (tabNames is { Count: > 0 })
            this.InitializeTabs(viewModel, tabNames); 

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

        new BorderSpec()
            .Border()
            .ApplyToBorder(this.MainBorder);
        this.MainBorder.ClipToBounds = true;

        new BorderSpec()
            .Border((UiSz.l, UiSz.l, UiSz.none, UiSz.none))
            .Padding(UiSz.ll, UiSz.ll, UiSz.ll, UiSz.ll)
            .ApplyToBorder(this.SearchBoxBorder);

        new BorderSpec()
            .Border((UiSz.none, UiSz.none, UiSz.l, UiSz.l))
            .Padding(UiSz.l, UiSz.s, UiSz.l, UiSz.s)
            .ApplyToBorder(this.StatusBarBorder);
        this.StatusBarBorder.ClipToBounds = true;

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

            // NextPalette actions show content in sidebar
            if (ActionBinding<TItem>.IsNextPaletteAction(action)) {
                this.ShowNextPaletteInSidebar(action, selectedItem);
                return;
            }

            // If KeepOpenAfterAction is true, execute immediately and keep palette open
            if (this._keepOpenAfterAction) {
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
    ///     Expands the sidebar to the specified width.
    ///     Only expands the parent window when transitioning from collapsed to expanded.
    ///     Public for future "expand panel" button feature.
    /// </summary>
    public void ExpandSidebar(GridLength width) {
        var wasCollapsed = this.SidebarColumn.Width.Value == 0;
        this.SidebarColumn.Width = width;

        // Only expand window when transitioning from collapsed to expanded
        if (wasCollapsed)
            this._parentWindow?.ExpandWidth(width.Value);
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
    ///     Collapses the sidebar to width 0.
    ///     Only collapses the parent window when transitioning from expanded to collapsed.
    ///     Public for future "expand panel" button feature.
    /// </summary>
    public void CollapseSidebar() {
        var currentWidth = this.SidebarColumn.Width.Value;
        if (currentWidth <= 0) return; // Already collapsed

        this.SidebarColumn.Width = new GridLength(0);
        this._parentWindow?.CollapseWidth(currentWidth);
    }

    /// <summary>
    ///     Toggles the sidebar between expanded and collapsed states.
    ///     Public for future "expand panel" button feature.
    /// </summary>
    public void ToggleSidebar() {
        if (this._currentSidebar == null) return;

        if (this.SidebarColumn.Width.Value > 0)
            this.CollapseSidebar();
        else
            this.ExpandSidebar(this._currentSidebar.Width);
    }

    /// <summary>
    ///     Sets the parent window reference for coordinating window size with sidebar expansion.
    /// </summary>
    public void SetParentWindow(EphemeralWindow window) {
        this._parentWindow = window;

        // Propagate to nested palette in sidebar if present
        if (this.SidebarContent.Content is Palette nestedPalette)
            nestedPalette.SetParentWindow(window);
    }

    /// <summary>
    ///     Shows the next palette content in the sidebar.
    /// </summary>
    private void ShowNextPaletteInSidebar<TItem>(PaletteAction<TItem> action, TItem item)
        where TItem : class, IPaletteListItem {
        var nextContent = action.NextPalette(item);

        // Propagate parent window to nested palettes so they can defer execution
        if (nextContent is Palette nestedPalette && this._parentWindow != null)
            nestedPalette.SetParentWindow(this._parentWindow);

        this.SidebarContent.Content = nextContent;

        var width = this._currentSidebar?.Width ?? new GridLength(DefaultSidebarWidth);
        this.ExpandSidebar(width);
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

        // NextPalette actions show content in sidebar
        if (ActionBinding<TItem>.IsNextPaletteAction(action)) {
            this.ShowNextPaletteInSidebar(action, selectedItem);
            return true;
        }

        // If KeepOpenAfterAction is true, execute immediately and keep palette open
        if (this._keepOpenAfterAction) {
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
    private void InitializeTabs<TItem>(PaletteViewModel<TItem> viewModel, List<string> tabNames)
        where TItem : class, IPaletteListItem {
        if (tabNames == null || tabNames.Count == 0) return;

        this.TabBarBorder.Visibility = Visibility.Visible;
        this._tabButtons.Clear();

        for (var i = 0; i < tabNames.Count; i++) {
            var tabIndex = i; // Capture for closure
            var button = new Button {
                Content = tabNames[i],
                Margin = new Thickness(0, 0, 4, 0),
                Padding = new Thickness(8, 4, 8, 4),
                Tag = tabIndex,
                Focusable = false, // Keep focus in search box
                FocusVisualStyle = null, // Remove focus rectangle
                BorderThickness = new Thickness(0) // Remove border
            };

            button.Click += (_, _) => {
                viewModel.SelectedTabIndex = tabIndex;
                this.UpdateTabButtonStates(viewModel.SelectedTabIndex);
            };

            this._tabButtons.Add(button);
            _ = this.TabBarItemsControl.Items.Add(button);
        }

        // Subscribe to tab changes from ViewModel (e.g., from keyboard navigation)
        viewModel.SelectedTabChanged += (_, _) => {
            this.UpdateTabButtonStates(viewModel.SelectedTabIndex);
            this.UpdateFilterBoxVisibility(viewModel);
        };

        // Set initial state
        this.UpdateTabButtonStates(viewModel.SelectedTabIndex);
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
            (this._filterBox as FilterBox)?.Collapse();
    }

    /// <summary>
    ///     Updates the visual state of tab buttons based on selected index.
    /// </summary>
    private void UpdateTabButtonStates(int selectedIndex) {
        for (var i = 0; i < this._tabButtons.Count; i++) {
            var button = this._tabButtons[i];
            if (i == selectedIndex) {
                // Selected: subtle accent background with primary text
                button.SetResourceReference(Button.BackgroundProperty, "ControlFillColorDefaultBrush");
                button.SetResourceReference(Button.ForegroundProperty, "TextFillColorPrimaryBrush");
            } else {
                // Unselected: transparent background with secondary text
                button.Background = Brushes.Transparent;
                button.SetResourceReference(Button.ForegroundProperty, "TextFillColorSecondaryBrush");
            }
        }
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