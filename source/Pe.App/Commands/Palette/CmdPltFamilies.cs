using Autodesk.Revit.Attributes;
using Pe.App.Commands.Palette.FamilyPalette;

namespace Pe.App.Commands.Palette;

/// <summary>
///     Opens the family palette with the "Families" tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilies : FamilyPaletteBase {
    protected override int DefaultTabIndex => 0;
}

/// <summary>
///     Opens the family palette with the "Family Types" tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyTypes : FamilyPaletteBase {
    protected override int DefaultTabIndex => 1;
}

/// <summary>
///     Opens the family palette with the "Family Instances" tab selected.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyInstances : FamilyPaletteBase {
    protected override int DefaultTabIndex => 2;
}

