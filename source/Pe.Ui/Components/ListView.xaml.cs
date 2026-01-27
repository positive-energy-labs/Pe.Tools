using Pe.Ui.Controls;
using Pe.Ui.Core;
using System.Collections;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Point = System.Windows.Point;
using WpfUiListViewItem = Wpf.Ui.Controls.ListViewItem;


namespace Pe.Ui.Components;

public partial class ListView {
    public static readonly DependencyProperty ItemsSourceProperty = DependencyProperty.Register(
        nameof(ItemsSource),
        typeof(IEnumerable),
        typeof(ListView),
        new PropertyMetadata(null, OnItemsSourceChanged));

    public static readonly DependencyProperty SelectedItemProperty = DependencyProperty.Register(
        nameof(SelectedItem),
        typeof(object),
        typeof(ListView),
        new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.BindsTwoWayByDefault));

    public static readonly DependencyProperty SelectedIndexProperty = DependencyProperty.Register(
        nameof(SelectedIndex),
        typeof(int),
        typeof(ListView),
        new FrameworkPropertyMetadata(-1, FrameworkPropertyMetadataOptions.BindsTwoWayByDefault));

    /// <summary>
    ///     Attached property to indicate if the list has any items with icons (for consistent spacing)
    /// </summary>
    public static readonly DependencyProperty HasIconsProperty = DependencyProperty.RegisterAttached(
        "HasIcons",
        typeof(bool),
        typeof(ListView),
        new PropertyMetadata(false));

    private AnimatedScrollViewer? _scrollViewer;
    private DateTime _lastSelectionChangeTime = DateTime.MinValue;
    private readonly TimeSpan _selectionChangeThrottle = TimeSpan.FromMilliseconds(50);
    private readonly TimeSpan _scrollAnimationDuration = TimeSpan.FromMilliseconds(300);


    public ListView() {
        // Note: Base class RevitHostedUserControl loads WpfUiResources before this runs
        this.InitializeComponent();

        this.ItemListView.ItemTemplate = new DataTemplate {
            VisualTree = new FrameworkElementFactory(typeof(ListViewItem))
        };

        this.ItemListView.SelectionChanged += this.OnInternalSelectionChanged;

        // Attach at multiple levels to ensure we catch arrow key events
        this.PreviewKeyDown += this.OnPreviewKeyDown;
        this.ItemListView.PreviewKeyDown += this.OnPreviewKeyDown;

        this.Loaded += this.OnLoaded;
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e) {
        if (e.Key is not (Key.Up or Key.Down)) return;

        var hasKeyboardFocus = this.ItemListView.IsKeyboardFocusWithin;
        var itemCount = this.ItemListView.Items.Count;

        if (!hasKeyboardFocus || itemCount == 0) return;

        // Check throttle to avoid rapid animations
        var now = DateTime.Now;
        if (now - this._lastSelectionChangeTime < this._selectionChangeThrottle) return;

        this._lastSelectionChangeTime = now;

        // Don't handle the event - let WPF's default navigation work
        // We're just observing to sync our animation timing
    }

    private void OnLoaded(object sender, RoutedEventArgs e) {
        // Find the AnimatedScrollViewer in the template
        this._scrollViewer = FindScrollViewer(this.ItemListView);

        // Configure scroll animation timing to match keyboard navigation throttle
        if (this._scrollViewer != null) {
            this._scrollViewer.ScrollingTime = this._scrollAnimationDuration;
        }
    }

    private void OnInternalSelectionChanged(object sender, SelectionChangedEventArgs e) {
        if (e.AddedItems.Count == 0 || this._scrollViewer == null) return;

        var selectedItem = e.AddedItems[0];
        // Use dispatcher to ensure the container is generated and laid out
        _ = this.Dispatcher.BeginInvoke(() => this.AnimateScrollIntoView(selectedItem),
            System.Windows.Threading.DispatcherPriority.Loaded);
    }

    private void AnimateScrollIntoView(object item) {
        if (this._scrollViewer == null) {
            this.ItemListView?.ScrollIntoView(item);
            return;
        }

        var container = this.ContainerFromItem(item);
        if (container == null) {
            this.ItemListView?.ScrollIntoView(item);
            return;
        }

        container.UpdateLayout();

        var transform = container.TransformToAncestor(this._scrollViewer);
        var position = transform.Transform(new Point(0, 0));

        var itemTop = position.Y;
        var itemHeight = container.ActualHeight;
        var viewportHeight = this._scrollViewer.ViewportHeight;

        // Only scroll if item is outside the "comfort zone" (middle 60% of viewport)
        var comfortZoneMargin = viewportHeight * 0.2;
        var itemCenter = itemTop + (itemHeight / 2);
        var isInComfortZone = itemCenter >= comfortZoneMargin && itemCenter <= viewportHeight - comfortZoneMargin;

        if (isInComfortZone) return;

        // Center the item in the viewport
        var targetOffset = this._scrollViewer.VerticalOffset + itemTop - (viewportHeight / 2) + (itemHeight / 2);
        targetOffset = Math.Clamp(targetOffset, 0, this._scrollViewer.ScrollableHeight);

        // Only animate if we're moving a significant distance
        if (Math.Abs(this._scrollViewer.TargetVerticalOffset - targetOffset) > 1) {
            this._scrollViewer.TargetVerticalOffset = targetOffset;
        }
    }

    private static AnimatedScrollViewer? FindScrollViewer(DependencyObject parent) {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++) {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is AnimatedScrollViewer scrollViewer) return scrollViewer;
            var result = FindScrollViewer(child);
            if (result != null) return result;
        }
        return null;
    }

    public IEnumerable ItemsSource {
        get => (IEnumerable)this.GetValue(ItemsSourceProperty);
        set => this.SetValue(ItemsSourceProperty, value);
    }

    public object SelectedItem {
        get => this.GetValue(SelectedItemProperty);
        set => this.SetValue(SelectedItemProperty, value);
    }

    public int SelectedIndex {
        get => (int)this.GetValue(SelectedIndexProperty);
        set => this.SetValue(SelectedIndexProperty, value);
    }

    public static bool GetHasIcons(DependencyObject obj) => (bool)obj.GetValue(HasIconsProperty);
    public static void SetHasIcons(DependencyObject obj, bool value) => obj.SetValue(HasIconsProperty, value);

    private static void OnItemsSourceChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) {
        if (d is not ListView listView) return;

        // Check if any item has an icon
        if (e.NewValue is IEnumerable items) {
            var hasIcons = items.Cast<object>()
                .OfType<IPaletteListItem>()
                .Any(item => item.Icon != null);

            SetHasIcons(listView, hasIcons);
            // Also set on the inner ItemListView so items can find it
            SetHasIcons(listView.ItemListView, hasIcons);
        }
    }

    public WpfUiListViewItem? ContainerFromItem(object item) =>
        this.ItemListView.ItemContainerGenerator.ContainerFromItem(item) as WpfUiListViewItem;

    public event SelectionChangedEventHandler SelectionChanged;
    public event MouseButtonEventHandler ItemMouseLeftButtonUp;
    public event MouseButtonEventHandler ItemMouseRightButtonUp;
    public event MouseEventHandler ItemMouseMove;
    public event MouseEventHandler ItemMouseLeave;

    /// <summary>
    ///     Scrolls to bring the specified item into view.
    /// </summary>
    public void ScrollIntoView(object item) => this.AnimateScrollIntoView(item);

    private void ItemListView_SelectionChanged(object sender, SelectionChangedEventArgs e) =>
        this.SelectionChanged?.Invoke(this, e);

    private void ItemListView_MouseLeftButtonUp(object sender, MouseButtonEventArgs e) =>
        this.ItemMouseLeftButtonUp?.Invoke(this, e);

    private void ItemListView_MouseRightButtonUp(object sender, MouseButtonEventArgs e) =>
        this.ItemMouseRightButtonUp?.Invoke(this, e);

    private void ItemListView_MouseMove(object sender, MouseEventArgs e) =>
        this.ItemMouseMove?.Invoke(this, e);

    private void ItemListView_MouseLeave(object sender, MouseEventArgs e) =>
        this.ItemMouseLeave?.Invoke(this, e);
}