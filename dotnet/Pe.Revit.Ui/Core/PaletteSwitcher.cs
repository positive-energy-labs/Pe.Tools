using Autodesk.Revit.UI;
using Wpf.Ui.Controls;

namespace Pe.Revit.Ui.Core;

/// <summary>
///     Coarse taxonomy for the palette switcher's two sections.
/// </summary>
public enum PaletteFamily {
    /// <summary> Drive/navigate Revit: Go, Do, MRU Views. </summary>
    Navigate,

    /// <summary> Content/data authoring: Elements, Schedule Manager, Family Foundry. </summary>
    Author
}

/// <summary>
///     One switcher destination — a palette the user can jump to. Lives in Pe.Revit.Ui so the
///     UI layer can render the switcher without referencing Pe.App; Pe.App supplies the actual
///     list through <see cref="PaletteSwitcher.Provider" /> at startup (keeps the
///     Pe.Revit.Ui -> Pe.App dependency direction clean).
/// </summary>
public sealed class PaletteSwitcherEntry {
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required SymbolRegular Icon { get; init; }
    public required PaletteFamily Family { get; init; }

    /// <summary> Whether this entry is offered for the given document. Default: always. </summary>
    public Func<UIDocument, bool> IsAvailable { get; init; } = _ => true;

    /// <summary> Opens the palette. Invoked in Revit API context by the switcher. </summary>
    public required Action<UIApplication> Launch { get; init; }
}

/// <summary>
///     Static provider slot for the palette switcher registry. Pe.App fills this at startup;
///     every palette then gets the switcher for free (wired in <see cref="Components.Palette" />).
/// </summary>
public static class PaletteSwitcher {
    public static Func<IReadOnlyList<PaletteSwitcherEntry>>? Provider { get; set; }
}
