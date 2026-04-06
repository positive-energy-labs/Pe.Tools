using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Effects;
using Wpf.Ui.Markup;

namespace Pe.Ui.Core;

/// <summary>
///     Fluent API builder for creating Border controls efficiently.
///     All properties are set once when Create() is called.
/// </summary>
/// <example>
///     Using WPF.UI theme resources (recommended):
///     <code>
/// var border = new BorderSpec()
///     .Background(ThemeResource.ApplicationBackgroundBrush)
///     .Border(UiSz.l, UiSz.ss, ThemeResource.ControlStrongStrokeColorDefaultBrush)
///     .Padding(UiSz.ll, UiSz.m)
///     .DropShadow()
///     .CreateAround(titleText);
/// </code>
///     Using custom brushes:
///     <code>
/// var border = new BorderSpec()
///     .Background(new SolidColorBrush(Colors.White))
///     .Border(6, 1, new SolidColorBrush(Colors.Gray))
///     .Width(400)
///     .Height(0, null, 300)
///     .CreateAround(content);
/// </code>
/// </example>
public class BorderSpec {
    private string _backgroundResourceKey = string.Empty;
    private string _borderBrushResourceKey = string.Empty;
    private Thickness _borderThickness = new(0);
    private CornerRadius _cornerRadius = new((double)UiSz.l);
    private DropShadowEffect _dropShadowEffect;
    private (double minHeight, double height, double maxHeight) _heights = (0.0, double.NaN, double.PositiveInfinity);
    private HorizontalAlignment _horizontalAlignment = HorizontalAlignment.Stretch;
    private Thickness _margin = new(0);
    private Thickness _padding = new(0);
    private VerticalAlignment _verticalAlignment = VerticalAlignment.Stretch;
    private (double minWidth, double width, double maxWidth) _widths = (0.0, double.NaN, double.PositiveInfinity);

    /// <summary>
    ///     Sets the border line properties using a WPF.UI theme resource for the line color.
    /// </summary>
    public BorderSpec Border(
        UiSz radius = UiSz.l,
        UiSz thickness = UiSz.none,
        ThemeResource lineColor = ThemeResource.Unknown
    ) {
        this._cornerRadius = new CornerRadius((double)radius);
        this._borderThickness = new Thickness((double)thickness);
        if (lineColor != ThemeResource.Unknown) this._borderBrushResourceKey = lineColor.ToString();

        return this;
    }

    /// <summary>
    ///     Sets the border line properties using a WPF.UI theme resource for the line color.
    /// </summary>
    public BorderSpec Border(
        (UiSz tl, UiSz tr, UiSz br, UiSz bl) radius,
        UiSz thickness = UiSz.none,
        ThemeResource lineColor = ThemeResource.Unknown
    ) {
        (double tl, double tr, double br, double bl) radii = (0, 0, 0, 0);
        if (radius.tl != UiSz.none) radii.tl = (double)radius.tl;
        if (radius.tr != UiSz.none) radii.tr = (double)radius.tr;
        if (radius.br != UiSz.none) radii.br = (double)radius.br;
        if (radius.bl != UiSz.none) radii.bl = (double)radius.bl;
        this._cornerRadius = new CornerRadius(radii.tl, radii.tr, radii.br, radii.bl);

        this._borderThickness = new Thickness((double)thickness);
        if (lineColor != ThemeResource.Unknown) this._borderBrushResourceKey = lineColor.ToString();

        return this;
    }

    /// <summary>
    ///     Sets the background color using a WPF.UI theme resource.
    /// </summary>
    public BorderSpec Background(ThemeResource bgFillColor) {
        this._backgroundResourceKey = bgFillColor.ToString();
        return this;
    }

    /// <summary>
    ///     Adds a drop shadow effect to the border.
    /// </summary>
    public BorderSpec DropShadow(
        UiSz shadowDepth = UiSz.s,
        UiSz blurRadius = UiSz.l,
        double opacity = 0.4,
        double direction = 270) {
        this._dropShadowEffect = new DropShadowEffect {
            Color = Colors.Black,
            Direction = direction,
            ShadowDepth = (double)shadowDepth,
            BlurRadius = (double)blurRadius,
            Opacity = opacity
        };
        return this;
    }

    /// <summary>
    ///     Sets padding inside the border.
    /// </summary>
    public BorderSpec Padding(UiSz uniform) {
        this._padding = new Thickness((double)uniform);
        return this;
    }

    /// <summary>
    ///     Sets padding with horizontal and vertical values.
    /// </summary>
    public BorderSpec Padding(UiSz horizontal, UiSz vertical) {
        this._padding = new Thickness((double)horizontal, (double)vertical, (double)horizontal, (double)vertical);
        return this;
    }

    /// <summary>
    ///     Sets padding with individual values for each side.
    /// </summary>
    public BorderSpec Padding(UiSz left, UiSz top, UiSz right, UiSz bottom) {
        this._padding = new Thickness((double)left, (double)top, (double)right, (double)bottom);
        return this;
    }

    /// <summary>
    ///     Sets padding with double values.
    /// </summary>
    public BorderSpec Padding(double left, double top, double right, double bottom) {
        this._padding = new Thickness(left, top, right, bottom);
        return this;
    }

    /// <summary>
    ///     Sets margin outside the border.
    /// </summary>
    public BorderSpec Margin(UiSz uniform) {
        this._margin = new Thickness((double)uniform);
        return this;
    }

    /// <summary>
    ///     Sets margin with individual values.
    /// </summary>
    public BorderSpec Margin(double left, double top, double right, double bottom) {
        this._margin = new Thickness(left, top, right, bottom);
        return this;
    }

    /// <summary>
    ///     Sets horizontal alignment.
    /// </summary>
    public BorderSpec HorizontalAlign(HorizontalAlignment alignment) {
        this._horizontalAlignment = alignment;
        return this;
    }

    /// <summary>
    ///     Sets vertical alignment.
    /// </summary>
    public BorderSpec VerticalAlign(VerticalAlignment alignment) {
        this._verticalAlignment = alignment;
        return this;
    }

    /// <summary>
    ///     Sets width of the border.
    /// </summary>
    /// <summary>
    ///     Sets width-related properties (min, exact, max). Use double.NaN for 'not set'.
    /// </summary>
    public BorderSpec Width(double minWidth, double width, double maxWidth) {
        this._widths = (minWidth, width, maxWidth);
        return this;
    }

    public BorderSpec Width(double width) {
        this._widths = (width, width, width);
        return this;
    }

    /// <summary>
    ///     Sets height of the border. Usually just setting MinHeight in enough
    /// </summary>
    public BorderSpec Height(double minHeight, double height, double maxHeight) {
        this._heights = (minHeight, height, maxHeight);
        return this;
    }

    public BorderSpec Height(double height) {
        this._heights = (height, height, height);
        return this;
    }

    /// <summary>
    ///     Creates the Border with all configured properties applied in one pass.
    /// </summary>
    public Border CreateAround(UIElement child = null) {
        var border = new Border {
            Child = child,
            CornerRadius = this._cornerRadius,
            BorderThickness = this._borderThickness,
            Padding = this._padding,
            Margin = this._margin,
            HorizontalAlignment = this._horizontalAlignment,
            VerticalAlignment = this._verticalAlignment,
            MinWidth = this._widths.minWidth,
            Width = this._widths.width,
            MaxWidth = this._widths.maxWidth,
            MinHeight = this._heights.minHeight,
            Height = this._heights.height,
            MaxHeight = this._heights.maxHeight,
            Effect = this._dropShadowEffect
        };

        // Apply brushes - use SetResourceReference for dynamic resources, direct assignment for static brushes
        if (this._borderBrushResourceKey != null) {
            border.SetResourceReference(System.Windows.Controls.Border.BorderBrushProperty,
                this._borderBrushResourceKey);
        }

        if (this._backgroundResourceKey != null)
            border.SetResourceReference(System.Windows.Controls.Border.BackgroundProperty, this._backgroundResourceKey);

        return border;
    }

    /// <summary>
    ///     Applies all configured properties to an existing Border.
    /// </summary>
    public void ApplyToBorder(Border border) {
        border.CornerRadius = this._cornerRadius;
        border.BorderThickness = this._borderThickness;
        border.Padding = this._padding;
        border.Margin = this._margin;
        border.HorizontalAlignment = this._horizontalAlignment;
        border.VerticalAlignment = this._verticalAlignment;
        border.MinWidth = this._widths.minWidth;
        border.Width = this._widths.width;
        border.MaxWidth = this._widths.maxWidth;
        border.MinHeight = this._heights.minHeight;
        border.Height = this._heights.height;
        border.MaxHeight = this._heights.maxHeight;
        border.Effect = this._dropShadowEffect;

        // Apply brushes - use SetResourceReference for dynamic resources
        if (!string.IsNullOrEmpty(this._borderBrushResourceKey)) {
            border.SetResourceReference(System.Windows.Controls.Border.BorderBrushProperty,
                this._borderBrushResourceKey);
        }

        if (!string.IsNullOrEmpty(this._backgroundResourceKey))
            border.SetResourceReference(System.Windows.Controls.Border.BackgroundProperty, this._backgroundResourceKey);
    }
}