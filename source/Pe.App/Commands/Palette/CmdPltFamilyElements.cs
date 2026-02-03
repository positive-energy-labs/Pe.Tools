using Autodesk.Revit.Attributes;
using Pe.App.Commands.Palette.FamilyPalette;

namespace Pe.App.Commands.Palette;

/// <summary>
///     Shows all family elements (parameters, dimensions, etc.) in a family document.
///     Opens on the "All" tab by default.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyElements : FamilyElementsPaletteBase {
    protected override int DefaultTabIndex => 0; // All tab
}

/// <summary>
///     Shows family elements palette with Families tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyElementsFamilies : FamilyElementsPaletteBase {
    protected override int DefaultTabIndex => 1; // Families tab
}

/// <summary>
///     Shows family elements palette with Parameters tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyElementsParams : FamilyElementsPaletteBase {
    protected override int DefaultTabIndex => 2; // Params tab
}

/// <summary>
///     Shows family elements palette with Dimensions tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyElementsDims : FamilyElementsPaletteBase {
    protected override int DefaultTabIndex => 3; // Dims tab
}

/// <summary>
///     Shows family elements palette with Reference Planes tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyElementsRefPlanes : FamilyElementsPaletteBase {
    protected override int DefaultTabIndex => 4; // Ref Planes tab
}

/// <summary>
///     Shows family elements palette with Connectors tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyElementsConnectors : FamilyElementsPaletteBase {
    protected override int DefaultTabIndex => 5; // Connectors tab
}