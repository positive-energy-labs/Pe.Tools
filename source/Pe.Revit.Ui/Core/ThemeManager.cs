using System.Windows;
using System.Windows.Media;

namespace Pe.Ui.Core;

/// <summary>
///     UI size constants for consistent spacing and sizing across components.
/// </summary>
public enum UiSz {
    none = 0,
    ss = 1,
    s = 2,
    m = 4,
    l = 6,
    ll = 9
}

/// <summary>
///     Font size constants for consistent typography across components.
///     These are base sizes before any zoom scaling is applied.
/// </summary>
public static class FontSize {
    /// <summary>Secondary text, help text, captions</summary>
    public const double Caption = 12;

    /// <summary>Standard body text</summary>
    public const double Body = 14;

    /// <summary>Emphasized text, semi-headers</summary>
    public const double Subtitle = 16;

    /// <summary>Window titles, section headers</summary>
    public const double Title = 20;

    /// <summary>Major section headers, hero text</summary>
    public const double TitleLarge = 24;
}

/// <summary>
///     Theme constants and resource loading for WPF.UI controls.
/// </summary>
public static class Theme {
    private static ResourceDictionary? _wpfUiResources;

    public static double IconOpacity { get; } = 0.8;
    public static CornerRadius Radius { get; } = new(6);
    public static double DisabledOpacity { get; } = 0.4;
    public static FontFamily FontFamily { get; } = new("Segoe UI Variable Text");

    /// <summary>
    ///     WPF.UI resources dictionary containing theme colors, brushes, and control styles.
    /// </summary>
    public static ResourceDictionary WpfUiResources =>
        _wpfUiResources ??= new ResourceDictionary {
            Source = new Uri("pack://application:,,,/Pe.Ui;component/Core/WpfUiResources.xaml",
                UriKind.Absolute)
        };

    /// <summary>
    ///     Loads WPF.UI resources into a FrameworkElement's resource dictionary.
    ///     This provides access to theme colors, brushes, and control styles.
    /// </summary>
    public static void LoadResources(FrameworkElement element) {
        if (element == null) return;
        element.Resources.MergedDictionaries.Add(WpfUiResources);
    }
}