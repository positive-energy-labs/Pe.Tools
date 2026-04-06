using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Ui.Core.Converters;

/// <summary>
///     Converts a nullable WPF Color to a SolidColorBrush for UI binding
/// </summary>
public class ColorToBrushConverter : IValueConverter {
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) {
        if (value is WpfColor color)
            return new SolidColorBrush(color);

        return null;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
        throw new NotImplementedException();
}