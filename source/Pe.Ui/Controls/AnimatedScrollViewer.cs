using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media.Animation;

namespace Pe.Ui.Controls;

/// <summary>
///     ScrollViewer with smooth animated scrolling. Based on Matthias Shapiro's implementation.
///     https://matthiasshapiro.com/how-to-create-an-animated-scrollviewer-or-listbox-in-wpf/
/// </summary>
public class AnimatedScrollViewer : ScrollViewer {
    public static readonly DependencyProperty ScrollingTimeProperty = DependencyProperty.Register(
        nameof(ScrollingTime),
        typeof(TimeSpan),
        typeof(AnimatedScrollViewer),
        new PropertyMetadata(TimeSpan.FromMilliseconds(300)));

    public static readonly DependencyProperty ScrollingSplineProperty = DependencyProperty.Register(
        nameof(ScrollingSpline),
        typeof(KeySpline),
        typeof(AnimatedScrollViewer),
        new PropertyMetadata(new KeySpline(0.25, 0.1, 0.25, 1))); // Ease-out cubic

    public static readonly DependencyProperty TargetVerticalOffsetProperty = DependencyProperty.Register(
        nameof(TargetVerticalOffset),
        typeof(double),
        typeof(AnimatedScrollViewer),
        new PropertyMetadata(0.0, OnTargetVerticalOffsetChanged));

    public static readonly DependencyProperty TargetHorizontalOffsetProperty = DependencyProperty.Register(
        nameof(TargetHorizontalOffset),
        typeof(double),
        typeof(AnimatedScrollViewer),
        new PropertyMetadata(0.0, OnTargetHorizontalOffsetChanged));

    public static readonly DependencyProperty VerticalScrollOffsetProperty = DependencyProperty.Register(
        nameof(VerticalScrollOffset),
        typeof(double),
        typeof(AnimatedScrollViewer),
        new PropertyMetadata(0.0, OnVerticalScrollOffsetChanged));

    public static readonly DependencyProperty HorizontalScrollOffsetProperty = DependencyProperty.Register(
        nameof(HorizontalScrollOffset),
        typeof(double),
        typeof(AnimatedScrollViewer),
        new PropertyMetadata(0.0, OnHorizontalScrollOffsetChanged));

    private ScrollBar? _verticalScrollBar;
    private ScrollBar? _horizontalScrollBar;

    static AnimatedScrollViewer() =>
        DefaultStyleKeyProperty.OverrideMetadata(
            typeof(AnimatedScrollViewer),
            new FrameworkPropertyMetadata(typeof(AnimatedScrollViewer)));

    public AnimatedScrollViewer() => this.PreviewMouseWheel += this.OnPreviewMouseWheel;

    public TimeSpan ScrollingTime {
        get => (TimeSpan)this.GetValue(ScrollingTimeProperty);
        set => this.SetValue(ScrollingTimeProperty, value);
    }

    public KeySpline ScrollingSpline {
        get => (KeySpline)this.GetValue(ScrollingSplineProperty);
        set => this.SetValue(ScrollingSplineProperty, value);
    }

    public double TargetVerticalOffset {
        get => (double)this.GetValue(TargetVerticalOffsetProperty);
        set => this.SetValue(TargetVerticalOffsetProperty, value);
    }

    public double TargetHorizontalOffset {
        get => (double)this.GetValue(TargetHorizontalOffsetProperty);
        set => this.SetValue(TargetHorizontalOffsetProperty, value);
    }

    public double VerticalScrollOffset {
        get => (double)this.GetValue(VerticalScrollOffsetProperty);
        set => this.SetValue(VerticalScrollOffsetProperty, value);
    }

    public double HorizontalScrollOffset {
        get => (double)this.GetValue(HorizontalScrollOffsetProperty);
        set => this.SetValue(HorizontalScrollOffsetProperty, value);
    }

    public override void OnApplyTemplate() {
        base.OnApplyTemplate();

        this._verticalScrollBar = this.GetTemplateChild("PART_VerticalScrollBar") as ScrollBar;
        if (this._verticalScrollBar != null) {
            this._verticalScrollBar.ValueChanged += this.OnVerticalScrollBarValueChanged;
        }

        this._horizontalScrollBar = this.GetTemplateChild("PART_HorizontalScrollBar") as ScrollBar;
        if (this._horizontalScrollBar != null) {
            this._horizontalScrollBar.ValueChanged += this.OnHorizontalScrollBarValueChanged;
        }
    }

    private static void OnTargetVerticalOffsetChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) {
        if (d is AnimatedScrollViewer viewer) {
            viewer.AnimateVerticalScroll((double)e.NewValue);
        }
    }

    private static void OnTargetHorizontalOffsetChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) {
        if (d is AnimatedScrollViewer viewer) {
            viewer.AnimateHorizontalScroll((double)e.NewValue);
        }
    }

    private static void OnVerticalScrollOffsetChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) {
        if (d is AnimatedScrollViewer viewer) {
            viewer.ScrollToVerticalOffset((double)e.NewValue);
        }
    }

    private static void OnHorizontalScrollOffsetChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) {
        if (d is AnimatedScrollViewer viewer) {
            viewer.ScrollToHorizontalOffset((double)e.NewValue);
        }
    }

    private void OnVerticalScrollBarValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e) => this.TargetVerticalOffset = e.NewValue;

    private void OnHorizontalScrollBarValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e) => this.TargetHorizontalOffset = e.NewValue;

    private void OnPreviewMouseWheel(object sender, MouseWheelEventArgs e) {
        var scrollAmount = e.Delta * SystemParameters.WheelScrollLines / 3.0;
        var newOffset = this.TargetVerticalOffset - scrollAmount;
        newOffset = Math.Max(0, Math.Min(this.ScrollableHeight, newOffset));
        
        this.TargetVerticalOffset = newOffset;
        e.Handled = true;
    }

    private void AnimateVerticalScroll(double targetOffset) {
        var animation = new DoubleAnimation(
            this.VerticalScrollOffset,
            targetOffset,
            new Duration(this.ScrollingTime)) {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
        };

        this.BeginAnimation(VerticalScrollOffsetProperty, animation);
    }

    private void AnimateHorizontalScroll(double targetOffset) {
        var animation = new DoubleAnimation(
            this.HorizontalScrollOffset,
            targetOffset,
            new Duration(this.ScrollingTime)) {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
        };

        this.BeginAnimation(HorizontalScrollOffsetProperty, animation);
    }

    protected override void OnInitialized(EventArgs e) {
        base.OnInitialized(e);
        this.TargetVerticalOffset = this.VerticalOffset;
        this.TargetHorizontalOffset = this.HorizontalOffset;
        this.VerticalScrollOffset = this.VerticalOffset;
        this.HorizontalScrollOffset = this.HorizontalOffset;
    }
}
