using Pe.Ui.Core;
using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace Pe.Ui.Components;

/// <summary>
///     Non-generic base class for FilterBox.xaml
///     This matches the XAML x:Class declaration and provides access to XAML-defined controls
/// </summary>
public partial class FilterBox : IPopoverExit {
    private Storyboard? _collapseStoryboard;
    private Storyboard? _expandStoryboard;
    private bool _isExpanded;

    protected FilterBox(List<Key> closeKeys) {
        this.CloseKeys = closeKeys.Count == 0 ?  [Key.Escape]:  closeKeys;
        // Note: Base class RevitHostedUserControl loads WpfUiResources before this runs
        this.InitializeComponent();
        
        this.Loaded += this.FilterBox_Loaded;
    }

    public event EventHandler? ExitRequested;
    public IEnumerable<Key> CloseKeys { get; set; }

    public void RequestExit() => this.ExitRequested?.Invoke(this, EventArgs.Empty);

    public bool ShouldCloseOnKey(Key key) => this.CloseKeys.Contains(key);

    private void FilterBox_Loaded(object sender, RoutedEventArgs e) => this.CreateStoryboards();

    private void CreateStoryboards() {
        // Create ExpandStoryboard
        this._expandStoryboard = new Storyboard();
        var expandWidthAnimation = new DoubleAnimation {
            To = 150.0,
            Duration = new Duration(TimeSpan.FromSeconds(0.2)),
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
        };
        Storyboard.SetTarget(expandWidthAnimation, this.FilterAutoSuggestBox);
        Storyboard.SetTargetProperty(expandWidthAnimation, new PropertyPath("Width"));
        this._expandStoryboard.Children.Add(expandWidthAnimation);

        var expandOpacityAnimation = new DoubleAnimation {
            To = 1.0,
            Duration = new Duration(TimeSpan.FromSeconds(0.15)),
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
        };
        Storyboard.SetTarget(expandOpacityAnimation, this.FilterAutoSuggestBox);
        Storyboard.SetTargetProperty(expandOpacityAnimation, new PropertyPath("Opacity"));
        this._expandStoryboard.Children.Add(expandOpacityAnimation);

        // Create CollapseStoryboard
        this._collapseStoryboard = new Storyboard();
        var collapseWidthAnimation = new DoubleAnimation {
            To = 0.0,
            Duration = new Duration(TimeSpan.FromSeconds(0.15)),
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn }
        };
        Storyboard.SetTarget(collapseWidthAnimation, this.FilterAutoSuggestBox);
        Storyboard.SetTargetProperty(collapseWidthAnimation, new PropertyPath("Width"));
        this._collapseStoryboard.Children.Add(collapseWidthAnimation);

        var collapseOpacityAnimation = new DoubleAnimation {
            To = 0.0,
            Duration = new Duration(TimeSpan.FromSeconds(0.1)),
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn }
        };
        Storyboard.SetTarget(collapseOpacityAnimation, this.FilterAutoSuggestBox);
        Storyboard.SetTargetProperty(collapseOpacityAnimation, new PropertyPath("Opacity"));
        this._collapseStoryboard.Children.Add(collapseOpacityAnimation);
    }

    /// <summary>
    ///     Shows the FilterBox (expands and focuses)
    /// </summary>
    public void Show() => this.Expand();


    protected void IconBorder_MouseLeftButtonDown(object sender, MouseButtonEventArgs e) =>
        this.FilterAutoSuggestBox.Focus();

    protected void ClearFilterBorder_MouseLeftButtonDown(object sender, MouseButtonEventArgs e) {
        this.OnClearFilterRequested();
        e.Handled = true;
    }

    protected virtual void OnClearFilterRequested() {
        // Override in derived class to clear filter
    }

    protected void FilterAutoSuggestBox_GotFocus(object sender, RoutedEventArgs e) {
        if (this._isExpanded) return;
        
        this.Expand();
        this.FilterAutoSuggestBox.Text = string.Empty;
        e.Handled = true;
    }

    protected void FilterAutoSuggestBox_LostFocus(object sender, RoutedEventArgs e) {
        var newFocus = Keyboard.FocusedElement;
        var isListView = newFocus is ListView;
        var isListViewItem = newFocus is ListViewItem;

        if (isListView || isListViewItem) return;

        // Clear text and collapse when unfocused (but not when navigating to suggestions)
        this.FilterAutoSuggestBox.Text = string.Empty;
        e.Handled = true;
        this.Collapse();
    }

    protected void Expand() {
        if (this._isExpanded) return;
        this._isExpanded = true;

        this._expandStoryboard?.Begin();

        // Focus the AutoSuggestBox after expansion starts
        _ = this.Dispatcher.BeginInvoke(new Action(this.FilterAutoSuggestBox.Focus),
            DispatcherPriority.Input);
    }

    public void Collapse() {
        if (!this._isExpanded) return;
        this._isExpanded = false;

        this._collapseStoryboard?.Begin();
    }
}

/// <summary>
///     Generic FilterBox implementation with typed ViewModel support
///     Provides filtering functionality with AutoSuggestBox
/// </summary>
public class FilterBox<TViewModel> : FilterBox where TViewModel : class {
    private readonly ObservableCollection<string>? _availableFilterValues;
    private readonly TViewModel _viewModel;

    public FilterBox(TViewModel viewModel,
        List<Key> closeKeys,
        ObservableCollection<string>? availableFilterValues = null) : base(closeKeys) {
        this._viewModel = viewModel;
        this._availableFilterValues = availableFilterValues;
        this.DataContext = viewModel;
        this.FilterAutoSuggestBox.SelectionChanged += this.FilterAutoSuggestBox_SelectionChanged;
        this.FilterAutoSuggestBox.PreviewKeyDown += this.FilterAutoSuggestBox_PreviewKeyDown;
    }


    protected override void OnClearFilterRequested() => this.UpdateSelectedFilterValue(null);

    /// <summary>
    ///     This event fires EVERY time a list item is focused by the keyboard. update view model here.
    /// </summary>
    private void FilterAutoSuggestBox_SelectionChanged(object sender, SelectionChangedEventArgs e) {
        if (e.AddedItems.Count > 0) this.UpdateSelectedFilterValue(e.AddedItems[0]?.ToString());
        e.Handled = true;
    }

    /// <summary>
    ///     Handle escaping and unfocusing the FilterBox here.
    /// </summary>
    private void FilterAutoSuggestBox_PreviewKeyDown(object sender, KeyEventArgs e) {
        // Check if this key should close the popover
        if (this.ShouldCloseOnKey(e.Key)) {
            this.UpdateSelectedFilterValue(null);
            this.FilterAutoSuggestBox.Text = string.Empty;
            e.Handled = true;
            this.RequestExit();
        } else if (e.Key is Key.Enter) {
            this.UpdateSelectedFilterValue(this.FilterAutoSuggestBox.Text);
            this.FilterAutoSuggestBox.Text = string.Empty;
            e.Handled = true;
            this.RequestExit();
        }
    }

    private void UpdateSelectedFilterValue(string? value) {
        var selectedValueProperty = typeof(TViewModel).GetProperty("SelectedFilterValue");
        var currentValue = selectedValueProperty?.GetValue(this._viewModel) as string;
        if (currentValue == value) return;

        if (string.IsNullOrEmpty(value)) {
            // enable clearing the value
            selectedValueProperty?.SetValue(this._viewModel, value);
            return;
        }

        // Validate that the value exists in available filter values
        if (this._availableFilterValues == null) return;
        if (!this._availableFilterValues.Contains(value)) return;
        selectedValueProperty?.SetValue(this._viewModel, value);
    }
}