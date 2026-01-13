using Pe.Ui.Core;
using System.Collections;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Threading;
using ContextMenu = System.Windows.Controls.ContextMenu;
using MenuItem = Wpf.Ui.Controls.MenuItem;

namespace Pe.Ui.Components;

/// <summary>
///     Non-generic base class for ActionMenu
///     Provides popover functionality and resource loading
/// </summary>
public abstract class ActionMenu : RevitHostedUserControl, IPopoverExit {
    protected IEnumerable? _actions;

    protected ContextMenu? Menu { get; set; }
    public event EventHandler? ExitRequested; 
    public IEnumerable<Key> CloseKeys { get; set; } = Array.Empty<Key>();

    public virtual void RequestExit() {
        if (this.Menu != null) this.Menu.IsOpen = false;
        this.OnExitRequested();
    }

    public bool ShouldCloseOnKey(Key key) => this.CloseKeys.Contains(key);

    protected void OnExitRequested() => this.ExitRequested?.Invoke(this, EventArgs.Empty);

    /// <summary>
    ///     Type-erased Show method for use when the generic type is not available
    /// </summary>
    public abstract void ShowUntyped(UIElement placementTarget, object item);

    /// <summary>
    ///     Sets the actions list (type-erased for non-generic access)
    /// </summary>
    public abstract void SetActionsUntyped(IEnumerable actions);
}

/// <summary>
///     Generic ActionMenu implementation with typed item support
///     Context menu component for displaying available actions with arrow key navigation
/// </summary>
public class ActionMenu<TItem> : ActionMenu where TItem : class, IPaletteListItem {
    private TItem? _currentItem;

    public ActionMenu(List<Key> closeKeys) {
        // Call base constructor to load XAML resources
        this.Menu = new ContextMenu { StaysOpen = false, Placement = PlacementMode.Right };

        this.CloseKeys = closeKeys.Count == 0 ? [Key.Escape] : closeKeys;

        this.Menu.Closed += (_, _) => this.OnExitRequested();
        this.Menu.PreviewKeyDown += this.ContextMenu_PreviewKeyDown;
    }

    public IEnumerable<PaletteAction<TItem>>? Actions {
        get => this._actions as IEnumerable<PaletteAction<TItem>>;
        set {
            this._actions = value;
            this.RebuildMenu();
        }
    }

    public event EventHandler<PaletteAction<TItem>>? ActionClicked;

    /// <inheritdoc />
    public override void ShowUntyped(UIElement placementTarget, object item) {
        if (item is TItem typedItem)
            this.Show(placementTarget, typedItem);
    }

    /// <inheritdoc />
    public override void SetActionsUntyped(IEnumerable actions) {
        if (actions is IEnumerable<PaletteAction<TItem>> typedActions)
            this.Actions = typedActions;
    }

    /// <summary>
    ///     Shows the action menu positioned to the right of the target element
    /// </summary>
    public void Show(UIElement placementTarget, TItem? currentItem) {
        if (this._actions == null || !this._actions.Cast<object>().Any() || this.Menu == null) return;

        this._currentItem = currentItem;
        this.RebuildMenu();

        this.Menu.PlacementTarget = placementTarget;
        this.Menu.IsOpen = true;

        _ = this.Menu.Dispatcher.BeginInvoke(new Action(() => {
            var firstEnabledItem = this.Menu!.Items.OfType<MenuItem>()
                .FirstOrDefault(mi => mi.IsEnabled);
            if (firstEnabledItem != null)
                _ = firstEnabledItem.Focus();
        }), DispatcherPriority.Loaded);
    }

    /// <summary>
    ///     Hides the action menu
    /// </summary>
    public void Hide() {
        if (this.Menu != null) this.Menu.IsOpen = false;
    }

    private void RebuildMenu() {
        if (this.Menu == null) return;

        this.Menu.Items.Clear();

        if (this._actions == null) return;

        var actionsList = this._actions.Cast<PaletteAction<TItem>>().ToList();

        for (var i = 0; i < actionsList.Count; i++) {
            var paletteAction = actionsList[i];
            var canExecute = this._currentItem == null || paletteAction.CanExecute(this._currentItem);
            var shortcutText = this.FormatShortcut(paletteAction);

            var menuItem = new MenuItem {
                Header = paletteAction.Name,
                InputGestureText = shortcutText,
                IsEnabled = canExecute,
                FocusVisualStyle = null // Remove focus rectangle for clean animation
            };

            menuItem.Click += (_, _) => {
                this.ActionClicked?.Invoke(this, paletteAction);
                this.Hide();
            };

            _ = this.Menu.Items.Add(menuItem);

            // Add separator between items (but not after the last item)
            if (i < actionsList.Count - 1) {
                var separator = new Separator();
                _ = this.Menu.Items.Add(separator);
            }
        }
    }

    private void ContextMenu_PreviewKeyDown(object sender, KeyEventArgs e) {
        if (this.ShouldCloseOnKey(e.Key)) {
            e.Handled = true;
            this.RequestExit();
        }
    }

    private string FormatShortcut(PaletteAction<TItem> action) {
        var parts = new List<string>();

        if (action.Modifiers != ModifierKeys.None) {
            if ((action.Modifiers & ModifierKeys.Control) != 0) parts.Add("Ctrl");
            if ((action.Modifiers & ModifierKeys.Shift) != 0) parts.Add("Shift");
            if ((action.Modifiers & ModifierKeys.Alt) != 0) parts.Add("Alt");
        }

        if (action.Key.HasValue) {
            var keyStr = action.Key.Value.ToString();
            if (keyStr == "Return") keyStr = "Enter";
            parts.Add(keyStr);
        }

        return parts.Count > 0 ? string.Join("+", parts) : string.Empty;
    }
}