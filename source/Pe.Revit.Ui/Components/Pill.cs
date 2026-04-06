using Pe.Ui.Core;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using Binding = System.Windows.Data.Binding;
using TextBlock = System.Windows.Controls.TextBlock;
using FontWeight = System.Windows.FontWeight;

namespace Pe.Ui.Components;

/// <summary>
///     Reusable pill component for displaying badges/labels.
/// </summary>
public class Pill : Border {
    public static readonly DependencyProperty TextProperty =
        DependencyProperty.Register(nameof(Text), typeof(string), typeof(Pill),
            new PropertyMetadata(string.Empty, OnTextChanged));

    public static readonly DependencyProperty FontWeightProperty =
        DependencyProperty.Register(nameof(FontWeight), typeof(FontWeight), typeof(Pill),
            new PropertyMetadata(FontWeights.Medium, OnFontWeightChanged));

    private readonly TextBlock _textBlock;

    public Pill() {
        this.VerticalAlignment = VerticalAlignment.Center;
        this.HorizontalAlignment = HorizontalAlignment.Right;
        this.BorderThickness = new Thickness((double)UiSz.ss);
        this.CornerRadius = new CornerRadius((double)UiSz.m);
        this.Padding = new Thickness((double)UiSz.m, 0, (double)UiSz.m, (double)UiSz.ss);

        // Create the TextBlock child
        this._textBlock = new TextBlock {
            VerticalAlignment = VerticalAlignment.Center, FontSize = 10, FontFamily = Theme.FontFamily
        };

        // Set up theme resource for foreground
        this._textBlock.SetResourceReference(TextBlock.ForegroundProperty, "TextFillColorSecondaryBrush");

        // Set up binding for Text property
        _ = this._textBlock.SetBinding(TextBlock.TextProperty,
            new Binding(nameof(this.Text)) { Source = this, Mode = BindingMode.OneWay });

        // Set up binding for FontWeight property
        _ = this._textBlock.SetBinding(TextBlock.FontWeightProperty,
            new Binding(nameof(this.FontWeight)) { Source = this, Mode = BindingMode.OneWay });

        // Set the TextBlock as the child
        this.Child = this._textBlock;
    }

    public string Text {
        get => (string)this.GetValue(TextProperty);
        set => this.SetValue(TextProperty, value);
    }

    public FontWeight FontWeight {
        get => (FontWeight)this.GetValue(FontWeightProperty);
        set => this.SetValue(FontWeightProperty, value);
    }

    private static void OnTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) {
        // Property change is handled by binding
    }

    private static void OnFontWeightChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) {
        // Property change is handled by binding
    }
}