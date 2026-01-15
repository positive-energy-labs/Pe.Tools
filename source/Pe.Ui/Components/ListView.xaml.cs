using Pe.Ui.Core;
using System.Collections;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
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

    public ListView() {
        // Note: Base class RevitHostedUserControl loads WpfUiResources before this runs
        this.InitializeComponent();

        this.ItemListView.ItemTemplate = new DataTemplate {
            VisualTree = new FrameworkElementFactory(typeof(ListViewItem))
        };
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

    public WpfUiListViewItem ContainerFromItem(object item) =>
        this.ItemListView.ItemContainerGenerator.ContainerFromItem(item) as WpfUiListViewItem;

    public event SelectionChangedEventHandler SelectionChanged;
    public event MouseButtonEventHandler ItemMouseLeftButtonUp;
    public event MouseButtonEventHandler ItemMouseRightButtonUp;
    public event MouseEventHandler ItemMouseMove;
    public event MouseEventHandler ItemMouseLeave;

    public void ScrollIntoView(object item) => this.ItemListView?.ScrollIntoView(item);

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