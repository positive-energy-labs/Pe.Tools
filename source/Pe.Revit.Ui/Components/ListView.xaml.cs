using System.Collections;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using WpfUiListViewItem = Wpf.Ui.Controls.ListViewItem;


namespace Pe.Revit.Ui.Components;

public partial class ListView {
    public static readonly DependencyProperty ItemsSourceProperty = DependencyProperty.Register(
        nameof(ItemsSource),
        typeof(IEnumerable),
        typeof(ListView),
        new PropertyMetadata(null));

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

    public ListView() {
        // Note: Base class RevitHostedUserControl loads WpfUiResources before this runs
        this.InitializeComponent();

        this.ItemListView.ItemTemplate = new DataTemplate {
            VisualTree = new FrameworkElementFactory(typeof(ListViewItem))
        };

        this.ItemListView.SelectionChanged += this.OnInternalSelectionChanged;
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

    private void OnInternalSelectionChanged(object sender, SelectionChangedEventArgs e) {
        if (e.AddedItems.Count == 0) return;
        var item = e.AddedItems[0];
        _ = this.Dispatcher.BeginInvoke(() => {
            if (ReferenceEquals(this.ItemListView.SelectedItem, item))
                this.ItemListView.ScrollIntoView(item);
        }, DispatcherPriority.Loaded);
    }

    public WpfUiListViewItem? ContainerFromItem(object item) =>
        this.ItemListView.ItemContainerGenerator.ContainerFromItem(item) as WpfUiListViewItem;

    public event SelectionChangedEventHandler? SelectionChanged;
    public event MouseButtonEventHandler? ItemMouseLeftButtonUp;
    public event MouseButtonEventHandler? ItemMouseRightButtonUp;
    public event MouseEventHandler? ItemMouseMove;
    public event MouseEventHandler? ItemMouseLeave;

    /// <summary>
    ///     Scrolls to bring the specified item into view.
    /// </summary>
    public void ScrollIntoView(object item) => this.ItemListView.ScrollIntoView(item);

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