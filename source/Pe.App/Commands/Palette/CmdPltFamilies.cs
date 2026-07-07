using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.FamilyPalette;
using Pe.App.Commands.Palette.ViewPalette;

namespace Pe.App.Commands.Palette;

/// <summary>
///     Opens the Go palette on its "Families" tab.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilies : ViewPaletteBase {
    protected override int DefaultTabIndex => 4;
}

/// <summary>
///     Opens the Go palette on its "Place" tab (family types).
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyTypes : ViewPaletteBase {
    protected override int DefaultTabIndex => 5;
}

/// <summary>
///     Opens the Elements palette: placed family instances in a project document,
///     family elements in a family document.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyInstances : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) => ElementsPalette.Show(commandData.Application);
}
