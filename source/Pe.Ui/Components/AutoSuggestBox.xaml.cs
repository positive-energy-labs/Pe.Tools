using Pe.Ui.Core;
using System.Collections;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using Visibility = System.Windows.Visibility;

namespace Pe.Ui.Components;

/// <summary>
///     Converter for string to visibility (empty/null = Collapsed)
/// </summary>
public class StringToVisibilityConverter : IValueConverter {
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        string.IsNullOrEmpty(value as string) ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotImplementedException();
}

/// <summary>
///     Internal helper for AutoSuggestBox items
/// </summary>
public class AutoSuggestBoxItem {
    public string PrimaryText { get; set; } = string.Empty;
    public string SecondaryText { get; set; } = string.Empty;
    public object? Value { get; set; }
}

public partial class AutoSuggestBox : RevitHostedUserControl {
    public AutoSuggestBox() {
        // Initialize FilteredItems before InitializeComponent so binding works
        this.FilteredItems = new ObservableCollection<AutoSuggestBoxItem>();

        // Note: Base class RevitHostedUserControl loads WpfUiResources before this runs
        this.InitializeComponent();

        // Event handlers
        this.PART_SuggestionsList.PreviewMouseLeftButtonUp += this.OnSuggestionListMouseUp;
        this.PART_TextBox.TextChanged += this.OnTextBoxTextChanged;
        this.PART_TextBox.GotFocus += this.OnTextBoxGotFocus;
        this.PART_TextBox.LostFocus += this.OnTextBoxLostFocus;
        this.Loaded += (s, e) => {
            this.PART_TextBox.Text = string.Empty;
            if (this.AlwaysShowSuggestions) this.UpdateFilteredItems();
        };
    }

    #region Dependency Properties

    public static readonly DependencyProperty TextProperty = DependencyProperty.Register(
        nameof(Text), typeof(string), typeof(AutoSuggestBox),
        new FrameworkPropertyMetadata(string.Empty, FrameworkPropertyMetadataOptions.BindsTwoWayByDefault,
            OnTextChanged));

    public string Text {
        get => (string)this.GetValue(TextProperty);
        set => this.SetValue(TextProperty, value);
    }

    public static readonly DependencyProperty PlaceholderTextProperty = DependencyProperty.Register(
        nameof(PlaceholderText), typeof(string), typeof(AutoSuggestBox), new PropertyMetadata(string.Empty));

    public string PlaceholderText {
        get => (string)this.GetValue(PlaceholderTextProperty);
        set => this.SetValue(PlaceholderTextProperty, value);
    }

    public static readonly DependencyProperty ItemsSourceProperty = DependencyProperty.Register(
        nameof(ItemsSource), typeof(IEnumerable), typeof(AutoSuggestBox),
        new PropertyMetadata(null, OnItemsSourceChanged));

    public IEnumerable? ItemsSource {
        get => (IEnumerable?)this.GetValue(ItemsSourceProperty);
        set => this.SetValue(ItemsSourceProperty, value);
    }

    public static readonly DependencyProperty DisplayMemberPathProperty = DependencyProperty.Register(
        nameof(DisplayMemberPath), typeof(string), typeof(AutoSuggestBox), new PropertyMetadata(string.Empty));

    public string DisplayMemberPath {
        get => (string)this.GetValue(DisplayMemberPathProperty);
        set => this.SetValue(DisplayMemberPathProperty, value);
    }

    public static readonly DependencyProperty SubtextMemberPathProperty = DependencyProperty.Register(
        nameof(SubtextMemberPath), typeof(string), typeof(AutoSuggestBox), new PropertyMetadata(string.Empty));

    public string SubtextMemberPath {
        get => (string)this.GetValue(SubtextMemberPathProperty);
        set => this.SetValue(SubtextMemberPathProperty, value);
    }

    public static readonly DependencyProperty SelectedItemProperty = DependencyProperty.Register(
        nameof(SelectedItem), typeof(object), typeof(AutoSuggestBox),
        new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.BindsTwoWayByDefault));

    public object? SelectedItem {
        get => this.GetValue(SelectedItemProperty);
        set => this.SetValue(SelectedItemProperty, value);
    }

    public static readonly DependencyProperty IsSuggestionListOpenProperty = DependencyProperty.Register(
        nameof(IsSuggestionListOpen), typeof(bool), typeof(AutoSuggestBox), new PropertyMetadata(false));

    public bool IsSuggestionListOpen {
        get => (bool)this.GetValue(IsSuggestionListOpenProperty);
        set => this.SetValue(IsSuggestionListOpenProperty, value);
    }

    public static readonly DependencyProperty MaxSuggestionListHeightProperty = DependencyProperty.Register(
        nameof(MaxSuggestionListHeight), typeof(double), typeof(AutoSuggestBox), new PropertyMetadata(250.0));

    public double MaxSuggestionListHeight {
        get => (double)this.GetValue(MaxSuggestionListHeightProperty);
        set => this.SetValue(MaxSuggestionListHeightProperty, value);
    }

    public static readonly DependencyProperty AlwaysShowSuggestionsProperty = DependencyProperty.Register(
        nameof(AlwaysShowSuggestions), typeof(bool), typeof(AutoSuggestBox), new PropertyMetadata(true));

    public bool AlwaysShowSuggestions {
        get => (bool)this.GetValue(AlwaysShowSuggestionsProperty);
        set => this.SetValue(AlwaysShowSuggestionsProperty, value);
    }

    public static readonly DependencyProperty TextBoxStyleProperty = DependencyProperty.Register(
        nameof(TextBoxStyle), typeof(Style), typeof(AutoSuggestBox), new PropertyMetadata(null));

    public Style? TextBoxStyle {
        get => (Style?)this.GetValue(TextBoxStyleProperty);
        set => this.SetValue(TextBoxStyleProperty, value);
    }

    #endregion

    #region Internal Properties

    public static readonly DependencyProperty FilteredItemsProperty = DependencyProperty.Register(
        nameof(FilteredItems), typeof(ObservableCollection<AutoSuggestBoxItem>), typeof(AutoSuggestBox),
        new PropertyMetadata(null));

    public ObservableCollection<AutoSuggestBoxItem> FilteredItems {
        get => (ObservableCollection<AutoSuggestBoxItem>)this.GetValue(FilteredItemsProperty);
        private set => this.SetValue(FilteredItemsProperty, value);
    }

    #endregion

    #region Events

    public event SelectionChangedEventHandler? SelectionChanged;
    public event EventHandler? TextChanged;

    #endregion

    #region Logic

    public new void Focus() => this.PART_TextBox.Focus();

    private static void OnTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) {
        if (d is not AutoSuggestBox box) return;
        box.SyncTextBoxFromProperty();
        box.TextChanged?.Invoke(box, EventArgs.Empty);
    }

    private void SyncTextBoxFromProperty() {
        if (this.PART_TextBox.Text == this.Text) return;

        // Update TextBox without triggering TextChanged handler
        this.PART_TextBox.TextChanged -= this.OnTextBoxTextChanged;
        this.PART_TextBox.Text = this.Text ?? string.Empty;
        this.PART_TextBox.TextChanged += this.OnTextBoxTextChanged;
    }

    private void OnTextBoxTextChanged(object sender, TextChangedEventArgs e) {
        this.Text = this.PART_TextBox.Text;
        this.UpdateFilteredItems();
    }

    private void OnTextBoxGotFocus(object sender, RoutedEventArgs e) {
        // Show suggestions when focused if AlwaysShowSuggestions is true
        if (this.AlwaysShowSuggestions && this.FilteredItems.Count > 0) this.IsSuggestionListOpen = true;
    }

    private void OnTextBoxLostFocus(object sender, RoutedEventArgs e) =>
        this.IsSuggestionListOpen = false;

    private static void OnItemsSourceChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) {
        if (d is AutoSuggestBox box) box.UpdateFilteredItems();
    }

    private void UpdateFilteredItems() {
        if (this.ItemsSource == null) {
            this.FilteredItems.Clear();
            this.IsSuggestionListOpen = false;
            return;
        }

        var searchText = this.Text?.Trim() ?? string.Empty;
        var items = new List<AutoSuggestBoxItem>();

        foreach (var item in this.ItemsSource) {
            var primaryText = this.GetPropertyValue(item, this.DisplayMemberPath) ?? item.ToString() ?? string.Empty;
            var secondaryText = this.GetPropertyValue(item, this.SubtextMemberPath) ?? string.Empty;

            if (string.IsNullOrEmpty(searchText) || this.IsMatch(searchText, primaryText)) {
                items.Add(new AutoSuggestBoxItem {
                    PrimaryText = primaryText, SecondaryText = secondaryText, Value = item
                });
            }
        }

        this.FilteredItems.Clear();
        foreach (var item in items) this.FilteredItems.Add(item);

        // Determine if suggestions should be shown
        var shouldOpen = this.AlwaysShowSuggestions
            ? this.FilteredItems.Count > 0 && this.PART_TextBox.IsFocused
            : this.FilteredItems.Count > 0 && !string.IsNullOrEmpty(searchText) && this.PART_TextBox.IsFocused;

        this.IsSuggestionListOpen = shouldOpen;
    }

    private bool IsMatch(string search, string text) {
        if (string.IsNullOrEmpty(search)) return true;
        if (string.IsNullOrEmpty(text)) return false;

        // Case insensitive comparison
        if (text.IndexOf(search, StringComparison.OrdinalIgnoreCase) >= 0) return true;

        // Acronym matching
        return this.IsAcronymMatch(search, text);
    }

    private bool IsAcronymMatch(string search, string text) {
        if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(search)) return false;

        // Strategy 1: Capital letters (e.g. "ABC" -> "Awesome Building Component")
        var capitals = new string(text.Where(char.IsUpper).ToArray());
        if (capitals.IndexOf(search, StringComparison.OrdinalIgnoreCase) >= 0) return true;

        // Strategy 2: First letters of words (e.g. "abc" -> "awesome building component")
        var words = text.Split(new[] { ' ', '-', '_', '.' }, StringSplitOptions.RemoveEmptyEntries);
        if (words.Length <= 1) return false; // Single word logic covered by Contains

        var firstLetters = new string(words.Select(w => w.FirstOrDefault()).Where(c => c != '\0').ToArray());
        if (firstLetters.IndexOf(search, StringComparison.OrdinalIgnoreCase) >= 0) return true;

        return false;
    }

    private string? GetPropertyValue(object item, string path) {
        if (string.IsNullOrEmpty(path)) return null;
        var prop = item.GetType().GetProperty(path);
        return prop?.GetValue(item)?.ToString();
    }

    #endregion

    #region Input Handling

    protected override void OnPreviewKeyDown(KeyEventArgs e) {
        if (e.Key == Key.Down) {
            this.NavigateSelection(1);
            e.Handled = true;
        } else if (e.Key == Key.Up) {
            this.NavigateSelection(-1);
            e.Handled = true;
        } else if (e.Key == Key.Enter) {
            this.CommitSelection();
            e.Handled = false;
        } else if (e.Key is Key.Escape or Key.Tab) {
            if (this.IsSuggestionListOpen)
                this.IsSuggestionListOpen = false;
        }

        base.OnPreviewKeyDown(e);
    }

    private void NavigateSelection(int direction) {
        if (!this.IsSuggestionListOpen && this.FilteredItems.Count > 0) this.IsSuggestionListOpen = true;

        if (this.FilteredItems.Count == 0) return;

        var index = this.PART_SuggestionsList.SelectedIndex;

        // Handle initial navigation from text box
        if (index == -1 && direction > 0) index = 0;
        else if (index == -1 && direction < 0) index = this.FilteredItems.Count - 1;
        else index += direction;

        // Clamp index
        if (index < 0) index = 0;
        if (index >= this.FilteredItems.Count) index = this.FilteredItems.Count - 1;

        this.PART_SuggestionsList.SelectedIndex = index;
        this.PART_SuggestionsList.ScrollIntoView(this.PART_SuggestionsList.SelectedItem);
    }

    private void CommitSelection() {
        var selected = this.PART_SuggestionsList.SelectedItem as AutoSuggestBoxItem;
        // If no specific item selected but there's only one match, select it
        if (selected == null && this.FilteredItems.Count == 1) selected = this.FilteredItems[0];

        if (selected == null) return;

        this.SelectedItem = selected.Value;
        this.Text = selected.PrimaryText;
        this.PART_TextBox.CaretIndex = this.PART_TextBox.Text.Length;

        this.IsSuggestionListOpen = false;
        this.SelectionChanged?.Invoke(this, new SelectionChangedEventArgs(
            Selector.SelectionChangedEvent,
            new List<object>(),
            new List<object?> { selected.Value }));
    }

    private void OnSuggestionListMouseUp(object sender, MouseButtonEventArgs e) {
        // Find the clicked item
        var dependencyObject = (DependencyObject)e.OriginalSource;
        while (dependencyObject is not null and not ListViewItem)
            dependencyObject = VisualTreeHelper.GetParent(dependencyObject);

        if (dependencyObject is ListViewItem item && item.DataContext is AutoSuggestBoxItem suggestItem) {
            this.PART_SuggestionsList.SelectedItem = suggestItem;
            this.CommitSelection();
        }
    }

    #endregion
}