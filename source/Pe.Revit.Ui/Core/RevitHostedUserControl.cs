using System.Windows.Controls;

namespace Pe.Ui.Core;

/// <summary>
///     Base class for all UserControls in the Revit-hosted WPF environment.
///     Loads WPF.UI theme resources (colors, brushes, control styles).
/// </summary>
public class RevitHostedUserControl : UserControl {
    public RevitHostedUserControl() => Theme.LoadResources(this);
}