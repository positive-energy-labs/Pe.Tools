using Autodesk.Revit.Attributes;
using Pe.App.Commands.Palette.ViewPalette;

namespace Pe.App.Commands.Palette;

/// <summary>
///     Opens the view palette with the "All" tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]

public class CmdPltViews : ViewPaletteBase {
    protected override int DefaultTabIndex => 0;
}

/// <summary>
///     Opens the view palette with the "Views" tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltViewsOnly : ViewPaletteBase {
    protected override int DefaultTabIndex => 1;
}

/// <summary>
///     Opens the view palette with the "Schedules" tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltSchedules : ViewPaletteBase {
    protected override int DefaultTabIndex => 2;
}


/// <summary>
///     Opens the view palette with the "Sheets" tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltSheets : ViewPaletteBase {
    protected override int DefaultTabIndex => 3;
}