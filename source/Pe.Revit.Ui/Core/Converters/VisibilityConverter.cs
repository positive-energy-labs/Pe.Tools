using System.Globalization;
using System.Windows.Data;
using System.Windows.Media.Imaging;
using Visibility = System.Windows.Visibility;

namespace Pe.Ui.Core.Converters;

/// <summary> Coerce value to a display state </summary>
public class VisibilityConverter : IValueConverter {
    public static readonly VisibilityConverter Instance = new();

    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
        value switch {
            bool boolValue => boolValue
                ? Visibility.Visible
                : Visibility.Collapsed,
            int intValue => intValue > 0
                ? Visibility.Visible
                : Visibility.Collapsed,
            string stringValue => !string.IsNullOrWhiteSpace(stringValue)
                ? Visibility.Visible
                : Visibility.Collapsed,
            BitmapImage img => img != null
                ? Visibility.Visible
                : Visibility.Collapsed,
            _ => Visibility.Collapsed
        };

    public object ConvertBack(object _, Type __, object ___, CultureInfo ____) =>
        throw new NotImplementedException();
}