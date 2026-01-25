using Pe.App.Commands.Palette.ViewPalette;

namespace Pe.App.Commands.Palette;

/// <summary>
///     Opens the view palette with the "All" tab selected.
/// </summary>
public class CmdPltViews : ViewPaletteBase {
    protected override int DefaultTabIndex => 0;
}

/// <summary>
///     Opens the view palette with the "Views" tab selected.
/// </summary>
public class CmdPltViewsOnly : ViewPaletteBase {
    protected override int DefaultTabIndex => 1;
}

/// <summary>
///     Opens the view palette with the "Schedules" tab selected.
/// </summary>
public class CmdPltSchedules : ViewPaletteBase {
    protected override int DefaultTabIndex => 2;
}


/// <summary>
///     Opens the view palette with the "Sheets" tab selected.
/// </summary>
public class CmdPltSheets : ViewPaletteBase {
    protected override int DefaultTabIndex => 3;
}