using System.Globalization;
using System.Windows.Data;
using Visibility = System.Windows.Visibility;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Ui.Core.Converters;

/// <summary>
///     Converts a nullable WPF Color to Visibility (Visible if color has value, Collapsed if null)
/// </summary>
public class NullableColorToVisibilityConverter : IValueConverter {
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) {
        if (value is WpfColor)
            return Visibility.Visible;

        return Visibility.Collapsed;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
        throw new NotImplementedException();
}